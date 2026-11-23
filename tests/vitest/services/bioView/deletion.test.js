import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowHistory } from '../../../../src/composables/useFlowHistory.js'
import {
  deleteConnection,
  deleteInstances,
  deletionLabel,
  deletionScope,
  isDeleteKey,
} from '../../../../src/services/bioView/deletion.js'
import { useFlowHistoryStore } from '../../../../src/stores/historyStore.js'

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
        if (c.type === 'remove') nodes.value = nodes.value.filter((node) => node.id !== c.id)
      }),
    applyEdgeChanges: (changes) =>
      changes.forEach((c) => {
        if (c.type === 'remove') edges.value = edges.value.filter((edge) => edge.id !== c.id)
      }),
  }),
}))

const node = (id, selected = false) => ({ id, selected, position: { x: 0, y: 0 }, data: { name: id } })
const edge = (source, target) => ({ id: `${source}--${target}`, source, target })
const ids = (list) => list.value.map((item) => item.id).sort()

describe('isDeleteKey', () => {
  it('takes Delete and Backspace, but not with a modifier', () => {
    expect(isDeleteKey({ key: 'Delete' })).toBe(true)
    expect(isDeleteKey({ key: 'Backspace' })).toBe(true)
    expect(isDeleteKey({ key: 'Backspace', metaKey: true })).toBe(false)
    expect(isDeleteKey({ key: 'Delete', ctrlKey: true })).toBe(false)
    expect(isDeleteKey({ key: 'Delete', altKey: true })).toBe(false)
    expect(isDeleteKey({ key: 'd' })).toBe(false)
  })
})

describe('deletionScope and deletionLabel', () => {
  const list = [node('a', true), node('b', true), node('c')]

  it('takes the selection when the node is in it, else the node alone', () => {
    expect(deletionScope('a', list)).toEqual(['a', 'b'])
    expect(deletionScope('c', list)).toEqual(['c'])
    expect(deletionLabel('a', list)).toBe('Delete Selection (2)')
    expect(deletionLabel('c', list)).toBe('Delete')
    expect(deletionLabel('a', [node('a', true)])).toBe('Delete')
  })
})

describe('deleteInstances', () => {
  let history, onNodeChange, onEdgeChange

  // vue-flow's removeNodes: the connected edges' removal first, then the nodes', each to its listener.
  const removeNodes = (gone) => {
    const list = toIds(gone)
    const connected = edges.value.filter((e) => list.includes(e.source) || list.includes(e.target))
    if (connected.length) onEdgeChange(connected.map((e) => ({ type: 'remove', id: e.id })))
    onNodeChange(list.map((id) => ({ type: 'remove', id })))
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    nodes.value = [node('a', true), node('b', true), node('c')]
    edges.value = [edge('a', 'c'), edge('b', 'c'), edge('c', 'd')]
    ;({ onNodeChange, onEdgeChange } = useFlowHistory({
      suppressedEdgeIds: new Set(),
      indexAddEdge: vi.fn(),
      indexRemoveEdge: vi.fn(),
      updateHelperLines: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
    }))
  })

  it('removes the instances with their edges as one Delete step, which one undo takes back', async () => {
    expect(await deleteInstances(['a', 'b'], { removeNodes, history })).toBe(true)
    expect(ids(nodes)).toEqual(['c'])
    expect(ids(edges)).toEqual(['c--d'])
    expect(history.undoLabel).toBe('Delete')

    await history.undo()
    expect(ids(nodes)).toEqual(['a', 'b', 'c'])
    expect(ids(edges)).toEqual(['a--c', 'b--c', 'c--d'])
    expect(history.canUndo).toBe(false)
  })

  it('leaves no step when there is nothing to delete', async () => {
    expect(await deleteInstances([], { removeNodes, history })).toBe(false)
    expect(history.canUndo).toBe(false)
  })
})

describe('deleteConnection', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('removes the edge by the workspace path, in one step named for it', async () => {
    const history = useFlowHistoryStore()
    const disconnectInstances = vi.fn(async (gone) => {
      history.addCommand({ type: 'remove-edge', undo: vi.fn(), redo: vi.fn() })
      history.addCommand({ type: 'add-annotated-ports', undo: vi.fn(), redo: vi.fn() })
      return gone
    })
    await deleteConnection('a--c', { disconnectInstances, history })
    expect(disconnectInstances).toHaveBeenCalledWith(['a--c'])
    expect(history.undoLabel).toBe('Disconnect')
    expect(history.pointerIndex).toBe(0)
  })
})
