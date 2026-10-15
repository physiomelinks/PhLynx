// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import createLibOpenCOR from '@opencor/libopencor'
import JSZip from 'jszip'
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

const { useLoadFromCellML } = await import('../../../src/composables/useLoadFromCellml.js')
const { parseCellMLConnections } = await import('../../../src/services/import/parseCellmlConnections.js')
const { checkScope, resolveScope } = await import('../../../src/services/simulation/scopedModel.js')
const { createSimulationSession } = await import('../../../src/services/simulation/engine.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { generateFlattenedModel, loadParametersFromCellML, processCellMLData } = await import('../../../src/utils/cellml.js')
const { BASELINE_SIMULATION_SETTINGS } = await import('../../../src/utils/constants.js')

const FILE = 'shared_constant.cellml'
const MATHML = 'xmlns="http://www.w3.org/1998/Math/MathML"'
// A CellML 1.0 model, as PMR has them (#786). `membrane` uses k in its own math and exports it, `bath` holds Na_o
// with no math, and both readers take each through a connection. per_millivolt appears only in a <cn>.
const XML = `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/1.0#" xmlns:cellml="http://www.cellml.org/cellml/1.0#" name="shared_constant">
  <units name="millivolt"><unit units="volt" prefix="milli"/></units>
  <units name="per_millivolt"><unit units="volt" prefix="milli" exponent="-1"/></units>
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="environment"><variable name="time" units="second" public_interface="out"/></component>
  <component name="membrane">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="k" units="per_second" initial_value="0.5" public_interface="out"/>
    <variable name="x" units="millivolt" initial_value="2" public_interface="out"/>
    <math ${MATHML}>
      <apply><eq/>
        <apply><diff/><bvar><ci>time</ci></bvar><ci>x</ci></apply>
        <apply><minus/><apply><times/><ci>k</ci><ci>x</ci></apply></apply>
      </apply>
    </math>
  </component>
  <component name="bath"><variable name="Na_o" units="millivolt" initial_value="140" public_interface="out"/></component>
  <component name="reader_a">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="k" units="per_second" public_interface="in"/>
    <variable name="Na_o" units="millivolt" public_interface="in"/>
    <variable name="y" units="millivolt" initial_value="0" public_interface="out"/>
    <math ${MATHML}>
      <apply><eq/>
        <apply><diff/><bvar><ci>time</ci></bvar><ci>y</ci></apply>
        <apply><times/><ci>k</ci><apply><minus/><ci>Na_o</ci><ci>y</ci></apply></apply>
      </apply>
    </math>
  </component>
  <component name="reader_b">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="k" units="per_second" public_interface="in"/>
    <variable name="Na_o" units="millivolt" public_interface="in"/>
    <variable name="x" units="millivolt" public_interface="in"/>
    <variable name="z" units="millivolt" initial_value="0" public_interface="out"/>
    <math ${MATHML}>
      <apply><eq/>
        <apply><diff/><bvar><ci>time</ci></bvar><ci>z</ci></apply>
        <apply><times/><ci>k</ci><ci>Na_o</ci><ci>x</ci><cn cellml:units="per_millivolt">0.001</cn></apply>
      </apply>
    </math>
  </component>
  <connection><map_components component_1="environment" component_2="membrane"/><map_variables variable_1="time" variable_2="time"/></connection>
  <connection><map_components component_1="environment" component_2="reader_a"/><map_variables variable_1="time" variable_2="time"/></connection>
  <connection><map_components component_1="environment" component_2="reader_b"/><map_variables variable_1="time" variable_2="time"/></connection>
  <connection><map_components component_1="membrane" component_2="reader_a"/><map_variables variable_1="k" variable_2="k"/></connection>
  <connection><map_components component_1="membrane" component_2="reader_b"/>
    <map_variables variable_1="k" variable_2="k"/><map_variables variable_1="x" variable_2="x"/></connection>
  <connection><map_components component_1="bath" component_2="reader_a"/><map_variables variable_1="Na_o" variable_2="Na_o"/></connection>
  <connection><map_components component_1="bath" component_2="reader_b"/><map_variables variable_1="Na_o" variable_2="Na_o"/></connection>
</model>`

describe('importing a CellML constant shared through connections (#786)', () => {
  let store
  let warn
  let restoreSelectors
  // One libOpenCOR for the file: a second instance in the same page breaks the first.
  let libOpenCOR

  beforeAll(async () => {
    restoreSelectors = patchUnderscoreTagSelectors()
    await ensureLibCellmlReady()
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  afterAll(() => restoreSelectors?.())

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  /**
   * The workspace nodes and edges loadFromCellML builds, as a CellML file or an OMEX archive without a flow snapshot
   * loads.
   *
   * @param {string} [xml]
   * @param {string} [file]
   * @returns {Promise<{nodes: Array, edges: Array}>}
   */
  async function importModel(xml = XML, file = FILE) {
    const processed = processCellMLData(xml)
    expect(processed.type).toBe('success')
    store.addMathFile(file, processed.components)
    store.addUnitsFile({ componentFile: file, model: processed.units.model })

    canvas.addNodes.mockClear()
    canvas.prepareLayout.mockClear().mockResolvedValue()
    await useLoadFromCellML().loadFromCellML(parseCellMLConnections(xml, file), file, loadParametersFromCellML(xml))
    return { nodes: canvas.addNodes.mock.calls[0][0], edges: canvas.prepareLayout.mock.calls[0][0] }
  }

  const rowsOf = (nodes, nodeName, names) => {
    const rows = nodes.find((node) => node.data.name === nodeName).data.variables
    return Object.fromEntries(names.map((name) => [name, rows.find((row) => row.name === name)]).map(([name, row]) => [name, `${row.type}=${row.value ?? ''}`]))
  }

  it('makes each holder a constant with its value, and its readers boundary conditions it supplies', async () => {
    const { nodes } = await importModel()

    expect(rowsOf(nodes, 'membrane', ['k', 'x'])).toEqual({ k: 'constant=0.5', x: 'variable=' })
    expect(rowsOf(nodes, 'bath', ['Na_o'])).toEqual({ Na_o: 'constant=140' })
    expect(rowsOf(nodes, 'reader_a', ['k', 'Na_o'])).toEqual({ k: 'boundary_condition=', Na_o: 'boundary_condition=' })
    expect(rowsOf(nodes, 'reader_b', ['k', 'Na_o', 'x'])).toEqual({
      k: 'boundary_condition=',
      Na_o: 'boundary_condition=',
      x: 'boundary_condition=',
    })
  })

  it('exports with the values set once by their holders, and simulates', async () => {
    const { nodes, edges } = await importModel()
    expect(checkScope(resolveScope(null, nodes, edges), store)).toMatchObject({ canBuild: true, errors: [] })

    const cellml = await (await generateFlattenedModel(nodes, edges, store)).text()
    expect(cellml).toMatch(/<variable name="k" units="per_second" initial_value="0\.5"/)
    expect(cellml).toMatch(/<variable name="Na_o" units="millivolt" initial_value="140"/)
    expect(cellml.match(/initial_value="(0\.5|140)"/g)).toHaveLength(2)
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/ignoring/))
    // A unit only a <cn> uses is imported too.
    expect(cellml).toMatch(/<units name="per_millivolt">/)

    const session = createSimulationSession({ module: libOpenCOR, cellml })
    try {
      const settings = { ...BASELINE_SIMULATION_SETTINGS, endingPoint: 1, pointInterval: 1 }
      const results = await session.run({ settings }).promise
      const last = (name) => results.variables.get(name).values.at(-1)
      const decay = 1 - Math.exp(-0.5)
      expect(last('membrane/x')).toBeCloseTo(2 * Math.exp(-0.5), 5)
      expect(last('reader_a/y')).toBeCloseTo(140 * decay, 4)
      expect(last('reader_b/z')).toBeCloseTo(0.28 * decay, 5)
    } finally {
      session.dispose()
    }
  }, 60000)
  it("lets PhLynx parameter data type the rows it feeds, as a parameter component isn't a holder (#686)", async () => {
    // A PhLynx export: instance_parameters feeds membrane's k, which membrane shares on to reader. g has a value
    // in membrane too, as hand-edited CellML may.
    const xml = `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="exported">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="environment"><variable name="time" units="second" interface="public"/></component>
  <component name="membrane">
    <variable name="t" units="second" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <variable name="g" units="per_second" initial_value="9" interface="public"/>
    <variable name="x" units="dimensionless" initial_value="2" interface="public"/>
    <math ${MATHML}><apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><minus/><ci>g</ci><apply><times/><ci>k</ci><ci>x</ci></apply></apply></apply></math>
  </component>
  <component name="reader">
    <variable name="t" units="second" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <variable name="g" units="per_second" interface="public"/>
    <variable name="y" units="dimensionless" initial_value="0" interface="public"/>
    <math ${MATHML}><apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>y</ci></apply><apply><plus/><ci>k</ci><ci>g</ci></apply></apply></math>
  </component>
  <component name="instance_parameters">
    <variable name="k_membrane" units="per_second" initial_value="0.5" interface="public"/>
    <variable name="g_membrane" units="per_second" initial_value="0.25" interface="public"/>
  </component>
  <connection component_1="environment" component_2="membrane"><map_variables variable_1="time" variable_2="t"/></connection>
  <connection component_1="environment" component_2="reader"><map_variables variable_1="time" variable_2="t"/></connection>
  <connection component_1="membrane" component_2="reader">
    <map_variables variable_1="k" variable_2="k"/><map_variables variable_1="g" variable_2="g"/></connection>
  <connection component_1="instance_parameters" component_2="membrane">
    <map_variables variable_1="k_membrane" variable_2="k"/><map_variables variable_1="g_membrane" variable_2="g"/></connection>
</model>`
    const { nodes, edges } = await importModel(xml, 'exported.cellml')

    expect(nodes.map((node) => node.data.name).sort()).toEqual(['membrane', 'reader'])
    expect(rowsOf(nodes, 'membrane', ['k', 'g'])).toEqual({ k: 'constant=0.5', g: 'constant=0.25' })
    expect(rowsOf(nodes, 'reader', ['k', 'g'])).toEqual({ k: 'boundary_condition=', g: 'boundary_condition=' })
    expect(checkScope(resolveScope(null, nodes, edges), store)).toMatchObject({ canBuild: true, errors: [] })
  })

  it('imports the parameter components of a circulatory_autogen OMEX as constants', async () => {
    const zip = await JSZip.loadAsync(await readFile(path.resolve(process.cwd(), 'tests/resources/3compartment.omex')))
    const xml = await zip.file('3compartment_flat.cellml').async('string')
    const { nodes, edges } = await importModel(xml, '3compartment_flat.cellml')

    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    for (const holder of ['parameters', 'parameters_global']) {
      const component = [...doc.getElementsByTagName('component')].find((comp) => comp.getAttribute('name') === holder)
      const names = [...component.getElementsByTagName('variable')].map((variable) => variable.getAttribute('name'))
      const expected = Object.fromEntries(
        [...component.getElementsByTagName('variable')].map((variable) => [variable.getAttribute('name'), `constant=${variable.getAttribute('initial_value')}`])
      )
      expect(rowsOf(nodes, holder, names)).toEqual(expected)
    }
    expect(rowsOf(nodes, 'pvn_module', ['R', 'C', 'u_ext'])).toEqual({
      R: 'boundary_condition=',
      C: 'boundary_condition=',
      u_ext: 'boundary_condition=',
    })
    expect(checkScope(resolveScope(null, nodes, edges), store)).toMatchObject({ canBuild: true, errors: [] })
  })
})
