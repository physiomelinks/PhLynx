// @vitest-environment happy-dom
/**
 * Nest, un-nest and Make unique keep the model: the expansion after each exports as the one before did, its modules
 * renamed as the edit renames them, and resolves the same boundary values. On the workspace each is one undo step
 * that puts back every store, and keeps the global constants the modules it moves use.
 */
import { useVueFlow } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { useFlowHistory } from '../../../src/composables/useFlowHistory.js'
import { useHierarchyOperations } from '../../../src/composables/useHierarchyOperations.js'
import { resolveBoundaryValues } from '../../../src/services/export/boundaryValues.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { makeUnique, modelIdMap, nestSelection, unnest } from '../../../src/services/hierarchy/operations.js'
import { compareCanonical } from '../../../src/services/testing/modelCompare.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useInspectionModuleStore } from '../../../src/stores/inspectionModuleStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { isSuperInstance } from '../../../src/utils/hierarchy.js'
import {
  bcOnlyThroughInterface,
  exposureLeavesInternalCouplings,
  loadBundledLibrary,
  moduleFactory,
  multiply,
  threeInstances,
  twoLevel,
  venousFanIn,
} from '../fixtures/hierarchy/equivalence.js'
import { connect, constant, exposed, exposures, module, port, shuffled, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Exporting through libcellml takes seconds per test on CI.
vi.setConfig({ testTimeout: 120000 })

vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() } }))

// The generated components' variables are named in the order edges are exported, so compare them by what they join.
const GENERATED = ['generated_summations', 'generated_multiplications']

/** The expansion of a store, each module named as `nameOf` says. */
function renamedExpansion({ nodes, edges }, nameOf) {
  const expansion = expandHierarchy(nodes, edges)
  return { nodes: expansion.nodes.map((node) => ({ ...node, data: { ...node.data, name: nameOf(node.id) } })), edges: expansion.edges }
}

/** A model's boundary values, by module name: what is supplied, missing, summed from nothing and ignored. */
function boundaryBuckets({ nodes, edges }) {
  const nameOf = new Map(nodes.map((node) => [node.id, node.data.name]))
  const { supplied, missing, emptySums, ignored } = resolveBoundaryValues(nodes, edges)
  const named = (map) => [...map].map(([id, names]) => `${nameOf.get(id)}: ${[...names].sort()}`).sort()
  return { supplied: named(supplied), missing: named(missing), emptySums: named(emptySums), ignored: named(ignored) }
}

describe('nest and un-nest keep the model the bundled modules make', () => {
  let store
  let make

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadBundledLibrary(store)
    make = moduleFactory(store)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  const exportOf = async ({ nodes, edges }) =>
    (await generateFlattenedModel(nodes, edges, store, [], { check: false, allowBcOnly: true })).text()

  /** Expects an edit to leave the model as it was: the same CellML and boundary values, the modules renamed. */
  async function expectSameModel(before, after, label) {
    expect(after.problems, label).toEqual([])
    const { idMap, nameOf } = modelIdMap(before, after, after.rewrite)
    const expansion = expandHierarchy(after.nodes, after.edges)
    expect(expansion.errors.filter((error) => error.severity === 'error'), label).toEqual([])
    const renamed = renamedExpansion(before, (id) => nameOf(idMap.get(id) ?? id))
    expect(boundaryBuckets(expansion), label).toEqual(boundaryBuckets(renamed))
    const result = compareCanonical(await exportOf(expansion), await exportOf(renamed), { nameByConnection: GENERATED })
    expect(result.differences, label).toEqual([])
  }

  /** Composes two edits' rewrites, as one edit from the first's store to the second's. */
  const composed = (first, second) => ({ ...second, rewrite: (chain) => second.rewrite(first.rewrite(chain)) })

  it.each([
    ['venous fan-in', venousFanIn],
    ['Multiply', multiply],
    ['two levels', twoLevel],
    ['three instances', threeInstances],
    ['an exposed port beside an internal coupling', exposureLeavesInternalCouplings],
    ['boundary conditions only through an interface', bcOnlyThroughInterface],
  ])('%s', async (_, fixture) => {
    const { nested, flat } = fixture(make)

    // The flat graph, all but its first module nested, edges in any order; and back.
    for (const seed of [0, 7]) {
      const graph = seed ? { ...flat, edges: shuffled(flat.edges, seed) } : flat
      const ids = graph.nodes.slice(1).map((node) => node.id)
      const nestedFlat = nestSelection(graph.nodes, graph.edges, ids, { name: 'wrap' })
      await expectSameModel(graph, nestedFlat, `nest, seed ${seed}`)
      const back = unnest(nestedFlat.nodes, nestedFlat.edges, nestedFlat.superInstanceId)
      await expectSameModel(graph, composed(nestedFlat, back), `un-nest, seed ${seed}`)
      expect(back.nodes).toHaveLength(graph.nodes.length)
      expect(back.edges).toHaveLength(graph.edges.length)
    }

    // The nested graph: each super instance at the root un-nested, and the root's modules and super instances nested.
    for (const node of nested.nodes.filter((candidate) => isSuperInstance(candidate) && candidate.data.scope === null)) {
      await expectSameModel(nested, unnest(nested.nodes, nested.edges, node.id), `un-nest ${node.data.name}`)
    }
    const roots = nested.nodes.filter((node) => node.data.scope === null)
    if (roots.length > 1) {
      const wrapped = nestSelection(nested.nodes, nested.edges, roots.slice(1).map((node) => node.id), { name: 'wrap' })
      await expectSameModel(nested, wrapped, 'nest the root')
    }
    // Every super instance's super-module, made unique for it.
    for (const node of nested.nodes.filter(isSuperInstance)) {
      await expectSameModel(nested, makeUnique(nested.nodes, nested.edges, node.id), `make ${node.data.name} unique`)
    }
  })
})

describe('nest, un-nest and Make unique on the workspace', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let history, listeners, operations, library, settings, inspection

  const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])
  const OUT = port('exit_ports', 'vessel', ['v', 'u_out'])
  const vessel = (localId, name, options = {}) =>
    module(localId, name, { ports: [{ ...IN }, { ...OUT }], variables: [constant('R', '1')], ...options })

  /** a → b → c, b using a global constant nothing else uses. */
  function chain() {
    const a = vessel('dndnode_0', 'a')
    const b = vessel('dndnode_1', 'b', { variables: [constant('R', '2'), { name: 'rho_only_b', type: 'global_constant', units: 'dimensionless' }] })
    const c = vessel('dndnode_2', 'c')
    const used = new Set()
    return { nodes: [a, b, c], edges: [connect(a, b, { used }), connect(b, c, { used })] }
  }

  /** One super-module (seg: s) used by three super instances in series. */
  function segments() {
    const s = vessel('s', 's', { scope: 'sm_1' })
    const sm = supermodule('sm_1', 'seg', { submoduleOrder: ['s'] })
    const exposure = exposures('sm_1', [exposed('xp_in', 's', 'entrance_ports', 'vessel'), exposed('xp_out', 's', 'exit_ports', 'vessel')])
    const inner = { nodes: [sm, s], edges: exposure }
    const segs = ['2', '3', '5'].map((value, i) => superInstance(inner, `dndnode_${i}`, `seg${i + 1}`, 'sm_1', { overrides: { s: { R: { value } } } }))
    const used = new Set()
    return { nodes: [...segs, sm, s], edges: [connect(segs[0], segs[1], { used }), connect(segs[1], segs[2], { used }), ...exposure] }
  }

  /** The store as saved: each node's and edge's model fields, by id. */
  const snapshot = () => ({
    nodes: flow.nodes.value.map(({ id, type, data }) => ({ id, type, data: JSON.parse(JSON.stringify(data)) })).sort((x, y) => x.id.localeCompare(y.id)),
    edges: flow.edges.value
      .map(({ id, type, source, target, data }) => ({ id, type, source, target, data: JSON.parse(JSON.stringify(data ?? {})) }))
      .sort((x, y) => x.id.localeCompare(y.id)),
  })
  /** The keyed stores' state. */
  const keys = () => JSON.stringify([settings.plotConfig, settings.parameterScanConfig, inspection.modules])
  const plotted = (nodeId) => ({ key: `${nodeId}::R`, nodeId, nodeName: nodeId, variableName: 'R', units: '', type: 'constant', plot: true, groupId: 'plot-1' })

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    history = useFlowHistoryStore()
    library = useLibraryStore()
    settings = useSimulationSettingsStore()
    inspection = useInspectionModuleStore()
    flow.applyDefault.value = false
    const { onNodeChange, onEdgeChange } = useFlowHistory({
      suppressedEdgeIds: new Set(),
      indexAddEdge: vi.fn(),
      indexRemoveEdge: vi.fn(),
      updateHelperLines: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
    })
    listeners = [flow.onNodesChange(onNodeChange), flow.onEdgesChange(onEdgeChange)]
    level.reset()
    await flow.fromObject({ nodes: [], edges: [] })
    operations = useHierarchyOperations({ history })
  })

  afterEach(() => {
    listeners.forEach((listener) => listener.off())
    flow.applyDefault.value = true
    vi.restoreAllMocks()
  })

  async function load(graph) {
    await flow.fromObject(level.withVisibility(graph))
    history.clear()
  }

  it('nests as one undo step, keys and globals following, and undoes and redoes it whole', async () => {
    await load(chain())
    library.assignGlobalConstant('rho_only_b', '3', 'dimensionless', 'test')
    settings.setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [plotted('dndnode_1'), plotted('dndnode_0')] })
    inspection.addModule({ id: 'i1', name: 'm', units: '', variables: [{ key: 'dndnode_1::R', nodeId: 'dndnode_1', nodeName: 'b' }] })
    const [flatStore, flatKeys] = [snapshot(), keys()]

    const { done, result } = await operations.nest(['dndnode_1', 'dndnode_2'], 'tail')
    expect(done).toBe(true)
    await nextTick()
    const nestedStore = snapshot()
    const nestedKeys = keys()
    const superInstanceId = result.superInstanceId
    expect(flow.findNode(superInstanceId).data).toMatchObject({ name: 'tail', smId: 'sm_0' })
    expect(flow.findNode('dndnode_1')).toBeUndefined()
    expect(flow.findNode('sm_0~dndnode_1').hidden).toBe(true)
    expect(settings.plotConfig.selections.map((selection) => [selection.key, selection.nodeName])).toEqual([
      [`${superInstanceId}/dndnode_1::R`, 'tail__b'],
      ['dndnode_0::R', 'dndnode_0'],
    ])
    expect(inspection.modules[0].variables[0].nodeId).toBe(`${superInstanceId}/dndnode_1`)
    expect(library.getGlobalConstant('rho_only_b')).toBeTruthy()
    expect(history.canUndo).toBe(true)

    await history.undo()
    await nextTick()
    expect(snapshot()).toEqual(flatStore)
    expect(keys()).toBe(flatKeys)
    expect(library.getGlobalConstant('rho_only_b')).toBeTruthy()
    expect(history.canUndo).toBe(false)

    await history.redo()
    await nextTick()
    expect(snapshot()).toEqual(nestedStore)
    expect(keys()).toBe(nestedKeys)
    expect(library.getGlobalConstant('rho_only_b')).toBeTruthy()
  })

  it('un-nests as one undo step, keys and globals following back', async () => {
    await load(chain())
    library.assignGlobalConstant('rho_only_b', '3', 'dimensionless', 'test')
    settings.setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [plotted('dndnode_1')] })
    const { result } = await operations.nest(['dndnode_1', 'dndnode_2'], 'tail')
    await nextTick()
    const [nestedStore, nestedKeys] = [snapshot(), keys()]

    const { done, result: unnested } = await operations.unnestSuperInstance(result.superInstanceId)
    expect(done).toBe(true)
    await nextTick()
    expect(unnested.removedSupermodule).toBe(true)
    expect(flow.nodes.value.map((node) => node.data.name)).toEqual(['a', 'b', 'c'])
    const b = flow.nodes.value.find((node) => node.data.name === 'b')
    expect(settings.plotConfig.selections[0]).toMatchObject({ key: `${b.id}::R`, nodeId: b.id, nodeName: 'b' })
    expect(library.getGlobalConstant('rho_only_b')).toBeTruthy()

    await history.undo()
    await nextTick()
    expect(snapshot()).toEqual(nestedStore)
    expect(keys()).toBe(nestedKeys)
    expect(library.getGlobalConstant('rho_only_b')).toBeTruthy()
  })

  it('has Vue Flow measure again the handles of the nodes it keeps whose handles move, and again on undo', async () => {
    const graph = chain()
    const [a] = graph.nodes
    a.data.handles = [{ uid: 'h_a', side: 'right', name: '', slotIndex: 4, variant: 'default' }]
    graph.edges[0].sourceHandle = 'h_a'
    await load(graph)
    const measured = vi.spyOn(flow, 'updateNodeInternals')
    await operations.nest(['dndnode_1', 'dndnode_2'], 'tail')
    await nextTick()
    expect(flow.findNode('dndnode_0').data.handles).not.toEqual(a.data.handles)
    expect(measured.mock.calls.flat(2)).toContain('dndnode_0')
    measured.mockClear()
    await history.undo()
    await nextTick()
    expect(measured.mock.calls.flat(2)).toContain('dndnode_0')
  })

  it('asks before an un-nest changes flat names, and changes nothing when declined', async () => {
    await load(chain())
    const { result } = await operations.nest(['dndnode_1', 'dndnode_2'], 'tail')
    await nextTick()
    const nestedStore = snapshot()
    const confirm = vi.fn().mockResolvedValue(false)
    const asking = useHierarchyOperations({ history, confirm })
    const outcome = await asking.unnestSuperInstance(result.superInstanceId)
    expect(outcome.done).toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0].message).toContain('tail__b → b')
    expect(snapshot()).toEqual(nestedStore)
  })

  it('makes one super instance unique as one undo step, the others’ model unchanged', async () => {
    await load(segments())
    const before = snapshot()
    const others = () => expandHierarchy(flow.nodes.value, flow.edges.value).nodes.filter((node) => !node.id.startsWith('dndnode_1/')).map((node) => [node.id, node.data])
    const othersBefore = JSON.stringify(others())
    expect(operations.canMakeUnique('dndnode_1')).toBe(true)

    expect((await operations.makeUniqueSuperInstance('dndnode_1')).done).toBe(true)
    await nextTick()
    expect(flow.findNode('dndnode_1').data.smId).toBe('sm_2')
    expect(JSON.stringify(others())).toBe(othersBefore)
    expect(operations.canMakeUnique('dndnode_1')).toBe(false)

    await history.undo()
    await nextTick()
    expect(snapshot()).toEqual(before)
  })

  describe('of a super-module keeping its components’ own names', () => {
    beforeEach(async () => {
      const graph = segments()
      const sm = graph.nodes.find((node) => node.id === 'sm_1')
      sm.data.supermodule = { ...sm.data.supermodule, naming: 'preserve' }
      await load(graph)
    })

    it('asks, then makes it unique as planned when nothing changed meanwhile', async () => {
      const confirm = vi.fn(async () => true)
      const { done } = await useHierarchyOperations({ history, confirm }).makeUniqueSuperInstance('dndnode_1')
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Flat Names Will Change' }))
      expect(done).toBe(true)
      expect(flow.findNode('dndnode_1').data.smId).toBe('sm_2')
    })

    it('makes nothing when the flat names it asked about changed while it asked', async () => {
      const before = snapshot()
      const confirm = vi.fn(async () => {
        const node = flow.findNode('dndnode_1')
        node.data = { ...node.data, name: 'renamed' }
        return true
      })
      const { done, problems } = await useHierarchyOperations({ history, confirm }).makeUniqueSuperInstance('dndnode_1')
      expect(done).toBe(false)
      expect(problems[0]).toMatch(/changed/)
      expect(flow.findNode('dndnode_1').data.smId).toBe('sm_1')
      expect(snapshot().nodes.filter((node) => node.id !== 'dndnode_1')).toEqual(before.nodes.filter((node) => node.id !== 'dndnode_1'))
    })
  })

  it('refuses to nest an interface node, changing nothing', async () => {
    await load(segments())
    const before = snapshot()
    const { done, problems } = await operations.nest(['sm_1', 'sm_1~s'], 'x')
    expect(done).toBe(false)
    expect(problems[0]).toMatch(/interface/)
    expect(snapshot()).toEqual(before)
    expect(history.canUndo).toBe(false)
  })
})
