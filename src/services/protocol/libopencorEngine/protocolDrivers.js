/**
 * Inputs that change continuously over a sub-experiment, ramps and traces, written as math of time for a model to
 * compute itself: a model can't be driven from outside it while it runs. Each driven parameter gets a driver, which
 * a selector constant switches between the inputs it takes, one per sub-experiment.
 */
import { PACING } from '../protocolShapes.js'

/**
 * Whether a cell changes continuously, so its parameter needs a driver.
 *
 * @param {Object} cell - From readProtocolInfo.
 * @returns {boolean}
 */
const isContinuous = (cell) => cell.kind === 'trace' || (cell.kind === 'shape' && cell.shape.type !== PACING)

/**
 * Plans the drivers a protocol needs: one for each parameter with a ramp or a trace in any sub-experiment. Its
 * other cells, numbers and pacing shapes, are taken by the driver too, as the traces CA would run them as.
 *
 * @param {Object} view - From readProtocolInfo.
 * @returns {Array<{parameter: string, name: string, traces: Array<{t: number[], values: number[]}>, selectors:
 *   number[][]}>} `selectors[e][s]` picks the driver's input in each sub-experiment: 0 for its number, n for
 *   `traces[n - 1]`.
 */
export function planDrivers(view) {
  return view.controls
    .filter(({ cells }) => cells.some((row) => row.some(isContinuous)))
    .map(({ parameter, cells }, index) => {
      const traces = []
      const byName = new Map()
      const selectors = cells.map((row) =>
        row.map((cell) => {
          if (cell.kind === 'constant') return 0
          if (!byName.has(cell.name)) {
            traces.push(cell.trace)
            byName.set(cell.name, traces.length)
          }
          return byName.get(cell.name)
        })
      )
      return { parameter, name: `driver_${index + 1}`, traces, selectors }
    })
}

/**
 * Writes a number as a MathML constant in some units.
 *
 * @param {number} value
 * @param {string} units
 * @returns {string}
 */
const writeNumber = (value, units) => `<cn cellml:units="${units}">${value}</cn>`

/**
 * Writes a trace as MathML of time: linear between its points, a balanced tree of comparisons deep only as the log of
 * their count, and held at its first and last values outside them, as CA's interpolated traces are.
 *
 * @param {{t: number[], values: number[]}} trace
 * @param {{time: string, valueUnits: string, timeUnits: string}} names - The time variable, and the units of values
 *   and of time.
 * @returns {string}
 */
export function writeTraceMathML({ t, values }, { time, valueUnits, timeUnits }) {
  const value = (index) => writeNumber(values[index], valueUnits)
  const at = (index) => writeNumber(t[index], timeUnits)
  // Between points i and i + 1, written so the units agree: value + change * (time - start) / length.
  const line = (i) =>
    values[i + 1] === values[i] || t[i + 1] === t[i]
      ? value(i)
      : `<apply><plus/>${value(i)}<apply><times/>${writeNumber(values[i + 1] - values[i], valueUnits)}<apply><divide/><apply><minus/><ci>${time}</ci>${at(i)}</apply>${writeNumber(t[i + 1] - t[i], timeUnits)}</apply></apply></apply>`
  const tree = (low, high) => {
    if (high - low === 1) return line(low)
    const middle = (low + high) >> 1
    return `<piecewise><piece>${tree(low, middle)}<apply><lt/><ci>${time}</ci>${at(middle)}</apply></piece><otherwise>${tree(middle, high)}</otherwise></piecewise>`
  }
  const last = t.length - 1
  if (last < 1) return value(0)
  return `<piecewise><piece>${value(0)}<apply><lt/><ci>${time}</ci>${at(0)}</apply></piece><piece>${value(last)}<apply><geq/><ci>${time}</ci>${at(last)}</apply></piece><otherwise>${tree(0, last)}</otherwise></piecewise>`
}

/**
 * Writes a driver's equation: its selector picks its number or one of its traces.
 *
 * @param {Object} driver - From planDrivers.
 * @param {{output: string, selector: string, value: string, time: string, valueUnits: string, timeUnits: string}} names
 *   - The driver's variables, and the units of its values and of time.
 * @returns {string} A MathML `<math>` element.
 */
export function writeDriverMathML(driver, names) {
  const pieces = driver.traces.map(
    (trace, index) => `<piece>${writeTraceMathML(trace, names)}<apply><lt/><ci>${names.selector}</ci>${writeNumber(index + 1.5, 'dimensionless')}</apply></piece>`
  )
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#"><apply><eq/><ci>${names.output}</ci><piecewise><piece><ci>${names.value}</ci><apply><lt/><ci>${names.selector}</ci>${writeNumber(0.5, 'dimensionless')}</apply></piece>${pieces.join('')}<otherwise><ci>${names.value}</ci></otherwise></piecewise></apply></math>`
}

/**
 * Finds the shortest time between two points of any driver's traces, which the solver mustn't step past.
 *
 * @param {Array<Object>} drivers - From planDrivers.
 * @returns {number} Infinity without drivers.
 */
export function findShortestFeature(drivers) {
  let shortest = Infinity
  for (const { traces } of drivers) {
    for (const { t } of traces) for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) shortest = Math.min(shortest, t[i] - t[i - 1])
  }
  return shortest
}
