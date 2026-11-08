/**
 * Writes a parameter set as a `schema_version: 1` parameterisation JSON, as libcuflynx and circulatory_autogen read
 * it, keeping each value's text as stored.
 *
 * @typedef {import('./parse').Param} Param
 */
import { PARAMETERS_SCHEMA_VERSION } from './parse'

/** What a value still to be filled is written as. */
const EMPTY_VALUE = 'EMPTY_MUST_BE_FILLED'

/** A JSON number, which a value is written as when its text is one, so `1e-07` stays `1e-07`. */
const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/

/**
 * Gives one entry's JSON on a line: its value, units, data reference and extra keys.
 *
 * @param {Param} param
 * @returns {string}
 */
function entryJson(param) {
  const value = param.value === null ? JSON.stringify(EMPTY_VALUE) : JSON_NUMBER.test(param.value) ? param.value : JSON.stringify(param.value)
  const fields = { units: param.units ?? '', data_reference: param.data_reference ?? '', ...param.extra }
  const rest = Object.entries(fields).map(([key, field]) => `${JSON.stringify(key)}: ${JSON.stringify(field)}`)
  return `{${[`"value": ${value}`, ...rest].join(', ')}}`
}

/**
 * Gives a map of entries as JSON object lines.
 *
 * @param {Map<string, Param>} params
 * @param {string} indent
 * @returns {string[]}
 */
const entryLines = (params, indent) => [...params].map(([name, param]) => `${indent}${JSON.stringify(name)}: ${entryJson(param)}`)

/**
 * Writes a set's file text, its globals under `global`.
 *
 * @param {{globals: Map<string, Param>, values: Map<string, Param>}} set
 * @returns {string}
 */
export function parametersJson(set) {
  const lines = [` "schema_version": ${PARAMETERS_SCHEMA_VERSION}`]
  if (set.globals.size) lines.push(` "global": {\n${entryLines(set.globals, '  ').join(',\n')}\n }`)
  lines.push(...entryLines(set.values, ' '))
  return `{\n${lines.join(',\n')}\n}\n`
}

/**
 * Gives the file a set is written to, as a config's `default_parameterisation` or a module array's `parameterisation`
 * names it.
 *
 * @param {string} paramRef
 * @returns {string}
 */
export const parametersFileName = (paramRef) => `${paramRef}_parameters.json`
