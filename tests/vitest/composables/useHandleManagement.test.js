import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useHandleManagement } from '../../../src/composables/useHandleManagement.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { HANDLE_VARIANT } from '../../../src/utils/constants.js'

const { nodes, edges, updateNodeInternals } = vi.hoisted(() => ({
  nodes: { value: [] },
  edges: { value: [] },
  updateNodeInternals: vi.fn(),
}))

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    getNodes: nodes,
    nodes,
    edges,
    findNode: (id) => nodes.value.find((node) => node.id === id),
    updateNodeData: (id, update, options = { replace: false }) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (!node) return
      const patch = typeof update === 'function' ? update(node) : update
      node.data = options.replace ? patch : { ...node.data, ...patch }
    },
    updateNodeInternals,
  }),
}))

const handle = (uid, side, slotIndex, variant = HANDLE_VARIANT.GHOST) => ({ uid, side, slotIndex, variant, type: 'port', name: uid })

const variantOf = (nodeId, uid) =>
  nodes.value.find((n) => n.id === nodeId).data.handles.find((h) => h.uid === uid).variant

describe('useHandleManagement', () => {
  let history, api

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    updateNodeInternals.mockClear()
    nodes.value = [
      {
        id: 'n1',
        data: {
          handles: [handle('l0', 'left', 0), handle('l1', 'left', 1), handle('l2', 'left', 2), handle('r0', 'right', 0)],
        },
      },
      { id: 'n2', data: { handles: [handle('t0', 'left', 0, HANDLE_VARIANT.DEFAULT)] } },
    ]
    edges.value = []
    api = useHandleManagement()
  })

  it('addHandle activates the most central ghost handle on that side and refreshes internals', async () => {
    await api.addHandle('n1', 'left')

    expect(variantOf('n1', 'l1')).toBe(HANDLE_VARIANT.DEFAULT)
    expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.GHOST)
    expect(variantOf('n1', 'l2')).toBe(HANDLE_VARIANT.GHOST)
    expect(variantOf('n1', 'r0')).toBe(HANDLE_VARIANT.GHOST)
    expect(updateNodeInternals).toHaveBeenCalledWith('n1')
  })

  it('addHandle does nothing for an unknown node or a side without ghost handles', async () => {
    await api.addHandle('missing', 'left')
    await api.addHandle('n2', 'left')
    await api.addHandle('n1', 'top')
    history.endBatch()

    expect(history.canUndo).toBe(false)
    expect(variantOf('n2', 't0')).toBe(HANDLE_VARIANT.DEFAULT)
  })

  it('undo restores the ghost variant and redo reapplies the default one', async () => {
    await api.addHandle('n1', 'left')
    history.endBatch()
    expect(history.canUndo).toBe(true)

    await history.undo()
    expect(variantOf('n1', 'l1')).toBe(HANDLE_VARIANT.GHOST)

    await history.redo()
    expect(variantOf('n1', 'l1')).toBe(HANDLE_VARIANT.DEFAULT)
  })

  it('does not record extra commands when a handle changes during an undo replay', async () => {
    history.addCommand({
      type: 'outer',
      undo: () => api.activateHandle('n1', 'l2'),
      redo: () => {},
    })
    history.endBatch()
    await history.undo()
    history.endBatch()

    expect(variantOf('n1', 'l2')).toBe(HANDLE_VARIANT.DEFAULT)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
  })

  it('records nothing when the variant is already the requested one', async () => {
    await api.activateHandle('n2', 't0')
    history.endBatch()

    expect(history.canUndo).toBe(false)
    expect(updateNodeInternals).not.toHaveBeenCalled()
  })

  it('activateHandle with trackHistory false changes the handle without recording a command', async () => {
    await api.activateHandle('n1', 'l0', { trackHistory: false })
    history.endBatch()

    expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
    expect(history.canUndo).toBe(false)
  })

  describe('revertHandleIfUnused', () => {
    beforeEach(async () => {
      await api.activateHandle('n1', 'l0', { trackHistory: false })
      edges.value = [{ id: 'e1', source: 'n1', sourceHandle: 'handle_l0', target: 'n2', targetHandle: 'handle_t0' }]
    })

    it('does nothing while another edge still uses the handle', async () => {
      await api.revertHandleIfUnused('n1', 'l0')
      history.endBatch()

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
      expect(history.canUndo).toBe(false)
    })

    it('treats an edge ending on the handle as a use', async () => {
      edges.value = [{ id: 'e2', source: 'n2', sourceHandle: 'handle_t0', target: 'n1', targetHandle: 'handle_l0' }]
      await api.revertHandleIfUnused('n1', 'l0')

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
    })

    it('ignores edges listed in excludeEdgeIds and reverts with a history command', async () => {
      await api.revertHandleIfUnused('n1', 'l0', { excludeEdgeIds: ['e1'] })
      history.endBatch()
      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.GHOST)

      await history.undo()
      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
    })

    it('still counts other edges when only some are excluded', async () => {
      edges.value.push({ id: 'e3', source: 'n1', sourceHandle: 'handle_l0', target: 'n2', targetHandle: 'handle_t0' })
      await api.revertHandleIfUnused('n1', 'l0', { excludeEdgeIds: ['e1'] })

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
    })

    it('reverts without a command when trackHistory is false', async () => {
      edges.value = []
      await api.revertHandleIfUnused('n1', 'l0', { trackHistory: false })
      history.endBatch()

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.GHOST)
      expect(history.canUndo).toBe(false)
    })

    it('ignores unknown nodes and handles', async () => {
      edges.value = []
      await api.revertHandleIfUnused('missing', 'l0')
      await api.revertHandleIfUnused('n1', 'nope')

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
    })
  })

  describe('revertHandlesForEdge', () => {
    const edge = { id: 'e1', source: 'n1', sourceHandle: 'handle_l0', target: 'n2', targetHandle: 'handle_t0' }

    beforeEach(async () => {
      await api.activateHandle('n1', 'l0', { trackHistory: false })
      edges.value = [edge]
    })

    it('reverts both ends of the edge, excluding the edge itself by default', async () => {
      await api.revertHandlesForEdge(edge)

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.GHOST)
      expect(variantOf('n2', 't0')).toBe(HANDLE_VARIANT.GHOST)
    })

    it('keeps an end that another edge still uses', async () => {
      edges.value.push({ id: 'e2', source: 'n1', sourceHandle: 'handle_l0', target: 'n2', targetHandle: 'handle_other' })
      await api.revertHandlesForEdge(edge)

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
      expect(variantOf('n2', 't0')).toBe(HANDLE_VARIANT.GHOST)
    })

    it('skips ends without a handle id', async () => {
      await api.revertHandlesForEdge({ id: 'e1', source: 'n1', target: 'n2', targetHandle: 'handle_t0' })

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
      expect(variantOf('n2', 't0')).toBe(HANDLE_VARIANT.GHOST)
    })

    it('records no commands when trackHistory is false', async () => {
      await api.revertHandlesForEdge(edge, [edge.id], { trackHistory: false })
      history.endBatch()

      expect(variantOf('n2', 't0')).toBe(HANDLE_VARIANT.GHOST)
      expect(history.canUndo).toBe(false)
    })

    it('records both ends as one undoable step', async () => {
      history.startBatch()
      await api.revertHandlesForEdge(edge)
      history.endBatch()

      await history.undo()
      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
      expect(variantOf('n2', 't0')).toBe(HANDLE_VARIANT.DEFAULT)
      expect(history.canUndo).toBe(false)
    })
  })

  describe('reactivateEdgeHandles', () => {
    const edge = { id: 'e1', source: 'n1', sourceHandle: 'handle_l0', target: 'n1', targetHandle: 'handle_r0' }

    it('activates both ends of the edge and records history', async () => {
      await api.reactivateEdgeHandles(edge)
      history.endBatch()

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
      expect(variantOf('n1', 'r0')).toBe(HANDLE_VARIANT.DEFAULT)

      await history.undo()
      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.GHOST)
      expect(variantOf('n1', 'r0')).toBe(HANDLE_VARIANT.GHOST)
    })

    it('records no command when trackHistory is false', async () => {
      await api.reactivateEdgeHandles(edge, { trackHistory: false })
      history.endBatch()

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
      expect(history.canUndo).toBe(false)
    })
  })

  describe('ghost activation preview', () => {
    it('beginGhostActivation previews an untracked activation that revertPendingGhostIfUnused undoes', async () => {
      api.beginGhostActivation('n1', 'l0')
      await nextTick()
      await nextTick()
      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)

      await api.revertPendingGhostIfUnused()
      history.endBatch()

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.GHOST)
      expect(history.canUndo).toBe(false)
    })

    it('confirmActivation keeps the handle active', async () => {
      api.beginGhostActivation('n1', 'l0')
      await nextTick()
      api.confirmActivation()
      await api.revertPendingGhostIfUnused()

      expect(variantOf('n1', 'l0')).toBe(HANDLE_VARIANT.DEFAULT)
    })
  })
})
