import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowHistory } from '../../../../src/composables/useFlowHistory.js'
import {
  deleteConnection,
  deleteInstances,
  deletionLabel,
  deletionMessage,
  deletionScope,
  isDeleteKey,
  planDeletion,
} from '../../../../src/services/bioView/deletion.js'
import { validatePieces } from '../../../../src/services/bioView/pieces/model.js'
import { getBuiltInPieceTemplate } from '../../../../src/services/bioView/pieces/builtInTemplates.js'
import { layoutPieces } from '../../../../src/services/bioView/pieces/layout.js'
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

describe('planDeletion on a cell with no single inside', () => {
  const rod = validatePieces(getBuiltInPieceTemplate('rod-photoreceptor').pieces).pieces

  it('leaves the segments standing where they were drawn when the membrane goes alone, their bridge a flow', () => {
    const rects = layoutPieces(rod).rects
    const plan = planDeletion(rod, [], { pieces: ['plasma-membrane'] })
    expect(plan.errors).toEqual([])
    const left = new Map(plan.next.map((piece) => [piece.id, piece]))
    expect([...left.keys()].sort()).toEqual(['cilium', 'inner-segment', 'outer-segment'])
    for (const id of ['outer-segment', 'inner-segment']) {
      expect(left.get(id).docks).toBeUndefined()
      const rect = rects.get(id)
      expect(left.get(id).frame).toEqual({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
    expect(left.get('cilium').flux).toBe('flow')
    // Asked about: only the extracellular space docked outside it, not the segments.
    expect(plan.alongWith).toEqual(['extracellular'])
  })

  it('names a fold that goes with its membrane', () => {
    const cardiomyocyte = validatePieces(getBuiltInPieceTemplate('cardiomyocyte').pieces).pieces
    expect(planDeletion(cardiomyocyte, [], { pieces: ['sarcolemma'] }).alongWith).toContain('t-tubule')
  })

  it('says plainly why a segment can’t be deleted', () => {
    const plan = planDeletion(rod, [], { pieces: ['inner-segment'] })
    expect(plan.next).toBeNull()
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatch(/^It is part of the inside of a cell with no other inside/)
  })
})

describe('planDeletion', () => {
  const pieces = validatePieces([
    { id: 'bath', kind: 'compartment', label: 'Bath', frame: { x: 0, y: 0, width: 200, height: 120 } },
    { id: 'cell', kind: 'compartment', label: 'Cell', frame: { x: 400, y: 0, width: 200, height: 120 } },
    { id: 'pm', kind: 'membrane', label: 'PM', encloses: ['cell'], sides: { top: [{ id: 'apical', label: 'Apical' }] } },
    { id: 'link', kind: 'tube', label: 'Link', ends: ['bath', 'cell'] },
  ]).pieces
  const on = (id, site) => ({ id, data: { name: id, bioView: { site } } })
  const nodes = [
    on('saline', 'pieces/bath'),
    on('cytosol', 'pieces/cell'),
    on('wall', 'pieces/pm'),
    on('pump', 'pieces/pm.apical'),
    on('conduit', 'pieces/link'),
    on('stale', 'pieces/nowhere'),
    { id: 'loose', data: { name: 'loose' } },
  ]

  it('takes a cell’s compartment with its membrane, tube and every module on them, asking about what was not chosen', () => {
    const plan = planDeletion(pieces, nodes, { instances: ['cytosol'] })
    expect(plan.pieces).toEqual(['cell'])
    expect(plan.next.map((piece) => piece.id)).toEqual(['bath'])
    expect(plan.going.sort()).toEqual(['conduit', 'cytosol', 'pump', 'wall'])
    expect(plan.alongWith).toEqual(['pm', 'link'])
    // The membrane's and tube's modules are those pieces, named by them; the protein is asked about.
    expect(plan.modulesToo).toEqual(['pump'])
  })

  it('takes a membrane alone, leaving the compartment it enclosed', () => {
    const plan = planDeletion(pieces, nodes, { instances: ['wall'] })
    expect(plan.next.map((piece) => piece.id)).toEqual(['bath', 'cell', 'link'])
    expect(plan.going.sort()).toEqual(['pump', 'wall'])
    expect(plan.alongWith).toEqual([])
    expect(plan.modulesToo).toEqual(['pump'])
  })

  it('takes a free compartment and its module without asking, and pieces chosen by id', () => {
    const plan = planDeletion(pieces, nodes, { pieces: ['link'] })
    expect(plan.going).toEqual(['conduit'])
    expect(deletionMessage(plan, { pieceName: (id) => id, nodeName: (id) => id })).toBeNull()
  })

  it('takes no piece for a protein or a loose module, nor a module on a site no piece offers', () => {
    const plan = planDeletion(pieces, nodes, { instances: ['pump', 'loose'] })
    expect(plan.next).toBeNull()
    expect(plan.going).toEqual(['pump', 'loose'])
    expect(planDeletion(pieces, nodes, { instances: ['saline'] }).going).not.toContain('stale')
  })

  it('says what else goes', () => {
    const plan = planDeletion(pieces, nodes, { instances: ['cytosol'] })
    const names = { pieceName: (id) => id.toUpperCase(), nodeName: (id) => `<${id}>` }
    expect(deletionMessage(plan, names)).toBe('PM, LINK go with it. These modules on it are deleted too: <pump>.')
  })
})
