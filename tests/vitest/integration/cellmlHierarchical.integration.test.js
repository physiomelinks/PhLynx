// @vitest-environment happy-dom
/**
 * The CellML export with imports (H14): each file validates, a module definition's on its own, every units is defined
 * once, in units.cellml, which every other file imports its units from, and the host, its imports resolved and flattened and its super instances' children renamed `<super instance>__<child>`, is the flat export's
 * model, canonically and simulated.
 */
import createLibOpenCOR from '@opencor/libopencor'
import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildHierarchicalCellML, flattenHierarchicalModel, generateHierarchicalCellMLZip, normalisePath, UNITS_FILE } from '../../../src/services/export/cellmlHierarchical.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { compareCanonical, compareSimulations } from '../../../src/services/testing/modelCompare.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import { generateFlattenedModel, isStandardUnit } from '../../../src/utils/cellml.js'
import { MAIN_NODE_TYPE } from '../../../src/utils/constants.js'
import { nodeIdOf } from '../../../src/utils/hierarchy.js'
import { connect, exposed, exposures, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'
import {
  bcOnlyThroughInterface,
  hubBranches,
  loadBundledLibrary,
  localConstantBranches,
  localConstantSegments,
  moduleFactory,
  multiply,
  threeInstances,
  twoLevel,
  venousFanIn,
  exposureLeavesInternalCouplings,
} from '../fixtures/hierarchy/equivalence.js'
import { libraryOf, loadCaLibrary, systemModel } from '../helpers/caLibrary.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'
import { buildCaModel, foldCaModel } from '../../../src/services/import/caFold.js'

vi.setConfig({ testTimeout: 120000 })

// Generated components, the host's or a super instance's (`<super instance>__generated_summations` once renamed).
const GENERATED = /^(?:(.+)__)?(generated_summations|generated_multiplications|affine_unit_conversions)$/
const BY_CONNECTION = ['generated_summations', 'generated_multiplications', 'affine_unit_conversions', 'instance_parameters', 'global_parameters']

/**
 * Flattens a hierarchical export and compares it with a flat CellML, the wrappers only relaying, but those that are self
 * leaves (`selves`) holding their maths.
 */
async function compareWithFlat({ files, host }, flat, { selves = [] } = {}) {
  const { cellml, wrappers: all } = await flattenHierarchicalModel(files, host)
  const wrappers = all.filter((name) => !selves.includes(name))
  const result = compareCanonical(cellml, flat, {
    renameA: (name) => name.match(GENERATED)?.[2] ?? name,
    renameVariableA: (component, variable) => {
      const prefix = component.match(GENERATED)?.[1]
      return prefix ? `${prefix}__${variable}` : variable
    },
    relays: wrappers,
    partialRelays: selves,
    mergeRenamed: true,
    equivalentUnits: true,
    nameByConnection: BY_CONNECTION,
    ignore: ['interface', 'encapsulation'],
  })
  return { ...result, cellml }
}

const TANK_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="tank">
  <component name="tank">
    <variable name="t" units="second" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="q_init" units="dimensionless" initial_value="1" interface="public"/>
    <variable name="v_sum" units="per_second" interface="public"/>
    <variable name="u" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply><apply><minus/><ci>v_sum</ci></apply></apply>
      <apply><eq/><ci>u</ci><ci>q</ci></apply>
    </math>
  </component>
</model>`
const DRAIN_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="drain">
  <component name="drain">
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v" units="per_second" interface="public"/>
    <variable name="k" units="per_second" initial_value="0.5" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>v</ci><apply><times/><ci>k</ci><ci>u</ci></apply></apply></math>
  </component>
</model>`

/**
 * A super-module whose own maths is its self leaf (#364): a tank draining through its Sum port into a child drain, used
 * twice, each super instance with its own k and starting volume.
 */
function selfLeafTanks(store) {
  store.addUnitsFile({ componentFile: 'per_second.cellml', model: '<model xmlns="http://www.cellml.org/cellml/2.0#" name="u"><units name="per_second"><unit units="second" exponent="-1"/></units></model>' })
  store.addMath('file:tank', TANK_XML)
  store.addMath('file:drain', DRAIN_XML)
  const build = (localId, name, mathRef, ports, data = {}) => {
    const portVariables = new Set(ports.flatMap((port) => port.variables))
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], { defaults: store.getMathDefaults(mathRef) }).map((row) => ({
      ...row,
      type: row.type === 'constant' && portVariables.has(row.name) ? 'boundary_condition' : row.type,
    }))
    return { id: nodeIdOf('sm_1', localId), type: MAIN_NODE_TYPE, data: { scope: 'sm_1', localId, name, mathRef, variables: rows, ports, ...data } }
  }
  const tank = build('tank', 'tank', 'file:tank', [{ portType: 'exit_ports', label: 'vessel', variables: ['v_sum', 'u'], multiportType: ['sum', 'True'] }], { role: 'self' })
  const drain = build('drain', 'drain', 'file:drain', [{ portType: 'entrance_ports', label: 'vessel', variables: ['v', 'u'], multiportType: 'None' }])
  const sm = supermodule('sm_1', 'reservoir', { submoduleOrder: ['tank', 'drain'] })
  const inner = [sm, tank, drain]
  const instances = [
    superInstance(inner, 'dndnode_0', 'p1', 'sm_1', { overrides: { drain: { k: { value: '0.25' } } } }),
    superInstance(inner, 'dndnode_1', 'p2', 'sm_1', { overrides: { tank: { q_init: { value: '2' } } } }),
  ]
  return { nodes: [...instances, ...inner], edges: [connect(tank, drain, { id: 'e_int' })] }
}

const BRANCH_G_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="branch">
  <component name="branch">
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v" units="per_second" interface="public"/>
    <variable name="k" units="per_second" initial_value="0.5" interface="public"/>
    <variable name="g" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>v</ci><apply><times/><ci>g</ci><ci>k</ci><ci>u</ci></apply></apply></math>
  </component>
</model>`

/**
 * Builds tanks (TANK_XML, draining through a Sum port) and branches (v = g·k·u, g a global constant 2), rows typed as
 * the canvas types them: a port's constants boundary conditions, `local` names local constants, `globals` global ones.
 */
function tankKit(store) {
  store.addUnitsFile({ componentFile: 'per_second.cellml', model: '<model xmlns="http://www.cellml.org/cellml/2.0#" name="u"><units name="per_second"><unit units="second" exponent="-1"/></units></model>' })
  store.addMath('file:tank', TANK_XML)
  store.addMath('file:branch_g', BRANCH_G_XML)
  store.assignGlobalConstant('g', '2', 'dimensionless', 'test')
  const build = (mathRef, ports) => (localId, name, { scope = null, values = {}, local = [], globals = ['g'], role } = {}) => {
    const portVariables = new Set(ports.flatMap((port) => port.variables))
    const typeOf = (row) =>
      globals.includes(row.name) ? 'global_constant' : local.includes(row.name) ? 'local_constant' : row.type === 'constant' && portVariables.has(row.name) ? 'boundary_condition' : row.type
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], { defaults: store.getMathDefaults(mathRef) }).map((row) => ({
      ...row,
      type: typeOf(row),
      ...(row.name in values && { value: values[row.name] }),
    }))
    const data = { scope, localId, name, mathRef, variables: rows, ports: structuredClone(ports), ...(role && { role }) }
    return { id: nodeIdOf(scope, localId), type: MAIN_NODE_TYPE, data }
  }
  return {
    module: build,
    tank: build('file:tank', [{ portType: 'exit_ports', label: 'vessel', variables: ['v_sum', 'u'], multiportType: ['sum', 'True'] }]),
    branch: build('file:branch_g', [{ portType: 'entrance_ports', label: 'vessel', variables: ['v', 'u'], multiportType: 'None' }]),
  }
}

let libcellml

/** A model's issues, as libcellml's Validator or Analyser gives them. */
const issuesOf = (text, Checker, check) => {
  const parser = new libcellml.Parser(false)
  const checker = new Checker()
  const model = parser.parseModel(text)
  checker[check](model)
  const issues = Array.from({ length: checker.issueCount() }, (_, i) => checker.issue(i).description())
  ;[model, checker, parser].forEach((object) => object.delete())
  return issues
}
const validationOf = (text) => issuesOf(text, libcellml.Validator, 'validateModel')
const analysisOf = (text) => issuesOf(text, libcellml.Analyser, 'analyseModel')

/** Every import of a file, as `href name component_ref`. */
const importsOf = (text) =>
  Array.from(new DOMParser().parseFromString(text, 'application/xml').getElementsByTagName('import')).flatMap((element) =>
    Array.from(element.getElementsByTagName('component')).map(
      (component) => `${element.getAttribute('xlink:href')} ${component.getAttribute('name')} ${component.getAttribute('component_ref')}`
    )
  ).sort()
/**
 * Expects units.cellml to define, once each, every units the files use, standard ones aside, and those they are made of,
 * and every other file to import those it uses from it, defining none.
 */
const expectSharedUnits = (files) => {
  const parse = (text) => new DOMParser().parseFromString(text, 'application/xml').documentElement
  const children = (element, tag) => Array.from(element.children).filter((child) => child.localName === tag)
  expect(files.has(UNITS_FILE)).toBe(true)
  const shared = parse(files.get(UNITS_FILE))
  expect(children(shared, 'import')).toEqual([])
  const defined = children(shared, 'units').map((units) => units.getAttribute('name'))
  expect(new Set(defined).size, 'no units defined twice').toBe(defined.length)
  const needed = new Set()
  const use = (name) => name && !isStandardUnit(name) && needed.add(name)
  for (const units of children(shared, 'units')) for (const unit of children(units, 'unit')) use(unit.getAttribute('units'))
  for (const [file, text] of files) {
    if (file === UNITS_FILE) continue
    const model = parse(text)
    expect(children(model, 'units'), `${file} defines no units`).toEqual([])
    const imported = new Set()
    for (const element of children(model, 'import')) {
      for (const units of children(element, 'units')) {
        expect(normalisePath(`${file.slice(0, file.lastIndexOf('/') + 1)}${element.getAttribute('xlink:href')}`), file).toBe(UNITS_FILE)
        expect(element.getAttribute('xlink:href')).toBe(file.includes('/') ? `../${UNITS_FILE}` : UNITS_FILE)
        expect(units.getAttribute('units_ref')).toBe(units.getAttribute('name'))
        imported.add(units.getAttribute('name'))
      }
    }
    const used = new Set()
    for (const component of model.getElementsByTagName('component')) {
      if (component.parentElement.localName === 'import') continue
      for (const variable of children(component, 'variable')) used.add(variable.getAttribute('units'))
    }
    for (const cn of model.getElementsByTagName('cn')) used.add(cn.getAttribute('cellml:units'))
    const nonStandard = [...used].filter((name) => name && !isStandardUnit(name))
    expect([...imported].sort(), `${file} imports the units it uses`).toEqual(nonStandard.sort())
    nonStandard.forEach(use)
  }
  expect([...defined].sort(), 'units.cellml holds every units needed, and only those').toEqual([...needed].sort())
}

/** The module definitions' files. */
const moduleFiles = (files) => [...files.keys()].filter((name) => name.startsWith('modules/'))

describe('the CellML export with imports', () => {
  let store
  let make
  let libOpenCOR

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
    libOpenCOR = await createLibOpenCOR()
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

  const flatOf = async ({ nodes, edges }, options = {}) => {
    const expansion = expandHierarchy(nodes, edges)
    return (await generateFlattenedModel(expansion.nodes, expansion.edges, store, [], options)).text()
  }

  // simulates: whether the flat export runs at all; the bundled modules with every blank value 1 may not.
  it.each([
    ['venous fan-in summed across the boundary', (s) => venousFanIn(moduleFactory(s)), false],
    ['Multiply made beside its factor', (s) => multiply(moduleFactory(s)), true],
    ['two levels, through via', (s) => twoLevel(moduleFactory(s)), false],
    ['one super-module three times, each with its own values', (s) => threeInstances(moduleFactory(s)), true],
    ['an exposed Sum port beside an internal coupling', (s) => exposureLeavesInternalCouplings(moduleFactory(s)), false],
    ['local constants in series', (s) => localConstantSegments(moduleFactory(s)), true],
    ['three super instances fed by a host Sum', hubBranches, true],
    ['local constants fed by a host Sum', localConstantBranches, true],
  ])('%s flattens to the flat export', async (_, fixture, simulates) => {
    const { nested } = fixture(store)
    const exported = await buildHierarchicalCellML(nested.nodes, nested.edges, store)
    const flat = await flatOf(nested)
    const result = await compareWithFlat(exported, flat)
    expect(result.differences).toEqual([])
    expect(analysisOf(result.cellml)).toEqual([])
    if (!simulates) return
    const simulated = await compareSimulations(result.cellml, flat, { module: libOpenCOR, endTime: 0.5 })
    expect(simulated.details.missing).toEqual([])
    expect(simulated.equal).toBe(true)
  })


  /** Exports a nested graph, checks each file and its imports, and compares the flattened model with the flat export. */
  const expectFlatEquivalent = async (nested, { endTime = 2 } = {}) => {
    const exported = await buildHierarchicalCellML(nested.nodes, nested.edges, store)
    for (const [name, text] of exported.files) {
      expect(validationOf(text), name).toEqual([])
      for (const [, href] of text.matchAll(/xlink:href="([^"]+)"/g)) expect(exported.files.has(normalisePath(`${name.slice(0, name.lastIndexOf('/') + 1)}${href}`)), href).toBe(true)
    }
    expectSharedUnits(exported.files)
    const flat = await flatOf(nested)
    const result = await compareWithFlat(exported, flat)
    expect(result.differences).toEqual([])
    expect(analysisOf(result.cellml)).toEqual([])
    const simulated = await compareSimulations(result.cellml, flat, { module: libOpenCOR, endTime })
    expect(simulated.details.missing).toEqual([])
    expect(simulated.equal).toBe(true)
    return exported
  }

  it('sums two, one and no host flows into one exposed Sum port', async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const { tank, branch } = tankKit(store)
    const h = tank('h', 'h', { scope: 'sm_1' })
    const sm = supermodule('sm_1', 'tankbox', { submoduleOrder: ['h'] })
    const exposure = exposures('sm_1', [exposed('xp', 'h', 'exit_ports', 'vessel')])
    const tanks = ['T1', 'T2', 'T3'].map((name, i) => superInstance({ nodes: [sm, h], edges: exposure }, `dndnode_${i}`, name, 'sm_1', { overrides: { h: { q_init: { value: String(i + 2) } } } }))
    const drains = ['0.5', '0.25', '0.125'].map((k, i) => branch(`dndnode_b${i}`, `b${i}`, { values: { k } }))
    const edges = [connect(tanks[0], drains[0], { id: 'e0' }), connect(tanks[0], drains[1], { id: 'e1' }), connect(tanks[1], drains[2], { id: 'e2' }), ...exposure]
    await expectFlatEquivalent({ nodes: [...tanks, ...drains, sm, h], edges })
  })

  it('gives a nested super instance its values per occurrence of the super-module holding it', async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const { tank, branch } = tankKit(store)
    const leaf = branch('leaf', 'leaf', { scope: 'sm_in' })
    const cell = supermodule('sm_in', 'cell', { submoduleOrder: ['leaf'] })
    const cellExposure = exposures('sm_in', [exposed('xp', 'leaf', 'entrance_ports', 'vessel')])
    const cells = { nodes: [cell, leaf], edges: cellExposure }
    const c1 = superInstance(cells, 'c1', 'c1', 'sm_in', { scope: 'sm_out' })
    const c2 = superInstance(cells, 'c2', 'c2', 'sm_in', { scope: 'sm_out', overrides: { leaf: { k: { value: '0.3' } } } })
    const organ = supermodule('sm_out', 'organ', { submoduleOrder: ['c1', 'c2'] })
    const exposure = [...exposures('sm_out', [exposed('x1', 'c1', null, null, { via: 'xp' }), exposed('x2', 'c2', null, null, { via: 'xp' })]), ...cellExposure]
    const inner = { nodes: [organ, c1, c2, cell, leaf], edges: exposure }
    const o1 = superInstance(inner, 'dndnode_1', 'o1', 'sm_out', { overrides: { 'c1/leaf': { k: { value: '0.2' } } } })
    const o2 = superInstance(inner, 'dndnode_2', 'o2', 'sm_out', { overrides: { 'c2/leaf': { k: { value: '0.7' } }, 'c1/leaf': { k: { value: '0.9' } } } })
    const tanks = [0, 1, 2, 3].map((i) => tank(`dndnode_h${i}`, `h${i}`))
    const used = new Set()
    const edges = [[0, o1], [1, o1], [2, o2], [3, o2]].map(([i, target]) => connect(tanks[i], target, { used, id: `e${i}` }))
    const exported = await expectFlatEquivalent({ nodes: [...tanks, o1, o2, ...inner.nodes], edges: [...edges, ...exposure] })
    // The global constant passes down through each level by its own name.
    for (const file of ['cell.cellml', 'organ.cellml']) expect(exported.files.get(file)).toMatch(/<variable name="g" units="dimensionless" interface="public_and_private"\/>/)
  })

  it('passes a global constant three levels down', async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const { tank, branch } = tankKit(store)
    const leaf = branch('leaf', 'leaf', { scope: 'sm_3' })
    const s3 = supermodule('sm_3', 'cell', { submoduleOrder: ['leaf'] })
    const e3 = exposures('sm_3', [exposed('xp', 'leaf', 'entrance_ports', 'vessel')])
    const i3 = superInstance({ nodes: [s3, leaf], edges: e3 }, 'c', 'c', 'sm_3', { scope: 'sm_2' })
    const s2 = supermodule('sm_2', 'tissue', { submoduleOrder: ['c'] })
    const e2 = [...exposures('sm_2', [exposed('xp2', 'c', null, null, { via: 'xp' })]), ...e3]
    const i2 = superInstance({ nodes: [s2, i3, s3, leaf], edges: e2 }, 't', 't', 'sm_2', { scope: 'sm_1' })
    const s1 = supermodule('sm_1', 'organ', { submoduleOrder: ['t'] })
    const e1 = [...exposures('sm_1', [exposed('xp1', 't', null, null, { via: 'xp2' })]), ...e2]
    const inner = { nodes: [s1, i2, s2, i3, s3, leaf], edges: e1 }
    const o1 = superInstance(inner, 'dndnode_1', 'o1', 'sm_1', { overrides: { 't/c/leaf': { k: { value: '0.2' } } } })
    const o2 = superInstance(inner, 'dndnode_2', 'o2', 'sm_1')
    const h = tank('dndnode_0', 'h')
    const own = branch('dndnode_3', 'own')
    const edges = [connect(h, o1, { id: 'e0' }), connect(h, o2, { id: 'e1' }), connect(h, own, { id: 'e2' }), ...e1]
    await expectFlatEquivalent({ nodes: [h, own, o1, o2, ...inner.nodes], edges })
  })

  it('sets nested local constants per occurrence, an outer one of the same name apart', async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const { tank, branch } = tankKit(store)
    const leaves = ['l1', 'l2'].map((id) => branch(id, id, { scope: 'sm_in', local: ['k'], values: { u: '1' } }))
    const cell = supermodule('sm_in', 'cell', { submoduleOrder: ['l1', 'l2'], localConstants: [{ name: 'k', units: 'per_second', value: '0.5' }] })
    const cellExposure = exposures('sm_in', [exposed('xa', 'l1', 'entrance_ports', 'vessel'), exposed('xb', 'l2', 'entrance_ports', 'vessel')])
    const cells = { nodes: [cell, ...leaves], edges: cellExposure }
    const c1 = superInstance(cells, 'c1', 'c1', 'sm_in', { scope: 'sm_out' })
    const c2 = superInstance(cells, 'c2', 'c2', 'sm_in', { scope: 'sm_out', overrides: { '@': { k: { value: '0.3' } } } })
    const own = branch('own', 'own', { scope: 'sm_out', local: ['k'] })
    const organ = supermodule('sm_out', 'organ', { submoduleOrder: ['c1', 'c2', 'own'], localConstants: [{ name: 'k', units: 'per_second', value: '0.05' }] })
    const exposure = [
      ...exposures('sm_out', [exposed('x1', 'c1', null, null, { via: 'xa' }), exposed('x2', 'c2', null, null, { via: 'xb' }), exposed('x3', 'own', 'entrance_ports', 'vessel')]),
      ...cellExposure,
    ]
    const inner = { nodes: [organ, c1, c2, own, cell, ...leaves], edges: exposure }
    const o1 = superInstance(inner, 'dndnode_1', 'o1', 'sm_out', { overrides: { 'c1/@': { k: { value: '0.2' } }, '@': { k: { value: '0.07' } } } })
    const o2 = superInstance(inner, 'dndnode_2', 'o2', 'sm_out')
    const h = tank('dndnode_0', 'h')
    const used = new Set()
    const edges = [o1, o1, o1, o2, o2, o2].map((target, i) => connect(h, target, { used, id: `e${i}` }))
    await expectFlatEquivalent({ nodes: [h, o1, o2, ...inner.nodes], edges: [...edges, ...exposure] })
  })

  it.each([
    ['global', 0],
    ['global', 1],
    ['local', 0],
    ['local', 1],
  ])('takes a %s constant on an exposed port from the host only where nothing connects to it (connected: #%s)', async (kind, connected) => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const { tank, branch } = tankKit(store)
    store.assignGlobalConstant('u', '0.75', 'dimensionless', 'test')
    const leaf = branch('leaf', 'leaf', { scope: 'sm_2', ...(kind === 'global' ? { globals: ['g', 'u'] } : { local: ['u'] }) })
    const other = branch('other', 'other', { scope: 'sm_2', ...(kind === 'global' ? { globals: ['g', 'u'] } : { local: ['u'] }) })
    const sm = supermodule('sm_2', 'branchbox', { submoduleOrder: ['leaf', 'other'], localConstants: kind === 'local' ? [{ name: 'u', units: 'dimensionless', value: '0.75' }] : [] })
    const exposure = exposures('sm_2', [exposed('xq', 'leaf', 'entrance_ports', 'vessel')])
    const boxes = ['B1', 'B2'].map((name, i) => superInstance({ nodes: [sm, leaf, other], edges: exposure }, `dndnode_b${i}`, name, 'sm_2'))
    const h = tank('dndnode_h', 'h')
    await expectFlatEquivalent({ nodes: [h, ...boxes, sm, leaf, other], edges: [connect(h, boxes[connected], { id: 'e0' }), ...exposure] })
  })

  it('zips a host, a file per super-module and one per module, each importing what it holds and validating on its own', async () => {
    const { nested } = twoLevel(make)
    const zip = await JSZip.loadAsync(await (await generateHierarchicalCellMLZip('model', nested.nodes, nested.edges, store)).arrayBuffer())
    const [PV, VP, PP] = ['pv_simple_type', 'vp_ven_simple_type', 'pp_T_fixed_I_type']
    const MODULES = { pv: `modules/${PV}.cellml`, vp: `modules/${VP}.cellml`, pp: `modules/${PP}.cellml` }
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
    const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await zip.file(name).async('string')])))
    // One file per distinct module, in modules/; the host and the super-modules at the root.
    expect(names).toEqual(['model.cellml', 'capillary_bed.cellml', 'limb.cellml', MODULES.pv, MODULES.vp, MODULES.pp, UNITS_FILE])
    for (const [name, text] of Object.entries(files)) expect(validationOf(text), name).toEqual([])
    expectSharedUnits(new Map(Object.entries(files)))

    expect(importsOf(files['model.cellml'])).toEqual([`${MODULES.pv} aorta ${PV}`, 'limb.cellml leg limb', `${MODULES.vp} vc ${VP}`].sort())
    expect(importsOf(files['limb.cellml'])).toEqual([`${MODULES.pv} art ${PV}`, 'capillary_bed.cellml bed capillary_bed'].sort())
    expect(importsOf(files['capillary_bed.cellml'])).toEqual([`${MODULES.pp} cap ${PP}`])
    for (const name of moduleFiles(new Map(Object.entries(files)))) expect(importsOf(files[name])).toEqual([])
    // Each import points at a file in the zip, relative to the importing file, at the root.
    for (const text of Object.values(files)) for (const line of importsOf(text)) expect(names).toContain(line.split(' ')[0])
    // The wrappers encapsulate their children, each by its local name.
    expect(files['limb.cellml']).toMatch(/<component_ref component="limb">\s*<component_ref component="art"\/>\s*<component_ref component="bed"\/>/)
    // Values are set in the host only, per super instance; a definition's wrapper variables are all public_and_private.
    for (const name of ['limb.cellml', 'capillary_bed.cellml', MODULES.pv, MODULES.pp, MODULES.vp]) expect(files[name]).not.toMatch(/initial_value="[-+.\d]/)
    const wrapper = files['capillary_bed.cellml'].match(/<component name="capillary_bed">([\s\S]*?)<\/component>/)[1]
    expect(wrapper).not.toMatch(/interface="(?!public_and_private)/)
    expect(files['model.cellml']).toMatch(/<variable name="R_art_leg" units="[^"]+" initial_value="4"/)
    expect(files['model.cellml']).toMatch(/<variable name="R_T_cap_bed_leg" units="[^"]+" initial_value="3"/)
  })

  it('writes a flat workspace as the host, its modules and the units, as the flat export', async () => {
    const { flat } = threeInstances(make)
    const exported = await buildHierarchicalCellML(flat.nodes, flat.edges, store)
    expect(moduleFiles(exported.files).length).toBeGreaterThan(0)
    expect([...exported.files.keys()]).toEqual(['model.cellml', ...moduleFiles(exported.files), UNITS_FILE])
    expectSharedUnits(exported.files)
    expect(importsOf(exported.files.get('model.cellml')).every((line) => line.startsWith('modules/'))).toBe(true)
    expect((await compareWithFlat(exported, await flatOf(flat))).differences).toEqual([])
  })

  it('names files after the super-modules, apart from the host and each other', async () => {
    const { nested } = threeInstances(make)
    nested.nodes.find((node) => node.id === 'sm_1').data.supermodule.name = 'model'
    const { files } = await buildHierarchicalCellML(nested.nodes, nested.edges, store)
    expect([...files.keys()].filter((name) => !name.startsWith('modules/'))).toEqual(['model.cellml', 'model_1.cellml', UNITS_FILE])
    // Nor the units file.
    nested.nodes.find((node) => node.id === 'sm_1').data.supermodule.name = 'units'
    const renamed = await buildHierarchicalCellML(nested.nodes, nested.edges, store, { name: 'Units' })
    expect([...renamed.files.keys()].filter((name) => !name.startsWith('modules/'))).toEqual(['Units_1.cellml', 'units_2.cellml', UNITS_FILE])
  })

  it('refuses what the flat export refuses', async () => {
    const { nested } = bcOnlyThroughInterface(make)
    await expect(buildHierarchicalCellML(nested.nodes, nested.edges, store)).rejects.toThrow('Boundary conditions connected only to each other')
  })

  it('imports one module file for every instance of a module, each instance with its own values and initial state', async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const { tank, branch } = tankKit(store)
    // Two tanks and two branches inside a super-module, used twice; two of each at the root.
    const inner = [tank('t1', 't1', { scope: 'sm_1', values: { q_init: '3' } }), tank('t2', 't2', { scope: 'sm_1', values: { q_init: '5' } })]
    const drains = [branch('d1', 'd1', { scope: 'sm_1', values: { k: '0.2' } }), branch('d2', 'd2', { scope: 'sm_1', values: { k: '0.4' } })]
    const sm = supermodule('sm_1', 'pair', { submoduleOrder: ['t1', 't2', 'd1', 'd2'] })
    const edges = [connect(inner[0], drains[0], { id: 'e_1' }), connect(inner[1], drains[1], { id: 'e_2' })]
    const definition = { nodes: [sm, ...inner, ...drains], edges }
    const pairs = [
      superInstance(definition, 'dndnode_p1', 'p1', 'sm_1'),
      superInstance(definition, 'dndnode_p2', 'p2', 'sm_1', { overrides: { t1: { q_init: { value: '7' } }, d2: { k: { value: '0.8' } } } }),
    ]
    const tanks = [tank('dndnode_h1', 'h1', { values: { q_init: '2' } }), tank('dndnode_h2', 'h2', { values: { q_init: '4' } })]
    const branches = [branch('dndnode_b1', 'b1', { values: { k: '0.5' } }), branch('dndnode_b2', 'b2', { values: { k: '0.25' } })]
    const roots = [connect(tanks[0], branches[0], { id: 'e0' }), connect(tanks[1], branches[1], { id: 'e1' })]
    const exported = await expectFlatEquivalent({ nodes: [...pairs, ...tanks, ...branches, ...definition.nodes], edges: [...roots, ...edges] })

    expect(moduleFiles(exported.files)).toEqual(['modules/tank.cellml', 'modules/branch.cellml'])
    const tankFile = exported.files.get('modules/tank.cellml')
    // No values in a module file: a state starts at its initialiser, an interface variable set from outside.
    expect(tankFile).not.toMatch(/initial_value="[-+.\d]/)
    expect(tankFile).toMatch(/<variable name="q" units="dimensionless" initial_value="q_init" interface="public"\/>/)
    expect(tankFile).toMatch(/<variable name="q_init" units="dimensionless" interface="public"\/>/)
    expect(exported.files.get('modules/branch.cellml')).not.toMatch(/initial_value=/)
    const host = exported.files.get('model.cellml')
    expect(importsOf(host)).toEqual(expect.arrayContaining(['modules/tank.cellml h1 tank', 'modules/tank.cellml h2 tank', 'modules/branch.cellml b1 branch', 'modules/branch.cellml b2 branch']))
    expect(importsOf(exported.files.get('pair.cellml'))).toEqual(['modules/tank.cellml t1 tank', 'modules/tank.cellml t2 tank', 'modules/branch.cellml d1 branch', 'modules/branch.cellml d2 branch'].sort())
    // Each instance's values, the super instances' per super instance, are the host's.
    for (const value of ['2', '4', '0.5', '0.25', '3', '5', '7', '0.2', '0.4', '0.8']) expect(host).toMatch(new RegExp(`initial_value="${value.replace('.', '\\.')}"`))
  })

  it('names module files apart when two library files hold components of one name', async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const { tank, module } = tankKit(store)
    const drainOf = (factor) => BRANCH_G_XML.replaceAll('name="branch"', 'name="drain"').replace(/\s*<variable name="g"[^>]*\/>/, '').replace('<ci>g</ci>', `<cn cellml:units="dimensionless">${factor}</cn>`).replace('<math xmlns="http://www.w3.org/1998/Math/MathML">', '<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">')
    store.addMath('slow_lib.cellml:drain', drainOf(1))
    store.addMath('fast_lib.cellml:drain', drainOf(3))
    const ports = [{ portType: 'entrance_ports', label: 'vessel', variables: ['v', 'u'], multiportType: 'None' }]
    const slow = module('slow_lib.cellml:drain', ports)('dndnode_s', 's', { globals: [] })
    const fast = module('fast_lib.cellml:drain', ports)('dndnode_f', 'f', { globals: [] })
    const tanks = [tank('dndnode_h1', 'h1'), tank('dndnode_h2', 'h2')]
    const exported = await expectFlatEquivalent({ nodes: [...tanks, slow, fast], edges: [connect(tanks[0], slow, { id: 'e0' }), connect(tanks[1], fast, { id: 'e1' })] })
    expect(moduleFiles(exported.files)).toEqual(['modules/tank.cellml', 'modules/drain_slow_lib.cellml', 'modules/drain_fast_lib.cellml'])
    expect(importsOf(exported.files.get('model.cellml'))).toEqual(expect.arrayContaining(['modules/drain_slow_lib.cellml s drain', 'modules/drain_fast_lib.cellml f drain']))
    expect(exported.files.get('modules/drain_fast_lib.cellml')).toContain('>3</cn>')
  })

  it('writes a self leaf as its super-module’s wrapper', async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    const { nodes, edges } = selfLeafTanks(store)
    const exported = await buildHierarchicalCellML(nodes, edges, store)
    const definition = exported.files.get('reservoir.cellml')
    expect(definition).toMatch(/<component name="reservoir">\s*<variable name="t"/)
    expect(definition).not.toMatch(/<component name="tank"/)
    // Only its other children import a module file.
    expect(moduleFiles(exported.files)).toEqual(['modules/drain.cellml'])
    expect(importsOf(definition)).toEqual(['modules/drain.cellml drain drain'])
    const flat = await flatOf({ nodes, edges })
    // The self leaf's flat name is its super instance's, so the two exports name it alike.
    expect(flat).toMatch(/<component name="p1">/)
    expect(flat).not.toMatch(/p1__tank/)
    const { cellml, differences } = await compareWithFlat(exported, flat, { selves: ['p1', 'p2'] })
    expect(differences).toEqual([])
    const simulated = await compareSimulations(cellml, flat, { module: libOpenCOR, endTime: 2 })
    expect(simulated.details.missing).toEqual([])
    expect(simulated.details.variables.map((variable) => variable.name)).toEqual(['p1/q', 'p2/q'])
    expect(simulated.equal).toBe(true)
  })
})


describe('the CellML export with imports of circulatory_autogen super-modules', () => {
  let store
  let load
  let libOpenCOR

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    ;({ load } = loadCaLibrary(store))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['3compartment_supermodules', 'system_models/closed_loop_cvs/3compartment_supermodules'],
    ['SN_simple_supermodules', 'system_models/cellular/SN_simple_supermodules'],
  ])('%s, imported, flattens to the flat export', async (_, path) => {
    const { rows, hostRows } = systemModel(path)
    const library = libraryOf(store)
    const model = buildCaModel(rows, library, { load, hostRows })
    const folded = foldCaModel(model, library, { load })
    for (const { name, value, units, data_reference } of model.globals) store.assignGlobalConstant(name, value, units, data_reference)

    const exported = await buildHierarchicalCellML(folded.nodes, folded.edges, store, { allowBcOnly: true })
    // Every file validates on its own, each module definition's included.
    expect(moduleFiles(exported.files).length).toBeGreaterThan(1)
    for (const [name, text] of exported.files) expect(validationOf(text), name).toEqual([])
    expectSharedUnits(exported.files)
    const expansion = expandHierarchy(folded.nodes, folded.edges)
    const flat = await (await generateFlattenedModel(expansion.nodes, expansion.edges, store, [], { allowBcOnly: true })).text()
    const result = await compareWithFlat(exported, flat)
    expect(result.differences).toEqual([])
    // The flattened model orders its equations otherwise, which the solver's steps follow.
    const simulated = await compareSimulations(result.cellml, flat, { module: libOpenCOR, endTime: 0.1, tolerance: 1e-4 })
    expect(simulated.details.missing).toEqual([])
    expect(simulated.equal).toBe(true)
  })
})
