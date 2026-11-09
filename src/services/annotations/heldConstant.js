/**
 * Holding a reservoir's summed flows at 0: the side-car variables that are Sums, and the variable rows that hold
 * them constant or let other instances supply them.
 */

import { roleOf } from './match.js'

/**
 * The variables of a side-car whose role is aggregator: the fluxes a reservoir holds at constant 0.
 *
 * @param {{ variables: Array<{ variable: string, property: string, location: string }> }|null} sidecar
 * @returns {Array<string>}
 */
export function aggregatorVariables(sidecar) {
  return (sidecar?.variables ?? [])
    .filter((entry) => entry.property && entry.location && roleOf(entry) === 'aggregator')
    .map((entry) => entry.variable)
}

/**
 * Makes the named constant rows boundary conditions, keeping their values as the fallback used when nothing is
 * connected. Rows the math computes, and globals, are kept as they are.
 *
 * @param {Array<Object>} rows
 * @param {Array<string>} names
 * @returns {Array<Object>} New rows.
 */
export function asBoundaryConditions(rows, names) {
  const supplied = new Set(names)
  return (rows ?? []).map((row) =>
    supplied.has(row.name) && row.type === 'constant' ? { ...row, type: 'boundary_condition' } : row
  )
}

const isZero = (value) => value !== null && value !== undefined && String(value).trim() !== '' && Number(value) === 0

/**
 * Whether every named variable row is a constant 0.
 *
 * @param {Array<{ name: string, type: string, value: * }>} rows - Node variable rows.
 * @param {Array<string>} names
 * @returns {boolean} False when there are no names, or a row is missing.
 */
export function isHeldAtZero(rows, names) {
  if (!names.length) return false
  return names.every((name) => {
    const row = rows?.find((candidate) => candidate.name === name)
    return !!row && row.type === 'constant' && isZero(row.value)
  })
}

/**
 * Makes the named variable rows constant 0; other rows are kept as they are.
 *
 * @param {Array<Object>} rows
 * @param {Array<string>} names
 * @returns {Array<Object>} New rows.
 */
export function holdAtZero(rows, names) {
  const held = new Set(names)
  return (rows ?? []).map((row) => (held.has(row.name) ? { ...row, type: 'constant', value: '0' } : row))
}
