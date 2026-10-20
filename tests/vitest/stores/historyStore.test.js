import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHistory, useFlowHistoryStore } from '../../../src/stores/historyStore.js'

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

  it('waits for each asynchronous command in a batch, in order, recording nothing they add', async () => {
    const log = []
    const history = reactive(createHistory())
    /** A command that finishes later, and records another change as it does, as replacing an edge does. */
    const slow = (name) => ({
      type: name,
      undo: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        history.addCommand(loggedCommand(`tail ${name}`, log))
        log.push(`undo ${name}`)
      },
      redo: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        history.addCommand(loggedCommand(`tail ${name}`, log))
        log.push(`redo ${name}`)
      },
    })

    history.startBatch()
    await history.executeAndAddCommand(slow('a'))
    await history.executeAndAddCommand(loggedCommand('b', log))
    await history.executeAndAddCommand(slow('c'))
    history.endBatch()
    log.length = 0

    await history.undo()
    expect(log).toEqual(['undo c', 'undo b', 'undo a'])
    expect(history.isUndoRedoing).toBe(false)
    expect(history.canRedo).toBe(true)

    await history.redo()
    expect(log).toEqual(['undo c', 'undo b', 'undo a', 'redo a', 'redo b', 'redo c'])
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 40))
    await history.undo()
    expect(history.canUndo).toBe(false)
  })

  it('ignores an undo or redo pressed while an asynchronous one is still running', async () => {
    const log = []
    const history = reactive(createHistory())
    let finish
    await history.executeAndAddCommand(loggedCommand('a', log))
    await history.executeAndAddCommand({
      type: 'slow',
      undo: () => new Promise((resolve) => (finish = resolve)).then(() => log.push('undo slow')),
      redo: () => log.push('redo slow'),
    })
    log.length = 0

    const first = history.undo()
    await history.undo()
    finish()
    await first
    expect(log).toEqual(['undo slow'])
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(true)

    const again = history.redo()
    await history.undo()
    await again
    expect(log).toEqual(['undo slow', 'redo slow'])
    expect(history.canRedo).toBe(false)
  })

  it('applies a batch of synchronous commands at once', () => {
    const log = []
    const history = reactive(createHistory())
    history.startBatch()
    history.addCommand(loggedCommand('a', log))
    history.addCommand(loggedCommand('b', log))
    history.endBatch()

    history.undo()
    expect(log).toEqual(['undo b', 'undo a'])
  })
})
