import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHistory, stepLabel, useFlowHistoryStore } from '../../../src/stores/historyStore.js'

/**
 * Creates a command that logs its undo and redo calls.
 *
 * @param {string} name
 * @param {Array<string>} log
 * @returns {Object}
 */
function loggedCommand(name, log) {
  return {
    type: name,
    undo: vi.fn(() => log.push(`undo ${name}`)),
    redo: vi.fn(() => log.push(`redo ${name}`)),
  }
}

describe('createHistory', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps each history separate from the others and from the workspace store', async () => {
    const log = []
    const first = reactive(createHistory())
    const second = reactive(createHistory())
    const workspace = useFlowHistoryStore()

    await first.executeAndAddCommand(loggedCommand('a', log))
    expect(first.canUndo).toBe(true)
    expect(second.canUndo).toBe(false)
    expect(workspace.canUndo).toBe(false)

    await second.undo()
    await workspace.undo()
    expect(log).toEqual(['redo a'])

    await first.undo()
    expect(log).toEqual(['redo a', 'undo a'])
  })

  it('undoes a manual batch as one step, in reverse order', async () => {
    const log = []
    const history = reactive(createHistory())

    history.startBatch()
    await history.executeAndAddCommand(loggedCommand('a', log))
    await history.executeAndAddCommand(loggedCommand('b', log))
    history.endBatch()

    await history.undo()
    expect(log).toEqual(['redo a', 'redo b', 'undo b', 'undo a'])
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
  })

  it('forgets every step when cleared', async () => {
    const history = reactive(createHistory())
    await history.executeAndAddCommand(loggedCommand('a', []))
    await history.executeAndAddCommand(loggedCommand('b', []))
    await history.undo()

    history.clear()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })

  it('drops commands still waiting to be batched when cleared, then batches afresh', async () => {
    vi.useFakeTimers()
    const log = []
    const history = reactive(createHistory())
    history.addCommand(loggedCommand('a', log))
    history.startBatch()
    history.addCommand(loggedCommand('b', log))

    history.clear()
    vi.advanceTimersByTime(25)
    expect(history.canUndo).toBe(false)

    history.addCommand(loggedCommand('c', log))
    vi.advanceTimersByTime(25)
    await history.undo()
    expect(log).toEqual(['undo c'])
  })

  it('batches commands added close together in the workspace store', async () => {
    vi.useFakeTimers()
    const log = []
    const workspace = useFlowHistoryStore()

    workspace.addCommand(loggedCommand('a', log))
    workspace.addCommand(loggedCommand('b', log))
    expect(workspace.canUndo).toBe(false)
    vi.advanceTimersByTime(25)
    expect(workspace.canUndo).toBe(true)

    await workspace.undo()
    await workspace.redo()
    expect(log).toEqual(['undo b', 'undo a', 'redo a', 'redo b'])
  })
})

describe('naming and rolling back steps', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('names a batch by the type it is given, else by the last labelled command in it', async () => {
    const log = []
    const history = reactive(createHistory())
    history.startBatch()
    await history.executeAndAddCommand(loggedCommand('add', log))
    await history.executeAndAddCommand(loggedCommand('rename-node', log))
    history.endBatch('add-edge')
    expect(history.undoLabel).toBe('Connect')

    history.startBatch()
    await history.executeAndAddCommand(loggedCommand('edit-instance', log))
    await history.executeAndAddCommand(loggedCommand('select', log))
    history.endBatch()
    expect(history.undoLabel).toBe('Edit module')
    expect(history.redoLabel).toBeNull()

    await history.undo()
    expect(history.undoLabel).toBe('Connect')
    expect(history.redoLabel).toBe('Edit module')
  })

  it('falls back to a plain name for a step of no known type', () => {
    expect(stepLabel({ type: 'something-new' })).toBe('Edit')
    expect(stepLabel({ type: 'apply-parameter-set' })).toBe('Apply parameter set')
    expect(stepLabel(undefined)).toBeNull()
  })

  it('rolls back a batch, leaving no step', async () => {
    const log = []
    const history = reactive(createHistory())
    history.startBatch()
    await history.executeAndAddCommand(loggedCommand('a', log))
    history.addCommand(loggedCommand('b', log))
    await history.rollbackBatch()
    expect(log).toEqual(['redo a', 'undo b', 'undo a'])
    expect(history.canUndo).toBe(false)

    // Batching is over: the next command is a step of its own.
    await history.executeAndAddCommand(loggedCommand('c', log))
    expect(history.pointerIndex).toBe(0)
  })

  it('records nothing while rolling back', async () => {
    const history = reactive(createHistory())
    history.startBatch()
    await history.executeAndAddCommand({
      type: 'a',
      redo: () => {},
      undo: () => history.addCommand({ type: 'echo', undo: () => {}, redo: () => {} }),
    })
    await history.rollbackBatch()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(history.canUndo).toBe(false)
  })

  it('keeps commands pending from before a batch when rolling it back', async () => {
    const log = []
    const history = reactive(createHistory())
    history.addCommand(loggedCommand('before', log))
    history.startBatch()
    await history.executeAndAddCommand(loggedCommand('in', log))
    await history.rollbackBatch()
    expect(log).toEqual(['redo in', 'undo in'])
    expect(history.pointerIndex).toBe(0)
    expect(history.undoLabel).toBe('Edit')
  })

  it('keeps commands pending before a batch starts as their own step', async () => {
    const log = []
    const history = reactive(createHistory())
    history.addCommand(loggedCommand('remove', log))
    history.startBatch()
    await history.executeAndAddCommand(loggedCommand('add', log))
    await history.executeAndAddCommand(loggedCommand('add-edge', log))
    history.endBatch()
    expect(history.pointerIndex).toBe(1)
    expect(history.undoLabel).toBe('Connect')

    await history.undo()
    expect(log).toEqual(['redo add', 'redo add-edge', 'undo add-edge', 'undo add'])
    expect(history.undoLabel).toBe('Delete')
  })

  it('is replaying only during an undo or redo, not while a new command runs', async () => {
    const history = reactive(createHistory())
    const seen = []
    const look = () => seen.push(history.isReplaying)
    const command = { type: 'a', undo: look, redo: look }
    await history.executeAndAddCommand(command)
    await history.undo()
    await history.redo()
    expect(seen).toEqual([false, true, true])
    expect(history.isReplaying).toBe(false)
  })
})
