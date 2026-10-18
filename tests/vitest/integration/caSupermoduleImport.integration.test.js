// @vitest-environment happy-dom
/**
 * A circulatory_autogen module array with super-modules, imported as super instances, is the model CA builds: the expansion
 * of the fold exports the CellML, values included, of CA's own expansion built flat, its names mapped from '__' to CA's
 * '_' between levels. Checked on the circulatory-autogen-modules super-module system models, an occurrence forked for
 * its own internal couplings, and host parameters naming nested modules. The palette places a library super-module, and
 * reuses it when dropped again.
 */
import { useVueFlow } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowHistory } from '../../../src/composables/useFlowHistory.js'
import { useSupermodules } from '../../../src/composables/useSupermodules.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { buildCaModel, foldCaModel, importCaModuleArray } from '../../../src/services/import/caFold.js'
import { compareCanonical } from '../../../src/services/testing/modelCompare.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { notify } from '../../../src/utils/notify.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { EXPOSURE_EDGE_TYPE, FLOW_IDS } from '../../../src/utils/constants.js'
import { isSuperInstance, isSupermoduleInterface } from '../../../src/utils/hierarchy.js'
import { libraryOf, loadCaLibrary, systemModel } from '../helpers/caLibrary.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Exporting through libcellml takes seconds per test on CI.
vi.setConfig({ testTimeout: 120000 })

vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() } }))
// Called through, so a test can see what the palette builds with and add to what it returns.
vi.mock('../../../src/services/import/caFold.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, importCaModuleArray: vi.fn(actual.importCaModuleArray) }
})

const THREE_COMPARTMENT = 'system_models/closed_loop_cvs/3compartment_supermodules'
const SN_SIMPLE = 'system_models/cellular/SN_simple_supermodules'
// CA joins levels with '_' until CA#582.
const toCa = (name) => name.replace(/__/g, '_')

/** A model's values by CA flat name: `name.variable` -> value. */
const valuesOf = (nodes, nameOf = (node) => node.data.name) =>
  Object.fromEntries(nodes.flatMap((node) => (node.data.variables ?? []).map((row) => [`${toCa(nameOf(node))}.${row.name}`, row.value ?? null])))

describe('circulatory_autogen module arrays with super-modules', () => {
  let store
  let load

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    ;({ load } = loadCaLibrary(store))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  const exportOf = async ({ nodes, edges }) =>
    (await generateFlattenedModel(nodes, edges, store, [], { check: false, allowBcOnly: true })).text()

  /** Folds a module array and expects its expansion to be CA's flat build, CellML and values. */
  async function expectFoldIsCa(rows, hostRows, loader = load) {
    const library = libraryOf(store)
    const model = buildCaModel(rows, library, { load: loader, hostRows })
    const folded = foldCaModel(model, library, { load: loader })
    for (const { name, value, units, data_reference } of model.globals) store.assignGlobalConstant(name, value, units, data_reference)

    const expansion = expandHierarchy(folded.nodes, folded.edges)
    expect(expansion.errors.filter((error) => error.severity === 'error')).toEqual([])
    expect(expansion.nodes.map((node) => toCa(node.data.name)).sort()).toEqual(model.nodes.map((node) => node.data.name).sort())
    expect(valuesOf(expansion.nodes)).toEqual(valuesOf(model.nodes))
    const result = compareCanonical(await exportOf(expansion), await exportOf(model), {
      renameA: toCa,
      renameVariableA: (_, variable) => toCa(variable),
    })
    expect(result.differences).toEqual([])
    return { model, folded, expansion }
  }

  it('folds 3compartment_supermodules into a heart super instance that exports as CA builds it', async () => {
    const { rows, hostRows } = systemModel(THREE_COMPARTMENT)
    const { folded } = await expectFoldIsCa(rows, hostRows)
    const [heart] = folded.nodes.filter(isSupermoduleInterface)
    expect(heart.data.supermodule).toMatchObject({ name: 'heart', ca: { module_type: 'heart', module_subtype: 'Argus2026_v01' } })
    const children = folded.nodes.filter((node) => node.data.scope === heart.id && !isSupermoduleInterface(node))
    expect(children.map((node) => node.data.name)).toEqual(['clock', 'ra', 'rv', 'la', 'lv', 'trv', 'puv', 'miv', 'aov'])
    // Exposed: the inputs to ra and la first, in per_submodule_inputs order, then the outputs in per_submodule_outputs order.
    const exposureOf = (name) => folded.edges.find((edge) => edge.type === EXPOSURE_EDGE_TYPE && edge.source === children.find((c) => c.data.name === name).id)
    const ordered = ['ra', 'la', 'puv', 'aov', 'rv', 'lv']
      .flatMap((name) => exposureOf(name).data.exposed.map((entry) => [entry.order, name, entry.alias.portType, entry.alias.label]))
      .sort(([a], [b]) => a - b)
      .map(([, ...rest]) => rest.join(' '))
    expect(ordered).toEqual([
      'ra entrance_ports vessel_port',
      'la entrance_ports vessel_port',
      'puv exit_ports vessel_port',
      'aov exit_ports vessel_port',
      'ra exit_ports volume_port',
      'rv exit_ports volume_port',
      'la exit_ports volume_port',
      'lv exit_ports volume_port',
    ])
  })

  it('folds SN_simple_supermodules through three levels of super-modules', async () => {
    const { rows, hostRows } = systemModel(SN_SIMPLE)
    const { folded, model } = await expectFoldIsCa(rows, hostRows)
    expect(folded.nodes.filter(isSupermoduleInterface).map((node) => node.data.supermodule.name)).toEqual(['soma', 'varicosity', 'neuron'])
    expect(folded.nodes.filter((node) => (node.data.scope ?? null) === null).map((node) => node.data.name)).toEqual(['SN'])
    expect(model.globals.map((row) => row.name)).toEqual(['R', 'F', 'T'])
  })

  it('forks a heart whose host takes a slot its own internal edge has elsewhere', async () => {
    const { rows, hostRows } = systemModel(THREE_COMPARTMENT)
    // h, before heart2, holds heart2's rv inlet, so heart2's trv → rv can't be made.
    const extra = [
      { name: 'h', module_type: 'venous', module_subtype: 'vp', inp_instances: [], out_instances: ['heart2'] },
      { name: 'heart2', module_type: 'heart', module_subtype: 'Argus2026_v01', inp_instances: ['h'], out_instances: [], per_submodule_inputs: { rv: ['h'] } },
    ]
    // h takes pvn's values, and no flow in, having no input.
    const hRows = [
      ...hostRows.filter((r) => r.variable_name.endsWith('_pvn')).map((r) => ({ ...r, variable_name: r.variable_name.replace(/_pvn$/, '_h') })),
      { variable_name: 'v_in_h', units: 'm3_per_s', value: '0', data_reference: 'test' },
    ]
    const { folded, model } = await expectFoldIsCa([...rows, ...extra], [...hostRows, ...hRows])
    expect(model.conflicts).toHaveLength(1)
    expect(folded.nodes.filter(isSupermoduleInterface).map((node) => node.data.supermodule.name)).toEqual(['heart', 'heart_2'])
    expect(folded.warnings).toEqual([expect.stringContaining('heart (heart); heart_2 (heart2)')])
  })

  it('applies host rows naming modules inside the heart, by path or flat name, as overrides on the heart', async () => {
    const { rows, hostRows } = systemModel(THREE_COMPARTMENT)
    const row = (variable_name, value) => ({ variable_name, units: 'J_per_m6', value, data_reference: 'test' })
    const { folded, expansion } = await expectFoldIsCa(rows, [row('heart/lv/E_A', '400000000'), row('E_B_heart_rv', '12345'), ...hostRows])
    const heart = folded.nodes.find((node) => isSuperInstance(node) && node.data.name === 'heart')
    const localId = (name) => folded.nodes.find((node) => node.data.scope === heart.data.smId && node.data.name === name).data.localId
    expect(heart.data.overrides[localId('lv')].E_A).toEqual({ value: '400000000' })
    expect(heart.data.overrides[localId('rv')].E_B).toEqual({ value: '12345' })
    const valueAt = (path, name) => expansion.nodes.find((node) => expansion.pathOf(node.id) === path).data.variables.find((v) => v.name === name).value
    expect([valueAt('heart/lv', 'E_A'), valueAt('heart/rv', 'E_B')]).toEqual(['400000000', '12345'])
    // The heart's own default for lv's E_A stays on the super-module.
    expect(folded.nodes.find((node) => node.id === `${heart.data.smId}~${localId('lv')}`).data.variables.find((v) => v.name === 'E_A').value).toBe('366575000')
  })

  it('shares nested super-modules between two neurons, taking host over outer over nested values', async () => {
    const row = (variable_name, value) => ({ variable_name, units: 'picoF', value, data_reference: 'test' })
    // The neuron's default also sets its soma's membrane C_sensed, which the soma's own default sets to 2.
    const outerLoad = (entry, request) => {
      const rows = load(entry, request)
      return entry.module_type === 'neuron' && request.parameterisation === 'default' ? [row('soma/membrane/C_sensed', '3'), ...rows] : rows
    }
    const neuron = (name) => ({ name, module_type: 'neuron', module_subtype: 'sympathetic', parameterisation: 'default', inp_instances: [], out_instances: [] })
    const { model, folded } = await expectFoldIsCa([neuron('SNa'), neuron('SNb')], [row('SNb/soma/membrane/C_sensed', '5')], outerLoad)
    expect(folded.nodes.filter(isSupermoduleInterface).map((node) => node.data.supermodule.name)).toEqual(['soma', 'varicosity', 'neuron'])
    const values = valuesOf(model.nodes)
    expect([values['SNa_soma_membrane.C_sensed'], values['SNb_soma_membrane.C_sensed']]).toEqual(['3', '5'])
  })
})

describe('the palette places a library super-module', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  let listeners

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(async () => {
    setActivePinia(createPinia())
    const library = useLibraryStore()
    // As the import dialog keeps the parameter files dropped with the configs.
    const { files, configPaths } = loadCaLibrary(library)
    library.addCaParameterFiles(files, configPaths)
    useFlowHistoryStore()
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
    await flow.fromObject({ nodes: [], edges: [] })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    listeners.forEach((listener) => listener.off())
    flow.applyDefault.value = true
    vi.restoreAllMocks()
  })

  it('as a workspace super-module built from its submodules, then reuses it', async () => {
    const supermodules = useSupermodules()
    expect(supermodules.librarySupermodules.value.map((entry) => entry.moduleRef)).toContain('neuron:sympathetic')

    const first = await supermodules.placeLibrarySupermodule('neuron:sympathetic', { x: 10, y: 20 })
    const interfaces = () => flow.nodes.value.filter(isSupermoduleInterface)
    expect(interfaces().map((node) => node.data.supermodule.name)).toEqual(['soma', 'varicosity', 'neuron'])
    const neuron = interfaces().at(-1)
    expect(flow.findNode(first)).toMatchObject({ position: { x: 10, y: 20 }, data: { name: 'neuron', smId: neuron.id, ports: [] } })
    // Nothing is exposed at its own level until the user exposes it; the soma's membrane is, for the axon inside.
    expect(flow.edges.value.filter((edge) => edge.type === EXPOSURE_EDGE_TYPE && edge.target === neuron.id)).toEqual([])
    expect(flow.edges.value.some((edge) => edge.type === EXPOSURE_EDGE_TYPE)).toBe(true)
    expect(expandHierarchy(flow.nodes.value, flow.edges.value).nodes).toHaveLength(28)

    const second = await supermodules.placeLibrarySupermodule('neuron:sympathetic', { x: 300, y: 20 })
    expect(interfaces()).toHaveLength(3)
    expect(flow.findNode(second).data).toMatchObject({ name: 'neuron_2', smId: neuron.id })
    expect(supermodules.find(neuron.id).count).toBe(2)

    // Placed, each matches the template it was made from, until an edit changes what it holds.
    await nextTick()
    expect(interfaces().map((node) => supermodules.templateOf(node.id).matches)).toEqual([true, true, true])
    expect(supermodules.templateOf(neuron.id).label).toBe('neuron:sympathetic')
    const child = flow.nodes.value.find((node) => node.data?.scope === neuron.id && !isSupermoduleInterface(node))
    flow.removeNodes([child.id])
    await nextTick()
    expect(supermodules.templateOf(neuron.id).matches).toBe(false)
  })

  it("builds with the library's CA variants, and says what the build warns about", async () => {
    const actual = importCaModuleArray.getMockImplementation()
    importCaModuleArray.mockImplementationOnce((...args) => ({ ...actual(...args), warnings: ['<b>forked</b>'], conflicts: ['a → b'] }))

    const id = await useSupermodules().placeLibrarySupermodule('neuron:sympathetic', { x: 0, y: 0 })

    expect(id).toBeTruthy()
    expect(importCaModuleArray.mock.calls.at(-1)[1].variants).toBe(useLibraryStore().caVariants)
    expect(notify.warning).toHaveBeenCalledWith(expect.objectContaining({ items: ['<b>forked</b>'], sticky: true }))
    expect(notify.warning).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connections Not Made', items: ['a → b'] }))
  })
})
