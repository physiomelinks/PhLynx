/**
 * The prediction plots of a protocol run, as the results views draw them (see FeaturePlot.vue): each of the obs_data's
 * prediction_plots, its features paired by protocol-kit's computePlotSeries.
 */
import { SERIES_COLOURS } from './seriesSlots'

const SLOT_COUNT = SERIES_COLOURS.light.length

/**
 * Names an experiment, as the results views do.
 *
 * @param {string[]} names - By experiment.
 * @param {number} experiment
 * @returns {string}
 */
const nameOf = (names, experiment) => names[experiment] ?? `Experiment ${experiment + 1}`

/**
 * Lists each value once, in order, those equal to 12 significant figures being one, as mergeTimes does.
 *
 * @param {number[]} values
 * @returns {{values: number[], indexOf: Function}} `indexOf` gives a value's place.
 */
function mergeValues(values) {
  const keyOf = (value) => Number(value).toPrecision(12)
  const byKey = new Map()
  for (const value of values) if (!byKey.has(keyOf(value))) byKey.set(keyOf(value), value)
  const merged = [...byKey.values()].sort((a, b) => a - b)
  const places = new Map(merged.map((value, index) => [keyOf(value), index]))
  return { values: merged, indexOf: (value) => places.get(keyOf(value)) }
}

/**
 * Builds the series of points coloured by experiment, joined by a line of no colour of its own: a series per
 * experiment, in order, with its one point.
 *
 * @param {string} key - The chart's.
 * @param {Array<{experiment: number, x: number, y: number}>} points
 * @param {Function} indexOf - A point's place on the x axis.
 * @param {number} length - The x axis's.
 * @param {string[]} names - The experiments'.
 * @returns {Array<Object>}
 */
function buildExperimentSeries(key, points, indexOf, length, names) {
  const line = new Array(length).fill(null)
  for (const { x, y } of points) line[indexOf(x)] = y
  return [
    { key: `${key}#line`, label: '', slot: null, values: line, showsLine: true, showsPoints: false, isInKey: false },
    ...[...points].sort((a, b) => a.experiment - b.experiment).map(({ experiment, x, y }) => {
      const values = new Array(length).fill(null)
      values[indexOf(x)] = y
      return { key: `${key}#e${experiment}`, label: nameOf(names, experiment), slot: experiment % SLOT_COUNT, values, showsLine: false, showsPoints: true, isInKey: true }
    }),
  ]
}

/**
 * Gives a prediction plot's input references their units: its x, for a feature_vs_input plot, and its series.
 *
 * @param {Array<Object>} plots - From computePlotSeries.
 * @param {Array<Object>} references - The obs_data's prediction_plots, by place, whose x and series name the inputs.
 * @param {Function} unitOf - An input's unit, by its params_to_change key.
 * @returns {Array<Object>} The plots, `x.unit` and `series.unit` filled.
 */
export function addInputUnits(plots, references, unitOf) {
  return plots.map((plot) => {
    const { x, series } = references[plot.index] ?? {}
    return {
      ...plot,
      x: plot.kind === 'feature_vs_input' && x?.params_to_change ? { ...plot.x, unit: unitOf(x.params_to_change) ?? '' } : plot.x,
      series: plot.series && series?.params_to_change ? { ...plot.series, unit: unitOf(series.params_to_change) ?? '' } : plot.series,
    }
  })
}

/**
 * Builds the series of a plot's measured points, its y items' value and std, where they have them: points with
 * whiskers, of no colour of their own, or a line's colour.
 *
 * @param {string} key - The series'.
 * @param {string} label
 * @param {number|null} slot
 * @param {Array<Object>} points - With `measured`.
 * @param {Function} indexOf - A point's place on the x axis.
 * @param {number} length - The x axis's.
 * @returns {Array<Object>} None when no point is measured.
 */
function buildMeasuredSeries(key, label, slot, points, indexOf, length) {
  const measured = points.filter((point) => point.measured)
  if (!measured.length) return []
  const values = new Array(length).fill(null)
  const errors = new Array(length).fill(null)
  for (const { x, measured: { value, std } } of measured) {
    values[indexOf(x)] = value
    errors[indexOf(x)] = std
  }
  return [{ key, label, slot, values, errors, showsLine: false, showsPoints: true, isInKey: true, isMeasured: true }]
}

/**
 * Names a value of an input, with its unit.
 *
 * @param {number} value
 * @param {string} [unit]
 * @returns {string}
 */
const describeInputValue = (value, unit) => `${Number.isFinite(value) ? Number(value.toPrecision(6)) : value}${unit && unit !== 'dimensionless' ? ` ${unit}` : ''}`

/**
 * Builds a chart of each prediction plot with points: a line per series value, in its own colour, or else a line
 * through points in each experiment's colour; and the y items' measured values, with their std as whiskers, as the
 * proposal draws them. One with errors, or no point, is left out.
 *
 * @param {Array<Object>} plots - From computePlotSeries, as addInputUnits gives them.
 * @param {string[]} names - The experiments'.
 * @returns {Array<Object>} As FeaturePlot takes them: `{key, title, unit, x: {label, unit, values, labels}, yLabel,
 *   series}`; a measured series has `errors` (std, by x) and `isMeasured`.
 */
export function buildPredictionPlotCharts(plots, names) {
  return plots.flatMap((plot) => {
    if (plot.errors.length || !plot.points.length) return []
    const key = `prediction-plot:${plot.index}:${plot.name}`
    const { values, indexOf } = mergeValues(plot.points.map(({ x }) => x))
    let series
    if (plot.series) {
      const lines = new Map()
      for (const point of plot.points) {
        if (!lines.has(point.series)) lines.set(point.series, [])
        lines.get(point.series).push(point)
      }
      series = [...lines].flatMap(([value, points], index) => {
        const lineValues = new Array(values.length).fill(null)
        for (const point of points) lineValues[indexOf(point.x)] = point.y
        const label = `${plot.series.label} = ${describeInputValue(value, plot.series.unit)}`
        const slot = index % SLOT_COUNT
        return [
          { key: `${key}#${value}`, label, slot, values: lineValues, showsLine: true, showsPoints: true, isInKey: true },
          ...buildMeasuredSeries(`${key}#${value}#measured`, `${label}, measured`, slot, points, indexOf, values.length),
        ]
      })
    } else {
      series = [...buildExperimentSeries(key, plot.points, indexOf, values.length, names), ...buildMeasuredSeries(`${key}#measured`, 'Measured', null, plot.points, indexOf, values.length)]
    }
    return [{ key, title: plot.name, unit: plot.y.unit, x: { label: plot.x.label, unit: plot.x.unit, values, labels: null }, yLabel: plot.y.label, series }]
  })
}
