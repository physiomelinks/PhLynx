/**
 * Writes a parameter set as a `schema_version: 1` parameterisation JSON, and a model's values as its parameters file,
 * as libcuflynx and circulatory_autogen read them, keeping each value's text as stored.
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
 * Gives one key's JSON: an entry on its line, or a group of entries and groups, one level of indent per level.
 *
 * @param {string} key
 * @param {Param|ParamTree} child - An entry, or a group (a Map).
 * @param {number} depth
 * @returns {string}
 */
function keyJson(key, child, depth) {
  const pad = ' '.repeat(depth)
  if (!(child instanceof Map)) return `${pad}${JSON.stringify(key)}: ${entryJson(child)}`
  if (!child.size) return `${pad}${JSON.stringify(key)}: {}`
  const lines = [...child].map(([name, grandchild]) => keyJson(name, grandchild, depth + 1))
  return `${pad}${JSON.stringify(key)}: {\n${lines.join(',\n')}\n${pad}}`
}

/**
 * Writes a file's text from its globals and its other keys, as libcuflynx's dump_parameters lays it out.
 *
 * @typedef {Map<string, Param|ParamTree>} ParamTree
 * @param {Map<string, Param>} globals - Written under `global` when there are any.
 * @param {ParamTree} rest
 * @returns {string}
 */
function documentJson(globals, rest) {
  const lines = [` "schema_version": ${PARAMETERS_SCHEMA_VERSION}`]
  if (globals.size) lines.push(keyJson('global', globals, 1))
  for (const [key, child] of rest) lines.push(keyJson(key, child, 1))
  return `{\n${lines.join(',\n')}\n}\n`
}

/**
 * Writes a set's file text, its globals under `global`.
 *
 * @param {{globals: Map<string, Param>, values: Map<string, Param>}} set
 * @returns {string}
 */
export const parametersJson = (set) => documentJson(set.globals, set.values)

/**
 * Writes a model's parameters file text (`<prefix>_parameters.json`): its globals under `global`, then each instance
 * by path, `inst/sub` nested as `{"inst": {"sub": ...}}`. Of an entry and a group of one name, the first is kept.
 *
 * @param {{globals: Map<string, Param>, instances: Map<string, Map<string, Param>>}} model - Instances in order.
 * @returns {string}
 */
export function modelParametersJson({ globals, instances }) {
  const tree = new Map()
  for (const [path, params] of instances) {
    let node = tree
    for (const level of path.split('/')) {
      if (!node.has(level)) node.set(level, new Map())
      node = node.get(level)
      if (!(node instanceof Map)) break
    }
    if (!(node instanceof Map)) continue
    for (const [name, param] of params) if (!node.has(name)) node.set(name, param)
  }
  return documentJson(globals, tree)
}

/**
 * Gives the file a set is written to, as a config's `default_parameterisation` or a module array's `parameterisation`
 * names it.
 *
 * @param {string} paramRef
 * @returns {string}
 */
export const parametersFileName = (paramRef) => `${paramRef}_parameters.json`
