/**
 * Samples a protocol's inputs for drawing: the value a parameter takes over a window of its sub-experiment's clock,
 * as CA runs it, a trace interpolated between its points and held at its ends.
 */

/**
 * Gives a trace's value at a time, as CA interpolates it.
 *
 * @param {{t: number[], values: number[]}} trace
 * @param {number} time
 * @returns {number}
 */
export function interpolateTrace({ t, values }, time) {
  if (time <= t[0]) return values[0]
  if (time >= t.at(-1)) return values.at(-1)
  const high = t.findIndex((point) => point > time)
  const low = high - 1
  return values[low] + ((values[high] - values[low]) * (time - t[low])) / (t[high] - t[low])
}

/**
 * Samples an input over a window of its clock: every point of its trace inside the window, and its values at the
 * window's ends.
 *
 * @param {Object} cell - From readProtocolInfo.
 * @param {number} from
 * @param {number} to
 * @returns {{t: number[], values: number[]}|null} Null when the input can't be drawn, as a trace the file lacks.
 */
export function sampleInput(cell, from, to) {
  if (cell.kind === 'constant') return Number.isFinite(cell.value) ? { t: [from, to], values: [cell.value, cell.value] } : null
  const trace = cell.trace
  if (!trace?.t?.length) return null
  const t = [from]
  const values = [interpolateTrace(trace, from)]
  trace.t.forEach((time, index) => {
    if (time > from && time < to) {
      t.push(time)
      values.push(trace.values[index])
    }
  })
  t.push(to)
  values.push(interpolateTrace(trace, to))
  return { t, values }
}

/**
 * Finds the range of values some samples cover, widened a little when flat, so a line has room above and below it.
 *
 * @param {Array<{values: number[]}|null>} samples
 * @returns {{low: number, high: number}}
 */
export function findValueRange(samples) {
  const all = samples.flatMap((sample) => sample?.values ?? [])
  if (!all.length) return { low: 0, high: 1 }
  let low = Math.min(...all)
  let high = Math.max(...all)
  if (low === high) {
    const pad = Math.abs(low) * 0.5 || 1
    low -= pad
    high += pad
  }
  return { low, high }
}

/**
 * Writes samples as SVG polyline points in a box `width` by `height`, time across from the window's start.
 *
 * @param {{t: number[], values: number[]}} sample
 * @param {{from: number, to: number, low: number, high: number, width: number, height: number, inset?: number}} box
 *   - The window, the value range, the box's size, and a margin kept above and below.
 * @returns {string}
 */
export function writePolylinePoints({ t, values }, { from, to, low, high, width, height, inset = 4 }) {
  const span = to - from || 1
  const range = high - low || 1
  return t
    .map((time, i) => `${(((time - from) / span) * width).toFixed(2)},${(inset + (1 - (values[i] - low) / range) * (height - 2 * inset)).toFixed(2)}`)
    .join(' ')
}
