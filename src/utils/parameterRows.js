/** Pure helpers for parameter-table rows, shared by the parameter table, the instance editor and the sidebar. */
import { PARAMETER_TYPE_OPTIONS, VALUE_REQUIRED_TYPES } from './constants'
import { cleanName } from './identifiers'
import { isBlank } from './variables'

export function isValueMissing(row) {
  return !row.textInit && VALUE_REQUIRED_TYPES.has(row.type) && isBlank(row.value)
}

export function getUnknownUnitsNotice(row, unitNames) {
  const cleaned = cleanName(row.units)
  if (!cleaned || unitNames.has(cleaned)) return ''
  return `"${cleaned}" isn't defined in the units library`
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
