/** Pure helpers for parameter-table rows, shared by the parameter table, the instance editor and the sidebar. */
import { PARAMETER_TYPE_OPTIONS, VALUE_REQUIRED_TYPES } from './constants'
import { cleanName } from './identifiers'
import { resolveUnits, sameDimensions } from './units'
import { isBlank } from './variables'

export function isValueMissing(row) {
  return !row.textInit && VALUE_REQUIRED_TYPES.has(row.type) && isBlank(row.value)
}

export function isUnitKnown(row, unitNames) {
  const cleaned = cleanName(row.units)
  return !!cleaned && unitNames.has(cleaned)
}

export function getUnknownUnitsNotice(row, unitNames) {
  const cleaned = cleanName(row.units)
  if (!cleaned || unitNames.has(cleaned)) return ''
  return `"${cleaned}" isn't defined in the units library`
}

/**
 * The rows whose units have other dimensions than their variable's in the math, which the export can't connect.
 * A scale-only difference (mm and metre) is fine, as libCellML converts it; units that can't be resolved are
 * skipped, as getUnknownUnitsNotice covers them.
 *
 * @param {Array<{ name: string, units: string }>} rows - Each with the units the export gives its value.
 * @param {Array<{ name: string, units: string }>} declared - The math's variables, as its analysis declares them.
 * @param {Map<string, Array<Object>>} unitDefinitions - The library's, as libraryStore.unitDefinitions.
 * @returns {string[]} A message for each.
 */
export function rowUnitConflicts(rows, declared, unitDefinitions) {
  const mathUnits = new Map((declared ?? []).map((variable) => [variable.name, cleanName(variable.units)]))
  const cache = new Map()
  const conflicts = []
  for (const row of rows) {
    const units = cleanName(row.units)
    const expected = mathUnits.get(row.name)
    if (!units || !expected || units === expected) continue
    const a = resolveUnits(units, unitDefinitions, cache)
    const b = resolveUnits(expected, unitDefinitions, cache)
    if (a && b && !sameDimensions(a, b)) {
      conflicts.push(`"${row.name}" is in ${units}, but its math uses ${expected}`)
    }
  }
  return conflicts
}

/** Kinds of variable the math itself computes, whose type is always `variable`. */
const COMPUTED_KINDS = new Set(['voi', 'state', 'computed_constant', 'algebraic'])

/** Types for a row the math doesn't compute: `variable` means computed, so it isn't one of them. */
const PARAMETER_ONLY_TYPE_OPTIONS = PARAMETER_TYPE_OPTIONS.filter((option) => option.value !== 'variable')

/**
 * Checks whether a row's type can't be changed: the math computes it or the text initialises it.
 * After reconcile, only computed rows are `variable`.
 *
 * @param {Object} row
 * @param {Map<string, string>|null} [variableKinds] - Each variable's kind, when the math has been analysed.
 * @returns {boolean}
 */
export function isTypeFixed(row, variableKinds = null) {
  return (
    row.stateRole === 'state' ||
    !!row.textInit ||
    row.type === 'variable' ||
    COMPUTED_KINDS.has(variableKinds?.get(row.name))
  )
}

/**
 * Lists the types a row can take.
 *
 * @param {Object} row
 * @param {Map<string, string>|null} [variableKinds]
 * @returns {Array} Options from PARAMETER_TYPE_OPTIONS.
 */
export function typeOptionsFor(row, variableKinds = null) {
  return isTypeFixed(row, variableKinds) ? PARAMETER_TYPE_OPTIONS : PARAMETER_ONLY_TYPE_OPTIONS
}
