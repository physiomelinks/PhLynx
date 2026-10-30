import { effectScope, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCouplingSuggestions } from '../../../src/composables/useCouplingSuggestions.js'
import { useNodeDataHistory } from '../../../src/composables/useNodeDataHistory.js'
import { useAnnotationStore } from '../../../src/stores/annotationStore.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useSuggestionStore } from '../../../src/stores/suggestionStore.js'
import { HANDLE_VARIANT } from '../../../src/utils/constants.js'
import { buildGhostHandles, getHandleUidFromHandleId } from '../../../src/utils/handles.js'
import { TOY_MODULES, readToy } from '../services/annotations/toyModel.js'
import { loadToyNodes } from '../services/annotations/toyNodes.js'

const nodes = ref([])
const edges = ref([])
const toIds = (ids) => (Array.isArray(ids) ? ids : [ids])
const findNode = (id) => nodes.value.find((node) => node.id === id)

/** Sets a handle's variant in place, as useHandleManagement does through updateNodeData. */
function setVariant(nodeId, uid, variant) {
  const node = findNode(nodeId)
  if (!node) return
  node.data = { ...node.data, handles: node.data.handles.map((h) => (h.uid === uid ? { ...h, variant } : h)) }
}

let history
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges,
    findNode,
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    updateNodeData: (id, patch, { replace } = {}) => {
      const node = findNode(id)
      if (node) node.data = replace ? patch : { ...node.data, ...patch }
    },
    // Stands in for useFlowHistory: an added edge is one step, whose undo also ghosts its handles again.
    addEdges: (added) => {
      const list = toIds(added).map((edge) => ({ ...edge }))
      edges.value = [...edges.value, ...list]
      const ids = list.map((edge) => edge.id)
      const ghost = () =>
        list.forEach((edge) => {
          if (edge.sourceHandle)
            setVariant(edge.source, getHandleUidFromHandleId(edge.sourceHandle), HANDLE_VARIANT.GHOST)
          if (edge.targetHandle)
            setVariant(edge.target, getHandleUidFromHandleId(edge.targetHandle), HANDLE_VARIANT.GHOST)
        })
      history.addCommand({
        type: 'add-edge',
        undo: () => {
          edges.value = edges.value.filter((edge) => !ids.includes(edge.id))
          ghost()
        },
        redo: () => (edges.value = [...edges.value, ...list]),
      })
    },
  }),
}))

const HELD = ['outside', 'vessel']

describe('useCouplingSuggestions', () => {
  let toy, scope, suggestions, store, annotationStore, activateHandle

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  /** A toy node with ghost handles, laid out top to bottom by rank. */
  const placed = (name, y, data = {}) => {
    const node = toy.node(name, [], {
      handles: buildGhostHandles(),
      ...(HELD.includes(name) ? { annotationOverlay: { heldConstant: true } } : {}),
      ...data,
    })
    return { ...node, position: { x: 0, y }, dimensions: { width: 100, height: 50 } }
  }

  const start = (options = {}) => {
    scope = effectScope()
    suggestions = scope.run(() =>
      useCouplingSuggestions({ activateHandle, recordEdit: useNodeDataHistory().recordEdit, delay: 0, ...options }),
    )
  }

  /** Lets the debounced recompute fire, then runs the latest one to the end. */
  const settle = async () => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await suggestions.refresh()
  }

  const keys = () => store.suggestions.map((s) => s.key)

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    store = useSuggestionStore()
    annotationStore = useAnnotationStore()
    const library = useLibraryStore()
    for (const module of new Set(Object.values(TOY_MODULES))) {
      const mathRef = `${module}.cellml:${module}`
      library.addMath(mathRef, readToy(`${module}.cellml`))
      library.setModuleAnnotations(mathRef, readToy(`${module}.ttl`))
    }
    annotationStore.addInstanceSource({ location: 'toy-apicoords.ttl', text: readToy('toy-apicoords.ttl') })
    activateHandle = vi.fn(async (nodeId, uid) => setVariant(nodeId, uid, HANDLE_VARIANT.DEFAULT))
    nodes.value = ['outside', 'porter_in', 'cell', 'wall', 'porter_out', 'vessel'].map((name, i) =>
      placed(name, i * 200),
    )
    edges.value = []
  })

  afterEach(() => scope?.stop())

  it('suggests every toy edge between bound nodes, the vessel one low confidence', async () => {
    start()
    await settle()
    expect(keys()).toEqual([
      'node_outside->node_porter_in',
      'node_porter_in->node_cell',
      'node_porter_in->node_wall',
      'node_cell->node_porter_out',
      'node_wall->node_porter_out',
      'node_porter_out->node_vessel',
    ])
    const low = store.suggestions.filter((s) => s.confidence === 'low')
    expect(low.map((s) => s.targetName)).toEqual(['node_vessel'])
    // Named by the instance, not its node id.
    expect(low[0].why).toMatch(/^Assumed: vessel is the only lyph/)
  })

  it('reads nothing when no node is bound', async () => {
    nodes.value = nodes.value.map((node) => ({ ...node, data: { ...node.data, apiCoord: undefined } }))
    const ensure = vi.spyOn(annotationStore, 'ensureApiCoords')
    start()
    await settle()
    expect(store.suggestions).toEqual([])
    expect(ensure).not.toHaveBeenCalled()
  })

  it('debounces changes into one recompute', async () => {
    vi.useFakeTimers()
    try {
      start({ delay: 100 })
      const ensure = vi.spyOn(annotationStore, 'ensureApiCoords')
      await vi.advanceTimersByTimeAsync(100)
      ensure.mockClear()
      nodes.value = nodes.value.slice(0, 5)
      await nextTick()
      nodes.value = nodes.value.slice(0, 4)
      await nextTick()
      await vi.advanceTimersByTimeAsync(50)
      expect(ensure).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      expect(ensure).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pairs only a new node against the rest, giving what a full pairing gives', async () => {
    // Refreshed by hand, so each run can be read.
    start({ delay: 1e6 })
    const vessel = nodes.value.pop()
    await suggestions.refresh()
    expect(suggestions.lastRun.full).toBe(true)
    expect(keys()).not.toContain('node_porter_out->node_vessel')

    nodes.value = [...nodes.value, vessel]
    await suggestions.refresh()
    // The vessel is the lyph a basolateral facet faces, so it re-pairs everything; a plain node does not.
    expect(suggestions.lastRun.full).toBe(true)
    const all = keys()

    const wall = nodes.value.find((node) => node.id === 'node_wall')
    nodes.value = nodes.value.filter((node) => node !== wall)
    await suggestions.refresh()
    expect(suggestions.lastRun).toEqual({ full: false, paired: [] })
    nodes.value = [...nodes.value, wall]
    await suggestions.refresh()
    expect(suggestions.lastRun).toEqual({ full: false, paired: ['node_wall'] })
    expect([...keys()].sort()).toEqual([...all].sort())
  })

  it('leaves out couplings already on an edge', async () => {
    start()
    await settle()
    await suggestions.accept(store.suggestions.find((s) => s.key === 'node_porter_in->node_wall'))
    await settle()
    expect(keys()).not.toContain('node_porter_in->node_wall')
    expect(keys()).toHaveLength(5)
  })

  describe('accepting', () => {
    beforeEach(async () => {
      start()
      await settle()
    })

    it('adds the edge, its ports and its handles as one undo step', async () => {
      const suggestion = store.suggestions.find((s) => s.key === 'node_porter_in->node_cell')
      await suggestions.accept(suggestion)

      expect(edges.value).toHaveLength(1)
      const [edge] = edges.value
      expect(edge).toMatchObject({ id: 'node_porter_in--node_cell', source: 'node_porter_in', target: 'node_cell' })
      const pairs = edge.data.couplings.map(({ sourcePort, targetPort }) => [
        sourcePort.variables[0],
        targetPort.variables[0],
      ])
      expect(pairs.sort()).toEqual([
        ['area', 'area'],
        ['c_A_i', 'c_A'],
        ['v_A_i', 'v_A'],
      ])
      const porter = findNode('node_porter_in')
      const cell = findNode('node_cell')
      expect(porter.data.ports.map((p) => p.variables[0]).sort()).toEqual(['area', 'c_A_i', 'v_A_i'])
      expect(cell.data.ports.map((p) => p.multiportType).sort()).toEqual(['Sum', 'True', 'True'])
      // The cell is below the porter: the porter's bottom and the cell's top.
      const handleOf = (node, id) => node.data.handles.find((h) => `handle_${h.uid}` === id)
      expect(handleOf(porter, edge.sourceHandle)).toMatchObject({ side: 'bottom', variant: HANDLE_VARIANT.DEFAULT })
      expect(handleOf(cell, edge.targetHandle)).toMatchObject({ side: 'top', variant: HANDLE_VARIANT.DEFAULT })

      await settle()
      expect(keys()).not.toContain(suggestion.key)
      expect(history.canUndo).toBe(true)

      await history.undo()
      expect(history.canUndo).toBe(false)
      expect(edges.value).toEqual([])
      expect(findNode('node_porter_in').data.ports).toEqual([])
      expect(findNode('node_cell').data.ports).toEqual([])
      expect(handleOf(findNode('node_porter_in'), edge.sourceHandle).variant).toBe(HANDLE_VARIANT.GHOST)
      // Undoing brings the suggestion back.
      await settle()
      expect(keys()).toContain(suggestion.key)

      await history.redo()
      expect(edges.value).toHaveLength(1)
      expect(findNode('node_cell').data.ports).toHaveLength(3)
    })

    it('reuses a port a node already has for the same subject', async () => {
      await suggestions.accept(store.suggestions.find((s) => s.key === 'node_porter_in->node_cell'))
      await suggestions.accept(store.suggestions.find((s) => s.key === 'node_cell->node_porter_out'))
      const cell = findNode('node_cell')
      // area, c_A and v_A are shared by both porters.
      expect(cell.data.ports.map((p) => p.variables[0]).sort()).toEqual(['area', 'c_A', 'v_A'])
    })

    it('merges into an edge already joining the nodes, keeping its couplings', async () => {
      const label = {
        sourcePort: { portType: 'exit_ports', label: 'x', variables: ['q'] },
        targetPort: { portType: 'entrance_ports', label: 'x', variables: ['q'] },
      }
      edges.value = [{ id: 'old', source: 'node_cell', target: 'node_porter_in', data: { couplings: [label] } }]
      await settle()
      const suggestion = store.suggestions.find((s) => s.key === 'node_porter_in->node_cell')
      await suggestions.accept(suggestion)

      expect(edges.value).toHaveLength(1)
      const [edge] = edges.value
      expect(edge.data.couplings[0]).toEqual(label)
      // In the existing edge's direction: the cell is its source.
      const pairs = edge.data.couplings
        .slice(1)
        .map(({ sourcePort, targetPort }) => [sourcePort.variables[0], targetPort.variables[0]])
      expect(pairs.sort()).toEqual([
        ['area', 'area'],
        ['c_A', 'c_A_i'],
        ['v_A', 'v_A_i'],
      ])
      await history.undo()
      expect(edges.value[0].data.couplings).toEqual([label])
      expect(findNode('node_cell').data.ports).toEqual([])
    })

    it('accepts all as one undo step, and undoing restores every suggestion', async () => {
      const before = keys()
      expect(await suggestions.acceptAll()).toBe(6)
      expect(edges.value).toHaveLength(6)
      expect(edges.value.flatMap((edge) => edge.data.couplings)).toHaveLength(12)
      await settle()
      expect(store.suggestions).toEqual([])

      await history.undo()
      expect(history.canUndo).toBe(false)
      expect(edges.value).toEqual([])
      expect(nodes.value.every((node) => !node.data.ports.length)).toBe(true)
      await settle()
      expect(keys()).toEqual(before)
    })

    it('leaves ambiguous couplings out of accept all, but not out of one accept', async () => {
      const twin = { ...placed('cell', 400), id: 'node_cell_twin' }
      twin.data = { ...twin.data, name: 'cell_twin', apiCoord: { ...twin.data.apiCoord, subject: 'twin' } }
      nodes.value = [...nodes.value, twin]
      await settle()
      const suggestion = store.suggestions.find((s) => s.key === 'node_porter_in->node_cell')
      expect(suggestion.couplings.some((c) => c.ambiguous)).toBe(true)
      const clear = suggestion.couplings.filter((c) => !c.ambiguous).length

      await suggestions.acceptAll()
      const edge = edges.value.find((e) => e.id === 'node_porter_in--node_cell')
      expect(edge?.data.couplings.length ?? 0).toBe(clear)
    })
  })

  describe('dismissing', () => {
    beforeEach(async () => {
      start()
      await settle()
    })

    it('keeps a dismissed suggestion out, by ApiCoord subjects, without an undo step', async () => {
      const suggestion = store.suggestions.find((s) => s.key === 'node_porter_in->node_wall')
      suggestions.dismiss(suggestion)
      expect(keys()).not.toContain(suggestion.key)
      const porter = findNode('node_porter_in').data.apiCoord.subject
      const wall = findNode('node_wall').data.apiCoord.subject
      expect([...annotationStore.dismissedSuggestions]).toEqual([`${porter}->${wall}`])
      expect(history.canUndo).toBe(false)

      // A recompute, e.g. after another node moves in, keeps it dismissed.
      nodes.value = [...nodes.value]
      edges.value = [...edges.value]
      await settle()
      expect(keys()).not.toContain(suggestion.key)
      expect(keys()).toHaveLength(5)
    })

    it('dismisses all', async () => {
      suggestions.dismissAll()
      await settle()
      expect(store.suggestions).toEqual([])
      expect(annotationStore.dismissedSuggestions.size).toBe(6)
    })

    it('brings dismissed suggestions back', async () => {
      suggestions.dismissAll()
      await settle()
      expect(store.dismissed).toHaveLength(6)
      suggestions.restoreDismissed()
      await settle()
      expect(keys()).toHaveLength(6)
      expect(store.dismissed).toEqual([])
      expect(annotationStore.dismissedSuggestions.size).toBe(0)
    })
  })
})
