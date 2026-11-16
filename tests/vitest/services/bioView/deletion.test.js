import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowHistory } from '../../../../src/composables/useFlowHistory.js'
import {
  cellContents,
  deleteConnection,
  deleteInstances,
  deletionLabel,
  deletionScope,
  isDeleteKey,
  releaseFromCell,
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

describe('a deleted cell’s contents', () => {
  const layout = new Map([
    ['cell', { kind: 'cell', rect: { x: 100, y: 50, width: 320, height: 240 } }],
    ['wall', { kind: 'membrane', cell: 'cell' }],
    ['pump', { kind: 'protein', cell: 'cell', x: 260, y: 50 }],
    ['gly', { kind: 'cytosolic', cell: 'cell', x: 150, y: 120 }],
    ['other', { kind: 'cell', rect: { x: 600, y: 50, width: 320, height: 240 } }],
    ['theirs', { kind: 'protein', cell: 'other', x: 700, y: 50 }],
    ['lumen', { kind: 'region', rect: { x: 0, y: 0, width: 10, height: 10 } }],
    ['bound', { kind: 'cell', instance: 'bt-1', rect: { x: 0, y: 400, width: 320, height: 240 } }],
    ['placed', { kind: 'protein', cell: 'bound', instance: 'bt-1', x: 50, y: 400 }],
  ])

  it('is its membrane, proteins and processes that are not going with it', () => {
    expect(cellContents(['cell'], layout)).toEqual(['wall', 'pump', 'gly'])
    expect(cellContents(['cell', 'pump', 'lumen'], layout)).toEqual(['wall', 'gly'])
    expect(cellContents(['pump', 'lumen'], layout)).toEqual([])
    // A template's cell keeps its places, so what is on them is not left without one.
    expect(cellContents(['bound'], layout)).toEqual([])
  })

  it('stays where it is drawn, out of any cell', () => {
    const patches = releaseFromCell(['wall', 'pump', 'gly'], layout, { width: 64, height: 48 })
    // A protein's place is its centre; a node's position is its corner.
    expect(patches.get('pump')).toEqual({ cell: undefined, facet: undefined, at: undefined, order: undefined, position: { x: 228, y: 26 } })
    expect(patches.get('gly').position).toEqual({ x: 150, y: 120 })
    expect(patches.get('wall').position).toEqual({ x: 100, y: 50 })
  })
})
