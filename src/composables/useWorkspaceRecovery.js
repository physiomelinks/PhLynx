import { onScopeDispose, ref, shallowRef, watch } from 'vue'

import { packDraft, unpackDraft } from '../services/recovery/draftFile'
import { createDraftStore } from '../services/recovery/draftStore'
import { liveTabIds, pageTabId } from '../services/recovery/tabSession'
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
 * has no unsaved changes again: saved, loaded, cleared, or undone back to its save.
 *
 * @param {Object} options
 * @param {import('vue').Ref<boolean>} options.hasUnsavedChanges - Whether there is unsaved work to keep.
 * @param {() => *} options.changeSignal - Changes with every edit, so each one restarts the wait.
 * @param {() => boolean} options.isEmpty - Whether the workspace is empty, when the drafts on offer are looked up.
 * @param {() => Object} options.buildState - The workspace, as a save writes it.
 * @param {() => { name?: string|null, nodeCount?: number }} [options.describe] - What the draft is, for its listing.
 * @param {(state: Object, draft: Object) => Promise<void>} options.applyState - Puts a draft's workspace in place.
 * @param {Object} [options.store] - Where drafts are kept (createDraftStore's interface).
 * @param {string} [options.tabId] - This tab's id.
 * @param {LockManager} [options.locks] - For telling which tabs are open.
 * @param {() => number} [options.now]
 * @param {EventTarget} [options.target=document] - Fires visibilitychange; its window fires pagehide.
 * @returns {{
 *   drafts: import('vue').Ref<Array<{ id: string, savedAt: number, name: string|null, nodeCount: number }>>,
 *   restoring: import('vue').Ref<string|null>,
 *   restore: (id: string) => Promise<boolean>,
 *   discard: (id: string) => Promise<void>,
 *   refresh: () => Promise<void>,
 *   flush: () => Promise<void>,
 * }}
 */
export function useWorkspaceRecovery({
  hasUnsavedChanges,
  changeSignal,
  isEmpty,
  buildState,
  describe = () => ({}),
  applyState,
  store = createDraftStore(),
  tabId = pageTabId(),
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
    if (!hasUnsavedChanges.value) return false
    const started = epoch
    try {
      const data = await packDraft(state ?? buildState())
      if (started !== epoch || !hasUnsavedChanges.value) return false
      await store.put({ id: tabId, savedAt: now(), name: null, nodeCount: 0, ...describe(), data })
      return true
    } catch (error) {
      console.warn('Recovery draft not written:', error)
      if (warned) return false
      warned = true
      notify.warning({
        title: 'Unsaved work is not being kept',
        message: 'This browser would not store a recovery copy, so save your work to keep it.',
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
      drafts.value = closed
        .filter((draft) => draft.savedAt >= cutoff)
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(({ id, savedAt, name, nodeCount }) => ({ id, savedAt, name: name ?? null, nodeCount: nodeCount ?? 0 }))
    } catch (error) {
      console.warn('Recovery drafts unavailable:', error)
      drafts.value = []
    }
  }

  /**
   * Puts a draft's workspace in place, keeps it as this tab's draft, then lets the old one go, unless this tab's could
   * not be written. A failure leaves the draft where it was and is thrown.
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
      if (await enqueue(() => writeDraft())) await store.delete(id)
      await refresh()
      return true
    } finally {
      restoring.value = null
    }
  }

  async function discard(id) {
    try {
      await store.delete(id)
    } finally {
      await refresh()
    }
  }

  const stopWatchingChanges = watch(
    [() => hasUnsavedChanges.value, changeSignal],
    ([unsaved]) => (unsaved ? schedule() : letGo()),
    { immediate: true }
  )
  const stopWatchingEmpty = watch(isEmpty, (empty) => empty && refresh(), { immediate: true })

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
