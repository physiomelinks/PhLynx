import { classifyVariables, isInitialisingKind } from 'cellml-text-editor'
import { VALUE_REQUIRED_TYPES } from '../../utils/constants'

/**
 * Lists the rows the parameter pane supplies: constant and global rows.
 *
 * @param {Array} rows - Parameter rows.
 * @returns {string[]}
 */
const parameterConstants = (rows) => rows.filter((row) => VALUE_REQUIRED_TYPES.has(row.type)).map((row) => row.name)

/**
 * Classifies a component's variables for the parameter table. The constant and global rows are
 * constants, and so is a boundary condition: its connection or fallback value supplies it, and the
 * export checks the network (see resolveBoundaryValues). See reconcileRows for how rows get their types.
 *
 * @param {import('cellml-text-editor').ModelAnalysis|null} analysis
 * @param {Array} rows - Parameter rows.
 * @returns {Map<string, import('cellml-text-editor').VariableKind>|null} Kinds by name, or null without an analysis.
 */
export function classifyRows(analysis, rows) {
  if (!analysis) return null
  const boundaries = rows.filter((row) => row.type === 'boundary_condition').map((row) => row.name)
  return classifyVariables(analysis, { constants: [...parameterConstants(rows), ...boundaries] })
}

/**
 * Finds the variables that can initialise a state only because a connection supplies a constant:
 * boundary conditions and anything the math computes from them.
 *
 * @param {import('cellml-text-editor').ModelAnalysis|null} analysis
 * @param {Array} rows - Parameter rows.
 * @returns {Set<string>|null} Names, or null without an analysis.
 */
export function findConnectionSupplied(analysis, rows) {
  if (!analysis) return null
  const kinds = classifyRows(analysis, rows)
  const localKinds = classifyVariables(analysis, { constants: parameterConstants(rows) })
  const names = new Set()
  for (const [name, kind] of kinds) {
    if (isInitialisingKind(kind) && !isInitialisingKind(localKinds.get(name))) names.add(name)
  }
  return names
}

/**
 * Whether a row can be a state's initial value: a constant or computed constant. Without kinds,
 * only constant rows can.
 *
 * @param {Object} row
 * @param {Map<string, string>|null} kinds - From classifyRows.
 * @returns {boolean}
 */
export function isInitialisable(row, kinds) {
  if (!kinds?.has(row.name)) return VALUE_REQUIRED_TYPES.has(row.type)
  return isInitialisingKind(kinds.get(row.name))
}
