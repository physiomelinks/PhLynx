/**
 * Instance sets: the parameter set an instance dropped with Parameters "None" makes of its own values. Unlike an
 * imported set, it follows the instance's edits as each is saved, and CA export writes it from the instance's values.
 *
 * @typedef {import('./parse').Param} Param
 * @typedef {import('../../stores/defaultParametersStore').ParamSet} ParamSet
 */
import { hasValueCell, isBlank } from '../variables'

/** A set's `source.kind` when an instance made it. */
export const INSTANCE_SET_KIND = 'instance'

const GLOBAL_TYPE = 'global_constant'

/**
 * Whether an instance made a set, so its edits are written back to it.
 *
 * @param {ParamSet|null|undefined} set
 * @returns {boolean}
 */
export const isInstanceSet = (set) => set?.source?.kind === INSTANCE_SET_KIND

/**
 * Whether a set is the one a node made, so that node's values are the set's.
 *
 * @param {ParamSet|null|undefined} set
 * @param {string} nodeId
 * @returns {boolean}
 */
export const isOwnInstanceSet = (set, nodeId) => isInstanceSet(set) && set.source.nodeId === nodeId

/**
 * Gives an instance's values as a set's entries: every row that holds a value, global constants under `globals`, a
 * blank value as null (needs a value).
 *
 * @param {Array<{name: string, type: string, value?: string, units?: string, data_reference?: string}>} variables
 * @returns {{globals: Map<string, Param>, values: Map<string, Param>}}
 */
export function setEntriesFromVariables(variables) {
  const globals = new Map()
  const values = new Map()
  for (const row of variables ?? []) {
    if (!hasValueCell(row.type)) continue
    const value = isBlank(row.value) ? null : String(row.value).trim()
    const param = { value, units: row.units ?? '', data_reference: row.data_reference ?? '', extra: {} }
    ;(row.type === GLOBAL_TYPE ? globals : values).set(row.name.trim(), param)
  }
  return { globals, values }
}

/**
 * Gives a set as the node that made it holds it now, or the set as stored for any other node.
 *
 * @param {ParamSet} set
 * @param {{id: string, data: {variables?: Array}}} node
 * @returns {ParamSet}
 */
export const setAsUsedBy = (set, node) =>
  isOwnInstanceSet(set, node.id) ? { ...set, ...setEntriesFromVariables(node.data.variables) } : set

/**
 * Whether a node's values come from a set others share: an imported set, one another node made, or the node's own set
 * once another node is tagged with it. Saving changed values on such a node asks whether to update the set or make
 * the node a set of its own; the node's own set updates without asking only while no other node uses it.
 *
 * @param {ParamSet|null|undefined} set
 * @param {string} nodeId
 * @param {Array} [otherUsers] - The other nodes tagged with the set (see otherSetUsers).
 * @returns {boolean}
 */
export const isSharedSet = (set, nodeId, otherUsers = []) =>
  !!set && (!isOwnInstanceSet(set, nodeId) || otherUsers.length > 0)

/** A value as compared, blank and null alike. */
const valueText = (value) => (isBlank(value) ? '' : String(value).trim())

/**
 * Gives the values a save changes that its set doesn't already hold: rows whose value differs from the node's before
 * the save, and from the set's entry of that name. Rows renamed, added or dropped, and other fields, don't count.
 *
 * @param {ParamSet} set
 * @param {Array} rowsBefore - The node's rows before the save.
 * @param {Array} rowsAfter - The rows the save writes.
 * @returns {{globals: Map<string, Param>, values: Map<string, Param>}} The changed values, as set entries.
 */
export function changedSetEntries(set, rowsBefore, rowsAfter) {
  const before = new Map((rowsBefore ?? []).map((row) => [row.name.trim(), valueText(row.value)]))
  const changedRows = (rowsAfter ?? []).filter((row) => {
    const name = row.name.trim()
    if (!hasValueCell(row.type) || !before.has(name)) return false
    const value = valueText(row.value)
    const inSet = set.values.get(name) ?? set.globals.get(name)
    return value !== before.get(name) && value !== valueText(inSet?.value)
  })
  return setEntriesFromVariables(changedRows)
}

/**
 * Whether set entries hold any value.
 *
 * @param {{globals: Map, values: Map}} entries
 * @returns {boolean}
 */
export const hasSetEntries = (entries) => entries.globals.size + entries.values.size > 0

/**
 * Gives the other nodes tagged with a set, on its math.
 *
 * @param {Array} nodes
 * @param {{nodeId: string, mathRef: string, paramRef: string}} target - The node saved, which is left out.
 * @returns {Array}
 */
export const otherSetUsers = (nodes, { nodeId, mathRef, paramRef }) =>
  nodes.filter((node) => node.id !== nodeId && node.data?.mathRef === mathRef && node.data?.parameterisation === paramRef)

/**
 * Whether a save gives a row a value it didn't hold: a changed value, or a new row with one. A value cleared or a row
 * dropped doesn't count.
 *
 * @param {Array} rowsBefore - The node's rows before the save.
 * @param {Array} rowsAfter - The rows the save writes.
 * @returns {boolean}
 */
export function hasNewValues(rowsBefore, rowsAfter) {
  const before = new Map((rowsBefore ?? []).map((row) => [row.name.trim(), valueText(row.value)]))
  return (rowsAfter ?? []).some((row) => {
    const value = valueText(row.value)
    return hasValueCell(row.type) && value !== '' && value !== before.get(row.name.trim())
  })
}
