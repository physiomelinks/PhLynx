import { cleanName } from './identifiers'
import { TIME_NAMES, ACCESS, NO_ACCESS } from './constants'

export function isEditableVariableType(variableType) {
  return variableType !== 'variable' && variableType !== 'boundary_condition'
}

/** Whether a row of this type can hold a value. A boundary condition's is a fallback, used only when no connection supplies it. */
export function hasValueCell(variableType) {
  return isEditableVariableType(variableType) || variableType === 'boundary_condition'
}

/** The value input's placeholder for a row. */
export function valuePlaceholder(variableType) {
  return variableType === 'boundary_condition' ? 'Used if no connection supplies it' : 'Enter value...'
}

export function isEmpty(val) {
  return val === undefined || val === null || val === ''
}

export function extractGlobalConstants(parameterArray) {
  return parameterArray.filter((param) => param.type === 'global_constant')
}

// ── Access vs interface ──────────────────────────────────────────────────────
/** Every declared variable is public, so a parameter or port can reach it; access is a table setting only. */
export const VARIABLE_INTERFACE = 'public'

export const accessFromInterface = (cellmlInterface) =>
  cellmlInterface === 'public' || cellmlInterface === 'public_and_private' ? ACCESS : NO_ACCESS

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Infers a row's type from its role in the math. States, equation LHS names, the variable of
 * integration and time are computed ('variable'); being an initialiser doesn't count.
 *
 * @param {string} name
 * @param {{states: Set, assigned: Set, voi: Set}} roles
 * @returns {'variable'|'constant'}
 */
export function inferType(name, { states, assigned, voi }) {
  if (states.has(name) || assigned.has(name) || voi.has(name) || TIME_NAMES.has(name)) return 'variable'
  return 'constant'
}

// ── Values ───────────────────────────────────────────────────────────────────
const NUMERIC_LITERAL = /^-?[\d.]+([eE][+-]?\d+)?$/

export const isNumericLiteral = (value) => NUMERIC_LITERAL.test(String(value ?? '').trim())

/**
 * Checks whether a value is empty once trimmed.
 *
 * @param {*} value
 * @returns {boolean}
 */
export const isBlank = (value) => String(value ?? '').trim() === ''

/**
 * Builds the declarations Simple Mode writes into the model from the table rows. They carry no
 * values, only each state's link to its initialiser. A shared initialiser is declared once, and
 * rows without units are skipped.
 *
 * @param {Array} rows - Parameter-table rows.
 * @returns {Array<{name: string, units: string, interface: string, initialValue: (string|undefined)}>}
 */
export function buildVariableDeclarations(rows) {
  const byName = new Map(rows.map((row) => [row.name, row]))

  // Initialisers are declared alongside their first state, so a shared one appears once.
  const initialiserNames = new Set(
    rows.filter((row) => row.stateRole === 'state' && row.initialiser).map((row) => row.initialiser)
  )
  const alreadyEmitted = new Set()

  const declarations = []
  for (const row of rows) {
    if (initialiserNames.has(row.name) && row.stateRole !== 'state') continue

    const units = cleanName(row.units)
    if (!units) continue

    const initialiserRow = row.stateRole === 'state' && row.initialiser ? byName.get(row.initialiser) : null

    declarations.push({
      name: row.name,
      units,
      interface: VARIABLE_INTERFACE,
      // Only a state's link to its initialiser; values live in the parameter rows, not the math.
      initialValue: initialiserRow?.name,
    })

    if (initialiserRow && !alreadyEmitted.has(initialiserRow.name)) {
      alreadyEmitted.add(initialiserRow.name)
      declarations.push({
        name: initialiserRow.name,
        units: cleanName(initialiserRow.units) || units,
        interface: VARIABLE_INTERFACE,
      })
    }
  }

  return declarations
}

/**
 * Gets the rows whose units must match a row's: its initialiser and every state that uses it.
 *
 * @param {Array} rows
 * @param {Object} row
 * @returns {Array} The linked rows, `row` first.
 */
export function getLinkedUnitRows(rows, row) {
  const initialiser = row.stateRole === 'state' ? row.initialiser : row.name
  if (!initialiser) return [row]
  const linked = rows.filter(
    (other) => other !== row && (other.name === initialiser || (other.stateRole === 'state' && other.initialiser === initialiser))
  )
  return [row, ...linked]
}

/**
 * Sets a row's units, and the same units on every row linked to it (see getLinkedUnitRows).
 *
 * @param {Array} rows
 * @param {Object} row
 * @param {string} units
 */
export function setLinkedUnits(rows, row, units) {
  for (const linkedRow of getLinkedUnitRows(rows, row)) linkedRow.units = units
}

/**
 * Brings each state's initialiser into line with the state's units.
 *
 * @param {Array} rows - Mutated in place.
 * @param {{ overwrite?: boolean }} [options] - overwrite: give every linked group one units, taken from its first state
 *   with units (else its initialiser). Otherwise only a blank initialiser is filled from its state.
 * @returns {Array} The same `rows`.
 */
export function syncInitialiserUnits(rows, { overwrite = false } = {}) {
  const byName = new Map(rows.map((row) => [row.name, row]))
  const done = new Set()

  for (const row of rows) {
    if (row.stateRole !== 'state' || !row.initialiser) continue
    const initialiserRow = byName.get(row.initialiser)
    if (!initialiserRow) continue

    if (!overwrite) {
      if (!cleanName(initialiserRow.units)) initialiserRow.units = row.units
      continue
    }
    if (done.has(row)) continue

    const linked = getLinkedUnitRows(rows, row)
    linked.forEach((linkedRow) => done.add(linkedRow))
    const source = linked.find((linkedRow) => linkedRow.stateRole === 'state' && cleanName(linkedRow.units)) ?? initialiserRow
    linked.forEach((linkedRow) => (linkedRow.units = source.units))
  }
  return rows
}
