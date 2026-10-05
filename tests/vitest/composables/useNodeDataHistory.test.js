import { reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNodeDataHistory } from '../../../src/composables/useNodeDataHistory.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'

const nodes = ref([])
const edges = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  // Writes data the way vue-flow does: a new data object on the same node.
  useVueFlow: () => ({
    nodes,
    edges,
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    updateNodeData: (id, patch) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (node) node.data = { ...node.data, ...patch }
    },
  }),
}))

/**
 * Creates a node with a name, one parameter row and one port.
 *
 * @param {string} id
 * @returns {Object}
 */
function createNode(id) {
  return reactive({
    id,
    data: { name: id, variables: [{ name: 'k', value: '1', type: 'constant' }], ports: [{ label: 'p', variables: ['k'] }] },
  })
}

const findNode = (id) => nodes.value.find((node) => node.id === id)

describe('useNodeDataHistory', () => {
  let history, recordEdit, findIncidentEdgeIds

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    nodes.value = [createNode('a'), createNode('b')]
    edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [{ from: 'k', to: 'k' }] } }]
    ;({ recordEdit, findIncidentEdgeIds } = useNodeDataHistory())
  })

  const rename = (id, name) =>
    recordEdit({ type: 'rename-node', nodeIds: [id], keys: ['name'], apply: () => (findNode(id).data = { ...findNode(id).data, name }) })

  it('undoes and redoes an edit as one step', async () => {
    expect(await rename('a', 'renamed')).toBe(true)
    expect(findNode('a').data.name).toBe('renamed')

    await history.undo()
    expect(findNode('a').data.name).toBe('a')
    expect(history.canUndo).toBe(false)

    await history.redo()
    expect(findNode('a').data.name).toBe('renamed')
  })

  it('records nothing when the edit changes nothing', async () => {
    expect(await rename('a', 'a')).toBe(false)
    expect(history.canUndo).toBe(false)
  })

  it('records nothing during undo or redo, or off the main flow', async () => {
    await rename('a', 'first')
    const replay = { undo: () => rename('b', 'undone'), redo: () => rename('b', 'redone') }
    await history.executeAndAddCommand(replay)

    await history.undo()
    expect(findNode('b').data.name).toBe('undone')
    expect(history.pointerIndex).toBe(0)
    expect(history.canRedo).toBe(true)

    await history.redo()
    expect(findNode('b').data.name).toBe('redone')
    expect(history.pointerIndex).toBe(1)
    expect(history.canRedo).toBe(false)

    history.clear()
    const macro = useNodeDataHistory(FLOW_IDS.MACRO)
    await macro.recordEdit({ type: 'rename-node', nodeIds: ['a'], keys: ['name'], apply: () => (findNode('a').data = { ...findNode('a').data, name: 'macro' }) })
    expect(findNode('a').data.name).toBe('macro')
    expect(history.canUndo).toBe(false)
  })

  it('finds a node by id after it was removed and added back', async () => {
    await rename('a', 'renamed')
    const restored = createNode('a')
    restored.data = { ...restored.data, name: 'renamed' }
    nodes.value = [restored, findNode('b')]

    await history.undo()
    expect(findNode('a').data.name).toBe('a')
  })

  it('leaves a node that something else has changed since', async () => {
    await rename('a', 'renamed')
    nodes.value = [createNode('a'), findNode('b')]
    findNode('a').data = { ...findNode('a').data, name: 'loaded' }

    await history.undo()
    expect(findNode('a').data.name).toBe('loaded')
  })

  it('applies nothing when one of the step’s nodes has changed since', async () => {
    const renameBoth = () => {
      findNode('a').data = { ...findNode('a').data, name: 'a2' }
      findNode('b').data = { ...findNode('b').data, name: 'b2' }
    }
    await recordEdit({ type: 'rename-nodes', nodeIds: ['a', 'b'], keys: ['name'], edgeIds: ['e'], apply: renameBoth })
    findNode('b').data = { ...findNode('b').data, name: 'elsewhere' }

    await history.undo()
    expect(findNode('a').data.name).toBe('a2')
    expect(findNode('b').data.name).toBe('elsewhere')
  })

  it('redoes a step whose added constant an undo kept for another node', async () => {
    const library = useLibraryStore()
    const makeGlobal = (id) => {
      library.assignGlobalConstant('k', '1', 'second', null)
      findNode(id).data = { ...findNode(id).data, variables: [{ name: 'k', value: '1', type: 'global_constant' }] }
    }
    await recordEdit({ type: 'edit-parameters', nodeIds: ['a'], keys: ['variables'], apply: () => makeGlobal('a') })
    findNode('b').data = { ...findNode('b').data, variables: [{ name: 'k', value: '1', type: 'global_constant' }] }

    await history.undo()
    expect(library.getGlobalConstant('k')).toBeDefined()
    expect(findNode('a').data.variables[0].type).toBe('constant')

    await history.redo()
    expect(findNode('a').data.variables[0].type).toBe('global_constant')
  })

  it('leaves a constant that something else has changed since', async () => {
    const library = useLibraryStore()
    await recordEdit({ type: 'edit-global-constant', nodeIds: [], keys: [], apply: () => library.assignGlobalConstant('g', '2', 'second', null) })
    library.assignGlobalConstant('g', '7', 'second', null, true)

    await history.undo()
    expect(library.getGlobalConstant('g').value).toBe('7')
  })

  it('applies nothing when one of the step’s nodes or edges has since been removed', async () => {
    const edit = () => {
      findNode('a').data = { ...findNode('a').data, name: 'a2' }
      findNode('b').data = { ...findNode('b').data, name: 'b2' }
      edges.value[0].data = { couplings: [] }
    }
    await recordEdit({ type: 'edit-connection', nodeIds: ['a', 'b'], keys: ['name'], edgeIds: ['e'], apply: edit })

    edges.value = []
    await history.undo()
    expect([findNode('a').data.name, findNode('b').data.name]).toEqual(['a2', 'b2'])

    await history.redo()
    edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [] } }]
    nodes.value = [findNode('a')]
    await history.undo()
    expect(findNode('a').data.name).toBe('a2')
  })

  it('restores couplings after the edge object is replaced', async () => {
    await recordEdit({
      type: 'edit-connection',
      nodeIds: ['a', 'b'],
      keys: ['ports'],
      edgeIds: findIncidentEdgeIds(['a']),
      apply: () => {
        findNode('a').data = { ...findNode('a').data, ports: [] }
        edges.value[0].data = { couplings: [] }
      },
    })
    edges.value = [{ ...edges.value[0] }]

    await history.undo()
    expect(edges.value[0].data.couplings).toEqual([{ from: 'k', to: 'k' }])
    expect(findNode('a').data.ports).toEqual([{ label: 'p', variables: ['k'] }])
  })

  it('undoes a constant an edit added only while no row uses it', async () => {
    const library = useLibraryStore()
    const makeGlobal = (id) => {
      library.assignGlobalConstant('k', '1', 'second', null)
      findNode(id).data = { ...findNode(id).data, variables: [{ name: 'k', value: '1', type: 'global_constant' }] }
    }
    await recordEdit({ type: 'edit-parameters', nodeIds: ['a'], keys: ['variables'], apply: () => makeGlobal('a') })

    await history.undo()
    expect(library.getGlobalConstant('k')).toBeUndefined()

    await history.redo()
    expect(library.getGlobalConstant('k')).toMatchObject({ value: '1' })
    findNode('b').data = { ...findNode('b').data, variables: [{ name: 'k', value: '1', type: 'global_constant' }] }
    await history.undo()
    expect(library.getGlobalConstant('k')).toMatchObject({ value: '1' })
  })

  it('undoes a change to a constant’s value', async () => {
    const library = useLibraryStore()
    library.assignGlobalConstant('g', '1', 'second', null)
    await recordEdit({ type: 'edit-global-constant', nodeIds: [], keys: [], apply: () => library.assignGlobalConstant('g', '2', 'second', null, true) })

    await history.undo()
    expect(library.getGlobalConstant('g').value).toBe('1')
    await history.redo()
    expect(library.getGlobalConstant('g').value).toBe('2')
  })
})
