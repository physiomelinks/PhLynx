import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/notify', () => ({ notify: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))

import {
  DRAFT_MAX_AGE_MS,
  RECOVERY_IDLE_MS,
  RECOVERY_MAX_WAIT_MS,
  useWorkspaceRecovery,
} from '../../../src/composables/useWorkspaceRecovery.js'
import { packDraft, unpackDraft } from '../../../src/services/recovery/draftFile.js'
import { notify } from '../../../src/utils/notify'

const LOCK = (id) => ({ name: `phlynx-recovery-tab:${id}` })

/** Keeps drafts in a Map, as the IndexedDB store would. */
function memoryStore() {
  const drafts = new Map()
  return {
    drafts,
    get: vi.fn(async (id) => drafts.get(id) ?? null),
    put: vi.fn(async (draft) => void drafts.set(draft.id, draft)),
    delete: vi.fn(async (id) => void drafts.delete(id)),
    list: vi.fn(async () => [...drafts.values()]),
  }
}

/** Lets queued writes, zipping included, run to the end. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}

let scope
let clock

function setup({ held = [], ...overrides } = {}) {
  const unsaved = ref(false)
  const empty = ref(true)
  const signal = ref(0)
  const store = overrides.store ?? memoryStore()
  const target = new EventTarget()
  target.visibilityState = 'visible'
  let state = { flow: { nodes: [{ id: 'n1' }] }, step: 0 }
  const applyState = vi.fn(async () => {
    unsaved.value = true
    empty.value = false
  })
  scope = effectScope()
  const recovery = scope.run(() =>
    useWorkspaceRecovery({
      hasUnsavedChanges: unsaved,
      changeSignal: () => signal.value,
      isEmpty: () => empty.value,
      buildState: () => state,
      describe: () => ({ name: 'heart', nodeCount: 1 }),
      applyState,
      store,
      tabId: 'me',
      locks: { query: async () => ({ held: held.map(LOCK) }) },
      now: () => clock,
      target,
      ...overrides,
    })
  )
  /** An edit: the workspace is unsaved and has moved on a step. */
  const edit = async () => {
    unsaved.value = true
    signal.value++
    state = { ...state, step: signal.value }
    await nextTick()
  }
  return { recovery, store, unsaved, empty, signal, target, applyState, edit, state: () => state }
}

/** Moves the clock and its timers on. */
async function advance(ms) {
  clock += ms
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

describe('useWorkspaceRecovery', () => {
  beforeEach(() => {
    clock = 1_000_000
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(notify.warning).mockClear()
  })
  afterEach(() => {
    scope?.stop()
    vi.useRealTimers()
  })

  it('writes the draft once the workspace has gone five seconds without a change', async () => {
    const { store, edit, state } = setup()
    await edit()
    await advance(RECOVERY_IDLE_MS - 1)
    expect(store.put).not.toHaveBeenCalled()
    await advance(1)
    const draft = store.drafts.get('me')
    expect(draft).toMatchObject({ id: 'me', savedAt: clock, name: 'heart', nodeCount: 1 })
    expect(await unpackDraft(draft.data)).toEqual(state())
  })

  it('starts the wait again with each change', async () => {
    const { store, edit } = setup()
    await edit()
    await advance(4000)
    await edit()
    await advance(4000)
    expect(store.put).not.toHaveBeenCalled()
    await advance(1000)
    expect(store.put).toHaveBeenCalledTimes(1)
  })

  it('writes anyway once changes have kept coming for the longest wait', async () => {
    const { store, edit } = setup()
    for (let elapsed = 0; elapsed < RECOVERY_MAX_WAIT_MS; elapsed += 4000) {
      await edit()
      await advance(4000)
    }
    expect(store.put).toHaveBeenCalled()
  })

  it('deletes the draft once nothing is unsaved: saved, loaded or cleared', async () => {
    const { store, edit, unsaved } = setup()
    await edit()
    await advance(RECOVERY_IDLE_MS)
    expect(store.drafts.has('me')).toBe(true)
    unsaved.value = false
    await nextTick()
    await settle()
    expect(store.drafts.has('me')).toBe(false)
  })

  it('drops a waiting draft when the work is saved before it is written', async () => {
    const { store, edit, unsaved } = setup()
    await edit()
    unsaved.value = false
    await nextTick()
    await advance(RECOVERY_IDLE_MS)
    expect(store.put).not.toHaveBeenCalled()
  })

  it('does not bring back a draft whose write was under way when the work was saved', async () => {
    const store = memoryStore()
    let releasePut
    store.put.mockImplementationOnce(
      (draft) =>
        new Promise((resolve) => {
          releasePut = () => resolve(store.drafts.set(draft.id, draft))
        })
    )
    const { edit, unsaved } = setup({ store })
    await edit()
    await advance(RECOVERY_IDLE_MS)
    expect(releasePut).toBeTypeOf('function')
    unsaved.value = false
    await nextTick()
    releasePut()
    await settle()
    expect(store.drafts.has('me')).toBe(false)
  })

  it('writes a waiting draft at once when the tab is hidden', async () => {
    const { store, edit, target } = setup()
    await edit()
    target.visibilityState = 'hidden'
    target.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(store.put).toHaveBeenCalledTimes(1)
  })

  it('tells the user once when drafts cannot be kept', async () => {
    const store = memoryStore()
    store.put.mockRejectedValue(new Error('QuotaExceededError'))
    const { edit } = setup({ store })
    await edit()
    await advance(RECOVERY_IDLE_MS)
    await edit()
    await advance(RECOVERY_IDLE_MS)
    expect(notify.warning).toHaveBeenCalledTimes(1)
  })

  it('offers the drafts of closed tabs only, newest first, throwing out those grown too old', async () => {
    const store = memoryStore()
    const put = (id, savedAt) => store.drafts.set(id, { id, savedAt, name: id, nodeCount: 2, data: null })
    put('me', clock)
    put('open', clock)
    put('older', clock - 1000)
    put('newer', clock - 10)
    put('stale', clock - DRAFT_MAX_AGE_MS - 1)
    const { recovery } = setup({ store, held: ['me', 'open'] })
    await settle()
    expect(recovery.drafts.value.map((draft) => draft.id)).toEqual(['newer', 'older'])
    expect(recovery.drafts.value[0]).toEqual({ id: 'newer', savedAt: clock - 10, name: 'newer', nodeCount: 2 })
    expect(store.drafts.has('stale')).toBe(false)
    expect(store.drafts.has('open')).toBe(true)
  })

  it('restores a draft, keeps it as this tab’s, then lets the old one go', async () => {
    const store = memoryStore()
    const workspace = { flow: { nodes: [{ id: 'lost' }] } }
    store.drafts.set('gone', { id: 'gone', savedAt: clock, name: 'lung', nodeCount: 1, data: await packDraft(workspace) })
    const { recovery, applyState } = setup({ store })
    await settle()
    expect(recovery.drafts.value).toHaveLength(1)

    expect(await recovery.restore('gone')).toBe(true)
    expect(applyState).toHaveBeenCalledWith(workspace, expect.objectContaining({ id: 'gone', name: 'lung' }))
    expect(store.drafts.has('gone')).toBe(false)
    expect(store.drafts.has('me')).toBe(true)
    expect(recovery.drafts.value).toEqual([])
    expect(recovery.restoring.value).toBe(null)
  })

  it('keeps the old draft when this tab’s copy cannot be written', async () => {
    const store = memoryStore()
    store.drafts.set('gone', { id: 'gone', savedAt: clock, data: await packDraft({ flow: {} }) })
    store.put.mockRejectedValue(new Error('QuotaExceededError'))
    const { recovery } = setup({ store })
    await recovery.restore('gone')
    expect(store.drafts.has('gone')).toBe(true)
  })

  it('leaves a draft that fails to restore where it was', async () => {
    const store = memoryStore()
    store.drafts.set('gone', { id: 'gone', savedAt: clock, data: await packDraft({ flow: {} }) })
    const { recovery, applyState } = setup({ store })
    applyState.mockRejectedValueOnce(new Error('Invalid workflow file format.'))
    await expect(recovery.restore('gone')).rejects.toThrow('Invalid workflow')
    expect(store.drafts.has('gone')).toBe(true)
    expect(recovery.restoring.value).toBe(null)
  })

  it('answers false for a draft another tab has already taken', async () => {
    const { recovery, applyState } = setup()
    expect(await recovery.restore('missing')).toBe(false)
    expect(applyState).not.toHaveBeenCalled()
  })

  describe('turned off', () => {
    it('writes no draft, not even building the workspace', async () => {
      const buildState = vi.fn(() => ({}))
      const { store, edit, target } = setup({ enabled: () => false, buildState })
      await edit()
      await advance(RECOVERY_MAX_WAIT_MS)
      target.visibilityState = 'hidden'
      target.dispatchEvent(new Event('visibilitychange'))
      await settle()
      expect(buildState).not.toHaveBeenCalled()
      expect(store.put).not.toHaveBeenCalled()
    })

    it('deletes this tab’s draft when turned off, and keeps one again when turned back on', async () => {
      const on = ref(true)
      const { store, edit } = setup({ enabled: () => on.value })
      await edit()
      await advance(RECOVERY_IDLE_MS)
      expect(store.drafts.has('me')).toBe(true)

      on.value = false
      await nextTick()
      await settle()
      expect(store.drafts.has('me')).toBe(false)

      on.value = true
      await nextTick()
      await advance(RECOVERY_IDLE_MS)
      expect(store.drafts.has('me')).toBe(true)
    })

    it('still offers and restores the drafts other tabs left, letting each go once restored', async () => {
      const store = memoryStore()
      store.drafts.set('gone', { id: 'gone', savedAt: clock, data: await packDraft({ flow: {} }) })
      const { recovery, applyState } = setup({ store, enabled: () => false })
      await settle()
      expect(recovery.drafts.value.map((draft) => draft.id)).toEqual(['gone'])
      expect(await recovery.restore('gone')).toBe(true)
      expect(applyState).toHaveBeenCalled()
      expect(store.drafts.size).toBe(0)
    })
  })

  it('discards a draft', async () => {
    const store = memoryStore()
    store.drafts.set('gone', { id: 'gone', savedAt: clock, data: null })
    const { recovery } = setup({ store })
    await settle()
    await recovery.discard('gone')
    expect(store.drafts.size).toBe(0)
    expect(recovery.drafts.value).toEqual([])
  })
})
