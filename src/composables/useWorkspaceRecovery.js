import { onScopeDispose, ref, shallowRef, watch } from 'vue'

import { packDraft, unpackDraft } from '../services/recovery/draftFile'
import { createDraftStore } from '../services/recovery/draftStore'
import { liveTabIds, pageTabId, reloadedTabId } from '../services/recovery/tabSession'
import { notify } from '../utils/notify'

/** How long the workspace must go without a change before its draft is written. */
export const RECOVERY_IDLE_MS = 5000
/** The longest a change waits for its draft while changes keep coming. */
export const RECOVERY_MAX_WAIT_MS = 60000
/** How old a closed tab's draft may grow before it is thrown away. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Keeps a recovery draft of the workspace's unsaved work, one per tab, and offers back the drafts of tabs that closed
 * without saving.
 *
 * The draft is written once the workspace has gone RECOVERY_IDLE_MS without a change, and deleted once the workspace
 * has no unsaved changes again: saved, loaded, cleared, or undone back to its save. While turned off, no draft is
 * written and this tab's is deleted, but the drafts other tabs left are still offered.
 *
 * A tab that reloads takes back the draft it left without asking, when autoRestore allows and its workspace is still
 * empty; the other drafts are offered as usual.
 *
 * @param {Object} options
 * @param {import('vue').Ref<boolean>} options.hasUnsavedChanges - Whether there is unsaved work to keep.
 * @param {() => boolean} [options.enabled] - Whether drafts are kept, the user's setting.
 * @param {() => *} options.changeSignal - Changes with every edit, so each one restarts the wait.
 * @param {() => boolean} options.isEmpty - Whether the workspace is empty, when the drafts on offer are looked up.
 * @param {() => Object} options.buildState - The workspace, as a save writes it.
 * @param {() => { name?: string|null, nodeCount?: number }} [options.describe] - What the draft is, for its listing.
 * @param {(state: Object, draft: Object) => Promise<void>} options.applyState - Puts a draft's workspace in place.
 * @param {() => boolean} [options.autoRestore] - Whether a reload takes back its draft without asking.
 * @param {Object} [options.store] - Where drafts are kept (createDraftStore's interface).
 * @param {string} [options.tabId] - This tab's id.
 * @param {string|null} [options.reloadedFrom] - The id the tab had before it reloaded, if it did.
 * @param {LockManager} [options.locks] - For telling which tabs are open.
 * @param {() => number} [options.now]
 * @param {EventTarget} [options.target=document] - Fires visibilitychange; its window fires pagehide.
 * @returns {{
 *   drafts: import('vue').Ref<Array<{ id: string, savedAt: number, name: string|null, nodeCount: number }>>,
 *   restoring: import('vue').Ref<string|null>,
 *   restore: (id: string) => Promise<boolean>,
 *   discard: (id: string) => Promise<(() => Promise<void>)|null>,
 *   refresh: () => Promise<void>,
 *   flush: () => Promise<void>,
 * }}
 */
export function useWorkspaceRecovery({
  hasUnsavedChanges,
  enabled = () => true,
  changeSignal,
  isEmpty,
  buildState,
  describe = () => ({}),
  applyState,
  autoRestore = () => true,
  store = createDraftStore(),
  tabId = pageTabId(),
  reloadedFrom = reloadedTabId(),
  locks = globalThis.navigator?.locks,
  now = () => Date.now(),
  target = globalThis.document,
}) {
  const drafts = ref([])
  const restoring = shallowRef(null)

  let idleTimer = null
  let firstPendingAt = null
  // Bumped whenever the draft is let go, so a write already under way does not bring it back.
  let epoch = 0
  // Writes and deletes run one after another, so an older write never lands after a newer one.
  let queue = Promise.resolve()
  let warned = false
  // The draft this tab left before it reloaded, until the first look at the drafts has had the chance to take it back.
  let reclaim = reloadedFrom

  /** Whether there is unsaved work, and drafts of it are wanted. */
  const keeping = () => hasUnsavedChanges.value && enabled()

  const enqueue = (task) => {
    queue = queue.then(task).catch((error) => console.warn('Recovery draft unavailable:', error))
    return queue
  }

  /**
   * Writes the draft, telling the user once when it cannot be kept.
   *
   * @param {Object} [state] - The workspace, when it had to be taken before the write's turn came.
   * @returns {Promise<boolean>} Whether a draft was written.
   */
  async function writeDraft(state) {
    if (!keeping()) return false
    const started = epoch
    try {
      const data = await packDraft(state ?? buildState())
      if (started !== epoch || !keeping()) return false
      await store.put({ id: tabId, savedAt: now(), name: null, nodeCount: 0, ...describe(), data })
      return true
    } catch (error) {
      console.warn('Recovery draft not written:', error)
      if (warned) return false
      warned = true
      notify.warning({
        title: 'Unsaved work is not being kept',
        message:
          'This browser would not store a recovery copy, so save your work to keep it. Recovery can be turned off in ' +
          'Settings.',
      })
      return false
    }
  }

  function stopWaiting() {
    clearTimeout(idleTimer)
    idleTimer = null
    firstPendingAt = null
  }

  function schedule() {
    clearTimeout(idleTimer)
    firstPendingAt ??= now()
    const wait = Math.max(0, Math.min(RECOVERY_IDLE_MS, firstPendingAt + RECOVERY_MAX_WAIT_MS - now()))
    idleTimer = setTimeout(() => {
      stopWaiting()
      enqueue(() => writeDraft())
    }, wait)
  }

  function letGo() {
    stopWaiting()
    epoch++
    enqueue(() => store.delete(tabId))
  }

  /** Writes a draft still waiting on its timer now. */
  function flush() {
    if (idleTimer === null) return queue
    stopWaiting()
    return enqueue(() => writeDraft())
  }

  /** Looks up the drafts on offer: those of tabs no longer open, newest first. Throws out the ones grown too old. */
  async function refresh() {
    try {
      const [all, live] = await Promise.all([store.list(), liveTabIds(locks)])
      const closed = all.filter((draft) => draft.id !== tabId && !live?.has(draft.id))
      const cutoff = now() - DRAFT_MAX_AGE_MS
      await Promise.all(closed.filter((draft) => draft.savedAt < cutoff).map((draft) => store.delete(draft.id)))
      const offered = closed
        .filter((draft) => draft.savedAt >= cutoff)
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(({ id, savedAt, name, nodeCount }) => ({ id, savedAt, name: name ?? null, nodeCount: nodeCount ?? 0 }))
      const claim = reclaim
      reclaim = null
      if (claim && autoRestore() && isEmpty() && offered.some((draft) => draft.id === claim)) {
        // Not offered while it is taken back, so the panel does not flash up for it.
        drafts.value = offered.filter((draft) => draft.id !== claim)
        await takeBack(claim)
        return
      }
      drafts.value = offered
    } catch (error) {
      console.warn('Recovery drafts unavailable:', error)
      drafts.value = []
    }
  }

  /** Restores the draft this tab left before it reloaded, offering it as usual if that fails. applyState says so. */
  async function takeBack(id) {
    try {
      await restore(id)
    } catch (error) {
      console.warn('Recovery draft not restored after reload:', error)
      notify.error({ title: 'Failed to restore unsaved work', message: `${error.message} It is still offered.` })
      await refresh()
    }
  }

  /**
   * Puts a draft's workspace in place, keeps it as this tab's draft, then lets the old one go, unless this tab's could
   * not be written. With drafts turned off, the old one goes at once. A failure leaves the draft where it was and is
   * thrown.
   *
   * @returns {Promise<boolean>} False when the draft had already gone, as when another tab restored it.
   */
  async function restore(id) {
    if (restoring.value) return false
    restoring.value = id
    try {
      const draft = await store.get(id)
      if (!draft) {
        await refresh()
        return false
      }
      await applyState(await unpackDraft(draft.data), draft)
      stopWaiting()
      if (!enabled() || (await enqueue(() => writeDraft()))) await store.delete(id)
      await refresh()
      return true
    } finally {
      restoring.value = null
    }
  }

  /**
   * Deletes a draft.
   *
   * @returns {Promise<(() => Promise<void>)|null>} Puts the draft back, as it was; null when it had already gone.
   */
  async function discard(id) {
    let draft = null
    try {
      draft = await store.get(id)
      await store.delete(id)
    } finally {
      await refresh()
    }
    if (!draft) return null
    return async () => {
      try {
        await store.put(draft)
      } finally {
        await refresh()
      }
    }
  }

  const stopWatchingChanges = watch(
    [keeping, changeSignal],
    ([keep]) => (keep ? schedule() : letGo()),
    { immediate: true }
  )
  // A workspace that fills before the drafts are looked at, as from a link, is not replaced by the reload's draft.
  const stopWatchingEmpty = watch(isEmpty, (empty) => (empty ? refresh() : (reclaim = null)), { immediate: true })

  const onVisibilityChange = () => (target.visibilityState === 'hidden' ? flush() : refresh())
  const onPageHide = () => flush()
  const view = target?.defaultView ?? null
  target?.addEventListener?.('visibilitychange', onVisibilityChange)
  view?.addEventListener?.('pagehide', onPageHide)

  onScopeDispose(() => {
    stopWatchingChanges()
    stopWatchingEmpty()
    target?.removeEventListener?.('visibilitychange', onVisibilityChange)
    view?.removeEventListener?.('pagehide', onPageHide)
    // A draft still waiting is written rather than dropped, taking the workspace now, while it can still be read.
    if (idleTimer === null) return
    stopWaiting()
    let state
    try {
      state = buildState()
    } catch {
      return
    }
    enqueue(() => writeDraft(state))
  })

  return { drafts, restoring, restore, discard, refresh, flush }
}
