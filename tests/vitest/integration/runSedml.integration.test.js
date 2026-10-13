// The run's SED-ML, as the simulation page exports it, read and run by libOpenCOR itself, beside the model it runs.
import createLibOpenCOR from '@opencor/libopencor'
import { beforeAll, describe, expect, it } from 'vitest'

import { RUN_SEDML_MODEL, buildRunSedml } from '../../../src/services/export/runSedml.js'
import { createSimulationSession } from '../../../src/services/simulation/engine.js'

const SETTINGS = { solver: 'CVODE', tolerance: 1e-7, maxSteps: 500, initialPoint: 0, startingPoint: 0, endingPoint: 1, pointInterval: 0.1 }

/**
 * Wraps a component's variables and maths in a CellML 2.0 model.
 *
 * @param {string} variables
 * @param {string} equations - MathML applies.
 * @returns {string}
 */
const model = (variables, equations) => `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" xmlns:cellml="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="c">${variables}
    <math xmlns="http://www.w3.org/1998/Math/MathML">${equations}</math>
  </component>
</model>`
const variable = (name, initial) => `<variable name="${name}" units="dimensionless"${initial === undefined ? '' : ` initial_value="${initial}"`}/>`
const ONE = '<cn cellml:units="dimensionless">1</cn>'
const TWO = '<cn cellml:units="dimensionless">2</cn>'

const ODE = model(variable('t') + variable('x', 1), `<apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><minus/><ci>x</ci></apply></apply>`)
// x² + x = v: an algebraic loop alongside the ODE.
const DAE = model(
  variable('t') + variable('v', 1) + variable('x'),
  `<apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>v</ci></apply><apply><minus/><ci>x</ci></apply></apply>
   <apply><eq/><apply><plus/><apply><times/><ci>x</ci><ci>x</ci></apply><ci>x</ci></apply><ci>v</ci></apply>`
)
const ALGEBRAIC = model(variable('a', 2) + variable('x'), `<apply><eq/><ci>x</ci><apply><times/>${TWO}<ci>a</ci></apply></apply>`)
// x² + x = a, with no ODEs: solved once, by KINSOL.
const NLA = model(
  variable('a', 2) + variable('x'),
  `<apply><eq/><apply><plus/><apply><times/><ci>x</ci><ci>x</ci></apply><ci>x</ci></apply><apply><plus/><ci>a</ci>${ONE}</apply></apply>`
)

describe('buildRunSedml, run by libOpenCOR', () => {
  // One libOpenCOR for the file: a second instance in the same page breaks the first.
  let libOpenCOR
  let folder = 0

  beforeAll(async () => {
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  /**
   * Gives an object's issues' descriptions.
   *
   * @param {Object} logger
   * @returns {string[]}
   */
  const issuesOf = (logger) => Array.from({ length: logger.issueCount }, (_, i) => logger.issue(i).description)

  /**
   * Exports a model's run as the page does, from what the simulator says of it, then runs the SED-ML in libOpenCOR.
   *
   * @param {string} cellml
   * @returns {{described: Object, issues: string[], values: number[]}} The issues reading, instancing and running it,
   *   and x's values as run.
   */
  function exportAndRun(cellml) {
    const session = createSimulationSession({ module: libOpenCOR, cellml })
    const described = session.describe()
    session.dispose()
    const sedml = buildRunSedml({
      settings: SETTINGS,
      isSteadyState: described.isSteadyState,
      needsNlaSolver: described.needsNlaSolver,
      voi: described.voi,
      groups: [{ id: 'g', name: 'Plot', xAxis: null }],
      traces: [{ name: 'c/x', label: 'c/x', unit: 'dimensionless', groupId: 'g' }],
    })

    const directory = `/run-sedml-${++folder}`
    const encoder = new TextEncoder()
    const modelFile = new libOpenCOR.File(`${directory}/${RUN_SEDML_MODEL}`)
    modelFile.setContents(encoder.encode(cellml))
    const sedmlFile = new libOpenCOR.File(`${directory}/simulation.sedml`)
    sedmlFile.setContents(encoder.encode(sedml))
    const document = new libOpenCOR.SedDocument(sedmlFile)
    const instance = document.instantiate()
    const issues = [...issuesOf(document), ...issuesOf(instance)]
    instance.run()
    issues.push(...issuesOf(instance))
    const task = instance.task(0)
    // c/x, whichever kind of variable the model makes it.
    let values = []
    for (const [count, name, read] of [
      ['stateCount', 'stateName', 'state'],
      ['algebraicVariableCount', 'algebraicVariableName', 'algebraicVariable'],
      ['computedConstantCount', 'computedConstantName', 'computedConstant'],
    ]) {
      for (let i = 0; i < task[count]; i++) if (task[name](i) === 'c/x') values = Array.from(task[read](i))
    }
    task.delete()
    instance.delete()
    document.delete()
    return { described, issues, values }
  }

  it('runs a time course, with its points as the settings give them', () => {
    const { described, issues, values } = exportAndRun(ODE)
    expect(described).toMatchObject({ isSteadyState: false, needsNlaSolver: false })
    expect(issues).toEqual([])
    expect(values).toHaveLength(11)
    expect(values.at(-1)).toBeCloseTo(Math.exp(-1), 4)
  })

  it('runs a time course with an algebraic loop, solved by KINSOL as it goes', () => {
    const { described, issues, values } = exportAndRun(DAE)
    expect(described).toMatchObject({ isSteadyState: false, needsNlaSolver: true })
    expect(issues).toEqual([])
    expect(values).toHaveLength(11)
    // x² + x = v at the start, with v = 1.
    expect(values[0]).toBeCloseTo((Math.sqrt(5) - 1) / 2, 4)
  })

  it('solves a model without ODEs once', () => {
    const { described, issues, values } = exportAndRun(ALGEBRAIC)
    expect(described).toMatchObject({ isSteadyState: true, needsNlaSolver: false })
    expect(issues).toEqual([])
    expect(values[0]).toBeCloseTo(4)
  })

  it('solves a model without ODEs but with an algebraic loop once, by KINSOL', () => {
    const { described, issues, values } = exportAndRun(NLA)
    expect(described).toMatchObject({ isSteadyState: true, needsNlaSolver: true })
    expect(issues).toEqual([])
    // x² + x = 3.
    expect(values[0]).toBeCloseTo((Math.sqrt(13) - 1) / 2, 4)
  })
})
