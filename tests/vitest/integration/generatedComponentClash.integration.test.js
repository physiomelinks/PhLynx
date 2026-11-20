// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import { parseCellMLConnections } from '../../../src/services/import/parseCellmlConnections.js'
import { mapInspectionModules } from '../../../src/services/simulation/variableMapping.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel, loadParametersFromCellML } from '../../../src/utils/cellml.js'
import { patchUnderscoreTagSelectors } from '../helpers/happyDom.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`
// dq/dt = k: a constant k, and q starting from q_init.
const FILL_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="fill">
  <component name="fill">
    <variable name="t" units="second" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="q_init" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply><ci>k</ci></apply>
    </math>
  </component>
</model>`

// Instances named as the components an export generates, and as circulatory_autogen's instance parameters.
const CLASHING_NAMES = ['instance_parameters', 'global_parameters', 'model_parameters', 'inspection_modules', 'environment', 'phlynx_environment']

/** A component's opening tag in a flattened model, with its id if it has one. */
const componentTag = (text, name) => text.match(new RegExp(`<component name="${name}"(?: id="([^"]+)")?>`))

describe('components an export generates, beside instances with the same names', () => {
  let store
  let restoreSelectors

  beforeAll(async () => {
    restoreSelectors = patchUnderscoreTagSelectors()
    await ensureLibCellmlReady()
  }, 120000)

  afterAll(() => restoreSelectors?.())

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMath('file:fill', FILL_XML)
  })

  /** An instance of the fill math: k an instance constant, or the global constant k. */
  function buildNode(name, { isGlobal = false } = {}) {
    const rows = reconcileRows(analyzeMathXml(FILL_XML)).map((row) => {
      if (row.name === 'k') return isGlobal ? { ...row, type: 'global_constant', value: '' } : { ...row, value: '1' }
      if (row.name === 'q_init') return { ...row, value: '0' }
      return row
    })
    return { id: name, type: 'instanceNode', data: { name, mathRef: 'file:fill', variables: rows, ports: [] } }
  }

  async function exportClashingModel() {
    store.assignGlobalConstant('k', '2', 'per_second')
    const nodes = CLASHING_NAMES.map((name) => buildNode(name, { isGlobal: name === 'global_parameters' }))
    const modules = [
      {
        id: 'total',
        name: 'total',
        units: 'dimensionless',
        variables: ['inspection_modules', 'environment'].map((nodeId) => ({ nodeId, variableName: 'q', units: 'dimensionless', sign: 1 })),
      },
    ]
    // Validated and analysed, so it throws were any name repeated.
    const text = await (await generateFlattenedModel(nodes, [], store, modules)).text()
    return { nodes, modules, text }
  }

  it('gives each a free name and its id, and keeps the instances as they are', async () => {
    const { text } = await exportClashingModel()

    for (const name of CLASHING_NAMES) expect(componentTag(text, name)?.[1]).toBe(name)
    expect(componentTag(text, 'instance_parameters_1')?.[1]).toBe('phlynx_autogen_instance_parameters_0001')
    expect(componentTag(text, 'global_parameters_1')?.[1]).toBe('phlynx_autogen_global_parameters_0001')
    expect(componentTag(text, 'inspection_modules_1')?.[1]).toBe('phlynx_autogen_inspection_modules_0001')
    expect(componentTag(text, 'phlynx_environment_1')?.[1]).toBe('phlynx_autogen_environment_0001')
  })

  it('reads the parameters back from the generated components, not the instances named like them', async () => {
    const { text } = await exportClashingModel()

    const { parameters, globalParameters } = loadParametersFromCellML(text)

    expect(Object.keys(parameters).sort()).toEqual([...CLASHING_NAMES].sort())
    expect(parameters.global_parameters).toEqual([{ name: 'q_init', value: '0', units: 'dimensionless' }])
    expect(parameters.instance_parameters).toEqual(
      expect.arrayContaining([
        { name: 'k', value: '1', units: 'per_second' },
        { name: 'q_init', value: '0', units: 'dimensionless' },
      ])
    )
    expect(globalParameters).toEqual([{ name: 'k', value: '2', units: 'per_second' }])
  })

  it('finds the inspection modules’ outputs in their renamed component', async () => {
    const { nodes, modules } = await exportClashingModel()
    const results = { variables: new Map([['inspection_modules_1/total', { kind: 'algebraic', values: new Float64Array([0]) }]]) }

    expect(mapInspectionModules(modules, nodes, results)).toEqual([
      { id: 'total', name: 'total', units: 'dimensionless', reportedName: 'inspection_modules_1/total' },
    ])
  })

  it('imports the instances back as modules, and only the generated components as parameters', async () => {
    const { text } = await exportClashingModel()

    const payload = parseCellMLConnections(text, 'clash.cellml')

    expect(payload.parameterComponents).toEqual(expect.arrayContaining(['instance_parameters_1', 'global_parameters_1']))
    expect(payload.parameterComponents).toHaveLength(2)
    expect(payload.nodes.map((node) => node.data.name)).toEqual(expect.arrayContaining(CLASHING_NAMES))
  })
})
