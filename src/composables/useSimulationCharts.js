/**
 * The charts of a run's results, as every simulation view shows them: the plotted variables of the simulated
 * instances, the values a protocol set when asked for, then the inspection modules' outputs, one chart per plot and
 * unit; and after them, when asked for, a protocol run's feature plots.
 */
import { computed, unref } from 'vue'
import { computePlotSeries, listPredictionPlots } from '@physiomelinks/protocol-kit'

import { addInputUnits, buildFeatureGroupCharts, buildPredictionPlotCharts } from '../services/simulation/featureCharts'
import { resolveGroups } from '../services/simulation/plotSelections'
import { INSPECTION_COMPONENT, isInspectionNodeId, readInspectionOutputId } from '../services/simulation/variableIndex'
import { SERIES_COLOURS, assignSeriesSlots, chunkSeries } from '../services/simulation/seriesSlots'
import { readNodeSeries } from '../services/simulation/variableMapping'
import { useAppSettings } from './useAppSettings'
import { ALL_EXPERIMENTS, useProtocolStore } from '../stores/protocolStore'
import { selectExperiment, useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'

const SERIES_SLOT_COUNT = SERIES_COLOURS.light.length

// Inspection modules belong to no instance or plot group, so their outputs make a plot of their own.
export const INSPECTION_PLOT = '__inspection_modules__'
// So do the values a protocol sets, shown after the results when asked for.
export const PROTOCOL_INPUTS_PLOT = '__protocol_inputs__'

/**
 * Finds where each sub-experiment of a protocol's experiment lies on its time axis.
 *
 * @param {Array<{startIndex: number, endIndex: number}>|undefined} subs - The experiment's, from its plan.
 * @param {Float64Array} values - The times shown.
 * @returns {Array<{from: number, to: number, number: number}>} None for a run of one; `number` counts from 1.
 */
export function findSegments(subs, values) {
  if (!subs || subs.length < 2) return []
  return subs
    .filter(({ startIndex }) => startIndex < values.length)
    .map(({ startIndex, endIndex }, index) => ({ from: values[startIndex], to: values[Math.min(endIndex, values.length - 1)], number: index + 1 }))
}

/**
 * Puts several runs' times on one axis: every time any of them has, once, in order.
 *
 * @param {Array<ArrayLike<number>>} timeArrays - Each run's times.
 * @returns {{times: number[], positions: Array<Int32Array>}} The axis, and where each run's times are on it.
 */
export function mergeTimes(timeArrays) {
  // Times equal to 12 significant figures are the same point, as experiments on one grid compute theirs apart.
  const keyOf = (time) => Number(time).toPrecision(12)
  const byKey = new Map()
  for (const values of timeArrays) for (const time of values) if (!byKey.has(keyOf(time))) byKey.set(keyOf(time), time)
  const times = [...byKey.values()].sort((a, b) => a - b)
  const indexByKey = new Map(times.map((time, index) => [keyOf(time), index]))
  return { times, positions: timeArrays.map((values) => Int32Array.from(values, (time) => indexByKey.get(keyOf(time)))) }
}

/**
 * Spreads a run's values over a shared time axis, with gaps where it has no point.
 *
 * @param {ArrayLike<number>} values
 * @param {Int32Array} positions - Where each value goes, from mergeTimes.
 * @param {number} length - The axis's length.
 * @returns {Array<number|null>}
 */
export function spreadValues(values, positions, length) {
  const spread = new Array(length).fill(null)
  for (let i = 0; i < values.length; i++) spread[positions[i]] = values[i]
  return spread
}

/**
 * Builds the charts of the shown results.
 *
 * @param {import('vue').Ref<Array<Object>>|Array<Object>} scopeNodes - The simulated instances.
 * @param {{hasInputs?: boolean, hasFeatures?: boolean}} [options] - `hasInputs` charts the values a protocol set,
 *   and `hasFeatures` its features, whether or not they're asked for, for a view that shows one chart at a time.
 * @returns {{xAxis: import('vue').ComputedRef<Object>, charts: import('vue').ComputedRef<Array<Object>>,
 *   featureCharts: import('vue').ComputedRef<Array<Object>>}} `featureCharts` as FeaturePlot takes them: each group
 *   of features across the experiments, then each of the obs_data's prediction plots.
 */
export function useSimulationCharts(scopeNodes, { hasInputs = false, hasFeatures = false } = {}) {
  const store = useSimulationResultsStore()
  const protocolStore = useProtocolStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const { settings } = useAppSettings()

  // Every experiment of a protocol run at once, on one time axis: their times together, and where each one's are.
  const overlay = computed(() => {
    const experiments = store.protocolResults?.experiments ?? []
    if (protocolStore.activeExperiment !== ALL_EXPERIMENTS || experiments.length < 2) return null
    const shown = experiments.map((_, e) => selectExperiment(store.protocolResults, e))
    const { times, positions } = mergeTimes(shown.map(({ voi }) => voi.values))
    const names = shown.map((_, e) => protocolStore.view?.experiments[e]?.label ?? `Experiment ${e + 1}`)
    return { experiments: shown, times, positions, names }
  })

  // Plots that start after the solve does, to let the model settle, count time from their start: t = 0. A protocol's
  // experiments already count from the end of their warm-up.
  const xAxis = computed(() => {
    if (overlay.value) {
      const voi = overlay.value.experiments[0].voi
      return { label: voi.name.split('/').pop(), unit: voi.unit, values: overlay.value.times, offset: 0, segments: [] }
    }
    const voi = store.results?.voi
    const values = voi?.values ?? new Float64Array()
    const { initialPoint, startingPoint } = simulationSettingsStore.simulationSettings
    const isSettled =
      !store.protocolResults &&
      initialPoint < startingPoint &&
      values.length > 0 &&
      Math.abs(values[0] - startingPoint) < 1e-9 * Math.max(1, Math.abs(startingPoint))
    return {
      label: voi?.name.split('/').pop() ?? '',
      unit: voi?.unit ?? '',
      values: isSettled ? values.map((time) => time - startingPoint) : values,
      // Where t = 0 is in the run's own time, when it isn't the same.
      offset: isSettled ? startingPoint : 0,
      segments: findSegments(store.results?.subs, values),
    }
  })

  /**
   * Gets every series to plot from some results: the values a protocol set, the plotted variables of all the
   * simulated instances, then the inspection modules' outputs, each with the plot it belongs to.
   *
   * @param {{voi: Object, variables: Map<string, Object>}} results - A run's, or one experiment's of a protocol run.
   * @returns {Array<{key: string, plot: string, label: string, unit: string, values: ArrayLike<number>}>}
   */
  function collectSeriesOf(results) {
    const nodesById = new Map(unref(scopeNodes).map((node) => [node.id, node]))
    const outputsById = new Map(store.inspectionOutputs.map((output) => [output.id, output]))
    const variables = (simulationSettingsStore.plotConfig?.selections ?? []).flatMap((selection) => {
      // An inspection module's output put on a plot, as a variable of no instance.
      if (isInspectionNodeId(selection.nodeId)) {
        const output = outputsById.get(readInspectionOutputId(selection.nodeId))
        const series = output && results.variables.get(output.reportedName)
        if (!series) return []
        const node = { id: selection.nodeId, data: { name: INSPECTION_COMPONENT } }
        return [{ key: selection.key, plot: selection.groupId ?? '', node, name: output.name, unit: output.units, values: series.values }]
      }
      const node = nodesById.get(selection.nodeId)
      const series = node && readNodeSeries(results, store.mapping, node.id, selection.variableName)
      if (!series) return []
      return [{ key: `${node.id}::${selection.variableName}`, plot: selection.groupId ?? '', node, name: selection.variableName, unit: series.unit || 'dimensionless', values: series.values }]
    })
    // Named as the variable search names them: instance/variable.
    const labelled = variables.map(({ node, name, ...series }) => ({
      ...series,
      component: node.data.name,
      name,
      label: `${node.data.name}/${name}`,
    }))
    // Inspection modules plot only when the settings ask for them.
    const outputs = (settings.plotInspectionModules ? store.inspectionOutputs : []).map((output) => ({
      key: `inspection::${output.id}`,
      plot: INSPECTION_PLOT,
      component: null,
      name: output.name,
      label: output.name,
      unit: output.units,
      values: results.variables.get(output.reportedName).values,
    }))
    // The values the protocol set, as the model ran with them.
    const inputs = store.protocolResults && (hasInputs || protocolStore.isShowingInputs)
      ? [...store.protocolInputs].flatMap(([parameter, { name, isStepped }]) => {
          const series = results.variables.get(name)
          if (!series) return []
          const separator = parameter.indexOf('/')
          return [{
            key: `protocol::${parameter}`,
            plot: PROTOCOL_INPUTS_PLOT,
            component: separator > 0 ? parameter.slice(0, separator) : null,
            name: parameter.slice(separator + 1),
            label: parameter,
            unit: series.unit || 'dimensionless',
            values: series.values,
            // A number held through each sub-experiment is drawn as steps rather than ramps between points.
            isStepped,
          }]
        })
      : []
    return [...labelled, ...inputs, ...outputs]
  }

  /**
   * Gets every series to plot: the shown results', or with every experiment shown at once, each experiment's on their
   * shared time axis, named and coloured by experiment.
   *
   * @returns {Array<Object>} As collectSeriesOf gives them.
   */
  function collectSeries() {
    const shared = overlay.value
    if (!shared) return collectSeriesOf(store.results)
    return shared.experiments.flatMap((results, e) =>
      collectSeriesOf(results).map((series) => ({
        ...series,
        key: `${series.key}#e${e}`,
        variableLabel: series.label,
        experiment: e,
        label: `${series.label} · ${shared.names[e]}`,
        values: spreadValues(series.values, shared.positions[e], shared.times.length),
      }))
    )
  }

  /**
   * Names a chart: its series when few, as instance/variable paths, else its plot.
   *
   * @param {Array<{label: string, component: string|null, name: string}>} series
   * @param {string} plotName
   * @returns {{title: string, titleParts: Array<{component: string|null, name: string}>|null}}
   */
  const titleFor = (series, plotName) =>
    series.length <= 3
      ? { title: series.map((item) => item.label).join(', '), titleParts: series.map(({ component, name }) => ({ component, name })) }
      : { title: `${plotName} (${series.length} variables)`, titleParts: null }

  // One chart per plot and unit, since one axis can't carry two; variables from different instances share a
  // chart when they share both. A series keeps its colour while it stays plotted.
  const charts = computed(() => {
    const previousSlots = store.getSeriesSlots()
    if (!store.results) return []
    // Named as the plot cards name them, even for an imported config that lists no plots.
    const groups = resolveGroups(simulationSettingsStore.plotConfig)
    const plotNames = new Map(groups.map((group) => [group.id, group.name]))
    plotNames.set(INSPECTION_PLOT, 'Inspection modules')
    plotNames.set(PROTOCOL_INPUTS_PLOT, 'Protocol inputs')
    // The results first, then the values the protocol set, when they're shown.
    const plotOrder = new Map([...groups.map((group, index) => [group.id, index]), [PROTOCOL_INPUTS_PLOT, groups.length]])

    const byPlotAndUnit = new Map()
    // Charts follow the plots' order; inspection outputs, then anything not on a plot, come last.
    const ordered = collectSeries()
      .map((series, index) => ({ series, index }))
      .sort((a, b) => (plotOrder.get(a.series.plot) ?? groups.length) - (plotOrder.get(b.series.plot) ?? groups.length) || a.index - b.index)
      .map(({ series }) => series)
    for (const series of ordered) {
      const id = `${series.plot}#${series.unit}`
      if (!byPlotAndUnit.has(id)) byPlotAndUnit.set(id, { plot: series.plot, unit: series.unit, series: [] })
      byPlotAndUnit.get(id).series.push(series)
    }

    const nextSlots = new Map()
    const result = []
    // A plot normally makes one chart; one that mixes units, or holds more series than colours, makes several.
    const chartsPerPlot = new Map()
    for (const [, { plot, series }] of byPlotAndUnit) chartsPerPlot.set(plot, (chartsPerPlot.get(plot) ?? 0) + chunkSeries(series).length)
    const unitsPerPlot = new Map()
    for (const [, { plot }] of byPlotAndUnit) unitsPerPlot.set(plot, (unitsPerPlot.get(plot) ?? 0) + 1)
    for (const [id, { plot, unit, series }] of byPlotAndUnit) {
      const chunks = chunkSeries(series)
      chunks.forEach((group, index) => {
        const plotName = plotNames.get(plot) ?? 'Ungrouped'
        const parts = [unitsPerPlot.get(plot) > 1 ? unit : null, chunks.length > 1 ? String(index + 1) : null].filter(Boolean)
        const slots = assignSeriesSlots(previousSlots, group.map((item) => item.key))
        slots.forEach((slot, key) => nextSlots.set(key, slot))
        // One variable over every experiment: named once in the title, its lines by experiment, each experiment in
        // its own colour on every chart.
        const isOneVariable = overlay.value && new Set(group.map((item) => item.variableLabel)).size === 1
        if (isOneVariable) {
          for (const item of group) {
            item.label = overlay.value.names[item.experiment]
            slots.set(item.key, item.experiment % SERIES_SLOT_COUNT)
          }
        }
        const named = isOneVariable ? [{ ...group[0], label: group[0].variableLabel }] : group
        result.push({
          key: `${id}#${index}`,
          plotId: plot,
          ...titleFor(named, plotName),
          // The plot's name, with what tells its charts apart when it makes several.
          plotLabel: chartsPerPlot.get(plot) > 1 && parts.length ? `${plotName} (${parts.join(', ')})` : plotName,
          unit,
          series: group.map((item) => ({ key: item.key, label: item.label, values: item.values, slot: slots.get(item.key), isStepped: !!item.isStepped })),
        })
      })
    }
    store.setSeriesSlots(new Map([...previousSlots, ...nextSlots]))
    return result
  })

  // Plots only: a feature's value is read off its point.
  const featureCharts = computed(() => {
    if (!store.protocolResults || !(hasFeatures || protocolStore.isShowingFeatures) || !store.features.length) return []
    const document = protocolStore.source?.document
    const names = store.protocolResults.experiments.map((_, e) => protocolStore.view?.experiments[e]?.label ?? `Experiment ${e + 1}`)
    // An input's unit, as the run reported the variable that shows it.
    const variables = store.protocolResults.experiments[0]?.variables
    const unitOf = (parameter) => variables?.get(store.protocolInputs.get(parameter)?.name)?.unit ?? ''
    const plots = addInputUnits(computePlotSeries(document, store.features), listPredictionPlots(document), unitOf)
    const items = Array.isArray(document?.prediction_items) ? document.prediction_items : []
    return [...buildFeatureGroupCharts(store.features, names, items), ...buildPredictionPlotCharts(plots, names)]
  })

  return { xAxis, charts, featureCharts }
}
