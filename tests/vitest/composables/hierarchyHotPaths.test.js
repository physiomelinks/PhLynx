// @vitest-environment happy-dom
/**
 * The work the hierarchy's shared lookups leave undone: what selecting, dragging and editing elsewhere need not redo.
 */
import { useVueFlow } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/services/hierarchy/operations.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, supermoduleContentHash: vi.fn(original.supermoduleContentHash) }
})
vi.mock('../../../src/services/hierarchy/exposure.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, planUnexpose: vi.fn(original.planUnexpose), portResolver: vi.fn(original.portResolver) }
})

const { supermoduleContentHash } = await import('../../../src/services/hierarchy/operations.js')
const { materialiseSuperInstances, planUnexpose, portResolver } = await import('../../../src/services/hierarchy/exposure.js')
const { useCanvasDelete } = await import('../../../src/composables/useCanvasDelete.js')
const { useCanvasLevel } = await import('../../../src/composables/useCanvasLevel.js')
const { useExposedPortOwners } = await import('../../../src/composables/useExposure.js')
const { useSupermodules } = await import('../../../src/composables/useSupermodules.js')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { FLOW_IDS, SUPER_INSTANCE_NODE_TYPE } = await import('../../../src/utils/constants.js')
const { connect, exposed, exposures, module, port, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

const IN = port('entrance_ports', 'vessel', ['v_in'])
const OUT = port('exit_ports', 'vessel', ['v'])
const vessel = (localId, name, scope) => module(localId, name, { scope, ports: [{ ...IN }, { ...OUT }] })

/** Two circulatory_autogen super-modules, heart (sm_1: ra → lv) and lung (sm_2: wall), each with two super instances. */
function graph() {
  const source = (moduleRef) => ({ format: 'circulatory_autogen', moduleRef, hash: 'h', contentHash: 'pending' })
  const heart = supermodule('sm_1', 'heart', { source: source('heart') })
  const lung = supermodule('sm_2', 'lung', { source: source('lung') })
  const [ra, lv, wall] = [vessel('ra', 'ra', 'sm_1'), vessel('lv', 'lv', 'sm_1'), vessel('wall', 'wall', 'sm_2')]
  const heartPorts = exposures('sm_1', [exposed('xp_0', 'ra', 'entrance_ports', 'vessel'), exposed('xp_1', 'lv', 'exit_ports', 'vessel')])
  const lungPorts = exposures('sm_2', [exposed('xp_2', 'wall', 'entrance_ports', 'vessel')])
  const heartStore = { nodes: [heart, ra, lv], edges: heartPorts }
  const lungStore = { nodes: [lung, wall], edges: lungPorts }
  const nodes = [
    superInstance(heartStore, 'dndnode_0', 'left', 'sm_1'),
    superInstance(heartStore, 'dndnode_1', 'right', 'sm_1'),
    superInstance(lungStore, 'dndnode_2', 'upper', 'sm_2'),
    superInstance(lungStore, 'dndnode_3', 'lower', 'sm_2'),
    module('dndnode_4', 'a'),
    heart,
    ra,
    lv,
    lung,
    wall,
  ]
  const edges = [connect(ra, lv, { id: 'e_int' }), ...heartPorts, ...lungPorts]
  for (const node of [heart, lung]) node.data.supermodule.source.contentHash = supermoduleContentHash(node.id, nodes, edges)
  return { nodes, edges }
}

describe('hierarchy hot paths', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)

  beforeEach(() => {
    setActivePinia(createPinia())
    flow.nodes.value = []
    flow.edges.value = []
    const { nodes, edges } = graph()
    flow.addNodes(nodes)
    flow.addEdges(edges)
    vi.clearAllMocks()
  })

  it('hashes a library super-module again only when what it holds changes, and only that one', () => {
    const { templateOf } = useSupermodules()
    expect([templateOf('sm_1').matches, templateOf('sm_2').matches]).toEqual([true, true])
    vi.clearAllMocks()

    flow.applyNodeChanges([
      { id: 'sm_1~ra', type: 'select', selected: true },
      { id: 'sm_1~lv', type: 'position', position: { x: 40, y: 80 }, dragging: true },
    ])
    flow.applyEdgeChanges([{ id: 'e_int', type: 'select', selected: true }])
    flow.findEdge('e_int').sourceX = 12
    expect([templateOf('sm_1').matches, templateOf('sm_2').matches]).toEqual([true, true])
    expect(supermoduleContentHash).not.toHaveBeenCalled()

    flow.updateNodeData('sm_1~lv', { name: 'renamed' })
    expect([templateOf('sm_1').matches, templateOf('sm_2').matches]).toEqual([false, true])
    expect(supermoduleContentHash.mock.calls.map(([smId]) => smId)).toEqual(['sm_1'])
    vi.clearAllMocks()

    // Written in place, as the editors do, rather than replaced.
    flow.findNode('sm_2~wall').data.name = 'renamed'
    expect([templateOf('sm_1').matches, templateOf('sm_2').matches]).toEqual([false, false])
    expect(supermoduleContentHash.mock.calls.map(([smId]) => smId)).toEqual(['sm_2'])
  })

  it('gives each super instance its own copies of its super-module’s ports, resolved for them all at once', () => {
    const nodes = flow.nodes.value.map((node) => (node.type === SUPER_INSTANCE_NODE_TYPE ? { ...node, data: { ...node.data, ports: [] } } : node))
    const { nodes: changed } = materialiseSuperInstances(nodes, flow.edges.value)
    const [left, right] = [changed.get('dndnode_0').ports, changed.get('dndnode_1').ports]
    expect(left).toEqual(right)
    expect(left).not.toBe(right)
    left.forEach((port, i) => expect(port).not.toBe(right[i]))
  })

  it('works out which canvas nodes are simulated once, for every card', () => {
    const level = useCanvasLevel()
    const results = useSimulationResultsStore()
    results.scopeNodeIds = ['dndnode_0/lv', 'dndnode_4']
    results.results = { voi: { values: [] } }
    const simulated = level.simulatedIds.value
    expect([...simulated].sort()).toEqual(['dndnode_0', 'dndnode_4', 'sm_1~lv'])
    for (const node of flow.nodes.value) {
      const expected = level.modelIdsOf([node.id]).some((id) => results.scopeNodeIds.includes(id))
      expect(simulated.has(node.id)).toBe(expected)
    }
    expect(level.simulatedIds.value).toBe(simulated)
  })

  it('shares one lookup of exposed ports’ owners per flow', () => {
    const ownersOf = useExposedPortOwners()
    expect(useExposedPortOwners()).toBe(ownersOf)
    expect(ownersOf('sm_1')).toBe(ownersOf('sm_1'))
    expect([...ownersOf('sm_1')]).toEqual([
      ['xp_0', 'ra'],
      ['xp_1', 'lv'],
    ])
    expect(ownersOf('missing')).toEqual(new Map())
  })

  it('asks nothing, and plans nothing, about deleting an empty selection', () => {
    const { selectionNeedsAsking } = useCanvasDelete({ confirm: vi.fn(), history: { startBatch() {}, endBatch() {} } })
    expect(selectionNeedsAsking.value).toBe(false)
    expect(portResolver).not.toHaveBeenCalled()

    flow.findNode('dndnode_4').selected = true
    expect(selectionNeedsAsking.value).toBe(false)
    expect(portResolver).toHaveBeenCalled()
    expect(planUnexpose).not.toHaveBeenCalled()
  })
})
