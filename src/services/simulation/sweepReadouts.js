/**
 * The readings a sweep of a model with ODEs takes from each time course: one value per variable, plotted against
 * the swept parameter. Min and max are circulatory_autogen's operations of those names, as a protocol's prediction
 * items compute them (see protocol-kit's applyOperation); the end value and the peak are PhLynx's own.
 */
import { applyOperation } from '@physiomelinks/protocol-kit'

// Each reading, as the Sweep view offers them.
export const READOUTS = [
  { id: 'end', label: 'End', description: 'The last value: the steady state, once the run has settled.' },
  { id: 'min', label: 'Min', description: 'The least value, such as a peak inward current.' },
  { id: 'max', label: 'Max', description: 'The greatest value.' },
  { id: 'peak', label: 'Peak', description: 'The value furthest from 0, keeping its sign.' },
]

export const DEFAULT_READOUT = 'end'

/**
 * Finds the value furthest from 0, keeping its sign; the first of two as far. NaN anywhere makes it NaN, as it
 * makes min and max.
 *
 * @param {ArrayLike<number>} values
 * @returns {number}
 */
function findPeak(values) {
  let peak = values[0]
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) return NaN
    if (Math.abs(values[i]) > Math.abs(peak)) peak = values[i]
  }
  return peak
}

/**
 * Reduces a variable's time course to the one value a reading takes.
 *
 * @param {ArrayLike<number>} values - The time course, perhaps a view of a longer array.
 * @param {number} length - How many of its values the run computed.
 * @param {string} readout - One of READOUTS' ids.
 * @returns {number} NaN for a run that computed nothing.
 */
export function reduceSeries(values, length, readout) {
  if (length < 1) return NaN
  const computed = values.length === length ? values : values.subarray(0, length)
  if (readout === 'min' || readout === 'max') return applyOperation(readout, [computed])
  if (readout === 'peak') return findPeak(computed)
  return computed[length - 1]
}
