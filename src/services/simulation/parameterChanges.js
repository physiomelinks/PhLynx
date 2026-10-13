/**
 * Turns slider values into parameter changes libOpenCOR applies to a model it has already read, so a
 * slider moving reruns the model without flattening it again.
 */
import { mappingKey } from './variableMapping'

// The kinds of variable libOpenCOR can change: a state's initial value, or a constant.
const CHANGEABLE_KINDS = new Set(['state', 'constant'])

/**
 * Reads a stored value as a number; a blank one isn't 0.
 *
 * @param {*} value
 * @returns {number} NaN when it isn't a number.
 */
const toNumber = (value) => (value == null || String(value).trim() === '' ? NaN : Number(value))

/**
 * Builds the parameter changes for a rerun of a model read earlier: every slider value, and the model's
 * own value for each one the model was flattened with but no longer tried out. A value the flatten would
 * ignore is left out too: one for a node outside the scope, a row that is no longer a constant, or a global
 * constant no node in the scope uses.
 *
 * @param {Object} options
 * @param {Array} options.nodes - The scope's nodes, as they are now.
 * @param {{rows: Map<string, number>, globals: Map<string, number>}} options.overrides - The slider values,
 *   rows by `nodeId::name` and global constants by name (see buildParameterOverrides).
 * @param {{rows: Set<string>, globals: Set<string>}} options.flattenedWith - The values flattened into the model.
 * @param {Map<string, string>} options.mapping - `nodeId::name` to the name libOpenCOR reports.
 * @param {Map<string, Object>} options.variables - The model's last results' variables, for their kinds.
 * @param {Function} options.getGlobalConstant - A global constant by name.
 * @returns {Array<{component: string, variable: string, value: number}>|null} The changes, or null when
 *   one can't be made this way and the model needs flattening again.
 */
export function buildParameterChanges({ nodes, overrides, flattenedWith, mapping, variables, getGlobalConstant }) {
  const changes = []
  /**
   * Adds the change of the variable a row maps to.
   *
   * @param {string} key - The row's `nodeId::name`.
   * @param {number} value
   * @returns {boolean} Whether it could.
   */
  const add = (key, value) => {
    const reported = mapping.get(key)
    if (!reported || !CHANGEABLE_KINDS.has(variables.get(reported)?.kind) || !Number.isFinite(value)) return false
    const separator = reported.indexOf('/')
    changes.push({ component: reported.slice(0, separator), variable: reported.slice(separator + 1), value })
    return true
  }

  const rowsByKey = new Map(nodes.flatMap((node) => (node.data.variables ?? []).map((row) => [mappingKey(node.id, row.name), row])))
  for (const key of new Set([...overrides.rows.keys(), ...flattenedWith.rows])) {
    const row = rowsByKey.get(key)
    // applyParameterOverrides sets a row's value, but only a constant row's value reaches the model.
    if (row?.type !== 'constant') continue
    const value = overrides.rows.has(key) ? overrides.rows.get(key) : toNumber(row.value)
    if (!add(key, value)) return null
  }

  for (const name of new Set([...overrides.globals.keys(), ...flattenedWith.globals])) {
    // A global constant is one variable however many instances use it, so any of them names it.
    const key = [...rowsByKey].find(([, row]) => row.type === 'global_constant' && row.name === name)?.[0]
    if (!key) continue
    const value = overrides.globals.has(name) ? overrides.globals.get(name) : toNumber(getGlobalConstant(name)?.value)
    if (!add(key, value)) return null
  }
  return changes
}
