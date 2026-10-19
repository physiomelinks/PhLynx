// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useModelGraph } from '../../../src/composables/useModelGraph.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { connect, constant, exposed, exposures, module, port, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])
const OUT = port('exit_ports', 'vessel', ['v', 'u_out'])
const vessel = (localId, name, options = {}) =>
  module(localId, name, { ports: [{ ...IN }, { ...OUT }], variables: [constant('R', '1')], ...options })

/** Root a → b → c. */
function flatGraph() {
  const [a, b, c] = [vessel('a', 'a'), vessel('b', 'b'), vessel('c', 'c')]
  const used = new Set()
  return { nodes: [a, b, c], edges: [connect(a, b, { used, id: 'e0' }), connect(b, c, { used, id: 'e1' })] }
}

/**
 * Root a → heart (sm_1: ra → lv, exposing ra's input and lv's output) → b, and, with a second super instance of sm_1, the
 * spare heart, connected to nothing.
 */
function heartGraph({ spare = false } = {}) {
  const ra = vessel('ra', 'ra', { scope: 'sm_1' })
  const lv = vessel('lv', 'lv', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'heart', { submoduleOrder: ['ra', 'lv'] })
  const exposure = exposures('sm_1', [exposed('xp_in', 'ra', 'entrance_ports', 'vessel'), exposed('xp_out', 'lv', 'exit_ports', 'vessel')])
  const inner = [sm, ra, lv]
  const store = { nodes: inner, edges: exposure }
  const heart = superInstance(store, 'dndnode_1', 'heart', 'sm_1')
  const a = vessel('dndnode_0', 'a')
  const b = vessel('dndnode_2', 'b')
  const used = new Set()
  const edges = [connect(a, heart, { used, id: 'e_in' }), connect(heart, b, { used, id: 'e_out' }), connect(ra, lv, { id: 'e_int' }), ...exposure]
  const spares = spare ? [superInstance(store, 'dndnode_3', 'spare', 'sm_1')] : []
  return { nodes: [a, heart, b, ...spares, ...inner], edges }
}

describe('useModelGraph', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const { graph, modelNodes, modelEdges, errors, isHierarchical, expandSelection, modelIdOf, mainIdOf, rootIdOf, findModelNode } =
    useModelGraph()

  /** Puts a graph in the workspace's store, as the canvas holds it. */
  const show = ({ nodes, edges }) => {
    flow.nodes.value = []
    flow.edges.value = []
    flow.addNodes(nodes)
    flow.addEdges(edges)
  }

  beforeEach(() => show({ nodes: [], edges: [] }))

  it('is one model for every caller', () => {
    expect(useModelGraph()).toBe(useModelGraph())
    expect(useModelGraph().graph).toBe(graph)
  })

  it('is the store itself without super instances: the same nodes and edges, in their order', () => {
    show(flatGraph())
    expect(modelNodes.value).toHaveLength(3)
    modelNodes.value.forEach((node, i) => expect(node).toBe(flow.nodes.value[i]))
    expect(modelEdges.value).toHaveLength(2)
    modelEdges.value.forEach((edge, i) => expect(edge).toBe(flow.edges.value[i]))
    expect(isHierarchical.value).toBe(false)
    expect(expandSelection(['c', 'a'])).toEqual(['c', 'a'])
    expect([modelIdOf('b'), mainIdOf('b'), rootIdOf('b'), findModelNode('b')]).toEqual(['b', 'b', 'b', flow.findNode('b')])
  })

  it('reports nothing without super instances, what flat export tolerates included', () => {
    const { nodes, edges } = flatGraph()
    nodes[2].data.name = 'a'
    show({ nodes, edges })
    expect(graph.value.errors.map((error) => error.kind)).toContain('flatNameClash')
    expect(errors.value).toEqual([])
  })

  it('expands super instances into their modules, by path ids and flat names, each traced to its node', () => {
    show(heartGraph())
    expect(isHierarchical.value).toBe(true)
    expect(modelNodes.value.map((node) => [node.id, node.data.name])).toEqual([
      ['dndnode_0', 'a'],
      ['dndnode_1/ra', 'heart__ra'],
      ['dndnode_1/lv', 'heart__lv'],
      ['dndnode_2', 'b'],
    ])
    expect(modelNodes.value.filter((node) => node.data.scope)).toEqual([])
    expect(modelEdges.value.map((edge) => `${edge.source} > ${edge.target}`).sort()).toEqual([
      'dndnode_0 > dndnode_1/ra',
      'dndnode_1/lv > dndnode_2',
      'dndnode_1/ra > dndnode_1/lv',
    ])
    expect(mainIdOf('dndnode_1/ra')).toBe('sm_1~ra')
    expect(modelIdOf('sm_1~ra', ['dndnode_1'])).toBe('dndnode_1/ra')
    expect(modelIdOf('sm_1~ra')).toBeUndefined()
    expect(rootIdOf('dndnode_1/lv')).toBe('dndnode_1')
    expect(rootIdOf('dndnode_2')).toBe('dndnode_2')
    expect(findModelNode('dndnode_1/lv').data.name).toBe('heart__lv')
    expect(errors.value).toEqual([])
  })

  it('expands a selection: a super instance to its modules, a super-module’s module to its copy in each super instance', () => {
    show(heartGraph({ spare: true }))
    expect(expandSelection(['dndnode_1'])).toEqual(['dndnode_1/ra', 'dndnode_1/lv'])
    expect(expandSelection(['dndnode_2', 'dndnode_1'])).toEqual(['dndnode_1/ra', 'dndnode_1/lv', 'dndnode_2'])
    expect(expandSelection(['sm_1~lv'])).toEqual(['dndnode_1/lv', 'dndnode_3/lv'])
    expect(expandSelection(['sm_1'])).toEqual([])
    expect(expandSelection([])).toEqual([])
  })

  it('reports what the expansion finds wrong once there are super instances', () => {
    const { nodes, edges } = heartGraph()
    show({ nodes, edges: edges.filter((edge) => edge.id !== 'sm_1~lv--sm_1') })
    expect(errors.value.map((error) => [error.kind, error.severity])).toEqual([['unresolvedAlias', 'error']])
    expect(errors.value[0].message).toMatch(/port "xp_out" of "heart", which its super-module no longer exposes/)
  })

  it.each([
    {
      workspace: 'without super instances',
      build: flatGraph,
      changes: [
        { id: 'a', type: 'position', position: { x: 40, y: 80 }, dragging: true },
        { id: 'b', type: 'dimensions', dimensions: { width: 120, height: 60 } },
        { id: 'c', type: 'select', selected: true },
      ],
      edgeId: 'e0',
      editId: 'b',
      modelId: 'b',
      isRebuilt: false,
    },
    {
      workspace: 'with super instances',
      build: heartGraph,
      changes: [
        { id: 'dndnode_0', type: 'position', position: { x: 40, y: 80 }, dragging: true },
        { id: 'sm_1~ra', type: 'position', position: { x: 10, y: 10 }, dragging: false },
        { id: 'dndnode_1', type: 'dimensions', dimensions: { width: 120, height: 60 } },
        { id: 'dndnode_2', type: 'select', selected: true },
      ],
      edgeId: 'e_in',
      editId: 'sm_1~ra',
      modelId: 'dndnode_1/ra',
      isRebuilt: true,
    },
  ])(
    'keeps its model, $workspace, while nodes move, are measured or are selected, and shows a change to the model',
    ({ build, changes, edgeId, editId, modelId, isRebuilt }) => {
      show(build())
      const before = graph.value
      flow.applyNodeChanges(changes)
      flow.applyEdgeChanges([{ id: edgeId, type: 'select', selected: true }])
      expect(flow.findNode(changes[0].id).position).toEqual({ x: 40, y: 80 })
      expect(flow.findEdge(edgeId).selected).toBe(true)
      expect(graph.value).toBe(before)

      flow.updateNodeData(editId, { variables: [constant('R', '9')] })
      // Without hierarchy, the model is the store's nodes themselves, so an edit to their data needs no new one.
      expect(graph.value === before).toBe(!isRebuilt)
      expect(findModelNode(modelId).data.variables).toEqual([constant('R', '9')])
    }
  )

  it('gives, without hierarchy, what expanding would: origins, names, paths and problems, read from the data as it is now', () => {
    const { nodes, edges } = flatGraph()
    nodes[1].data.name = 'a'
    delete nodes[2].data.name
    show({ nodes, edges })
    const expanded = expandHierarchy(flow.nodes.value, flow.edges.value)
    const model = graph.value
    expect(model.nodes).toEqual(expanded.nodes)
    expect(model.edges).toEqual(expanded.edges)
    expect(model.origin).toEqual(expanded.origin)
    for (const key of ['a', 'b', 'c', 'e0', 'x']) {
      expect([model.nameOf(key), model.pathOf(key)]).toEqual([expanded.nameOf(key), expanded.pathOf(key)])
    }
    for (const name of ['a', 'b', 'c', '', undefined]) expect(model.idOf(name)).toBe(expanded.idOf(name))
    expect(model.errors).toEqual(expanded.errors)

    flow.updateNodeData('b', { name: 'renamed' })
    expect(graph.value).toBe(model)
    expect([model.nameOf('b'), model.pathOf('b'), model.idOf('renamed')]).toEqual(['renamed', 'renamed', 'b'])
    expect(model.errors).toEqual(expandHierarchy(flow.nodes.value, flow.edges.value).errors)
  })
})

describe('useModelGraph in development', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/services/hierarchy/expand.js')
    vi.resetModules()
  })

  /**
   * Gets a fresh model graph whose expansion is changed, over a graph in a fresh store.
   *
   * @param {Function} change - Changes expandHierarchy's result.
   * @param {{nodes: Array, edges: Array}} shown
   * @returns {Promise<Object>} The model graph.
   */
  async function withExpansion(change, shown) {
    vi.resetModules()
    vi.doMock('../../../src/services/hierarchy/expand.js', async (importOriginal) => {
      const original = await importOriginal()
      return { ...original, expandHierarchy: (nodes, edges) => change(original.expandHierarchy(nodes, edges)) }
    })
    const { useVueFlow: useFreshVueFlow } = await import('@vue-flow/core')
    const { useModelGraph: useFreshModelGraph } = await import('../../../src/composables/useModelGraph.js')
    const store = useFreshVueFlow(FLOW_IDS.MAIN)
    store.nodes.value = []
    store.edges.value = []
    store.addNodes(shown.nodes)
    store.addEdges(shown.edges)
    return useFreshModelGraph()
  }

  it('refuses a node of a super-module reaching the model', async () => {
    const leak = (expansion) => ({ ...expansion, nodes: [...expansion.nodes, { id: 'x', data: { scope: 'sm_1' } }] })
    const { graph } = await withExpansion(leak, heartGraph())
    expect(() => graph.value).toThrow('Node "x" of super-module "sm_1" reached the model.')
  })
})
