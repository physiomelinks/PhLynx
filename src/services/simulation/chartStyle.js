/**
 * How the simulation charts draw their axes and values, shared by the time charts (SimulationPlot) and the
 * prediction plots (FeaturePlot).
 */

export const CHROME = {
  light: { text: '#52514e', grid: '#e1e0d9', axis: '#c3c2b7', band: 'rgba(82, 81, 78, 0.06)', neutral: '#9a9990' },
  dark: { text: '#c3c2b7', grid: '#2c2c2a', axis: '#383835', band: 'rgba(195, 194, 183, 0.07)', neutral: '#77766f' },
}

export const AXIS_FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
// What an axis takes beside its labels: uPlot's ticks (10px) and the gap after them (5px), and a little to spare.
const AXIS_CHROME_PX = 18
let measuringContext = null

/**
 * Formats axis ticks to as many decimals as their spacing needs, or in exponent form when very small or
 * large, so ticks a thousandth apart don't all read 0.
 *
 * @param {Object} _ - The chart.
 * @param {number[]} splits - The tick values.
 * @returns {string[]}
 */
export function formatTicks(_, splits) {
  const step = splits.length > 1 ? Math.abs(splits[1] - splits[0]) : Math.abs(splits[0]) || 1
  const largest = Math.max(...splits.map(Math.abs))
  if (largest >= 1e6 || (largest > 0 && step < 1e-4)) return splits.map((value) => (value === 0 ? '0' : value.toExponential(2)))
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))
  return splits.map((value) => value.toFixed(decimals))
}

/**
 * Measures a tick label as the axis draws it.
 *
 * @param {string} text
 * @returns {number} Pixels.
 */
export function measureLabel(text) {
  measuringContext ??= document.createElement('canvas').getContext('2d')
  if (!measuringContext) return text.length * 7
  measuringContext.font = AXIS_FONT
  return measuringContext.measureText(text).width
}

/**
 * Sizes the value axis to fit its widest tick label; its unit is in the chart's heading.
 *
 * @param {Object} _ - The chart.
 * @param {string[]|null} values - The tick labels, once known.
 * @returns {number} Pixels.
 */
export const sizeValueAxis = (_, values) => Math.max(32, Math.ceil(Math.max(0, ...(values ?? []).map(measureLabel))) + AXIS_CHROME_PX)

/**
 * Formats a value for the readout, to 5 significant figures.
 *
 * @param {number|null|undefined} value
 * @returns {string}
 */
export const formatValue = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(5))) : '–')
