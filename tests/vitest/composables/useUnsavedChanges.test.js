import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  installUnloadGuard,
  isUnloadGuarded,
  registerWorkspaceSaver,
  useUnsavedChanges,
  workspaceSave,
} from '../../../src/composables/useUnsavedChanges.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'

const step = () => ({ type: 'add', undo: () => {}, redo: () => {} })

/** Fires a beforeunload on a target, returning whether it asked. */
function unload(target) {
  const event = new Event('beforeunload', { cancelable: true })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useUnsavedChanges', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('guards only a workspace with content that changed since its save', () => {
    expect(isUnloadGuarded({ hasContent: false, isAtSaved: false })).toBe(false)
    expect(isUnloadGuarded({ hasContent: true, isAtSaved: true })).toBe(false)
    expect(isUnloadGuarded({ hasContent: true, isAtSaved: false })).toBe(true)
  })

  it('follows the history: dirty after a step, clean once saved, dirty again after an undo', async () => {
    const history = useFlowHistoryStore()
    const dirty = useUnsavedChanges(() => true)
    expect(dirty.value).toBe(false)
    await history.executeAndAddCommand(step())
    expect(dirty.value).toBe(true)
    history.markSaved()
    expect(dirty.value).toBe(false)
    await history.undo()
    expect(dirty.value).toBe(true)
    await history.redo()
    expect(dirty.value).toBe(false)
  })

  it('never guards an empty workspace, as for the isolation reload of a first visit', async () => {
    const history = useFlowHistoryStore()
    await history.executeAndAddCommand(step())
    expect(useUnsavedChanges(() => false).value).toBe(false)
  })

  it('asks before unloading only while guarded, until removed', () => {
    const target = new EventTarget()
    let guarded = true
    const remove = installUnloadGuard(() => guarded, target)
    expect(unload(target)).toBe(true)
    guarded = false
    expect(unload(target)).toBe(false)
    guarded = true
    remove()
    expect(unload(target)).toBe(false)
  })

  it('offers the workspace save only while it has content', () => {
    let hasContent = false
    const save = () => {}
    const unregister = registerWorkspaceSaver({ save, hasContent: () => hasContent })
    expect(workspaceSave.value).toBeNull()
    hasContent = true
    unregister()
    registerWorkspaceSaver({ save, hasContent: () => hasContent })
    expect(workspaceSave.value).toBe(save)
  })
})
