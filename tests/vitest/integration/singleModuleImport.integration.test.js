// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { loadParametersFromCellML, processCellMLData } = await import('../../../src/utils/cellml.js')

const FILE = 'one-module.cellml'
const MATHML = 'xmlns="http://www.w3.org/1998/Math/MathML"'

/** A PhLynx export of a one-module workspace: the module is connected only to the environment and parameters. */
const ONE_MODULE_EXPORT = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="PhLynxGenerated">
  <units name="per_s"><unit exponent="-1" units="second"/></units>
  <component name="environment">
    <variable name="t" units="second" interface="public"/>
  </component>
  <component name="global_parameters">
    <variable name="k" units="per_s" initial_value="2" interface="public"/>
  </component>
  <component name="instance_parameters">
    <variable name="x_init" units="dimensionless" initial_value="3" interface="public"/>
  </component>
  <component name="decay">
    <variable name="t" units="second" interface="public"/>
    <variable name="k" units="per_s" interface="public"/>
    <variable name="x_init" units="dimensionless" interface="public"/>
    <variable name="x" units="dimensionless" initial_value="x_init" interface="public"/>
    <math ${MATHML}>
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply></apply>
    </math>
  </component>
  <connection component_1="environment" component_2="decay"><map_variables variable_1="t" variable_2="t"/></connection>
  <connection component_1="global_parameters" component_2="decay"><map_variables variable_1="k" variable_2="k"/></connection>
  <connection component_1="instance_parameters" component_2="decay"><map_variables variable_1="x_init" variable_2="x_init"/></connection>
</model>`

describe('one-module CellML import', () => {
  let restoreSelectors

  beforeAll(async () => {
    restoreSelectors = patchUnderscoreTagSelectors()
    await ensureLibCellmlReady()
  }, 120000)

  afterAll(() => restoreSelectors?.())

  beforeEach(() => {
    setActivePinia(createPinia())
    canvas.addNodes.mockClear()
    canvas.prepareLayout.mockClear().mockResolvedValue()
  })

  it('places the module as a single node instead of leaving the load waiting', async () => {
    const cellml = prepareCellmlImport(ONE_MODULE_EXPORT, FILE)
    const processed = processCellMLData(cellml)
    expect(processed.type).toBe('success')
    const store = useLibraryStore()
    store.addMathFile(FILE, processed.components)
    store.addUnitsFile({ componentFile: FILE, model: processed.units.model })

    const payload = parseCellMLConnections(cellml, FILE)
    expect(payload.edges.length).toBeGreaterThan(0)

    const loaded = await useLoadFromCellML().loadFromCellML(payload, FILE, loadParametersFromCellML(cellml))

    expect(loaded).toBe(true)
    const nodes = canvas.addNodes.mock.calls[0][0]
    expect(nodes.map((n) => n.data.name)).toEqual(['decay'])
    expect(canvas.prepareLayout).toHaveBeenCalledWith([], null, 1)
  })
})
