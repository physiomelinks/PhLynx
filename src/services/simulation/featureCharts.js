/**
 * The feature plots of a protocol run, as the results views draw them (see FeaturePlot.vue): each group of features
 * across the experiments, then each of the obs_data's prediction plots (see protocol-kit's computePlotSeries).
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
 * Builds a chart of each group of features (an item_name_for_plotting) across the experiments it is in, with a point
 * in each experiment's colour; one with more than one item in an experiment draws a line per operation and
 * sub-experiment. A group with no value is left out.
 *
 * @param {Array<Object>} features - From computeFeatures.
 * @param {string[]} names - The experiments'.
 * @returns {Array<Object>} As FeaturePlot takes them: `{key, title, unit, x: {label, unit, values, labels}, yLabel,
 *   series}`.
 */
export function buildFeatureGroupCharts(features, names) {
  const groups = new Map()
  for (const feature of features) {
    if (!groups.has(feature.group)) groups.set(feature.group, [])
    groups.get(feature.group).push(feature)
  }
  return [...groups].flatMap(([group, items]) => {
    const shown = items.filter(({ value }) => Number.isFinite(value))
    if (!shown.length) return []
    const key = `feature:${group}`
    const experiments = [...new Set(items.map(({ experiment }) => experiment))].sort((a, b) => a - b)
    const { values, indexOf } = mergeValues(experiments.map((experiment) => experiment + 1))
    const x = { label: 'Experiment', unit: '', values, labels: experiments.map((experiment) => nameOf(names, experiment)) }
    const isRepeated = experiments.length < items.length
    let series
    if (isRepeated) {
      const lines = new Map()
      for (const feature of shown) {
        const line = `${feature.operation}#${feature.subexperiment}`
        if (!lines.has(line)) lines.set(line, { label: `${feature.operation}, sub-experiment ${feature.subexperiment + 1}`, values: new Array(values.length).fill(null) })
        lines.get(line).values[indexOf(feature.experiment + 1)] = feature.value
      }
      series = [...lines].map(([line, { label, values: lineValues }], index) => ({
        key: `${key}#${line}`,
        label,
        slot: index % SLOT_COUNT,
        values: lineValues,
        showsLine: true,
        showsPoints: true,
        isInKey: true,
      }))
    } else {
      const points = shown.map(({ experiment, value }) => ({ experiment, x: experiment + 1, y: value }))
      series = buildExperimentSeries(key, points, indexOf, values.length, names)
    }
    return [{ key, title: group, unit: items[0].unit ?? '', x, yLabel: '', series }]
  })
}

/**
 * Builds a chart of each prediction plot with points: a line per series value, in its own colour, or else a line
 * through points in each experiment's colour. One with errors, or no point, is left out.
 *
 * @param {Array<Object>} plots - From computePlotSeries.
 * @param {string[]} names - The experiments'.
 * @returns {Array<Object>} As buildFeatureGroupCharts gives them.
 */
export function buildPredictionPlotCharts(plots, names) {
  return plots.flatMap((plot) => {
    if (plot.errors.length || !plot.points.length) return []
    const key = `prediction-plot:${plot.index}:${plot.name}`
    const { values, indexOf } = mergeValues(plot.points.map(({ x }) => x))
    const labels = plot.kind === 'feature_vs_experiment' ? values.map((value) => nameOf(names, value - 1)) : null
    let series
    if (plot.series) {
      const lines = new Map()
      for (const point of plot.points) {
        if (!lines.has(point.series)) lines.set(point.series, new Array(values.length).fill(null))
        lines.get(point.series)[indexOf(point.x)] = point.y
      }
      series = [...lines].map(([value, lineValues], index) => ({
        key: `${key}#${value}`,
        label: `${plot.series.label} = ${Number.isFinite(value) ? Number(value.toPrecision(6)) : value}`,
        slot: index % SLOT_COUNT,
        values: lineValues,
        showsLine: true,
        showsPoints: true,
        isInKey: true,
      }))
    } else {
      series = buildExperimentSeries(key, plot.points, indexOf, values.length, names)
    }
    return [{ key, title: plot.name, unit: plot.y.unit, x: { label: plot.x.label, unit: plot.x.unit, values, labels }, yLabel: plot.y.label, series }]
  })
}
