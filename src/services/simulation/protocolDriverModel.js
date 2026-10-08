/**
 * Adds a protocol's drivers (see services/protocol/libopencorEngine/protocolDrivers.js) to a flattened CellML model: each computes
 * the parameter it drives, which loses its own value.
 */
import { writeDriverMathML } from '../protocol/libopencorEngine/protocolDrivers'

export const DRIVER_COMPONENT = 'protocol_drivers'

// The clock a protocol's export plots against: experiment_time is the model's time less time_offset, which each run
// of the protocol sets, so that it reads 0 at the end of the warm-up and carries on across sub-experiments.
export const CLOCK_COMPONENT = 'protocol_clock'
export const CLOCK_OFFSET = `${CLOCK_COMPONENT}/time_offset`
export const CLOCK_TIME = `${CLOCK_COMPONENT}/experiment_time`

/**
 * Names a driver's variables in the model.
 *
 * @param {{name: string}} driver
 * @returns {{output: string, selector: string, value: string}}
 */
export const nameDriverVariables = ({ name }) => ({ output: name, selector: `${name}_selector`, value: `${name}_value` })

/**
 * Lists a variable and every variable equivalent to it.
 *
 * @param {Object} variable - A libcellml Variable.
 * @param {Array} handles - Collects the handles to free.
 * @returns {Array<Object>}
 */
function findEquivalenceSet(variable, handles) {
  const found = [variable]
  const seen = new Set([`${variable.parent().name()}/${variable.name()}`])
  for (let index = 0; index < found.length; index++) {
    const current = found[index]
    for (let i = 0; i < current.equivalentVariableCount(); i++) {
      const equivalent = current.equivalentVariable(i)
      handles.push(equivalent)
      const parent = equivalent.parent()
      handles.push(parent)
      const key = `${parent.name()}/${equivalent.name()}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push(equivalent)
    }
  }
  return found
}

/**
 * Adds a variable to a component.
 *
 * @param {Object} libcellml
 * @param {Object} component
 * @param {{name: string, units: string, initialValue?: string}} definition
 * @returns {Object} The variable, to free.
 */
function addVariable(libcellml, component, { name, units, initialValue }) {
  const variable = new libcellml.Variable()
  variable.setName(name)
  variable.setUnitsByName(units)
  variable.setInterfaceTypeByString('public')
  if (initialValue != null) variable.setInitialValueByString(initialValue)
  component.addVariable(variable)
  return variable
}

/**
 * Adds drivers to a flattened model. A driver's parameter is named `component/variable` as the model has it; its
 * value, and every value equivalent to it, gives way to the driver, whose number starts as that value.
 *
 * @param {Object} options
 * @param {Object} options.libcellml - The libcellml module (see whenLibCellMLReady).
 * @param {string} options.cellml - The flattened model.
 * @param {Array<Object>} options.drivers - From planDrivers.
 * @returns {{cellml: string, errors: string[]}} The model with its drivers, and why any couldn't be added.
 */
export function addProtocolDrivers({ libcellml, cellml, drivers }) {
  const parser = new libcellml.Parser(false)
  const printer = new libcellml.Printer()
  const model = parser.parseModel(cellml)
  const handles = [parser, printer, model]
  const errors = []
  /** Keeps a handle to free, and gives it back. */
  const keep = (handle) => (handles.push(handle), handle)
  /** Names a variable's units. */
  const unitsOf = (variable) => keep(variable.units()).name()
  try {
    const environment = keep(model.componentByName('environment', true))
    const clock = environment && keep(environment.variableByName('time'))
    if (!clock) return { cellml, errors: ['The model has no environment time for a protocol to follow.'] }
    const timeUnits = unitsOf(clock)

    const component = new libcellml.Component()
    component.setName(DRIVER_COMPONENT)
    model.addComponent(component)
    handles.push(component)
    const time = addVariable(libcellml, component, { name: 'time', units: timeUnits })
    handles.push(time)
    libcellml.Variable.addEquivalence(time, clock)

    for (const driver of drivers) {
      const separator = driver.parameter.indexOf('/')
      const targetComponent = keep(model.componentByName(driver.parameter.slice(0, separator), true))
      const target = targetComponent && keep(targetComponent.variableByName(driver.parameter.slice(separator + 1)))
      if (!target) {
        errors.push(`The protocol drives ${driver.parameter}, which isn't in the model being simulated.`)
        continue
      }
      const members = findEquivalenceSet(target, handles)
      const valued = members.filter((member) => member.initialValue() !== '')
      const startValue = valued.map((member) => member.initialValue()).find((value) => Number.isFinite(Number(value))) ?? '0'
      valued.forEach((member) => member.removeInitialValue())
      const valueUnits = unitsOf(target)
      const names = nameDriverVariables(driver)
      handles.push(
        addVariable(libcellml, component, { name: names.output, units: valueUnits }),
        addVariable(libcellml, component, { name: names.selector, units: 'dimensionless', initialValue: '0' }),
        addVariable(libcellml, component, { name: names.value, units: valueUnits, initialValue: startValue })
      )
      const output = keep(component.variableByName(names.output))
      if (target.interfaceType() !== 'public' && target.interfaceType() !== 'public_and_private') target.setInterfaceTypeByString('public')
      libcellml.Variable.addEquivalence(output, target)
      component.appendMath(writeDriverMathML(driver, { ...names, time: 'time', valueUnits, timeUnits }))
    }
    return { cellml: printer.printModel(model, false), errors }
  } finally {
    handles.reverse().forEach((handle) => handle?.delete?.())
  }
}

/**
 * Adds a protocol's clock to a flattened model: experiment_time, the model's time less time_offset, a constant that
 * starts at 0.
 *
 * @param {Object} options
 * @param {Object} options.libcellml - The libcellml module (see whenLibCellMLReady).
 * @param {string} options.cellml - The flattened model, with any drivers.
 * @returns {{cellml: string, errors: string[]}} The model with its clock, and why it couldn't be added.
 */
export function addProtocolClock({ libcellml, cellml }) {
  const parser = new libcellml.Parser(false)
  const printer = new libcellml.Printer()
  const model = parser.parseModel(cellml)
  const handles = [parser, printer, model]
  /** Keeps a handle to free, and gives it back. */
  const keep = (handle) => (handles.push(handle), handle)
  try {
    const environment = keep(model.componentByName('environment', true))
    const clock = environment && keep(environment.variableByName('time'))
    if (!clock) return { cellml, errors: ['The model has no environment time for a protocol to follow.'] }
    if (keep(model.componentByName(CLOCK_COMPONENT, true))) return { cellml, errors: [`The model already has a ${CLOCK_COMPONENT} component.`] }
    const timeUnits = keep(clock.units()).name()

    const component = keep(new libcellml.Component())
    component.setName(CLOCK_COMPONENT)
    model.addComponent(component)
    const time = keep(addVariable(libcellml, component, { name: 'time', units: timeUnits }))
    libcellml.Variable.addEquivalence(time, clock)
    keep(addVariable(libcellml, component, { name: 'time_offset', units: timeUnits, initialValue: '0' }))
    keep(addVariable(libcellml, component, { name: 'experiment_time', units: timeUnits }))
    component.appendMath(
      `<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>experiment_time</ci><apply><minus/><ci>time</ci><ci>time_offset</ci></apply></apply></math>`
    )
    return { cellml: printer.printModel(model, false), errors: [] }
  } finally {
    handles.reverse().forEach((handle) => handle?.delete?.())
  }
}
