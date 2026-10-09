/**
 * Works out a protocol's run on a model the simulator has read: the variable each parameter sets, the planned
 * segments, what the inputs chart shows, and the solver settings its drivers need.
 */
import { findCircAutogenLimits } from '@physiomelinks/protocol-kit'

import { DRIVER_COMPONENT, nameDriverVariables } from './protocolDriverModel'
import { resolveProtocolTargets } from './protocolTargets'
import { findShortestFeature } from '../protocol/libopencorEngine/protocolDrivers'
import { compileProtocolPlan } from '../protocol/libopencorEngine/protocolPlan'

/**
 * Prepares a protocol's run.
 *
 * @param {Object} options
 * @param {Object} options.view - The protocol, from readProtocolInfo.
 * @param {Array<Object>} options.drivers - Its drivers, from planDrivers, already written into the model.
 * @param {Array<Object>} options.nodes - The scope's nodes, to find `instance/variable` parameters by.
 * @param {Map<string, string>} options.mapping - `nodeId::name` to the name libOpenCOR reports.
 * @param {Map<string, {kind: string}>} options.variables - The model's variables, as the simulator lists them.
 * @param {Object} options.settings - Simulation settings.
 * @returns {{plan: Object, targets: Map<string, string>, inputs: Map<string, Object>, settings: Object, errors: string[],
 *   warnings: string[]}} `targets` maps each parameter the plan sets to its reported name, `inputs` each protocol
 *   parameter to what the inputs chart shows of it (`{name, isStepped}`).
 */
export function prepareProtocolRun({ view, drivers, nodes, mapping, variables, settings }) {
  // A driven parameter is set through its driver's selector and number, which the model reports by their own names.
  const driven = new Map(
    drivers.map((driver) => {
      const names = nameDriverVariables(driver)
      const variable = (name) => `${DRIVER_COMPONENT}/${name}`
      return [driver.parameter, { selectorParameter: variable(names.selector), valueParameter: variable(names.value), selectors: driver.selectors }]
    })
  )
  const { targets, kinds, errors: targetErrors } = resolveProtocolTargets({
    parameters: [
      ...view.controls.map(({ parameter }) => parameter).filter((parameter) => !driven.has(parameter)),
      ...[...driven.values()].flatMap(({ selectorParameter, valueParameter }) => [selectorParameter, valueParameter]),
    ],
    nodes,
    mapping,
    variables,
  })
  const plan = compileProtocolPlan({ view, pointInterval: settings.pointInterval, kinds, drivers: driven })
  // What the inputs chart shows of each parameter: its own variable, or its driver's output, which changes smoothly.
  const inputs = new Map(
    view.controls.flatMap(({ parameter }) => {
      const driver = drivers.find((candidate) => candidate.parameter === parameter)
      if (!driver) return targets.has(parameter) ? [[parameter, { name: targets.get(parameter), isStepped: true }]] : []
      const output = `${DRIVER_COMPONENT}/${nameDriverVariables(driver).output}`
      return variables.has(output) ? [[parameter, { name: output, isStepped: false }]] : []
    })
  )
  // CVODE mustn't step past any point of a driver's traces.
  const shortest = findShortestFeature(drivers)
  const isCvode = (settings.solver ?? 'CVODE') === 'CVODE'
  const runSettings = isCvode && Number.isFinite(shortest) ? { ...settings, timeStep: settings.timeStep > 0 ? Math.min(settings.timeStep, shortest) : shortest } : settings
  return {
    plan,
    targets,
    inputs,
    settings: runSettings,
    errors: [...targetErrors, ...plan.errors],
    // Now that each parameter's kind is known: what CUFLynx couldn't run, a state it couldn't drive included.
    warnings: [...plan.warnings, ...findCircAutogenLimits(view, { kinds })],
  }
}
