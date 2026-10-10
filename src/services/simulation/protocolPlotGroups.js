/**
 * The plots a protocol run's obs_data asks for, as CUFLynx draws them (its lib/plot.js): each prediction item's
 * variable as a trace, one plot per trace label, and on it each data item's measured value as a dashed obs line and
 * the run's as a solid calc line, over the window its operation reduces; and a prediction item's feature as a calc
 * line, with an obs line when it holds a value.
 */
import { isRangeOperation, readObsDataParts, readOperation, sliceRangeBounds } from '@physiomelinks/protocol-kit'

import { SLOT_COUNT } from './seriesSlots'

// The obs_data's plots make a plot of their own, after the plotted variables.
export const OBS_DATA_PLOT = '__obs_data__'
const TIME_NAMES = new Set(['time', 't'])
// The operations whose value is a height above the window's least value, drawn from there.
const SPAN_OPERATIONS = new Set(['max_minus_min', 'max_minus_min_in_range'])

/**
 * Finds the model variable a data item attaches to: its first operand other than the time.
 *
 * @param {Object} item
 * @returns {string|undefined}
 */
export function obsModelVar(item) {
  if (Array.isArray(item.operands) && item.operands.length) {
    const variable = item.operands.find((operand) => !TIME_NAMES.has(String(operand).split('/').pop()))
    if (variable) return variable
  }
  return item.data_item_name ?? item.variable
}

/**
 * Whether a data item is drawn as a line across its plot or up it: a horizontal plot_type (horizontal,
 * horizontal_from_min…) or vertical. A frequency, or a series, isn't drawn here.
 *
 * @param {Object} item
 * @returns {boolean}
 */
export function isPlottableOverlay(item) {
  if (item.data_type === 'frequency' || item.data_type === 'series') return false
  const plotType = item.plot_type
  return (typeof plotType === 'string' && plotType.startsWith('horizontal')) || plotType === 'vertical'
}

/**
 * Names the variable a prediction item plots: its first operand.
 *
 * @param {Object} item
 * @returns {string|undefined}
 */
const predictedVar = (item) => (Array.isArray(item.operands) && item.operands[0]) || item.variable

/**
 * Lists the variables an obs_data plots: every prediction item's, then every drawn data item's, one plot per trace
 * label (#347), as one variable may be named two ways, `aortic_root/u` and `aortic_root_module/u`. A variable joins
 * the first label that names it.
 *
 * @param {Object|Array|undefined} document - The obs_data, as parsed.
 * @returns {Array<{qname: string, label: string, qnames: string[]}>} `qname` is the first of `qnames`.
 */
export function derivePlotVariables(document) {
  if (document == null) return []
  const { dataItems, predictionItems } = readObsDataParts(document)
  const byLabel = new Map()
  const placed = new Set()
  const add = (qname, label) => {
    if (!qname || placed.has(qname)) return
    const key = label || qname
    if (!byLabel.has(key)) byLabel.set(key, { qname, label: key, qnames: [] })
    byLabel.get(key).qnames.push(qname)
    placed.add(qname)
  }
  for (const item of predictionItems) if (item && typeof item === 'object') add(predictedVar(item), item.trace_name_for_plotting ?? item.name_for_plotting)
  for (const item of dataItems) {
    if (item && typeof item === 'object' && isPlottableOverlay(item)) add(obsModelVar(item), item.trace_name_for_plotting ?? item.name_for_plotting)
  }
  return [...byLabel.values()]
}

/**
 * Lists the drawn data items of an experiment that attach to a plot's variable, by any of its names.
 *
 * @param {Object|Array|undefined} document
 * @param {number} experiment
 * @param {string|string[]} qnames
 * @returns {Array<Object>}
 */
export function overlayItemsFor(document, experiment, qnames) {
  if (document == null) return []
  const wanted = new Set(Array.isArray(qnames) ? qnames : [qnames])
  return readObsDataParts(document).dataItems.filter(
    (item) => item && typeof item === 'object' && isPlottableOverlay(item) && (item.experiment_idx ?? 0) === experiment && wanted.has(obsModelVar(item))
  )
}

/**
 * Finds the window an item's operation reduces, on its experiment's time axis (CUFLynx's constantLineRange): its
 * sub-experiment, narrowed for an *_in_range operation to the samples its start_frac and end_frac take of the
 * sub-experiment's own (sliceRangeBounds). A sub-experiment outside the run spans the whole axis, and fractions the
 * operation can't read the whole sub-experiment, rather than guess.
 *
 * @param {ArrayLike<number>} times - The experiment's.
 * @param {Array<{startIndex: number, endIndex: number}>} subs - The experiment's, from its plan.
 * @param {number} sub
 * @param {string|null} operation
 * @param {Object} [kwargs] - Its operation_kwargs, those naming a feature as its value.
 * @returns {{from: number, to: number, start: number, end: number}|null} Times, and the first and last index; null
 *   when the window has no point run.
 */
export function findItemWindow(times, subs, sub, operation, kwargs = {}) {
  const last = times.length - 1
  if (last < 0) return null
  const window = subs?.[sub]
  let start = window ? window.startIndex : 0
  let end = window ? window.endIndex : last
  if (window && isRangeOperation(operation)) {
    try {
      const bounds = sliceRangeBounds(end - start + 1, kwargs)
      if (bounds.end > bounds.start) [start, end] = [start + bounds.start, start + bounds.end - 1]
    } catch {
      // A fraction the operation can't read: the whole sub-experiment.
    }
  }
  if (start > last) return null
  end = Math.min(end, last)
  return { from: times[start], to: times[end], start, end }
}

/**
 * Finds the least sample of a window, from which a max_minus_min is drawn.
 *
 * @param {ArrayLike<number>} values
 * @param {{start: number, end: number}} window
 * @returns {number}
 */
function findLeast(values, { start, end }) {
  let least = Infinity
  for (let i = start; i <= end; i++) if (values[i] < least) least = values[i]
  return least
}

/**
 * Builds the reference lines of one item: its measured value dashed (obs), the run's solid (calc), in one colour.
 *
 * @param {Object} options
 * @param {string} options.key
 * @param {string} options.name
 * @param {string|null} options.operation
 * @param {boolean} options.isVertical - A time, up the plot, rather than a value across its window.
 * @param {number|null} options.obs - The measured value.
 * @param {number|null} options.calc - The run's.
 * @param {{from: number, to: number}|null} options.window
 * @param {number} options.base - Added to both, for a max_minus_min.
 * @param {number} options.slot
 * @returns {Array<Object>} As SimulationPlot takes them: `{key, label, role, slot, orientation, from, to, value}`.
 */
function buildItemLines({ key, name, operation, isVertical, obs, calc, window, base, slot }) {
  const line = (role, value) => ({
    key: `${key}#${role}`,
    label: `${name} (${role}${operation ? ` ${operation}` : ''})`,
    role,
    slot,
    orientation: isVertical ? 'vertical' : 'horizontal',
    from: isVertical ? null : window.from,
    to: isVertical ? null : window.to,
    value: isVertical ? value : base + value,
  })
  return [...(Number.isFinite(obs) ? [line('obs', obs)] : []), ...(Number.isFinite(calc) ? [line('calc', calc)] : [])]
}

/**
 * Builds the plots of a protocol run's obs_data, for the experiments shown: one per trace label (derivePlotVariables),
 * its variable's trace in each, with its data items' obs and calc lines and its prediction items' features. One whose
 * variable the model lacks is left out.
 *
 * @param {Object} options
 * @param {Object|Array|undefined} options.document - The obs_data, as parsed.
 * @param {Array<{experiment: number, name: string, results: Object, place: Function}>} options.shown - Each experiment
 *   shown, its results (`{voi, variables, subs, subSeries}`) and how its values go on the plot's time axis.
 * @param {Function} options.resolve - A variable's reported name, by its obs_data name, or null.
 * @param {Array<Object>} [options.features] - The prediction items', from computeFeatures.
 * @param {Array<Object>} [options.dataItemFeatures] - The data items', from computeDataItemFeatures.
 * @returns {Array<Object>} As useSimulationCharts gives its charts, each with `references`.
 */
export function buildObsDataCharts({ document, shown, resolve, features = [], dataItemFeatures = [] }) {
  if (document == null || !shown.length) return []
  const { dataItems, predictionItems } = readObsDataParts(document)
  const isOverlay = shown.length > 1
  const dataFeatureOf = new Map(dataItemFeatures.map((feature) => [feature.index, feature]))
  return derivePlotVariables(document).flatMap(({ label, qnames }) => {
    const reported = qnames.map(resolve).find((name) => name && shown[0].results.variables.has(name))
    if (!reported) return []
    const unit = shown[0].results.variables.get(reported).unit || 'dimensionless'
    const wanted = new Set(qnames)
    const series = shown.map(({ experiment, name, results, place }) => ({
      key: `obs-data::${reported}${isOverlay ? `#e${experiment}` : ''}`,
      label: isOverlay ? name : label,
      values: place(results.variables.get(reported)?.values ?? []),
      slot: isOverlay ? experiment % SLOT_COUNT : 0,
      isStepped: false,
    }))
    const references = []
    for (const { experiment, results } of shown) {
      const times = results.voi.values
      const joined = results.variables.get(reported)?.values ?? []
      let next = 1
      const slotFor = () => (isOverlay ? experiment % SLOT_COUNT : next++ % SLOT_COUNT)
      // Its own samples where the run kept them, as the feature reduced them; else the joined trace's.
      const leastOf = (window, sub) => {
        const own = results.subSeries?.[sub]?.[reported]
        const offset = results.subs?.[sub]?.startIndex ?? 0
        return own && results.subs?.[sub] ? findLeast(own, { start: window.start - offset, end: window.end - offset }) : findLeast(joined, window)
      }
      for (const item of overlayItemsFor(document, experiment, qnames)) {
        const index = dataItems.indexOf(item)
        const feature = dataFeatureOf.get(index)
        const operation = readOperation(item.operation)
        const sub = Number(item.subexperiment_idx ?? 0)
        const window = findItemWindow(times, results.subs, sub, operation, feature?.kwargs ?? item.operation_kwargs)
        const isVertical = item.plot_type === 'vertical'
        if (!window && !isVertical) continue
        const base = !isVertical && SPAN_OPERATIONS.has(operation) ? leastOf(window, sub) : 0
        const name = item.trace_name_for_plotting ?? item.name_for_plotting ?? item.data_item_name ?? item.variable ?? 'obs'
        references.push(
          ...buildItemLines({ key: `data:${index}:e${experiment}`, name, operation, isVertical, obs: item.value, calc: feature?.value, window, base, slot: slotFor() })
        )
      }
      for (const feature of features) {
        const item = predictionItems[feature.index]
        // One the kit couldn't read has no sub-experiment to draw on.
        if (feature.experiment !== experiment || feature.subexperiment == null || !item || !wanted.has(predictedVar(item))) continue
        const window = findItemWindow(times, results.subs, feature.subexperiment, feature.operation, feature.kwargs)
        if (!window) continue
        const base = SPAN_OPERATIONS.has(feature.operation) ? leastOf(window, feature.subexperiment) : 0
        const name = feature.group || feature.name
        references.push(
          ...buildItemLines({ key: `prediction:${feature.index}`, name, operation: feature.operation, isVertical: false, obs: item.value, calc: feature.value, window, base, slot: slotFor() })
        )
      }
    }
    return [{ key: `${OBS_DATA_PLOT}#${label}`, plotId: OBS_DATA_PLOT, title: label, titleParts: null, plotLabel: 'obs_data', unit, series, references }]
  })
}
