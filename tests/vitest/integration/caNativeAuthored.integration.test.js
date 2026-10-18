// @vitest-environment happy-dom
/**
 * The native circulatory_autogen export of PhLynx-authored super-modules: written natively once named, checked by
 * expanding them as CA would; written flat, with a notice, where they have no identity or CA can't express them.
 */
import JSZip from 'jszip'
import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildFlatExport, generateExportZip } from '../../../src/services/export/ca.js'
import { caIdentityProblem, caIdentityRequests, planNativeExport } from '../../../src/services/export/caNative.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { indexExposures } from '../../../src/services/hierarchy/exposure.js'
import { supermoduleContentHash } from '../../../src/services/hierarchy/operations.js'
import { buildCaModel, foldCaModel } from '../../../src/services/import/caFold.js'
import { parameterFileLoader } from '../../../src/services/import/caParameters.js'
import { expandSupermodules } from '../../../src/services/import/caSupermodules.js'
import { normaliseModuleRecords } from '../../../src/services/import/caModuleArray.js'
import { supermoduleTemplate } from '../../../src/services/import/caModuleConfig.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { loadBundledLibrary, moduleFactory, threeInstances, twoLevel } from '../fixtures/hierarchy/equivalence.js'
import { named, nestedLimb } from '../fixtures/ca/native.js'
import { connect } from '../fixtures/hierarchy/graph.js'
import { libraryOf, parseCsv } from '../helpers/caLibrary.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'
import { EXPOSURE_EDGE_TYPE } from '../../../src/utils/constants.js'
import { isSupermoduleInterface } from '../../../src/utils/hierarchy.js'

vi.setConfig({ testTimeout: 120000 })

const notified = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

async function readZip(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await zip.file(name).async('string')])))
}
const csvRows = (text) => Papa.parse(text, { header: true, skipEmptyLines: true }).data
const flatNotice = () => notified.info.mock.calls.map(([note]) => note).find((note) => note.title === 'Super-modules Written Flat')

describe('the native circulatory_autogen export of a PhLynx-authored workspace', () => {
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
    notified.info.mockClear()
  })

  afterEach(() => vi.restoreAllMocks())

  /** Exports a store graph natively and flat. */
  const exportBoth = async (graph) => {
    const expansion = expandHierarchy(graph.nodes, graph.edges)
    const native = await readZip(await generateExportZip('m', expansion.nodes, expansion.edges, store, null, { hierarchy: graph }))
    const flat = await readZip(await generateExportZip('m', expansion.nodes, expansion.edges, store))
    return { native, flat }
  }

  it('writes a named nested super-module natively: per_submodule_* to its hosts, its values as its parameterisation', async () => {
    const { native, flat } = await exportBoth(nestedLimb(make))
    expect(flatNotice()).toBeUndefined()
    const records = JSON.parse(native['m_module_array.json'])
    expect(records).toEqual([
      { name: 'aorta', module_type: 'arterial_simple', module_subtype: 'pv', inp_instances: [], out_instances: ['leg'] },
      { name: 'leg', module_type: 'limb', module_subtype: 'phlynx_v1', inp_instances: [], out_instances: [], parameterisation: 'default', per_submodule_inputs: { art: ['aorta'] }, per_submodule_outputs: { vein: ['vc'] } },
      { name: 'vc', module_type: 'venous', module_subtype: 'vp', inp_instances: ['leg'], out_instances: [] },
    ])
    const [limb] = JSON.parse(native['supermodules/limb/versions/phlynx_v1/limb_phlynx_v1_modules_config.json'])
    expect(limb.submodules).toEqual([
      { name: 'art', module_type: 'arterial_simple', module_subtype: 'pv', inp_instances: [], out_instances: ['bed'] },
      { name: 'bed', module_type: 'capillary_bed', module_subtype: 'phlynx_v1', inp_instances: [], out_instances: [], parameterisation: 'default', per_submodule_inputs: { cap: ['art'] }, per_submodule_outputs: { cap: ['vein'] } },
      { name: 'vein', module_type: 'venous', module_subtype: 'vp', inp_instances: ['bed'], out_instances: [] },
    ])
    expect(limb.phlynx_interface).toEqual([
      { submodule: 'art', ports: 'entrance_ports', port_type: 'vessel_port', slot: 0, name: 'vessel_port' },
      { submodule: 'vein', ports: 'exit_ports', port_type: 'vessel_port', slot: 0, name: 'vessel_port' },
    ])
    expect(Object.keys(limb.phlynx_layout.submodules)).toEqual(['art', 'bed', 'vein'])

    // The super instances' overrides are the host's rows, by path; the definition's are below it.
    const host = new Map(csvRows(native['m_parameters.csv']).map((row) => [row.variable_name, row.value]))
    expect([host.get('leg/art/R'), host.get('leg/bed/cap/R_T')]).toEqual(['4', '3'])
    const limbRows = new Map(csvRows(native['supermodules/limb/versions/phlynx_v1/parameterisations/default/default_parameters.csv']).map((row) => [row.variable_name, row.value]))
    expect(limbRows.get('bed/cap/R_T')).toBe('2')
    expect(limbRows.get('art/R')).toBe('1')

    // CA's expansion of it is the flat export's module array, the names joined with '__'.
    const registry = new Map(
      Object.entries(native)
        .filter(([file]) => file.endsWith('_modules_config.json') && file.startsWith('supermodules/'))
        .map(([file, text]) => supermoduleTemplate(JSON.parse(text)[0], file))
        .map((template) => [template.moduleRef, template])
    )
    const expanded = expandSupermodules(normaliseModuleRecords(records, 'm'), registry, { separator: '__' })
    const flatRecords = JSON.parse(flat['m_module_array.json'])
    expect(expanded.records.map(({ name, module_type, module_subtype }) => ({ name, module_type, module_subtype }))).toEqual(
      flatRecords.map(({ name, module_type, module_subtype }) => ({ name, module_type, module_subtype }))
    )
    for (const file of Object.keys(flat).filter((file) => file.startsWith('modules/'))) expect(native[file]).toBe(flat[file])
  })

  it('gives back its layout and exposed ports when imported again, a label and a port no edge uses included', async () => {
    const graph = nestedLimb(make)
    // limb also exposes vein's inlet, which nothing outside uses, and calls art's inlet "inflow".
    const limbExposure = graph.edges.filter((edge) => edge.type === EXPOSURE_EDGE_TYPE && edge.target === 'sm_1')
    limbExposure.find((edge) => edge.source === 'sm_1~art').data.exposed[0].label = 'inflow'
    limbExposure.find((edge) => edge.source === 'sm_1~vein').data.exposed.push({ id: 'xp_vin', alias: { portType: 'entrance_ports', label: 'vessel_port', slot: 0 }, order: 2 })
    graph.nodes.find((node) => node.id === 'sm_1~vein').position = { x: 40, y: 300 }
    const { native } = await exportBoth(graph)
    expect(flatNotice()).toBeUndefined()

    // As a folder of the zip is imported.
    const paths = new Map()
    const parameterFiles = new Map()
    for (const [file, text] of Object.entries(native)) {
      if (!file.startsWith('supermodules/')) continue
      if (file.endsWith('_modules_config.json')) {
        const entries = JSON.parse(text)
        store.addConfigFile(file.split('/').at(-1), entries)
        entries.forEach((entry) => paths.set(`${entry.module_type}:${entry.module_subtype}`, file))
      } else parameterFiles.set(file, parseCsv(text))
    }
    const load = parameterFileLoader(parameterFiles, paths)
    const library = libraryOf(store)
    const built = buildCaModel(normaliseModuleRecords(JSON.parse(native['m_module_array.json']), 'm'), library, { load, hostRows: parseCsv(native['m_parameters.csv']) })
    const again = foldCaModel(built, library, { load })

    const interfaceOf = ({ nodes, edges }) => {
      const exposures = indexExposures(nodes, edges)
      const nameOf = (smId, localId) => nodes.find((node) => node.data.scope === smId && node.data.localId === localId)?.data.name
      return nodes.filter(isSupermoduleInterface).map((node) => ({
        name: node.data.supermodule.ca.module_type,
        ports: (exposures.get(node.id) ?? []).map(({ alias, label }) => ({ ...alias, child: nameOf(node.id, alias.child), label })),
        positions: nodes.filter((child) => child.data.scope === node.id).map((child) => [child.data.name ?? 'interface', child.position]).sort(),
      })).sort((a, b) => a.name.localeCompare(b.name))
    }
    expect(interfaceOf(again)).toEqual(interfaceOf(graph))
    expect(again.positioned).toEqual(new Set(again.nodes.filter(isSupermoduleInterface).map((node) => node.id)))
    const values = (g) => Object.fromEntries(expandHierarchy(g.nodes, g.edges).nodes.flatMap((node) => node.data.variables.map((row) => [`${node.data.name}.${row.name}`, row.value])))
    expect(values(again)).toEqual(values(graph))
  })

  it('writes three super instances of one super-module natively, each linked to the next and with its own values', async () => {
    const graph = threeInstances(make).nested
    named(graph.nodes.find((node) => node.id === 'sm_1'), 'segment')
    const { native } = await exportBoth(graph)
    expect(flatNotice()).toBeUndefined()
    const records = JSON.parse(native['m_module_array.json'])
    // A host that is a super instance too lists it back, as CA needs to link them.
    expect(records.map((record) => [record.name, record.inp_instances, record.out_instances, record.per_submodule_inputs ?? null, record.per_submodule_outputs ?? null])).toEqual([
      ['seg1', [], ['seg2'], null, { a: ['seg2'] }],
      ['seg2', ['seg1'], ['seg3'], { a: ['seg1'] }, { a: ['seg3'] }],
      ['seg3', ['seg2'], [], { a: ['seg2'] }, null],
    ])
    const host = new Map(csvRows(native['m_parameters.csv']).map((row) => [row.variable_name, row.value]))
    expect(['seg1/a/R', 'seg2/a/R', 'seg3/a/R'].map((name) => host.get(name))).toEqual(['2', '3', '5'])
  })

  it('writes a super-module flat, with every super instance of it, when expanding it as CA would differs from the flat export', () => {
    const graph = threeInstances(make).nested
    named(graph.nodes.find((node) => node.id === 'sm_1'), 'segment')
    const expansion = expandHierarchy(graph.nodes, graph.edges)
    const plan = (change) => {
      const flat = buildFlatExport(expansion.nodes, expansion.edges, store)
      change(flat)
      return planNativeExport({ ...graph, expansion, flat, library: store })
    }
    expect(plan(() => {}).fallbacks).toEqual([])

    // A module of one super instance exported with a config of its own, as the planner may give it, can't be its
    // super-module's.
    const variant = plan((flat) => (flat.rows.find((row) => row.name === 'seg2__a').module_subtype = 'vp__0123abcd'))
    expect(variant.records).toBeNull()
    expect(variant.fallbacks).toEqual([{ smId: 'sm_1', name: 'segment', reason: expect.stringContaining('is wired otherwise inside "seg2"') }])

    // A value CA would give otherwise.
    const value = plan((flat) => (flat.parametersOf.get(flat.rows.find((row) => row.name === 'seg1__a').id).find((row) => row.variable_name === 'R_seg1__a').value = '99'))
    expect(value.fallbacks).toEqual([{ smId: 'sm_1', name: 'segment', reason: 'would have CA give seg1__a other values than here' }])
  })

  it('writes a super-module without an identity flat, as the flat export does, naming it', async () => {
    const { native, flat } = await exportBoth(nestedLimb(make, { identities: false }))
    expect(native).toEqual(flat)
    expect(flatNotice().items[0]).toContain('"limb" has no circulatory_autogen identity')
    expect(flatNotice().items[0]).toContain('"capillary_bed" has no circulatory_autogen identity')
  })

  it("writes a super-module flat when CA's '_'-joined names of its modules clash with another module's", async () => {
    const graph = nestedLimb(make)
    // CA names leg's art leg_art, as this artery is named.
    const artery = make('dndnode_9', 'leg_art', 'arterial_simple:pv')
    const vein = make('dndnode_10', 'leg_vc', 'venous:vp', { values: { Delta_q_us: '0', Delta_C: '0' } })
    const { native, flat } = await exportBoth({ nodes: [...graph.nodes, artery, vein], edges: [...graph.edges, connect(artery, vein, { id: 'e_x' })] })
    expect(native).toEqual(flat)
    expect(flatNotice().items[0]).toContain('"limb" gives modules CA names that clash')
  })

  it("writes a super-module exposing a nested super instance's port flat, with every super instance of it", async () => {
    const graph = twoLevel(make).nested
    named(graph.nodes.find((node) => node.id === 'sm_1'), 'limb')
    named(graph.nodes.find((node) => node.id === 'sm_2'), 'capillary_bed')
    const { native, flat } = await exportBoth(graph)
    expect(native).toEqual(flat)
    const [message] = flatNotice().items
    expect(message).toContain('"limb" exposes a port of a super instance inside it')
    expect(message).not.toContain('"capillary_bed"')
  })

  it('asks for an identity for each super-module without one, offering its name and a free phlynx_v<n>', () => {
    const graph = nestedLimb(make, { identities: false })
    // A component has limb's first offer.
    store.addConfigFile('taken.json', [{ module_type: 'limb', module_subtype: 'phlynx_v1', component_file: 'BG_modules.cellml', component_type: 'vp_simple_type', entrance_ports: [], exit_ports: [], general_ports: [], variables_and_units: [] }])
    const requests = caIdentityRequests(graph.nodes, graph.edges, store)
    expect(requests.map(({ smId, name, reason, suggestion }) => ({ smId, name, reason, suggestion }))).toEqual([
      { smId: 'sm_1', name: 'limb', reason: 'new', suggestion: { module_type: 'limb', module_subtype: 'phlynx_v2' } },
      { smId: 'sm_2', name: 'capillary_bed', reason: 'new', suggestion: { module_type: 'capillary_bed', module_subtype: 'phlynx_v1' } },
    ])
  })

  it("checks an identity by CA's name rules, and that no component or other super-module has it", () => {
    const options = { smId: 'sm_1', library: store, taken: new Map([['bed:phlynx_v1', 'sm_2']]) }
    expect(caIdentityProblem({ module_type: 'limb', module_subtype: 'phlynx_v1' }, options)).toBeNull()
    expect(caIdentityProblem({ module_type: 'my limb', module_subtype: 'v1' }, options)).toMatch(/module_type/)
    expect(caIdentityProblem({ module_type: 'limb', module_subtype: 'v1__x' }, options)).toMatch(/module_subtype/)
    expect(caIdentityProblem({ module_type: 'venous', module_subtype: 'vp' }, options)).toMatch(/component/)
    expect(caIdentityProblem({ module_type: 'bed', module_subtype: 'phlynx_v1' }, options)).toMatch(/Another super-module/)
    // Changed from a template the library no longer has, it still can't take the template's identity.
    expect(caIdentityProblem({ module_type: 'limb', module_subtype: 'default' }, { ...options, from: 'limb:default' })).toMatch(/library super-module/)
  })

  it("asks for a new identity for a library super-module once what it holds changed, and keeps the template's while not", () => {
    const graph = nestedLimb(make)
    // As the import leaves them: each with the content it was made with, a nested one too.
    for (const [smId, moduleRef] of [['sm_1', 'limb:phlynx_v1'], ['sm_2', 'capillary_bed:phlynx_v1']]) {
      graph.nodes.find((node) => node.id === smId).data.supermodule.source = {
        format: 'circulatory_autogen',
        moduleRef,
        caHash: supermoduleContentHash(smId, graph.nodes, graph.edges, { exposure: false }),
      }
    }
    expect(caIdentityRequests(graph.nodes, graph.edges, store)).toEqual([])
    graph.nodes.find((node) => node.id === 'sm_1~art').data.variables.find((row) => row.name === 'R').value = '9'
    expect(caIdentityRequests(graph.nodes, graph.edges, store).map(({ smId, reason, from }) => ({ smId, reason, from }))).toEqual([
      { smId: 'sm_1', reason: 'changed', from: 'limb:phlynx_v1' },
    ])
  })
})
