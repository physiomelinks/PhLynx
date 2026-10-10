/**
 * Builds parameter-table rows from a MathAnalysis, keeping whatever the previous rows already hold.
 * Pure (no Vue, no DOM), so it is safe in a worker.
 *
 * A row's type says where its value comes from:
 * - `variable`: this component's math computes it (state, assigned, VoI). Only computed
 *   rows are variables, and computed rows always are.
 * - `boundary_condition`: another module supplies it through a port.
 * - `constant` / `global_constant`: the parameter pane supplies it. The default for a new row.
 * A port doesn't settle which of these a row is, since the connected module may compute it or take
 * it as its own boundary condition, so a stored type is always kept. Ports only re-type a stale
 * `variable` the math doesn't compute: in a port it becomes a boundary condition, else a constant.
 */
import { ACCESS, NO_ACCESS } from '../../utils/constants'
import { accessFromInterface, findVoiNames, inferType, isNumericLiteral, syncInitialiserUnits } from '../../utils/variables'

export const SIMPLE_MODE = 'simple'
export const ADVANCED_MODE = 'advanced'

/**
 * Maps the editor's Simple Mode flag to a reconcile mode.
 *
 * @param {boolean} isSimple - Whether Simple Mode is on.
 * @returns {'simple'|'advanced'}
 */
export const modeFor = (isSimple) => (isSimple ? SIMPLE_MODE : ADVANCED_MODE)

/**
 * Gets the roles the math gives its variables, as used by inferType.
 *
 * @param {import('./analyzeMath').MathAnalysis} analysis
 * @param {Array} rows - Rows giving units the math doesn't declare.
 * @returns {{states: Set<string>, assigned: Set<string>, voi: Set<string>}}
 */
function getRoles(analysis, rows) {
  const rowUnits = new Map(rows.map((row) => [row.name, row.units]))
  const voi = findVoiNames(analysis, (name) => rowUnits.get(name))
  return { states: new Set(analysis.stateVariables), assigned: new Set(analysis.assigned), voi }
}

/**
 * Resolves a row's type from what the math computes, what the ports carry and the stored type.
 *
 * @param {string} name
 * @param {{states: Set, assigned: Set, voi: Set}} roles
 * @param {Object|undefined} previousRow
 * @param {Set<string>|null} portVariables - Names the instance's ports carry; null keeps a stored `variable`.
 * @returns {string} The row type.
 */
function resolveRowType(name, roles, previousRow, portVariables) {
  if (inferType(name, roles) === 'variable') return 'variable'
  const storedType = previousRow?.type
  if (!storedType) return 'constant'
  if (storedType !== 'variable' || !portVariables) return storedType
  return portVariables.has(name) ? 'boundary_condition' : 'constant'
}

/**
 * Lists the variable names a set of ports carries. Saved ports may hold `{ name }` objects.
 *
 * @param {Array} [ports=[]]
 * @returns {Set<string>}
 */
export function getPortVariables(ports = []) {
  const names = (ports ?? []).flatMap((port) => (Array.isArray(port.variables) ? port.variables : []))
  return new Set(names.map((variable) => (typeof variable === 'object' && variable !== null ? variable.name : variable)))
}

/**
 * Re-types rows after the ports change, without rebuilding them. States keep their type.
 *
 * @param {Array} rows - Mutated in place.
 * @param {import('./analyzeMath').MathAnalysis|null} analysis
 * @param {Set<string>} portVariables - Names the instance's ports carry.
 * @returns {Array} The same `rows`.
 */
export function applyPortTypes(rows, analysis, portVariables) {
  if (!analysis) return rows
  const roles = getRoles(analysis, rows)
  for (const row of rows) {
    if (row.stateRole === 'state') continue
    const type = resolveRowType(row.name, roles, row, portVariables)
    if (type !== row.type) row.type = type
  }
  return rows
}

/**
 * Pairs each state with the variable supplying its initial value. Declarations win, and previous
 * rows fill in any pairing the declarations can't show.
 *
 * @param {import('./analyzeMath').MathAnalysis} analysis
 * @param {Array} previousRows
 * @param {Set<string>} stateNames
 * @returns {Map<string, string>} State name to initialiser name.
 */
function findInitialiserPairings(analysis, previousRows, stateNames) {
  const declaredByName = new Map(analysis.declared.map((variable) => [variable.name, variable]))
  const initialiserOf = new Map()

  for (const stateName of stateNames) {
    const initialValue = declaredByName.get(stateName)?.initialValue
    if (initialValue && !isNumericLiteral(initialValue)) initialiserOf.set(stateName, initialValue)
  }
  for (const row of previousRows) {
    if (row.stateRole === 'state' && stateNames.has(row.name) && row.initialiser && !initialiserOf.has(row.name)) {
      initialiserOf.set(row.name, row.initialiser)
    }
  }
  return initialiserOf
}

/**
 * @typedef {Object} RowContext
 * @property {{states: Set, assigned: Set, voi: Set}} roles
 * @property {Set<string>|null} portVariables - Names the instance's ports carry; null if unknown.
 * @property {Map<string, string>} defaults - Values taken out of the math, for rows with none yet.
 */

/**
 * Builds a Simple Mode row, where the table owns units, value, type and access.
 *
 * @param {string} name
 * @param {import('./analyzeMath').DeclaredVariable|undefined} declaration
 * @param {Object|undefined} previousRow
 * @param {RowContext} context
 * @returns {Object} A new row.
 */
function buildSimpleModeRow(name, declaration, previousRow, { roles, portVariables, defaults }) {
  const seededValue = declaration && isNumericLiteral(declaration.initialValue) ? declaration.initialValue.trim() : ''
  return {
    name,
    units: previousRow?.units || declaration?.units || '',
    access: previousRow?.access ?? (declaration ? accessFromInterface(declaration.interface) : ACCESS),
    value: previousRow?.value ?? defaults.get(name) ?? seededValue,
    type: resolveRowType(name, roles, previousRow, portVariables),
    data_reference: previousRow?.data_reference ?? null,
  }
}

/**
 * Builds an Advanced Mode row, where the text owns units and initial values.
 *
 * @param {string} name
 * @param {import('./analyzeMath').DeclaredVariable} declaration
 * @param {Object|undefined} previousRow
 * @param {RowContext} context
 * @returns {Object} A new row, with `textInit` when the text sets an initial value.
 */
function buildAdvancedModeRow(name, declaration, previousRow, { roles, portVariables, defaults }) {
  const hasInitialValue = !!declaration.initialValue
  const defaultAccess = roles.voi.has(name) ? accessFromInterface(declaration.interface) : ACCESS
  return {
    name,
    units: declaration.units,
    access: previousRow?.access ?? defaultAccess,
    value: previousRow?.value ?? defaults.get(name) ?? (declaration.initialValue || ''),
    // A missing initial value doesn't make it a variable: the value is set outside the math.
    type: resolveRowType(name, roles, previousRow, portVariables),
    data_reference: previousRow?.data_reference ?? null,
    ...(hasInitialValue ? { textInit: declaration.initialValue } : {}),
  }
}

/**
 * Marks each current state and points it at a real initialiser row, creating `<state>_init` only
 * when nothing supplies one. Existing pairings, including shared ones, are left alone.
 *
 * @param {Array} rows - Mutated in place.
 * @param {string[]} stateNames - States in the current math.
 * @returns {Array} The same `rows`.
 */
function resolveStateInitialisers(rows, stateNames) {
  const currentStateNames = new Set(stateNames)
  const rowsByName = new Map(rows.map((row) => [row.name, row]))

  for (const row of rows) {
    if (row.stateRole === 'state' && !currentStateNames.has(row.name)) {
      delete row.stateRole
      delete row.initialiser
    }
  }

  for (const stateName of currentStateNames) {
    const stateRow = rowsByName.get(stateName)
    if (!stateRow) continue

    stateRow.stateRole = 'state'
    stateRow.type = 'variable'
    if (stateRow.initialiser && rowsByName.has(stateRow.initialiser)) continue

    const defaultName = `${stateName}_init`
    let initialiserRow = rowsByName.get(defaultName)
    if (!initialiserRow) {
      const seed = String(stateRow.value ?? '').trim()
      initialiserRow = {
        name: defaultName,
        value: isNumericLiteral(seed) ? seed : '',
        units: stateRow.units,
        type: 'constant',
        access: NO_ACCESS,
        // The state's value was its initial value, so its source moves with it.
        data_reference: stateRow.data_reference ?? null,
      }
      rows.push(initialiserRow)
      rowsByName.set(defaultName, initialiserRow)
    }
    stateRow.initialiser = defaultName
  }

  return rows
}

/**
 * Builds the parameter rows for an analysis, keeping every value already set in `previousRows`.
 * Used on instance creation, on every editor change, and when saved math is applied to siblings.
 *
 * @param {import('./analyzeMath').MathAnalysis|null} analysis - With null, `previousRows` is returned.
 * @param {Array} [previousRows=[]] - Existing rows; never mutated.
 * @param {Object} [options]
 * @param {'simple'|'advanced'} [options.mode='simple'] - Whether the table or the text owns declarations.
 * @param {Iterable<string>|null} [options.portVariables=null] - Names the instance's ports carry; null keeps stored types.
 * @param {Map<string, string>} [options.defaults] - Values for rows that have none yet: a new instance's
 *   math defaults (libraryStore.getMathDefaults), or values typed into the text. A value someone cleared
 *   stays blank.
 * @returns {Array} New row objects.
 */
export function reconcileRows(analysis, previousRows = [], { mode = SIMPLE_MODE, portVariables = null, defaults = new Map() } = {}) {
  if (!analysis) return previousRows

  const previousByName = new Map(previousRows.map((row) => [row.name, row]))
  const declaredByName = new Map(analysis.declared.map((variable) => [variable.name, variable]))
  const stateNames = new Set(analysis.stateVariables)
  const initialiserOf = findInitialiserPairings(analysis, previousRows, stateNames)
  const context = { roles: getRoles(analysis, previousRows), portVariables: portVariables ? new Set(portVariables) : null, defaults }

  const rows = []
  const listedNames = new Set()
  // State roles are set by resolveStateInitialisers; here a state only records its pairing.
  const addRow = (row) => {
    if (listedNames.has(row.name)) return
    listedNames.add(row.name)
    if (stateNames.has(row.name)) row.initialiser = initialiserOf.get(row.name)
    rows.push(row)
  }

  if (mode === SIMPLE_MODE) {
    // A row the math still declares stays even if no equation uses it, so its value and source aren't lost.
    const keptDeclared = analysis.declared.map((variable) => variable.name).filter((name) => previousByName.has(name))
    for (const name of new Set([...analysis.referenced, ...initialiserOf.values(), ...keptDeclared])) {
      addRow(buildSimpleModeRow(name, declaredByName.get(name), previousByName.get(name), context))
    }
  } else {
    for (const declaration of analysis.declared) {
      addRow(buildAdvancedModeRow(declaration.name, declaration, previousByName.get(declaration.name), context))
    }
  }

  // Keep an initialiser known only from previous rows rather than silently dropping it.
  for (const name of new Set(initialiserOf.values())) {
    const previousRow = previousByName.get(name)
    if (!listedNames.has(name) && previousRow) addRow({ ...previousRow })
  }

  resolveStateInitialisers(rows, analysis.stateVariables)
  syncInitialiserUnits(rows, { overwrite: mode === SIMPLE_MODE })
  return rows
}
