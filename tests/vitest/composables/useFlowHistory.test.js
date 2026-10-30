import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEdgeDragOffsets } from '../../../src/composables/useEdgeDragOffsets.js'
import { getUndoRedoAction, useFlowHistory } from '../../../src/composables/useFlowHistory.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const nodes = ref([])
const edges = ref([])

const toIds = (ids) => (Array.isArray(ids) ? ids : [ids])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  // Applies the change types the composable produces, the way vue-flow would.
  useVueFlow: () => ({
    nodes,
    edges,
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    addNodes: (added) => nodes.value.push(...toIds(added)),
    removeNodes: (ids) => (nodes.value = nodes.value.filter((node) => !toIds(ids).includes(node.id))),
    addEdges: (added) => edges.value.push(...toIds(added)),
    removeEdges: (ids) => (edges.value = edges.value.filter((edge) => !toIds(ids).includes(edge.id))),
    applyNodeChanges: (changes) =>
      changes.forEach((c) => {
        if (c.type === 'add') nodes.value.push(c.item)
        else if (c.type === 'remove') nodes.value = nodes.value.filter((node) => node.id !== c.id)
        else if (c.type === 'position' && c.position) nodes.value.find((node) => node.id === c.id).position = c.position
      }),
    applyEdgeChanges: (changes) =>
      changes.forEach((c) => {
        if (c.type === 'add') edges.value.push(c.item)
        else if (c.type === 'remove') edges.value = edges.value.filter((edge) => edge.id !== c.id)
      }),
  }),
}))

const createNode = (id, extra = {}) => ({
  id,
  position: { x: 0, y: 0 },
  dimensions: { width: 100, height: 60 },
  data: { name: id, variables: [] },
  ...extra,
})

describe('useFlowHistory', () => {
  let history, onNodeChange, onEdgeChange, deps, suppressedEdgeIds

  /** Commits pending commands as one step without waiting for the batch timer. */
  const commit = () => {
    history.startBatch()
    history.endBatch()
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    nodes.value = []
    edges.value = []
    suppressedEdgeIds = new Set()
    deps = {
      suppressedEdgeIds,
      indexAddEdge: vi.fn(),
      indexRemoveEdge: vi.fn(),
      updateHelperLines: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
    }
    ;({ onNodeChange, onEdgeChange } = useFlowHistory(deps))
  })

  describe('moving an instance', () => {
    const dragTo = (x, y) => {
      onNodeChange([{ type: 'position', id: 'a', position: { x: 1, y: 1 }, dragging: true }])
      onNodeChange([{ type: 'position', id: 'a', position: { x, y }, dragging: true }])
      onNodeChange([{ type: 'position', id: 'a', from: { x, y }, dragging: false }])
      commit()
    }

    it('batches a whole drag into one move command', () => {
      nodes.value = [createNode('a')]
      dragTo(50, 70)

      expect(history.pointerIndex).toBe(0)
      expect(nodes.value[0].position).toEqual({ x: 50, y: 70 })
    })

    it('undoes and redoes the position', async () => {
      nodes.value = [createNode('a')]
      dragTo(50, 70)

      await history.undo()
      expect(nodes.value[0].position).toEqual({ x: 0, y: 0 })
      expect(history.canUndo).toBe(false)
      await history.redo()
      expect(nodes.value[0].position).toEqual({ x: 50, y: 70 })
    })

    it('records nothing when the node ends where it started', () => {
      nodes.value = [createNode('a')]
      onNodeChange([{ type: 'position', id: 'a', position: { x: 0, y: 0 }, dragging: true }])
      onNodeChange([{ type: 'position', id: 'a', from: { x: 0, y: 0 }, dragging: false }])
      commit()

      expect(history.canUndo).toBe(false)
    })

    it('applies changes without recording or helper lines while an undo is running', async () => {
      nodes.value = [createNode('a')]
      history.addCommand({
        undo: () => onNodeChange([{ type: 'position', id: 'a', position: { x: 9, y: 9 }, dragging: true }]),
        redo: () => {},
      })
      commit()
      await history.undo()

      expect(nodes.value[0].position).toEqual({ x: 9, y: 9 })
      expect(deps.updateHelperLines).not.toHaveBeenCalled()
    })
  })

  describe('moving instances with a routed edge between them', () => {
    const route = [{ x: 50, y: 20 }]
    const { edgeDragOffsets } = useEdgeDragOffsets()

    /** Drags the given nodes together by (dx, dy), checking the live offsets on the way. */
    const dragAll = (ids, dx, dy) => {
      const frame = (x, y, dragging) => ids.map((id) => ({ type: 'position', id, position: { x, y }, dragging }))
      onNodeChange(frame(1, 1, true))
      onNodeChange(frame(dx, dy, true))
      const during = new Map(edgeDragOffsets.value)
      onNodeChange(ids.map((id) => ({ type: 'position', id, from: { x: dx, y: dy }, dragging: false })))
      commit()
      return during
    }

    beforeEach(() => {
      nodes.value = [createNode('a'), createNode('b'), createNode('c')]
      edges.value = [
        { id: 'ab', source: 'a', target: 'b', data: { couplings: [], waypoints: route } },
        { id: 'bc', source: 'b', target: 'c', data: { couplings: [], waypoints: route } },
      ]
    })

    it('carries the route of an edge whose two nodes moved together, as one undo step with the move', async () => {
      const during = dragAll(['a', 'b'], 30, 40)

      expect([...during]).toEqual([['ab', { x: 30, y: 40 }]])
      expect(edgeDragOffsets.value.size).toBe(0)
      expect(edges.value[0].data.waypoints).toEqual([{ x: 80, y: 60 }])
      expect(edges.value[1].data.waypoints).toEqual(route)
      expect(history.pointerIndex).toBe(0)

      await history.undo()
      expect(edges.value[0].data.waypoints).toEqual(route)
      expect(nodes.value[0].position).toEqual({ x: 0, y: 0 })
      await history.redo()
      expect(edges.value[0].data.waypoints).toEqual([{ x: 80, y: 60 }])
    })

    it('carries the route of an edge whose two nodes were nudged together with the arrow keys', () => {
      onNodeChange(['a', 'b'].map((id) => ({ type: 'position', id, position: { x: 5, y: 0 }, dragging: false })))
      expect(edges.value[0].data.waypoints).toEqual([{ x: 55, y: 20 }])
      expect(edges.value[1].data.waypoints).toEqual(route)

      // A later drag measures from where the nudge left the nodes.
      dragAll(['a', 'b'], 30, 40)
      expect(edges.value[0].data.waypoints).toEqual([{ x: 80, y: 60 }])
    })

    it('leaves routes alone when one node moves', () => {
      dragAll(['a'], 30, 40)
      expect(edges.value.map((e) => e.data.waypoints)).toEqual([route, route])
    })
  })

  describe('adding a node', () => {
    it('undoes by removing and redoes by restoring', async () => {
      onNodeChange([{ type: 'add', item: createNode('n1') }])
      commit()
      expect(nodes.value.map((n) => n.id)).toEqual(['n1'])

      await history.undo()
      expect(nodes.value).toEqual([])
      await history.redo()
      expect(nodes.value.map((n) => n.id)).toEqual(['n1'])
    })

    it('re-records the add with the node centred once its dimensions arrive', async () => {
      onNodeChange([{ type: 'add', item: createNode('n1', { position: { x: 200, y: 100 } }) }])
      onNodeChange([{ type: 'dimensions', id: 'n1', dimensions: { width: 100, height: 60 } }])
      commit()

      expect(history.pointerIndex).toBe(0)

      await history.undo()
      await history.redo()
      expect(nodes.value[0].position).toEqual({ x: 150, y: 70 })
    })
  })

  describe('deleting an instance', () => {
    it('undoes by restoring the node with its data and redoes by removing it', async () => {
      nodes.value = [createNode('a', { data: { name: 'Heart', variables: [{ name: 'k' }] } }), createNode('b')]
      onNodeChange([{ type: 'remove', id: 'a' }])
      commit()
      expect(nodes.value.map((n) => n.id)).toEqual(['b'])

      await history.undo()
      expect(nodes.value.map((n) => n.id)).toEqual(['b', 'a'])
      expect(nodes.value.find((n) => n.id === 'a').data).toEqual({ name: 'Heart', variables: [{ name: 'k' }] })
      await history.redo()
      expect(nodes.value.map((n) => n.id)).toEqual(['b'])
    })

    it('restores the node from a snapshot, not the live object', async () => {
      const original = createNode('a')
      nodes.value = [original]
      onNodeChange([{ type: 'remove', id: 'a' }])
      commit()
      original.data.name = 'mutated after delete'

      await history.undo()
      expect(nodes.value[0].data.name).toBe('a')
    })

    it('removes global constants no remaining node uses and brings them back on undo', async () => {
      const libraryStore = useLibraryStore()
      libraryStore.assignGlobalConstant('k', '1', 'dimensionless', null)
      nodes.value = [createNode('a', { data: { name: 'a', variables: [{ name: 'k' }] } })]

      onNodeChange([{ type: 'remove', id: 'a' }])
      commit()
      expect(libraryStore.getGlobalConstant('k')).toBeFalsy()

      await history.undo()
      expect(libraryStore.getGlobalConstant('k')).toBeTruthy()
      await history.redo()
      expect(libraryStore.getGlobalConstant('k')).toBeFalsy()
    })
  })

  describe('deleting an edge', () => {
    const edge = { id: 'e1', source: 'a', target: 'b', data: {} }

    it('ghosts the handles straight away and indexes the removal', () => {
      edges.value = [{ ...edge }]
      onEdgeChange([{ type: 'remove', id: 'e1' }])

      expect(deps.indexRemoveEdge).toHaveBeenCalledWith({ type: 'remove', id: 'e1' })
      expect(deps.revertHandlesForEdge).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), ['e1'])
      expect(edges.value).toEqual([])
    })

    it('undoes by restoring the edge and reactivating its handles, and redoes by removing it', async () => {
      edges.value = [{ ...edge }]
      onEdgeChange([{ type: 'remove', id: 'e1' }])
      commit()
      deps.revertHandlesForEdge.mockClear()

      await history.undo()
      expect(edges.value.map((e) => e.id)).toEqual(['e1'])
      expect(deps.reactivateEdgeHandles).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), { trackHistory: false })

      await history.redo()
      expect(edges.value).toEqual([])
      expect(deps.revertHandlesForEdge).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), ['e1'], { trackHistory: false })
    })

    it('undoes an added edge by removing it and reverting its handles', async () => {
      onEdgeChange([{ type: 'add', item: { ...edge } }])
      commit()
      expect(deps.indexAddEdge).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))

      await history.undo()
      expect(edges.value).toEqual([])
      expect(deps.revertHandlesForEdge).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), ['e1'], { trackHistory: false })
      await history.redo()
      expect(edges.value.map((e) => e.id)).toEqual(['e1'])
      expect(deps.reactivateEdgeHandles).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), { trackHistory: false })
    })

    it('records no command for suppressed edge ids but still applies the change', () => {
      suppressedEdgeIds.add('e1')
      edges.value = [{ ...edge }]
      onEdgeChange([{ type: 'remove', id: 'e1' }])
      onEdgeChange([{ type: 'add', item: { ...edge, id: 'e1' } }])
      commit()

      expect(history.canUndo).toBe(false)
      expect(edges.value.map((e) => e.id)).toEqual(['e1'])
    })
  })

  describe('getUndoRedoAction', () => {
    const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...mods })

    it('maps Ctrl/Cmd+Z to undo', () => {
      expect(getUndoRedoAction(key('z', { ctrlKey: true }))).toBe('undo')
      expect(getUndoRedoAction(key('z', { metaKey: true }))).toBe('undo')
    })

    it('maps Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y to redo', () => {
      expect(getUndoRedoAction(key('z', { ctrlKey: true, shiftKey: true }))).toBe('redo')
      expect(getUndoRedoAction(key('y', { metaKey: true }))).toBe('redo')
      expect(getUndoRedoAction(key('Y', { ctrlKey: true }))).toBe('redo')
    })

    it('maps Ctrl/Cmd+Shift+Z to redo when the browser reports an uppercase key', () => {
      expect(getUndoRedoAction(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo')
      expect(getUndoRedoAction(key('Z', { metaKey: true, shiftKey: true }))).toBe('redo')
    })

    it('ignores keys without a modifier and other shortcuts', () => {
      expect(getUndoRedoAction(key('z'))).toBeNull()
      expect(getUndoRedoAction(key('y'))).toBeNull()
      expect(getUndoRedoAction(key('c', { ctrlKey: true }))).toBeNull()
    })
  })
})
