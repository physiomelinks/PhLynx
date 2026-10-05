import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractVoiAndParametersFromModel } from '../../../src/utils/cellml.js'
import { readFileAsText } from '../../../src/utils/misc.js'
import { cellmlParameterInfoFixture } from '../fixtures/cellml-parameter-info.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const modelFixturePath = path.resolve(__dirname, '../../resources/model.cellml')

async function loadModelFixtureAsText() {
  const fixtureText = await readFile(modelFixturePath, 'utf8')
  const fixtureFile = new File([fixtureText], 'model.cellml', { type: 'application/xml' })
  return readFileAsText(fixtureFile)
}

describe('CellML integration', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    vi.restoreAllMocks()
    // vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('extracts VOI using real libCellML initialized from plugin bootstrap', async () => {
    const modelString = await loadModelFixtureAsText()

    const result = extractVoiAndParametersFromModel(modelString, cellmlParameterInfoFixture)

    expect(result).toBeDefined()
    expect(result.voi).toEqual({
      name: 'time',
      componentName: 'environment',
      units: 'second',
    })
  })

  it('extracts selected parameters using real libCellML', async () => {
    const modelString = await loadModelFixtureAsText()

    const result = extractVoiAndParametersFromModel(modelString, cellmlParameterInfoFixture)

    expect(result.voi).toEqual({
      name: 'time',
      componentName: 'environment',
      units: 'second',
    })

    expect(result.mappedParameters).toBeDefined()
    expect(Object.keys(result.mappedParameters)).toHaveLength(3)
    expect(result.mappedParameters).toEqual({
      'axon_SN/C': { name: 'C', componentName: 'instance_parameters' },
      'soma_SN/Vol': { name: 'soma_SN_Vol', componentName: 'instance_parameters' },
      'var_SN/Vol': { name: 'var_SN_Vol', componentName: 'instance_parameters' },
    })
  })

  it('extracts VOI from a model whose state is initialised by a computed constant', () => {
    const result = extractVoiAndParametersFromModel(odeModel('<variable name="V" units="dimensionless" initial_value="k_eff"/>'))

    expect(result.voi).toEqual({ name: 't', componentName: 'c', units: 'second' })
  })

  it('throws the analyser errors for an invalid model', () => {
    const modelString = odeModel('<variable name="V" units="dimensionless"/>') // state never initialised

    expect(() => extractVoiAndParametersFromModel(modelString)).toThrow(/Analyser error count/)
  })
})

/** A one-component ODE model, dV/dt = k_eff with k_eff = k1 * k2, completed by the given declaration of V. */
function odeModel(stateDeclaration) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="c">
    <variable name="t" units="second"/>
    ${stateDeclaration}
    <variable name="k1" units="per_second" initial_value="2"/>
    <variable name="k2" units="dimensionless" initial_value="3"/>
    <variable name="k_eff" units="per_second"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply><eq/><ci>k_eff</ci><apply><times/><ci>k1</ci><ci>k2</ci></apply></apply>
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply><ci>k_eff</ci></apply>
    </math>
  </component>
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`
}
