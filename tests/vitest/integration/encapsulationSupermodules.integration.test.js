// @vitest-environment happy-dom
/**
 * Importing a CellML model's encapsulation as super-modules (#364): each encapsulating component a super-module with
 * naming 'preserve', its own maths a self leaf; the flat export the hoisted model's, and the hierarchical export the
 * original structure.
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { patchUnderscoreTagSelectors } from '../helpers/happyDom.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

vi.setConfig({ testTimeout: 120000 })

// loadFromCellML with the canvas stubbed: it hands its nodes to addNodes, the root's edges to prepareLayout and the
// edges inside super-modules to addEdges.
const canvas = vi.hoisted(() => ({ addNodes: vi.fn(), addEdges: vi.fn(), prepareLayout: vi.fn() }))
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes: { value: [] }, addNodes: canvas.addNodes, addEdges: canvas.addEdges }),
}))
vi.mock('../../../src/composables/useClearWorkspace', () => ({ useClearWorkspace: () => ({ clearWorkspace: async () => {} }) }))
vi.mock('../../../src/composables/useWorkflowLayout', () => ({ useWorkflowLayout: () => ({ prepareLayout: canvas.prepareLayout }) }))
vi.mock('../../../src/composables/useGtm', () => ({ useGtm: () => ({ trackEvent: () => {} }) }))
vi.mock('../../../src/services/layouts/scopes', () => ({ layoutSupermoduleScopes: async () => {} }))
vi.mock('../../../src/utils/notify', () => ({ notify: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

const { useLoadFromCellML } = await import('../../../src/composables/useLoadFromCellml.js')
const { parseCellMLConnections } = await import('../../../src/services/import/parseCellmlConnections.js')
const { prepareCellmlImport } = await import('../../../src/services/import/prepareCellml.js')
const { buildHierarchicalCellML, flattenHierarchicalModel } = await import('../../../src/services/export/cellmlHierarchical.js')
const { expandHierarchy } = await import('../../../src/services/hierarchy/expand.js')
const { canonicalModel, compareCanonical, compareSimulations } = await import('../../../src/services/testing/modelCompare.js')
const { flatNameChanges, makeUnique, nestSelection, preserveConflicts, unnest, withPrefixedNaming } = await import('../../../src/services/hierarchy/operations.js')
const { toPath } = await import('../../../src/services/hierarchy/names.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { generateFlattenedModel, hoistEncapsulatedComponents, loadParametersFromCellML, processCellMLData, readEncapsulation } = await import(
  '../../../src/utils/cellml.js'
)
const { notify } = await import('../../../src/utils/notify')
const { COMPONENTS, FILE, STATES, WRAPPER_COMPONENTS, encapsulatedModel } = await import('../fixtures/encapsulatedCellml.js')

describe('importing CellML encapsulation as super-modules (#364)', () => {
  let store
  let restoreSelectors

  beforeAll(async () => {
    restoreSelectors = patchUnderscoreTagSelectors()
    await ensureLibCellmlReady()
  })

  afterAll(() => restoreSelectors?.())

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    notify.warning.mockClear()
  })

  afterEach(() => vi.restoreAllMocks())

  /**
   * Imports a CellML file as a drop does: prepared once, registered in the library and built into the workspace, its
   * encapsulation folded unless `flat`.
   *
   * @returns {Promise<{nodes: Array, edges: Array}>}
   */
  async function importModel(xml, { flat = false } = {}) {
    const cellml = prepareCellmlImport(xml, FILE)
    const processed = processCellMLData(cellml)
    expect(processed.type).toBe('success')
    store.addMathFile(FILE, processed.components)
    store.addUnitsFile({ componentFile: FILE, model: processed.units.model })
    for (const mock of Object.values(canvas)) mock.mockClear()
    canvas.prepareLayout.mockResolvedValue()
    const encapsulation = flat ? undefined : readEncapsulation(xml)
    await useLoadFromCellML().loadFromCellML(parseCellMLConnections(cellml, FILE), FILE, loadParametersFromCellML(cellml), { encapsulation })
    return { nodes: canvas.addNodes.mock.calls[0][0], edges: [...canvas.prepareLayout.mock.calls[0][0], ...(canvas.addEdges.mock.calls[0]?.[0] ?? [])] }
  }

  /** The flat export of the store's graph. */
  async function flatExport({ nodes, edges }) {
    const expansion = expandHierarchy(nodes, edges)
    expect(expansion.errors.filter((error) => error.severity === 'error')).toEqual([])
    return (await generateFlattenedModel(expansion.nodes, expansion.edges, store)).text()
  }

  const SUPERMODULES = ['sodium_current', 'potassium_current', 'potassium_current_n_gate', 'calcium_wrapper']
  const wrapped = () => encapsulatedModel('', { wrapper: true })
  const byName = (nodes, name) => nodes.find((node) => node.data?.supermodule?.name === name)
  const inScope = (nodes, smId) => nodes.filter((node) => node.data?.scope === smId && !node.data?.supermodule)
  const variablesOf = (edges) => edges.flatMap((edge) => (edge.data?.couplings ?? []).flatMap((c) => [...c.sourcePort.variables, ...c.targetPort.variables]))

  it('makes each encapsulating component a super-module with one super instance, its own maths its self leaf', async () => {
    const { nodes, edges } = await importModel(wrapped())

    const interfaces = nodes.filter((node) => node.data?.supermodule)
    expect(interfaces.map((node) => node.data.supermodule.name)).toEqual(SUPERMODULES)
    expect(interfaces.map((node) => node.data.supermodule.naming)).toEqual(SUPERMODULES.map(() => 'preserve'))
    expect(interfaces[0].data.supermodule.source).toEqual({ format: 'cellml', component: 'sodium_current', file: FILE })
    // The root: membrane and one super instance of each outermost encapsulating component, where it was.
    const root = nodes.filter((node) => !node.data.scope)
    expect(root.map((node) => [node.type, node.data.name])).toEqual([
      ['instanceNode', 'membrane'],
      ['superInstanceNode', 'sodium_current'],
      ['superInstanceNode', 'potassium_current'],
      ['superInstanceNode', 'calcium_wrapper'],
    ])
    expect(nodes.filter((node) => node.data.scope).every((node) => node.hidden)).toBe(true)

    // Each super-module's children: its self leaf, then its children by their own names, a nested one a super instance.
    const children = (name) => inScope(nodes, byName(nodes, name).id).map((node) => [node.data.localId, node.data.name, node.data.originalName, node.data.role ?? node.type])
    expect(children('sodium_current')).toEqual([
      ['self', 'self', 'sodium_current', 'self'],
      ['dndnode_0', 'sodium_current_m_gate', 'sodium_current_m_gate', 'instanceNode'],
      ['dndnode_1', 'sodium_current_h_gate', 'sodium_current_h_gate', 'instanceNode'],
    ])
    expect(children('potassium_current')).toEqual([
      ['self', 'self', 'potassium_current', 'self'],
      ['dndnode_0', 'potassium_current_n_gate', 'potassium_current_n_gate', 'superInstanceNode'],
    ])
    // A pure wrapper's self leaf only relays.
    const relay = inScope(nodes, byName(nodes, 'calcium_wrapper').id)[0]
    expect(relay.data.role).toBe('self')
    expect(store.getMathEntry(relay.data.mathRef).math).not.toMatch(/<math/)

    // Exposure: from each self leaf, exactly the ports connected outside; the private ones stay on internal edges.
    const exposed = (name) => {
      const smId = byName(nodes, name).id
      return edges.filter((edge) => edge.type === 'exposure' && edge.target === smId).map((edge) => [edge.source, edge.data.exposed.map((entry) => [entry.id, entry.alias.label, entry.order])])
    }
    expect(exposed('sodium_current')).toEqual([['sm_0~self', [['xp_0', 'V__membrane', 0], ['xp_1', 'i_Na__sodium_current', 1]]]])
    expect(exposed('potassium_current_n_gate')).toEqual([['sm_2~self', [['xp_6', 'V__potassium_current', 0], ['xp_7', 'n__potassium_current_n_gate', 1]]]])
    const internal = (name) => edges.filter((edge) => edge.type !== 'exposure' && nodes.find((node) => node.id === edge.source).data.scope === byName(nodes, name).id)
    expect(internal('sodium_current').map((edge) => [edge.source, edge.target])).toEqual([
      ['sm_0~self', 'sm_0~dndnode_0'],
      ['sm_0~self', 'sm_0~dndnode_1'],
    ])
    expect(internal('potassium_current')).toHaveLength(1)
    // Outside, the super instance's couplings name its exposed ports.
    const toSodium = edges.find((edge) => edge.target === root[1].id)
    expect(toSodium.data.couplings.map((c) => c.targetPort.exposedPortId)).toEqual(['xp_0', 'xp_1'])
    // No time relays.
    expect(variablesOf(edges)).not.toContain('time')
  })

  it('keeps every component its own flat name, found by path and by flat name', async () => {
    const expansion = expandHierarchy(...Object.values(await importModel(wrapped())))

    expect(expansion.nodes.map((node) => node.data.name).sort()).toEqual([...WRAPPER_COMPONENTS].sort())
    const id = expansion.idOf('sodium_current_m_gate')
    expect(expansion.pathOf(id)).toBe('sodium_current/sodium_current_m_gate')
    expect(expansion.nameOf(expansion.idOf('sodium_current/self'))).toBe('sodium_current')
    expect(toPath('potassium_current_n_gate_alpha', expansion)).toBe('potassium_current/potassium_current_n_gate/potassium_current_n_gate_alpha')
    expect(expansion.errors).toEqual([])
  })

  it('exports flat as the hoisted model imports flat, simulating as the original does', async () => {
    const xml = wrapped()
    const nested = await flatExport(await importModel(xml))
    const flat = await flatExport(await importModel(xml, { flat: true }))

    expect(compareCanonical(flat, nested)).toEqual({ equal: true, differences: [] })
    // Against the hoisted original, only the values the flat export moves into its parameters differ.
    const { differences } = compareCanonical(hoistEncapsulatedComponents(xml).cellml, nested, { ignore: ['interface', 'encapsulation'] })
    expect(differences.filter((line) => !/instance_parameters|initial value|variable \w+_init only in B/.test(line))).toEqual([])
    const simulated = await compareSimulations(xml, nested, { endTime: 2 })
    expect(simulated.details.missing).toEqual([])
    expect(simulated.details.variables.map((variable) => variable.name).sort()).toEqual([...STATES].sort())
    expect(simulated.equal).toBe(true)
  })

  it('exports hierarchically as the original encapsulation: each self leaf its wrapper, every component its own name', async () => {
    const xml = wrapped()
    const graph = await importModel(xml)
    const { files, host, preserved } = await buildHierarchicalCellML(graph.nodes, graph.edges, store)

    // The main file and one file per super-module at the root, beside the shared units file; modules under modules/.
    const atRoot = [...files.keys()].filter((file) => !file.startsWith('modules/') && file !== 'units.cellml')
    expect(atRoot.sort()).toEqual(['model.cellml', ...SUPERMODULES.map((name) => `${name}.cellml`)].sort())
    expect([...files.keys()].some((file) => file.startsWith('modules/'))).toBe(true)
    expect(preserved.sort()).toEqual(SUPERMODULES.map((name) => `${name}.cellml`).sort())
    expect(files.get('sodium_current.cellml')).toMatch(/<component name="sodium_current">\s*<variable name="time"/)
    expect(files.get('sodium_current.cellml')).not.toMatch(/name="self"/)

    const { cellml } = await flattenHierarchicalModel(files, host, { preserved })
    const [original, exported] = [canonicalModel(xml), canonicalModel(cellml)]
    expect(exported.encapsulation).toEqual(original.encapsulation)
    expect(Object.keys(exported.components).filter((name) => name !== 'instance_parameters')).toEqual(Object.keys(original.components))
    for (const [name, component] of Object.entries(original.components)) expect(exported.components[name].equations, name).toEqual(component.equations)
    const simulated = await compareSimulations(xml, cellml, { endTime: 2 })
    expect(simulated.details.missing).toEqual([])
    expect(simulated.equal).toBe(true)
  })

  it('keeps preserved names when flattening a hierarchical export nested in a prefixed super-module', async () => {
    const graph = await importModel(wrapped())
    const sodium = graph.nodes.find((node) => node.data.smId === byName(graph.nodes, 'sodium_current').id)
    const nested = nestSelection(graph.nodes, graph.edges, [sodium.id], { name: 'wrap', position: { x: 0, y: 0 } })
    expect(nested.problems).toEqual([])

    const result = await buildHierarchicalCellML(nested.nodes, nested.edges, store)
    expect(result.selfNamed).toContain('sodium_current.cellml')
    const { cellml } = await flattenHierarchicalModel(result.files, result.host, result)
    // Only the new super-module's empty wrapper is extra: the self leaf keeps its own name, not wrap__sodium_current.
    const names = (xml) => Object.keys(canonicalModel(xml).components).sort()
    expect(names(cellml)).toEqual([...names(await flatExport(nested)), 'wrap'].sort())
  })

  it('un-nests to the components themselves, the model unchanged', async () => {
    const graph = await importModel(wrapped())
    const sodium = graph.nodes.find((node) => node.data.smId === byName(graph.nodes, 'sodium_current').id)
    const after = unnest(graph.nodes, graph.edges, sodium.id)

    expect(after.problems).toEqual([])
    const root = after.nodes.filter((node) => !node.data.scope && !node.data.supermodule)
    expect(root.map((node) => node.data.name)).toEqual(expect.arrayContaining(['sodium_current', 'sodium_current_m_gate', 'sodium_current_h_gate']))
    expect(root.some((node) => node.data.role || node.data.originalName)).toBe(false)
    expect(compareCanonical(await flatExport(graph), await flatExport(after))).toEqual({ equal: true, differences: [] })
  })

  it('imports flat (hoisted) as before when asked', async () => {
    const { nodes, edges } = await importModel(wrapped(), { flat: true })

    expect(nodes.map((node) => node.data.name).sort()).toEqual([...WRAPPER_COMPONENTS].sort())
    expect(nodes.every((node) => !node.data.scope && node.type === 'instanceNode')).toBe(true)
    expect(edges).toHaveLength(8)
    expect(canvas.addEdges).not.toHaveBeenCalled()
  })

  it('imports a model without the wrapper as before, but nested', async () => {
    const { nodes } = await importModel(encapsulatedModel())
    expect(expandHierarchy(nodes, []).nodes.map((node) => node.data.name).sort()).toEqual([...COMPONENTS].sort())
    expect(notify.warning).not.toHaveBeenCalled()
  })

  it('switches a super-module to prefixed names once it would occur twice, listing the flat names that change', async () => {
    const { nodes } = await importModel(wrapped())
    const sodium = byName(nodes, 'sodium_current')
    const potassium = byName(nodes, 'potassium_current')
    const nGate = byName(nodes, 'potassium_current_n_gate')
    const another = (smId) => [...nodes, { id: 'dndnode_99', type: 'superInstanceNode', data: { scope: null, smId, name: 'x' } }]

    expect(preserveConflicts(nodes)).toEqual([])
    expect(preserveConflicts(another(sodium.id))).toEqual([sodium.id])
    // Another potassium_current is another n gate too.
    expect(preserveConflicts(another(potassium.id))).toEqual([potassium.id, nGate.id])
    expect(flatNameChanges(nodes, withPrefixedNaming(nodes, [sodium.id]))).toEqual([
      { from: 'sodium_current_m_gate', to: 'sodium_current__sodium_current_m_gate' },
      { from: 'sodium_current_h_gate', to: 'sodium_current__sodium_current_h_gate' },
    ])
    // Make unique gives a copy named after its super instance.
    const instance = nodes.find((node) => node.data.smId === sodium.id)
    const unique = makeUnique([...nodes, { ...instance, id: 'dndnode_99', data: { ...instance.data, name: 'x' } }], [], 'dndnode_99')
    expect(unique.nodes.find((node) => node.id === unique.smId).data.supermodule.naming).toBe('prefixed')
  })

  it('names a prefixed self leaf after its super instance, the flat and hierarchical exports alike', async () => {
    const graph = await importModel(wrapped())
    const sodium = byName(graph.nodes, 'sodium_current')
    const prefixed = { nodes: withPrefixedNaming(graph.nodes, [sodium.id]), edges: graph.edges }

    const expansion = expandHierarchy(prefixed.nodes, prefixed.edges)
    const self = expansion.idOf('sodium_current')
    expect(expansion.pathOf(self)).toBe('sodium_current/self')
    expect(expansion.idOf('sodium_current/self')).toBe(self)
    expect(toPath('sodium_current', expansion)).toBe('sodium_current/self')
    expect(expansion.nameOf(expansion.idOf('sodium_current/sodium_current_m_gate'))).toBe('sodium_current__sodium_current_m_gate')

    const flat = await flatExport(prefixed)
    const components = Object.keys(canonicalModel(flat).components)
    expect(components).toContain('sodium_current')
    expect(components.some((name) => name.endsWith('__self'))).toBe(false)
    const result = await buildHierarchicalCellML(prefixed.nodes, prefixed.edges, store)
    const { cellml, wrappers } = await flattenHierarchicalModel(result.files, result.host, result)
    // Every wrapper is a self leaf, holding its maths and relaying the rest; parameters are named after what they set.
    const options = { partialRelays: wrappers, nameByConnection: ['instance_parameters', 'global_parameters'], ignore: ['interface', 'encapsulation'] }
    expect(compareCanonical(cellml, flat, options)).toEqual({ equal: true, differences: [] })
    const simulated = await compareSimulations(flat, cellml, { endTime: 2 })
    expect(simulated.details.missing).toEqual([])
    expect(simulated.equal).toBe(true)
 
    // Un-nested, it keeps its flat name.
    const after = unnest(prefixed.nodes, prefixed.edges, prefixed.nodes.find((node) => node.data.smId === sodium.id).id)
    expect(after.problems).toEqual([])
    expect(compareCanonical(flat, await flatExport(after))).toEqual({ equal: true, differences: [] })
  })
})
