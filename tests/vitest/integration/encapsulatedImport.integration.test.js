// @vitest-environment happy-dom
import createLibOpenCOR from '@opencor/libopencor'
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { patchUnderscoreTagSelectors } from '../helpers/happyDom.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// loadFromCellML with the canvas stubbed: it hands its nodes to addNodes and its edges to prepareLayout.
const canvas = vi.hoisted(() => ({ addNodes: vi.fn(), prepareLayout: vi.fn() }))
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes: { value: [] }, addNodes: canvas.addNodes }),
}))
vi.mock('../../../src/composables/useClearWorkspace', () => ({ useClearWorkspace: () => ({ clearWorkspace: async () => {} }) }))
vi.mock('../../../src/composables/useWorkflowLayout', () => ({ useWorkflowLayout: () => ({ prepareLayout: canvas.prepareLayout }) }))
vi.mock('../../../src/composables/useGtm', () => ({ useGtm: () => ({ trackEvent: () => {} }) }))
vi.mock('../../../src/utils/notify', () => ({ notify: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

const { useLoadFromCellML } = await import('../../../src/composables/useLoadFromCellml.js')
const { parseCellMLConnections } = await import('../../../src/services/import/parseCellmlConnections.js')
const { prepareCellmlImport } = await import('../../../src/services/import/prepareCellml.js')
const { checkScope, resolveScope } = await import('../../../src/services/simulation/scopedModel.js')
const { createSimulationSession } = await import('../../../src/services/simulation/engine.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { generateFlattenedModel, hoistEncapsulatedComponents, loadParametersFromCellML, processCellMLData } = await import(
  '../../../src/utils/cellml.js'
)
const { BASELINE_SIMULATION_SETTINGS } = await import('../../../src/utils/constants.js')
const { notify } = await import('../../../src/utils/notify')

const FILE = 'encapsulated.cellml'
const MATHML = 'xmlns="http://www.w3.org/1998/Math/MathML"'
const ci = (name) => `<ci>${name}</ci>`
const ode = (state, rhs) => `<math ${MATHML}><apply><eq/><apply><diff/><bvar>${ci('time')}</bvar>${ci(state)}</apply>${rhs}</apply></math>`
const times = (...args) => `<apply><times/>${args.join('')}</apply>`
const minus = (...args) => `<apply><minus/>${args.join('')}</apply>`
const one = '<cn cellml:units="dimensionless">1</cn>'

const GROUPS = `
  <group>
    <relationship_ref relationship="encapsulation"/>
    <component_ref component="sodium_current">
      <component_ref component="sodium_current_m_gate"/>
      <component_ref component="sodium_current_h_gate"/>
    </component_ref>
    <component_ref component="potassium_current">
      <component_ref component="potassium_current_n_gate">
        <component_ref component="potassium_current_n_gate_alpha"/>
      </component_ref>
    </component_ref>
  </group>`
const CONTAINMENT = `
  <group>
    <relationship_ref relationship="containment"/>
    <component_ref component="membrane"><component_ref component="sodium_current"/><component_ref component="potassium_current"/></component_ref>
  </group>`

/**
 * A CellML 1.0 model as PMR has them (#787). sodium_current has its own math and encapsulates two gates, relaying
 * time and V to them; potassium_current nests two levels. Each gate's state shares its name with the parent's
 * private variable that reads it.
 *
 * @param {string} [extraGroups] - More groups, such as containment.
 * @returns {string}
 */
const encapsulatedModel = (extraGroups = '') => `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/1.0#" xmlns:cellml="http://www.cellml.org/cellml/1.0#" name="encapsulated_channels">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="environment"><variable name="time" units="second" public_interface="out"/></component>
  <component name="membrane">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="V" units="dimensionless" initial_value="1" public_interface="out"/>
    <variable name="i_Na" units="per_second" public_interface="in"/>
    <variable name="i_K" units="per_second" public_interface="in"/>
    ${ode('V', minus(`<apply><plus/>${ci('i_Na')}${ci('i_K')}</apply>`))}
  </component>
  <component name="sodium_current">
    <variable name="time" units="second" public_interface="in" private_interface="out"/>
    <variable name="V" units="dimensionless" public_interface="in" private_interface="out"/>
    <variable name="g_Na" units="per_second" initial_value="2"/>
    <variable name="m" units="dimensionless" private_interface="in"/>
    <variable name="h" units="dimensionless" private_interface="in"/>
    <variable name="i_Na" units="per_second" public_interface="out"/>
    <math ${MATHML}><apply><eq/>${ci('i_Na')}${times(ci('g_Na'), ci('m'), ci('h'), ci('V'))}</apply></math>
  </component>
  <component name="sodium_current_m_gate">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="V" units="dimensionless" public_interface="in"/>
    <variable name="m" units="dimensionless" initial_value="0.1" public_interface="out"/>
    <variable name="alpha_m" units="per_second" initial_value="3"/>
    <variable name="beta_m" units="per_second" initial_value="1"/>
    ${ode('m', minus(times(ci('alpha_m'), minus(one, ci('m'))), times(ci('beta_m'), ci('V'), ci('m'))))}
  </component>
  <component name="sodium_current_h_gate">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="V" units="dimensionless" public_interface="in"/>
    <variable name="h" units="dimensionless" initial_value="0.9" public_interface="out"/>
    <variable name="k_h" units="per_second" initial_value="0.5"/>
    ${ode('h', minus(times(ci('k_h'), ci('V'), ci('h'))))}
  </component>
  <component name="potassium_current">
    <variable name="time" units="second" public_interface="in" private_interface="out"/>
    <variable name="V" units="dimensionless" public_interface="in" private_interface="out"/>
    <variable name="g_K" units="per_second" initial_value="1.5"/>
    <variable name="n" units="dimensionless" private_interface="in"/>
    <variable name="i_K" units="per_second" public_interface="out"/>
    <math ${MATHML}><apply><eq/>${ci('i_K')}${times(ci('g_K'), ci('n'), ci('V'))}</apply></math>
  </component>
  <component name="potassium_current_n_gate">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="V" units="dimensionless" public_interface="in" private_interface="out"/>
    <variable name="n" units="dimensionless" initial_value="0.3" public_interface="out"/>
    <variable name="alpha_n" units="per_second" private_interface="in"/>
    <variable name="beta_n" units="per_second" initial_value="0.2"/>
    ${ode('n', minus(times(ci('alpha_n'), minus(one, ci('n'))), times(ci('beta_n'), ci('n'))))}
  </component>
  <component name="potassium_current_n_gate_alpha">
    <variable name="V" units="dimensionless" public_interface="in"/>
    <variable name="a_n" units="per_second" initial_value="0.4"/>
    <variable name="alpha_n" units="per_second" public_interface="out"/>
    <math ${MATHML}><apply><eq/>${ci('alpha_n')}${times(ci('a_n'), `<apply><plus/>${one}${ci('V')}</apply>`)}</apply></math>
  </component>
  ${GROUPS}${extraGroups}
  <connection><map_components component_1="environment" component_2="membrane"/><map_variables variable_1="time" variable_2="time"/></connection>
  <connection><map_components component_1="environment" component_2="sodium_current"/><map_variables variable_1="time" variable_2="time"/></connection>
  <connection><map_components component_1="environment" component_2="potassium_current"/><map_variables variable_1="time" variable_2="time"/></connection>
  <connection><map_components component_1="membrane" component_2="sodium_current"/>
    <map_variables variable_1="V" variable_2="V"/><map_variables variable_1="i_Na" variable_2="i_Na"/></connection>
  <connection><map_components component_1="membrane" component_2="potassium_current"/>
    <map_variables variable_1="V" variable_2="V"/><map_variables variable_1="i_K" variable_2="i_K"/></connection>
  <connection><map_components component_1="sodium_current" component_2="sodium_current_m_gate"/>
    <map_variables variable_1="time" variable_2="time"/><map_variables variable_1="V" variable_2="V"/><map_variables variable_1="m" variable_2="m"/></connection>
  <connection><map_components component_1="sodium_current" component_2="sodium_current_h_gate"/>
    <map_variables variable_1="time" variable_2="time"/><map_variables variable_1="V" variable_2="V"/><map_variables variable_1="h" variable_2="h"/></connection>
  <connection><map_components component_1="potassium_current" component_2="potassium_current_n_gate"/>
    <map_variables variable_1="time" variable_2="time"/><map_variables variable_1="V" variable_2="V"/><map_variables variable_1="n" variable_2="n"/></connection>
  <connection><map_components component_1="potassium_current_n_gate" component_2="potassium_current_n_gate_alpha"/>
    <map_variables variable_1="V" variable_2="V"/><map_variables variable_1="alpha_n" variable_2="alpha_n"/></connection>
</model>`

const COMPONENTS = [
  'membrane',
  'sodium_current',
  'sodium_current_m_gate',
  'sodium_current_h_gate',
  'potassium_current',
  'potassium_current_n_gate',
  'potassium_current_n_gate_alpha',
]
const STATES = ['membrane/V', 'sodium_current_m_gate/m', 'sodium_current_h_gate/h', 'potassium_current_n_gate/n']

describe('importing a CellML model with encapsulated components (#787)', () => {
  let store
  let libcellml
  let restoreSelectors
  // One libOpenCOR for the file: a second instance in the same page breaks the first.
  let libOpenCOR

  beforeAll(async () => {
    restoreSelectors = patchUnderscoreTagSelectors()
    libcellml = (await ensureLibCellmlReady()).instance
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  afterAll(() => restoreSelectors?.())

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    notify.info.mockClear()
    notify.warning.mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  /**
   * Imports a CellML file as a drop or an OMEX archive without a flow snapshot does: prepared once, then registered
   * in the library and built into the workspace.
   *
   * @param {string} [xml]
   * @returns {Promise<{nodes: Array, edges: Array}>}
   */
  async function importModel(xml = encapsulatedModel()) {
    const cellml = prepareCellmlImport(xml, FILE)
    const processed = processCellMLData(cellml)
    expect(processed.type).toBe('success')
    store.addMathFile(FILE, processed.components)
    store.addUnitsFile({ componentFile: FILE, model: processed.units.model })

    canvas.addNodes.mockClear()
    canvas.prepareLayout.mockClear().mockResolvedValue()
    await useLoadFromCellML().loadFromCellML(parseCellMLConnections(cellml, FILE), FILE, loadParametersFromCellML(cellml))
    return { nodes: canvas.addNodes.mock.calls[0][0], edges: canvas.prepareLayout.mock.calls[0][0] }
  }

  /**
   * Analyses a model with libCellML.
   *
   * @param {string} cellml
   * @returns {{issues: string[], states: number, type: string}} The analyser's issues, state count and model type.
   */
  function analyse(cellml) {
    const parser = new libcellml.Parser(false)
    const model = parser.parseModel(cellml)
    const analyser = new libcellml.Analyser()
    analyser.analyseModel(model)
    const issues = Array.from({ length: analyser.errorCount() }, (_, i) => analyser.error(i).description())
    const analysed = analyser.analyserModel()
    const result = { issues, states: analysed.stateCount(), type: libcellml.AnalyserModel.typeAsString(analysed.type()) }
    ;[analyser, parser, model].forEach((object) => object.delete())
    return result
  }

  /**
   * Simulates a model for 2 s with libOpenCOR.
   *
   * @param {string} cellml
   * @param {string[]} names - Variables as `component/variable`.
   * @returns {Promise<Object<string, number>>} Each variable's final value, by name.
   */
  async function simulate(cellml, names) {
    const session = createSimulationSession({ module: libOpenCOR, cellml })
    try {
      const settings = { ...BASELINE_SIMULATION_SETTINGS, endingPoint: 2, pointInterval: 0.5 }
      const results = await session.run({ settings }).promise
      return Object.fromEntries(names.map((name) => [name, results.variables.get(name).values.at(-1)]))
    } finally {
      session.dispose()
    }
  }

  it('moves every encapsulated component to the top level, keeping the model equivalent', () => {
    const xml = encapsulatedModel()
    const { cellml, hoisted, ignoredContainment } = hoistEncapsulatedComponents(xml)

    expect([...hoisted].sort()).toEqual([
      'potassium_current_n_gate',
      'potassium_current_n_gate_alpha',
      'sodium_current_h_gate',
      'sodium_current_m_gate',
    ])
    expect(hoisted.indexOf('potassium_current_n_gate_alpha')).toBeLessThan(hoisted.indexOf('potassium_current_n_gate'))
    expect(ignoredContainment).toBe(false)
    expect(cellml).not.toMatch(/encapsulation/)

    const validator = new libcellml.Validator()
    const parser = new libcellml.Parser(false)
    const model = parser.parseModel(cellml)
    validator.validateModel(model)
    expect(validator.errorCount()).toBe(0)
    expect(model.componentCount()).toBe(COMPONENTS.length + 1)
    ;[validator, parser, model].forEach((object) => object.delete())

    expect(analyse(cellml)).toEqual({ ...analyse(xml), issues: [] })
  })

  it('registers each component with its own math only, and keeps each default with its holder', async () => {
    const { nodes, edges } = await importModel()

    expect(nodes.map((node) => node.data.name).sort()).toEqual([...COMPONENTS].sort())
    for (const node of nodes) {
      const math = store.getMathEntry(node.data.mathRef)?.math
      expect(math, node.data.name).toMatch(/<math/)
      // The stored math is the component alone, with no children nested in it.
      expect(math.match(/<component /g), node.data.name).toHaveLength(1)
    }

    const defaults = (name) => Object.fromEntries(store.getMathDefaults(`${FILE}:${name}`))
    expect(defaults('sodium_current')).toEqual({ g_Na: '2' })
    expect(defaults('sodium_current_m_gate')).toEqual({ m_init: '0.1', alpha_m: '3', beta_m: '1' })
    expect(defaults('sodium_current_h_gate')).toEqual({ h_init: '0.9', k_h: '0.5' })
    expect(defaults('potassium_current')).toEqual({ g_K: '1.5' })
    expect(defaults('potassium_current_n_gate')).toEqual({ n_init: '0.3', beta_n: '0.2' })
    expect(defaults('potassium_current_n_gate_alpha')).toEqual({ a_n: '0.4' })

    const rowsOf = (nodeName, names) => {
      const rows = nodes.find((node) => node.data.name === nodeName).data.variables
      return Object.fromEntries(names.map((name) => rows.find((row) => row.name === name)).map((row) => [row.name, `${row.type}=${row.value ?? ''}`]))
    }
    expect(rowsOf('sodium_current', ['g_Na', 'm', 'h'])).toEqual({ g_Na: 'constant=2', m: 'boundary_condition=', h: 'boundary_condition=' })
    expect(rowsOf('sodium_current_m_gate', ['m', 'm_init'])).toEqual({ m: 'variable=', m_init: 'constant=0.1' })
    expect(rowsOf('potassium_current_n_gate', ['alpha_n', 'n_init'])).toEqual({ alpha_n: 'boundary_condition=', n_init: 'constant=0.3' })

    // Parent-child connections are ordinary edges; time relays are not.
    const nameOf = (id) => nodes.find((node) => node.id === id).data.name
    const pairs = edges.map((edge) => [nameOf(edge.source), nameOf(edge.target)].sort().join('--'))
    expect(pairs).toEqual(
      expect.arrayContaining([
        'sodium_current--sodium_current_m_gate',
        'sodium_current--sodium_current_h_gate',
        'potassium_current--potassium_current_n_gate',
        'potassium_current_n_gate--potassium_current_n_gate_alpha',
      ])
    )
    expect(pairs).toHaveLength(6)
  })

  it('exports a flat model that simulates as the original does', async () => {
    const { nodes, edges } = await importModel()
    expect(checkScope(resolveScope(null, nodes, edges), store)).toMatchObject({ canBuild: true, errors: [] })

    const cellml = await (await generateFlattenedModel(nodes, edges, store)).text()
    expect(cellml).not.toMatch(/encapsulation/)
    expect(analyse(cellml)).toMatchObject({ issues: [], states: STATES.length })

    const original = await simulate(encapsulatedModel(), STATES)
    const exported = await simulate(cellml, STATES)
    for (const name of STATES) {
      expect(Number.isFinite(original[name]), name).toBe(true)
      expect(exported[name], name).toBeCloseTo(original[name], 9)
    }
  }, 60000)

  it('leaves a model without encapsulation byte-identical, and says once when containment groups are ignored', () => {
    const raw10 = encapsulatedModel().replace(GROUPS, '')
    expect(prepareCellmlImport(raw10, FILE)).toBe(raw10)
    const flat = hoistEncapsulatedComponents(encapsulatedModel()).cellml
    expect(prepareCellmlImport(flat, FILE)).toBe(flat)
    expect(notify.info).not.toHaveBeenCalled()

    const containmentOnly = encapsulatedModel(CONTAINMENT).replace(GROUPS, '')
    expect(hoistEncapsulatedComponents(containmentOnly)).toEqual({ cellml: containmentOnly, hoisted: [], ignoredContainment: true, hoistFailed: false })

    const xml = encapsulatedModel(CONTAINMENT)
    const prepared = prepareCellmlImport(xml, FILE)
    expect(prepared).toBe(hoistEncapsulatedComponents(xml).cellml)
    expect(notify.info).toHaveBeenCalledTimes(1)
    expect(notify.info).toHaveBeenCalledWith(expect.objectContaining({ title: 'Containment Groups Ignored' }))
    expect(notify.warning).not.toHaveBeenCalled()
  })
})
