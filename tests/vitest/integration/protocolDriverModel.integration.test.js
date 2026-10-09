// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest'

import { addProtocolClock, addProtocolDrivers, CLOCK_OFFSET, CLOCK_TIME } from '../../../src/services/simulation/protocolDriverModel.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// As PhLynx flattens a decay module: its constants in instance_parameters, its time in environment.
const FLATTENED = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="flat">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="environment"><variable name="time" units="second" interface="public"/></component>
  <component name="decay">
    <variable name="t" units="second" interface="public"/>
    <variable name="x" units="dimensionless" initial_value="1"/>
    <variable name="k" units="per_second" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply></apply>
    </math>
  </component>
  <component name="instance_parameters"><variable name="k" units="per_second" initial_value="0.5" interface="public"/></component>
  <connection component_1="environment" component_2="decay"><map_variables variable_1="time" variable_2="t"/></connection>
  <connection component_1="decay" component_2="instance_parameters"><map_variables variable_1="k" variable_2="k"/></connection>
</model>`

const DRIVER = { parameter: 'decay/k', name: 'driver_1', traces: [{ t: [0, 1, 2], values: [0.5, 2, 0.5] }], selectors: [[1]] }

/**
 * Lists a model's issues as libcellml's validator and analyser find them.
 *
 * @param {Object} libcellml
 * @param {string} cellml
 * @returns {{issues: string[], model: Object}} The issues, and the model parsed.
 */
function check(libcellml, cellml) {
  const parser = new libcellml.Parser(false)
  const model = parser.parseModel(cellml)
  const validator = new libcellml.Validator()
  validator.validateModel(model)
  const analyser = new libcellml.Analyser()
  analyser.analyseModel(model)
  const issues = [
    ...Array.from({ length: parser.issueCount() }, (_, i) => parser.issue(i).description()),
    ...Array.from({ length: validator.errorCount() }, (_, i) => validator.error(i).description()),
    ...Array.from({ length: analyser.errorCount() }, (_, i) => analyser.error(i).description()),
  ]
  return { issues, model }
}

describe('addProtocolDrivers', () => {
  let libcellml

  beforeAll(async () => {
    libcellml = (await ensureLibCellmlReady()).instance
  })

  it('computes a driven constant from its driver, whose number starts as its value', () => {
    const { cellml, errors } = addProtocolDrivers({ libcellml, cellml: FLATTENED, drivers: [DRIVER] })
    expect(errors).toEqual([])
    const { issues, model } = check(libcellml, cellml)
    expect(issues).toEqual([])

    const parameters = model.componentByName('instance_parameters', true)
    expect(parameters.variableByName('k').initialValue()).toBe('')
    const drivers = model.componentByName('protocol_drivers', true)
    expect(drivers.variableByName('driver_1_value').initialValue()).toBe('0.5')
    expect(drivers.variableByName('driver_1_selector').initialValue()).toBe('0')
  })

  it("says which driven parameter the model doesn't have", () => {
    const { errors } = addProtocolDrivers({ libcellml, cellml: FLATTENED, drivers: [{ ...DRIVER, parameter: 'decay/nope' }] })
    expect(errors).toEqual(["The protocol drives decay/nope, which isn't in the model being simulated."])
  })
})

describe('addProtocolClock', () => {
  let libcellml

  beforeAll(async () => {
    libcellml = (await ensureLibCellmlReady()).instance
  })

  it('computes experiment time as the model time less an offset that starts at 0', () => {
    const { cellml, errors } = addProtocolClock({ libcellml, cellml: FLATTENED })
    expect(errors).toEqual([])
    const { issues, model } = check(libcellml, cellml)
    expect(issues).toEqual([])

    const clock = model.componentByName('protocol_clock', true)
    expect(clock.variableByName('time_offset').initialValue()).toBe('0')
    expect(clock.variableByName('time_offset').units().name()).toBe('second')
    expect(clock.variableByName('experiment_time').units().name()).toBe('second')
    expect(clock.variableByName('time').equivalentVariable(0).name()).toBe('time')
    expect(CLOCK_OFFSET).toBe('protocol_clock/time_offset')
    expect(CLOCK_TIME).toBe('protocol_clock/experiment_time')

    const analyser = new libcellml.Analyser()
    analyser.analyseModel(model)
    const analysed = analyser.analyserModel()
    expect(libcellml.AnalyserModel.typeAsString(analysed.type())).toBe('ode')
    const kind = (name) => libcellml.AnalyserVariable.typeAsString(analysed.analyserVariable(clock.variableByName(name.split('/')[1])).type())
    expect(kind(CLOCK_OFFSET)).toBe('constant')
    expect(kind(CLOCK_TIME)).toBe('algebraic_variable')
  })

  it('adds to a model with drivers', () => {
    const driven = addProtocolDrivers({ libcellml, cellml: FLATTENED, drivers: [DRIVER] })
    const { cellml, errors } = addProtocolClock({ libcellml, cellml: driven.cellml })
    expect(errors).toEqual([])
    expect(check(libcellml, cellml).issues).toEqual([])
  })

  it('says why a model without environment time, or with a clock already, gets none', () => {
    const timeless = FLATTENED.replace('<component name="environment">', '<component name="surroundings">')
    expect(addProtocolClock({ libcellml, cellml: timeless })).toEqual({ cellml: timeless, errors: ['The model has no environment time for a protocol to follow.'] })
    const { cellml } = addProtocolClock({ libcellml, cellml: FLATTENED })
    expect(addProtocolClock({ libcellml, cellml }).errors).toEqual(['The model already has a protocol_clock component.'])
  })
})
