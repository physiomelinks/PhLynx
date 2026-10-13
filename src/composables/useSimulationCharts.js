/**
 * The charts of a run's results, as every simulation view shows them: the plotted variables of the simulated
 * instances, the values a protocol set when asked for, then the inspection modules' outputs, one chart per plot and
 * unit; after them, a protocol run's obs_data plots, and its prediction plots. Tracked runs' lines go under the live
 * run's, beside the variables they show.
 */
import { computed, unref } from 'vue'
import { computePlotSeries, listPredictionPlots } from '@physiomelinks/protocol-kit'

import { resolveGroups } from '../services/simulation/plotSelections'
import { addInputUnits, buildPredictionPlotCharts } from '../services/simulation/predictionPlotCharts'
import { buildObsDataCharts } from '../services/simulation/protocolPlotGroups'
import { findProtocolTarget } from '../services/simulation/protocolTargets'
import { INSPECTION_COMPONENT, isInspectionNodeId, readInspectionOutputId } from '../services/simulation/variableIndex'
import { SERIES_COLOURS, assignSeriesSlots, chunkSeries } from '../services/simulation/seriesSlots'
import { alignVoi, displayVoi, formatPlotValue, runDash, runLabel } from '../services/simulation/trackedRuns'
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
 * @param {{hasInputs?: boolean, plotConfig?: import('vue').Ref<Object|null>|Object|null}} [options] - `hasInputs`
 *   charts the values a protocol set whether or not they're asked for, for a view that shows one chart at a time;
 *   `plotConfig` charts a view's own plots in place of the workspace's.
 * @returns {{xAxis: import('vue').ComputedRef<Object>, charts: import('vue').ComputedRef<Array<Object>>,
 *   predictionPlotCharts: import('vue').ComputedRef<Array<Object>>}} `charts` end with the obs_data's plots (see
 *   buildObsDataCharts), with their `references`; `predictionPlotCharts` as FeaturePlot takes them.
 */
export function useSimulationCharts(scopeNodes, { hasInputs = false, plotConfig = null } = {}) {
  const store = useSimulationResultsStore()
  const protocolStore = useProtocolStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const { settings } = useAppSettings()
  const getPlotConfig = () => unref(plotConfig) ?? simulationSettingsStore.plotConfig

  // Every experiment of a protocol run at once, on one time axis: their times together, and where each one's are.
  const overlay = computed(() => {
    const experiments = store.protocolResults?.experiments ?? []
    if (protocolStore.activeExperiment !== ALL_EXPERIMENTS || experiments.length < 2) return null
    const shown = experiments.map((_, e) => selectExperiment(store.protocolResults, e))
    const { times, positions } = mergeTimes(shown.map(({ voi }) => voi.values))
    const names = shown.map((_, e) => protocolStore.view?.experiments[e]?.label ?? `Experiment ${e + 1}`)
    return { experiments: shown, times, positions, names }
  })

  // The tracked runs shown, each with the values of the variable of integration (VoI) its charts show. A protocol run
  // isn't compared with them (see trackBlocker).
  const shownRuns = computed(() =>
    store.protocolResults
      ? []
      : store.trackedRuns
          .filter((run) => run.isVisible)
          .map((run) => ({ ...run, voiValues: displayVoi(run.results, run.settings ?? simulationSettingsStore.simulationSettings).values }))
  )

  // Plots that start after the solve does, to let the model settle, count the VoI from their start: 0. A protocol's
  // experiments already count from the end of their warm-up.
  const liveVoi = computed(() =>
    store.protocolResults
      ? { values: store.results?.voi?.values ?? new Float64Array(), offset: 0 }
      : displayVoi(store.results, simulationSettingsStore.simulationSettings)
  )

  // One VoI axis for the runs shown, which is the live run's while they share it. A hidden live run's
  // points are left out, so tracked runs with the same points still draw without gaps. Every experiment of a
  // protocol run shown at once is already spread over their shared axis.
  const voiAxis = computed(() => {
    if (overlay.value) return { values: overlay.value.times, align: (_, values) => values }
    const runVoi = shownRuns.value.map((run) => run.voiValues)
    if (!store.isLiveRunVisible && runVoi.length) return alignVoi(runVoi[0], runVoi.slice(1))
    return alignVoi(liveVoi.value.values, runVoi)
  })

  const xAxis = computed(() => {
    if (overlay.value) {
      const voi = overlay.value.experiments[0].voi
      return { label: voi.name.split('/').pop(), unit: voi.unit, values: overlay.value.times, offset: 0, segments: [], isSteadyState: false, isSweep: false }
    }
    const voi = store.results?.voi
    // A sweep's x-axis is the swept parameter, which displayVoi leaves as it is.
    const isSweep = !!store.results?.isSweep
    return {
      label: isSweep ? store.results.sweepLabel : voi?.name.split('/').pop() ?? '',
      unit: voi?.unit ?? '',
      values: voiAxis.value.values,
      // Where 0 is in the run's own VoI, when it isn't the same.
      offset: liveVoi.value.offset,
      segments: findSegments(store.results?.subs, voi?.values ?? new Float64Array()),
      // A model without ODEs is solved once: one value per variable, and no VoI to plot them against.
      isSteadyState: !!store.results?.isSteadyState && !isSweep,
      isSweep,
      // What a sweep of a model with ODEs read from each time course (see sweepReadouts.js).
      readout: (isSweep && store.results.readout) || null,
    }
  })

  /**
   * Reads a run's values of a plotted variable, or of the variable a plot plots against: an instance's, or
   * an inspection module's output.
   *
   * @param {{nodeId: string, variableName: string}} reference
   * @param {{results: Object, mapping: Map}} run - The live run, a tracked one, or one experiment of a protocol run.
   * @param {Map<string, Object>} nodesById
   * @param {Map<string, Object>} outputsById - The run's inspection outputs.
   * @returns {{node: Object, name: string, unit: string, values: ArrayLike<number>}|null}
   */
  function readPlotted({ nodeId, variableName }, run, nodesById, outputsById) {
    // An inspection module's output put on a plot, as a variable of no instance.
    if (isInspectionNodeId(nodeId)) {
      const output = outputsById.get(readInspectionOutputId(nodeId))
      const series = output && run.results.variables.get(output.reportedName)
      return series ? { node: { id: nodeId, data: { name: INSPECTION_COMPONENT } }, name: output.name, unit: output.units, values: series.values } : null
    }
    const node = nodesById.get(nodeId)
    const series = node && readNodeSeries(run.results, run.mapping, node.id, variableName)
    return series ? { node, name: variableName, unit: series.unit || 'dimensionless', values: series.values } : null
  }

  /**
   * Reads a run's values of the variable a plot plots against, as a phase plot does.
   *
   * @param {Object} xAxis - The plot's `xAxis` (see setPlotXAxis).
   * @param {{results: Object, mapping: Map, inspectionOutputs: Array<Object>}} run
   * @returns {{node: Object, name: string, unit: string, values: ArrayLike<number>}|null}
   */
  const readPlotX = (xAxis, run) =>
    readPlotted(xAxis, run, new Map(unref(scopeNodes).map((node) => [node.id, node])), new Map(run.inspectionOutputs.map((output) => [output.id, output])))

  /**
   * Says that a plot plots against the run's own x-axis, as the variable it is set to plot against has no
   * values in the run.
   *
   * @param {{nodeName: string, variableName: string}} reference
   * @returns {string}
   */
  const missingXNote = (reference) =>
    `${reference.nodeName}/${reference.variableName} isn’t in this run, so this plot is against ${xAxis.value.label || 'time'}.`

  /**
   * Gets every series to plot from a run: the plotted variables of all the simulated instances, the values a protocol
   * set, then the inspection modules' outputs, each with the plot it belongs to.
   *
   * @param {{results: Object, mapping: Map, inspectionOutputs: Array<Object>}} run - The live run, a tracked one, or
   *   one experiment of a protocol run.
   * @returns {Array<{key: string, plot: string, label: string, unit: string, values: ArrayLike<number>}>}
   */
  function collectSeriesOf(run) {
    const { results } = run
    const nodesById = new Map(unref(scopeNodes).map((node) => [node.id, node]))
    const outputsById = new Map(run.inspectionOutputs.map((output) => [output.id, output]))
    const variables = (getPlotConfig()?.selections ?? []).flatMap((selection) => {
      const plotted = readPlotted(selection, run, nodesById, outputsById)
      if (!plotted) return []
      const key = isInspectionNodeId(selection.nodeId) ? selection.key : `${plotted.node.id}::${selection.variableName}`
      return [{ key, plot: selection.groupId ?? '', ...plotted }]
    })
    // Named as the variable search names them: instance/variable.
    const labelled = variables.map(({ node, name, ...series }) => ({
      ...series,
      component: node.data.name,
      name,
      label: `${node.data.name}/${name}`,
    }))
    // Inspection modules plot only when the settings ask for them.
    const outputs = (settings.plotInspectionModules ? run.inspectionOutputs : []).flatMap((output) => {
      const series = results.variables.get(output.reportedName)
      if (!series) return []
      return [
        {
          key: `inspection::${output.id}`,
          plot: INSPECTION_PLOT,
          component: null,
          name: output.name,
          label: output.name,
          unit: output.units,
          values: series.values,
        },
      ]
    })
    // The values the protocol set, as the model ran with them; a tracked run is never a protocol's.
    const inputs = run.isProtocolRun && (hasInputs || protocolStore.isShowingInputs)
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
    const live = { results: store.results, mapping: store.mapping, inspectionOutputs: store.inspectionOutputs, isProtocolRun: !!store.protocolResults }
    const shared = overlay.value
    const family = store.results?.family
    if (!shared && family?.curves?.length) {
      const unit = family.unit && family.unit !== 'dimensionless' ? ` ${family.unit}` : ''
      // A curve per value of the family's parameter, each named for its value.
      return family.curves.flatMap((curve, i) => {
        const run = { ...live, results: { ...store.results, variables: curve.variables } }
        return collectSeriesOf(run).map((series) => ({
          ...series,
          key: `${series.key}@f${i}`,
          variableKey: series.key,
          variableLabel: series.label,
          curve: i,
          curveRun: run,
          label: `${store.results.familyLabel ?? family.name} = ${formatPlotValue(curve.value)}${unit}`,
        }))
      })
    }
    if (!shared) return collectSeriesOf(live)
    return shared.experiments.flatMap((results, e) =>
      collectSeriesOf({ ...live, results }).map((series) => ({
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
  const plotCharts = computed(() => {
    const previousSlots = store.getSeriesSlots()
    if (!store.results) return []
    // Named as the plot cards name them, even for an imported config that lists no plots.
    const groups = resolveGroups(getPlotConfig())
    const plotNames = new Map(groups.map((group) => [group.id, group.name]))
    plotNames.set(INSPECTION_PLOT, 'Inspection modules')
    plotNames.set(PROTOCOL_INPUTS_PLOT, 'Protocol inputs')
    // The results first, then the values the protocol set, when they're shown.
    const plotOrder = new Map([...groups.map((group, index) => [group.id, index]), [PROTOCOL_INPUTS_PLOT, groups.length]])
    // A plot against a variable, as a phase plot is, takes its x values from the same run. One solve has a single
    // point, so it lists its values instead, as every other plot does; every experiment of a protocol at once share
    // only their time axis, so they plot against it.
    const plotXAxes = new Map()
    for (const group of groups) {
      if (!group.xAxis || xAxis.value.isSteadyState || overlay.value) continue
      const plotted = readPlotX(group.xAxis, store)
      plotXAxes.set(
        group.id,
        plotted && {
          key: group.xAxis.key,
          label: `${plotted.node.data.name}/${plotted.name}`,
          unit: plotted.unit,
          values: plotted.values,
          isPhase: true,
          // When each point is, for the readout: the run's own x-axis, its VoI or a sweep's parameter.
          run: { label: xAxis.value.label, unit: xAxis.value.unit, values: liveVoi.value.values },
        }
      )
    }

    const byPlotAndUnit = new Map()
    // Charts follow the plots' order; inspection outputs, then anything not on a plot, come last.
    const ordered = collectSeries()
      .map((series, index) => ({ series, index }))
      .sort((a, b) => (plotOrder.get(a.series.plot) ?? groups.length) - (plotOrder.get(b.series.plot) ?? groups.length) || a.index - b.index)
      .map(({ series }) => series)
    for (const series of ordered) {
      // A family's curves of each variable make a chart of their own, coloured by the family's value.
      const id = `${series.plot}#${series.unit}${series.variableKey ? `#${series.variableKey}` : ''}`
      if (!byPlotAndUnit.has(id)) byPlotAndUnit.set(id, { plot: series.plot, unit: series.unit, series: [] })
      byPlotAndUnit.get(id).series.push(series)
    }

    // Each tracked run's values by series key, and its VoI values; a variable it didn't simulate has no line.
    const { align } = voiAxis.value
    const runs = shownRuns.value.map((run) => ({ run, values: new Map(collectSeriesOf(run).map((series) => [series.key, series.values])) }))
    const live = liveVoi.value.values

    const nextSlots = new Map()
    const result = []
    // A plot normally makes one chart; one that mixes units, or holds more series than colours, makes several.
    const chartsPerPlot = new Map()
    for (const [, { plot, series }] of byPlotAndUnit) chartsPerPlot.set(plot, (chartsPerPlot.get(plot) ?? 0) + chunkSeries(series).length)
    const unitsPerPlot = new Map()
    for (const [, { plot, unit }] of byPlotAndUnit) unitsPerPlot.set(plot, (unitsPerPlot.get(plot) ?? new Set()).add(unit))
    for (const [id, { plot, unit, series }] of byPlotAndUnit) {
      const chunks = chunkSeries(series)
      chunks.forEach((group, index) => {
        const plotName = plotNames.get(plot) ?? 'Ungrouped'
        const parts = [unitsPerPlot.get(plot).size > 1 ? unit : null, chunks.length > 1 ? String(index + 1) : null].filter(Boolean)
        const isFamily = group[0].curve != null
        // A family's colour says which value of its parameter a curve is, the same on every chart.
        const slots = isFamily ? new Map(group.map((item) => [item.key, item.curve % SERIES_SLOT_COUNT])) : assignSeriesSlots(previousSlots, group.map((item) => item.key))
        if (!isFamily) slots.forEach((slot, key) => nextSlots.set(key, slot))
        // One variable over every experiment: named once in the title, its lines by experiment, each experiment in
        // its own colour on every chart.
        const isOneVariable = overlay.value && new Set(group.map((item) => item.variableLabel)).size === 1
        if (isOneVariable) {
          for (const item of group) {
            item.label = overlay.value.names[item.experiment]
            slots.set(item.key, item.experiment % SERIES_SLOT_COUNT)
          }
        }
        const named = isOneVariable || isFamily ? [{ ...group[0], label: group[0].variableLabel }] : group
        const title = titleFor(named, plotName)
        // A phase plot's lines each go against their own run's x values, as they needn't share points.
        const phaseX = plotXAxes.get(plot) ?? null
        const phaseGroup = groups.find((item) => item.id === plot)
        // Tracked runs first, so the live run's lines are drawn over theirs.
        const tracked = runs.flatMap(({ run, values }) => {
          const runX = phaseX && readPlotX(phaseGroup.xAxis, run)
          if (phaseX && !runX) return []
          return group.flatMap((item) =>
            values.has(item.key)
              ? [
                  {
                    key: `${run.id}::${item.key}`,
                    label: runLabel(item.label, run.number, run.name),
                    variableLabel: item.label,
                    // The live run's line of the same variable, so hiding the variable hides both.
                    liveKey: item.key,
                    values: phaseX ? values.get(item.key) : align(run.voiValues, values.get(item.key)),
                    ...(phaseX && { xValues: runX.values, runValues: run.voiValues }),
                    slot: slots.get(item.key),
                    run: { number: run.number, name: run.name ?? null, dash: runDash(run.number) },
                  },
                ]
              : []
          )
        })
        const shown = store.isLiveRunVisible
          ? group.map((item) => ({
              key: item.key,
              label: item.label,
              variableLabel: item.variableLabel ?? item.label,
              values: phaseX ? item.values : align(live, item.values),
              // A family's curve, on a phase plot, against its own values of the plot's x variable.
              ...(phaseX && item.curveRun && { xValues: readPlotX(phaseGroup.xAxis, item.curveRun)?.values ?? phaseX.values }),
              slot: slots.get(item.key),
              run: null,
              // Every experiment of a protocol shown at once: which one the line is.
              experiment: item.experiment ?? null,
              isStepped: !!item.isStepped,
            }))
          : []
        result.push({
          key: `${id}#${index}`,
          plotId: plot,
          ...title,
          // Each variable's colour, for the title to show it.
          titleParts: title.titleParts?.map((part, partIndex) => ({ ...part, key: named[partIndex].key, slot: slots.get(named[partIndex].key) })) ?? null,
          // The plot's name, with what tells its charts apart when it makes several.
          plotLabel: chartsPerPlot.get(plot) > 1 && parts.length ? `${plotName} (${parts.join(', ')})` : plotName,
          unit,
          // Null to plot against the run's own x-axis: its VoI, or a sweep's parameter.
          x: phaseX,
          // Says so when the plot is set to plot against a variable the run has no values for.
          note: plotXAxes.has(plot) && !phaseX ? missingXNote(phaseGroup.xAxis) : null,
          series: [...tracked, ...shown],
        })
      })
    }
    const slotsKept = new Map([...previousSlots, ...nextSlots])
    // A variable drawn as a family's curves has no one colour, as the plot list's swatches would show it.
    for (const series of ordered) if (series.variableKey) slotsKept.delete(series.variableKey)
    store.setSeriesSlots(slotsKept)
    return result
  })

  // The experiments' names, as the picker names them.
  const experimentNames = computed(() =>
    (store.protocolResults?.experiments ?? []).map((_, e) => protocolStore.view?.experiments[e]?.label ?? `Experiment ${e + 1}`)
  )

  // The obs_data's variables, for the experiment shown or all of them, with their data items' obs and calc lines.
  const obsDataCharts = computed(() => {
    const experiments = store.protocolResults?.experiments ?? []
    const document = protocolStore.source?.document
    if (!experiments.length || !store.results || document == null) return []
    const shared = overlay.value
    const shownIndex = Math.min(Math.max(protocolStore.activeExperiment, 0), experiments.length - 1)
    const shown = shared
      ? experiments.map((results, e) => ({ experiment: e, name: shared.names[e], results, place: (values) => spreadValues(values, shared.positions[e], shared.times.length) }))
      : [{ experiment: shownIndex, name: experimentNames.value[shownIndex], results: experiments[shownIndex], place: (values) => values }]
    const nodes = unref(scopeNodes)
    const mapping = store.mapping ?? new Map()
    const variables = experiments[0].variables
    // As the features' operands are found, those the run kept first.
    const resolve = (qname) => store.featureOperands.get(qname) ?? findProtocolTarget(String(qname), { nodes, mapping, variables })
    return buildObsDataCharts({ document, shown, resolve, features: store.features, dataItemFeatures: store.dataItemFeatures })
  })

  const charts = computed(() => [...plotCharts.value, ...obsDataCharts.value])

  // The obs_data's prediction plots, each of its features paired across the experiments; plots only.
  const predictionPlotCharts = computed(() => {
    const document = protocolStore.source?.document
    if (!store.protocolResults || !store.features.length || !listPredictionPlots(document).length) return []
    // An input's unit, as the run reported the variable that shows it.
    const variables = store.protocolResults.experiments[0]?.variables
    const unitOf = (parameter) => variables?.get(store.protocolInputs.get(parameter)?.name)?.unit ?? ''
    const plots = addInputUnits(computePlotSeries(document, store.features), listPredictionPlots(document), unitOf)
    return buildPredictionPlotCharts(plots, experimentNames.value)
  })

  return { xAxis, charts, predictionPlotCharts }
}
