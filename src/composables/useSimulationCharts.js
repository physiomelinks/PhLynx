/**
 * The charts of a run's results, as every simulation view shows them: the plotted variables of the simulated
 * instances, then the inspection modules' outputs, one chart per plot and unit.
 */
import { computed, unref } from 'vue'

import { resolveGroups } from '../services/simulation/plotSelections'
import { INSPECTION_COMPONENT, isInspectionNodeId } from '../services/simulation/variableIndex'
import { assignSeriesSlots, chunkSeries } from '../services/simulation/seriesSlots'
import { readNodeSeries } from '../services/simulation/variableMapping'
import { useAppSettings } from './useAppSettings'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'

// Inspection modules belong to no instance or plot group, so their outputs make a plot of their own.
export const INSPECTION_PLOT = '__inspection_modules__'

/**
 * Builds the charts of the shown results.
 *
 * @param {import('vue').Ref<Array<Object>>|Array<Object>} scopeNodes - The simulated instances.
 * @returns {{xAxis: import('vue').ComputedRef<Object>, charts: import('vue').ComputedRef<Array<Object>>}}
 */
export function useSimulationCharts(scopeNodes) {
  const store = useSimulationResultsStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const { settings } = useAppSettings()

  // Plots that start after the solve does, to let the model settle, count time from their start: t = 0.
  const xAxis = computed(() => {
    const voi = store.results?.voi
    const values = voi?.values ?? new Float64Array()
    const { initialPoint, startingPoint } = simulationSettingsStore.simulationSettings
    // A sweep's values are the swept parameter's, never times to settle over.
    const isSweep = !!store.results?.isSweep
    const isSettled =
      !isSweep && initialPoint < startingPoint && values.length > 0 && Math.abs(values[0] - startingPoint) < 1e-9 * Math.max(1, Math.abs(startingPoint))
    return {
      label: isSweep ? store.results.sweepLabel : voi?.name.split('/').pop() ?? '',
      unit: voi?.unit ?? '',
      values: isSettled ? values.map((time) => time - startingPoint) : values,
      // Where t = 0 is in the run's own time, when it isn't the same.
      offset: isSettled ? startingPoint : 0,
      // A model without ODEs is solved once: one value per variable, and no time to plot them against.
      isSteadyState: !!store.results?.isSteadyState && !isSweep,
      isSweep,
    }
  })

  /**
   * Reads the values of a plotted variable, or of the variable a plot plots against: an instance's, or an
   * inspection module's output.
   *
   * @param {{nodeId: string, variableName: string}} reference
   * @param {Map<string, Object>} nodesById
   * @param {Map<string, Object>} outputsById
   * @returns {{node: Object, name: string, unit: string, values: Float64Array}|null}
   */
  function readPlotted({ nodeId, variableName }, nodesById, outputsById) {
    // An inspection module's output put on a plot, as a variable of no instance.
    if (isInspectionNodeId(nodeId)) {
      const output = outputsById.get(nodeId.slice('inspection:'.length))
      const series = output && store.results.variables.get(output.reportedName)
      return series ? { node: { id: nodeId, data: { name: INSPECTION_COMPONENT } }, name: output.name, unit: output.units, values: series.values } : null
    }
    const node = nodesById.get(nodeId)
    const series = node && readNodeSeries(store.results, store.mapping, node.id, variableName)
    return series ? { node, name: variableName, unit: series.unit || 'dimensionless', values: series.values } : null
  }

  /**
   * Says that a plot plots against the run's own x-axis, as the variable it is set to plot against has no
   * values in the run.
   *
   * @param {{nodeName: string, variableName: string}} reference
   * @returns {string}
   */
  const missingXNote = (reference) =>
    `${reference.nodeName}/${reference.variableName} isn’t in this run, so this plot is against ${xAxis.value.label || 'time'}.`

  const lookups = () => ({
    nodesById: new Map(unref(scopeNodes).map((node) => [node.id, node])),
    outputsById: new Map(store.inspectionOutputs.map((output) => [output.id, output])),
  })

  /**
   * Gets every series to plot: the plotted variables of all the simulated instances, then the inspection
   * modules' outputs, each with the plot it belongs to.
   *
   * @returns {Array<{key: string, plot: string, label: string, unit: string, values: Float64Array}>}
   */
  function collectSeries() {
    const { nodesById, outputsById } = lookups()
    const variables = (simulationSettingsStore.plotConfig?.selections ?? []).flatMap((selection) => {
      const plotted = readPlotted(selection, nodesById, outputsById)
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
    const outputs = (settings.plotInspectionModules ? store.inspectionOutputs : []).map((output) => ({
      key: `inspection::${output.id}`,
      plot: INSPECTION_PLOT,
      component: null,
      name: output.name,
      label: output.name,
      unit: output.units,
      values: store.results.variables.get(output.reportedName).values,
    }))
    return [...labelled, ...outputs]
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
    // A plot against a variable, as a phase plot is, takes its x values from the same run. One solve has
    // a single point, so it lists its values instead, as every other plot does.
    const { nodesById, outputsById } = lookups()
    const plotXAxes = new Map()
    for (const group of groups) {
      if (!group.xAxis || xAxis.value.isSteadyState) continue
      const plotted = readPlotted(group.xAxis, nodesById, outputsById)
      plotXAxes.set(
        group.id,
        plotted && {
          key: group.xAxis.key,
          label: `${plotted.node.data.name}/${plotted.name}`,
          unit: plotted.unit,
          values: plotted.values,
          isPhase: true,
          // When each point is, for the readout: the run's own x-axis, time or a sweep's parameter.
          run: { label: xAxis.value.label, unit: xAxis.value.unit, values: xAxis.value.values },
        }
      )
    }
    plotNames.set(INSPECTION_PLOT, 'Inspection modules')
    const plotOrder = new Map(groups.map((group, index) => [group.id, index]))

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
        result.push({
          key: `${id}#${index}`,
          plotId: plot,
          ...titleFor(group, plotName),
          // The plot's name, with what tells its charts apart when it makes several.
          plotLabel: chartsPerPlot.get(plot) > 1 && parts.length ? `${plotName} (${parts.join(', ')})` : plotName,
          unit,
          // Null to plot against the run's own x-axis: time, or a sweep's parameter.
          x: plotXAxes.get(plot) ?? null,
          // Says so when the plot is set to plot against a variable the run has no values for.
          note: plotXAxes.has(plot) && !plotXAxes.get(plot) ? missingXNote(groups.find((item) => item.id === plot).xAxis) : null,
          series: group.map((item) => ({ key: item.key, label: item.label, values: item.values, slot: slots.get(item.key) })),
        })
      })
    }
    store.setSeriesSlots(new Map([...previousSlots, ...nextSlots]))
    return result
  })

  return { xAxis, charts }
}
