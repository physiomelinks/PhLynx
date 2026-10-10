/**
 * Parameter sweeps: a model without ODEs is solved once per value of one of its constants, so its variables
 * can be plotted against that constant, as an I–V curve is against the membrane voltage. The sweep is kept
 * in simulationSettingsStore.simulationSettings.sweep.
 */
import { pickDefaultValue } from './parameterSliders'
import { mappingKey } from './variableMapping'

// The row types a sweep can vary: what the parameter pane gives a value, or a boundary condition's own value.
const SWEEPABLE_TYPES = new Set(['constant', 'global_constant', 'boundary_condition'])

export const DEFAULT_SWEEP_POINTS = 51
export const MAX_SWEEP_POINTS = 1000

/**
 * Checks whether a row can be swept.
 *
 * @param {Object} row
 * @returns {boolean}
 */
export const isSweepableRow = (row) => Boolean(row?.name) && SWEEPABLE_TYPES.has(row.type)

/**
 * Builds a sweep of a node's row, over half its value either side, or 0 to 1 when it has none.
 *
 * @param {Object} node
 * @param {Object} row
 * @param {Function} getGlobalConstant - libraryStore.getGlobalConstant.
 * @returns {{key: string, nodeId: string, nodeName: string, parameterName: string, units: string, type: string,
 *   from: number, to: number, points: number}}
 */
export function createSweep(node, row, getGlobalConstant) {
  const value = pickDefaultValue(row, getGlobalConstant)
  const spread = Math.abs(value ?? 0) * 0.5
  return {
    key: mappingKey(node.id, row.name),
    nodeId: node.id,
    nodeName: node.data.name,
    parameterName: row.name,
    units: row.units || '',
    type: row.type,
    from: spread ? value - spread : 0,
    to: spread ? value + spread : 1,
    points: DEFAULT_SWEEP_POINTS,
  }
}

/**
 * Names a sweep's parameter as the variable search does.
 *
 * @param {Object} sweep
 * @returns {string}
 */
export const sweepLabel = (sweep) => `${sweep.nodeName}/${sweep.parameterName}`

/**
 * Says what stops a sweep from running, if anything.
 *
 * @param {Object|null} sweep
 * @returns {string|null}
 */
export function findSweepProblem(sweep) {
  if (!sweep?.parameterName) return 'Choose a parameter to sweep.'
  const { from, to, points } = sweep
  if (![from, to].every((value) => typeof value === 'number' && Number.isFinite(value))) return 'The sweep needs a value to start and end at.'
  if (from === to) return 'The sweep needs to end at a different value from the one it starts at.'
  if (!Number.isInteger(points) || points < 2 || points > MAX_SWEEP_POINTS) {
    return `The sweep needs from 2 to ${MAX_SWEEP_POINTS} points.`
  }
  return null
}

/**
 * Lists the values a sweep solves at: evenly spaced, from the lower end up, as a plot's x-axis needs.
 *
 * @param {{from: number, to: number, points: number}} sweep
 * @returns {number[]}
 */
export function sweepValues({ from, to, points }) {
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  return Array.from({ length: points }, (_, i) => (i === points - 1 ? high : low + ((high - low) * i) / (points - 1)))
}

/**
 * Finds the variable libOpenCOR reports a sweep's parameter under, which a run can change.
 *
 * @param {Object} options
 * @param {Object} options.sweep
 * @param {Array<Object>} options.nodes - The scope's nodes.
 * @param {Map<string, string>} options.mapping - `nodeId::name` to the name libOpenCOR reports.
 * @param {Map<string, {kind: string}>} options.variables - The model's variables, with their kinds.
 * @returns {{component: string, variable: string}|{problem: string}}
 */
export function resolveSweepTarget({ sweep, nodes, mapping, variables }) {
  const label = sweepLabel(sweep)
  // A global constant is one variable however many instances use it, so any of them names it.
  const node =
    sweep.type === 'global_constant'
      ? nodes.find((candidate) => candidate.data?.variables?.some((row) => row.name === sweep.parameterName && row.type === 'global_constant'))
      : nodes.find((candidate) => candidate.id === sweep.nodeId)
  if (!node) return { problem: `${label} isn’t in the simulated instances, so it can’t be swept.` }

  const reported = mapping.get(mappingKey(node.id, sweep.parameterName))
  if (!reported) return { problem: `${label} isn’t in the model, so it can’t be swept.` }
  if (variables.get(reported)?.kind !== 'constant') {
    return { problem: `${label} is computed by the model, or supplied through a connection, so it can’t be swept. Sweep a parameter instead.` }
  }
  const separator = reported.indexOf('/')
  return { component: reported.slice(0, separator), variable: reported.slice(separator + 1) }
}
