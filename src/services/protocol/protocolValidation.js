/**
 * Checks a protocol_info as circulatory_autogen does on reading obs_data (PrimitiveParsers.py), in the same order and
 * with the same messages, then for what running it in PhLynx needs besides.
 */
import { formatPythonList, getPythonTypeName } from './pythonFormat.js'
import { ProtocolShapeError, isMapping, materialiseShapes, validateTraceReferences } from './protocolShapes.js'

const LIST = "(<class 'list'>, <class 'tuple'>, <class 'numpy.ndarray'>)"
// CA's protocol_info schema: each key's allowed types, as CA prints them, and whether it is required.
const SCHEMA = {
  pre_times: { types: LIST, isAllowed: Array.isArray, isRequired: true },
  sim_times: { types: LIST, isAllowed: Array.isArray, isRequired: true },
  params_to_change: { types: "(<class 'dict'>,)", isAllowed: isMapping, fallback: {} },
  offline_pre_time: { types: "(<class 'float'>, <class 'int'>)", isAllowed: (value) => typeof value === 'number' || typeof value === 'boolean' },
  experiment_labels: { types: LIST, isAllowed: Array.isArray },
  experiment_ids: { types: LIST, isAllowed: Array.isArray },
  experiment_colors: { types: LIST, isAllowed: Array.isArray },
  comment: { types: "(<class 'str'>,)", isAllowed: (value) => typeof value === 'string' },
  protocol_traces: { types: "(<class 'dict'>,)", isAllowed: isMapping, fallback: {} },
  protocol_shapes: { types: "(<class 'dict'>,)", isAllowed: isMapping, fallback: {} },
}
export const PROTOCOL_INFO_KEYS = Object.keys(SCHEMA)

/**
 * Whether a value counts as missing to CA: None, or a NaN number.
 *
 * @param {*} value
 * @returns {boolean}
 */
const isMissing = (value) => value == null || (typeof value === 'number' && Number.isNaN(value))

/**
 * Names a value's class as Python prints `type(value)`.
 *
 * @param {*} value
 * @returns {string}
 */
const formatPythonClass = (value) => `<class '${getPythonTypeName(value)}'>`

/**
 * Checks params_to_change against sim_times: one row per experiment, one value per sub-experiment. Ported from CA's
 * validate_params_to_change.
 *
 * @param {Object} protocolInfo
 * @returns {string|null} CA's error, or null.
 */
export function checkParamsToChange(protocolInfo) {
  const paramsToChange = protocolInfo.params_to_change
  if (!paramsToChange || !Object.keys(paramsToChange).length) return null
  const simTimes = protocolInfo.sim_times
  if (simTimes == null) return "protocol_info missing required key 'sim_times'"

  const experiments = simTimes.length
  const preTimes = protocolInfo.pre_times
  if (preTimes != null && preTimes.length !== experiments) {
    return `pre_times length (${preTimes.length}) does not match num_experiments (${experiments})`
  }

  const errors = []
  for (const key of Object.keys(paramsToChange).sort()) {
    const rows = paramsToChange[key]
    if (!Array.isArray(rows)) {
      errors.push(`  ${key}: expected list of experiment rows, got ${getPythonTypeName(rows)}`)
      continue
    }
    if (rows.length !== experiments) {
      errors.push(`  ${key}: ${rows.length} experiment row(s), expected ${experiments}`)
      continue
    }
    rows.forEach((row, experiment) => {
      // A sim_times entry that isn't a list makes CA fail outright; validateProtocolInfo reports it.
      // CA takes len() of the row: a string has one, anything else that isn't a list makes CA fail outright.
      if (!Array.isArray(simTimes[experiment]) && typeof simTimes[experiment] !== 'string') return
      const subs = simTimes[experiment].length
      if (!Array.isArray(row)) errors.push(`  ${key}[${experiment}]: expected list, got ${getPythonTypeName(row)}`)
      else if (row.length !== subs) errors.push(`  ${key}[${experiment}]: ${row.length} sub value(s), expected ${subs}`)
    })
  }
  return errors.length ? `params_to_change shape mismatch:\n${errors.join('\n')}` : null
}

/**
 * Checks a protocol_info as CA reads it: the schema, params_to_change's shape, then expanding the shapes and
 * resolving every trace a sub-experiment names. Stops at the first stage that fails, as CA does. Where CA fails with
 * a KeyError, on a required key that is absent rather than null, this reports it as missing instead.
 *
 * @param {*} protocolInfo
 * @returns {{error: string|null, protocolInfo: Object|null}} CA's error, or the protocol_info as CA would use it:
 *   defaults filled in and shapes expanded into protocol_traces.
 */
export function readAsCircAutogen(protocolInfo) {
  if (!isMapping(protocolInfo)) return { error: `protocol_info must be a mapping, got ${getPythonTypeName(protocolInfo)}`, protocolInfo: null }
  const unknown = Object.keys(protocolInfo).filter((key) => !Object.hasOwn(SCHEMA, key)).sort()
  if (unknown.length) return { error: `Unknown protocol_info keys not in schema: ${formatPythonList(unknown)}`, protocolInfo: null }

  const read = { ...protocolInfo }
  const missingRequired = []
  const typeErrors = []
  for (const [key, rules] of Object.entries(SCHEMA)) {
    if (!Object.hasOwn(read, key) || isMissing(read[key])) {
      if (rules.isRequired) missingRequired.push(key)
      else read[key] = structuredClone(rules.fallback ?? null)
      continue
    }
    if (read[key] != null && !rules.isAllowed(read[key])) {
      typeErrors.push(`protocol_info['${key}']: expected ${rules.types}, got ${formatPythonClass(read[key])}`)
    }
  }
  if (missingRequired.length) {
    return { error: `Missing required protocol_info keys: ${formatPythonList(missingRequired.sort())}`, protocolInfo: null }
  }
  if (typeErrors.length) return { error: `Invalid protocol_info value types:\n${typeErrors.join('\n')}`, protocolInfo: null }

  const shapeError = checkParamsToChange(read)
  if (shapeError) return { error: shapeError, protocolInfo: null }
  try {
    const materialised = materialiseShapes(read)
    validateTraceReferences(materialised)
    return { error: null, protocolInfo: materialised }
  } catch (error) {
    if (error instanceof ProtocolShapeError) return { error: error.message, protocolInfo: null }
    throw error
  }
}

/**
 * Checks a protocol_info for running in PhLynx: everything CA checks, then that each experiment has sub-experiments
 * of positive length, a warm-up that isn't negative, and a number or a trace for every value.
 *
 * @param {*} protocolInfo
 * @returns {{errors: string[], warnings: string[], protocolInfo: Object|null}} `protocolInfo` as CA would use it, when
 *   there are no errors.
 */
export function validateProtocolInfo(protocolInfo) {
  const { error, protocolInfo: read } = readAsCircAutogen(protocolInfo)
  if (error) return { errors: [error], warnings: [], protocolInfo: null }

  const errors = []
  const warnings = []
  const simTimes = read.sim_times
  if (!simTimes.length) errors.push('The protocol has no experiments.')
  simTimes.forEach((subs, experiment) => {
    if (!Array.isArray(subs) || !subs.length) {
      errors.push(`Experiment ${experiment + 1} has no sub-experiments.`)
      return
    }
    subs.forEach((duration, sub) => {
      if (typeof duration !== 'number' || !(duration > 0) || !Number.isFinite(duration)) {
        errors.push(`Experiment ${experiment + 1}, sub-experiment ${sub + 1} needs a length greater than 0.`)
      }
    })
  })
  if (read.pre_times.length !== simTimes.length) {
    errors.push(`pre_times has ${read.pre_times.length} values for ${simTimes.length} experiments.`)
  }
  read.pre_times.forEach((preTime, experiment) => {
    if (typeof preTime !== 'number' || !(preTime >= 0) || !Number.isFinite(preTime)) {
      errors.push(`Experiment ${experiment + 1} needs a warm-up (pre_time) of 0 or more.`)
    }
  })
  for (const [parameter, rows] of Object.entries(read.params_to_change)) {
    rows.forEach((row, experiment) =>
      (Array.isArray(row) ? row : []).forEach((leaf, sub) => {
        if (typeof leaf === 'string' || (typeof leaf === 'number' && Number.isFinite(leaf))) return
        errors.push(`${parameter} has no number or trace for experiment ${experiment + 1}, sub-experiment ${sub + 1}.`)
      })
    )
  }

  for (const key of ['experiment_labels', 'experiment_colors', 'experiment_ids']) {
    if (read[key] != null && read[key].length !== simTimes.length) {
      warnings.push(`${key} has ${read[key].length} entries for ${simTimes.length} experiments.`)
    }
  }
  if (read.offline_pre_time != null) {
    warnings.push('offline_pre_time is only used for calibration, so PhLynx ignores it.')
  }
  return { errors, warnings, protocolInfo: errors.length ? null : read }
}
