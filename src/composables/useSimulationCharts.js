/**
 * The charts of a run's results, as every simulation view shows them: the plotted variables of the simulated
 * instances, then the inspection modules' outputs, one chart per plot and unit. Tracked runs' lines go under
 * the live run's, beside the variables they show.
 */
import { computed, unref } from 'vue'

import { resolveGroups } from '../services/simulation/plotSelections'
import { INSPECTION_COMPONENT, isInspectionNodeId } from '../services/simulation/variableIndex'
import { assignSeriesSlots, chunkSeries } from '../services/simulation/seriesSlots'
import { alignVoi, displayVoi, runDash, runLabel } from '../services/simulation/trackedRuns'
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

  // The tracked runs shown, each with the values of the variable of integration (VoI) its charts show.
  const shownRuns = computed(() =>
    store.trackedRuns
      .filter((run) => run.isVisible)
      .map((run) => ({ ...run, voiValues: displayVoi(run.results, run.settings ?? simulationSettingsStore.simulationSettings).values }))
  )

  // Plots that start after the solve does, to let the model settle, count the VoI from their start: 0.
  const liveVoi = computed(() => displayVoi(store.results, simulationSettingsStore.simulationSettings))

  // One VoI axis for the runs shown, which is the live run's while they share it. A hidden live run's
  // points are left out, so tracked runs with the same points still draw without gaps.
  const voiAxis = computed(() => {
    const runVoi = shownRuns.value.map((run) => run.voiValues)
    if (!store.isLiveRunVisible && runVoi.length) return alignVoi(runVoi[0], runVoi.slice(1))
    return alignVoi(liveVoi.value.values, runVoi)
  })

  const xAxis = computed(() => {
    const voi = store.results?.voi
    return {
      label: voi?.name.split('/').pop() ?? '',
      unit: voi?.unit ?? '',
      values: voiAxis.value.values,
      // Where 0 is in the run's own VoI, when it isn't the same.
      offset: liveVoi.value.offset,
      // A model without ODEs is solved once: one value per variable, and no VoI to plot them against.
      isSteadyState: !!store.results?.isSteadyState,
    }
  })

  /**
   * Gets every series to plot from a run: the plotted variables of all the simulated instances, then the
   * inspection modules' outputs, each with the plot it belongs to.
   *
   * @param {{results: Object, mapping: Map, inspectionOutputs: Array<Object>}} run - The live run or a tracked one.
   * @returns {Array<{key: string, plot: string, label: string, unit: string, values: Float64Array}>}
   */
  function collectSeries(run) {
    const nodesById = new Map(unref(scopeNodes).map((node) => [node.id, node]))
    const outputsById = new Map(run.inspectionOutputs.map((output) => [output.id, output]))
    const variables = (simulationSettingsStore.plotConfig?.selections ?? []).flatMap((selection) => {
      // An inspection module's output put on a plot, as a variable of no instance.
      if (isInspectionNodeId(selection.nodeId)) {
        const output = outputsById.get(selection.nodeId.slice('inspection:'.length))
        const series = output && run.results.variables.get(output.reportedName)
        if (!series) return []
        const node = { id: selection.nodeId, data: { name: INSPECTION_COMPONENT } }
        return [{ key: selection.key, plot: selection.groupId ?? '', node, name: output.name, unit: output.units, values: series.values }]
      }
      const node = nodesById.get(selection.nodeId)
      const series = node && readNodeSeries(run.results, run.mapping, node.id, selection.variableName)
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
    const outputs = (settings.plotInspectionModules ? run.inspectionOutputs : []).flatMap((output) => {
      const series = run.results.variables.get(output.reportedName)
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
    plotNames.set(INSPECTION_PLOT, 'Inspection modules')
    const plotOrder = new Map(groups.map((group, index) => [group.id, index]))

    const byPlotAndUnit = new Map()
    // Charts follow the plots' order; inspection outputs, then anything not on a plot, come last.
    const ordered = collectSeries(store)
      .map((series, index) => ({ series, index }))
      .sort((a, b) => (plotOrder.get(a.series.plot) ?? groups.length) - (plotOrder.get(b.series.plot) ?? groups.length) || a.index - b.index)
      .map(({ series }) => series)
    for (const series of ordered) {
      const id = `${series.plot}#${series.unit}`
      if (!byPlotAndUnit.has(id)) byPlotAndUnit.set(id, { plot: series.plot, unit: series.unit, series: [] })
      byPlotAndUnit.get(id).series.push(series)
    }

    // Each tracked run's values by series key, and its VoI values; a variable it didn't simulate has no line.
    const { align } = voiAxis.value
    const runs = shownRuns.value.map((run) => ({ run, values: new Map(collectSeries(run).map((series) => [series.key, series.values])) }))
    const live = liveVoi.value.values

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
        const title = titleFor(group, plotName)
        // Tracked runs first, so the live run's lines are drawn over theirs.
        const tracked = runs.flatMap(({ run, values }) =>
          group.flatMap((item) =>
            values.has(item.key)
              ? [
                  {
                    key: `${run.id}::${item.key}`,
                    label: runLabel(item.label, run.number),
                    variableLabel: item.label,
                    values: align(run.voiValues, values.get(item.key)),
                    slot: slots.get(item.key),
                    run: { number: run.number, dash: runDash(run.number) },
                  },
                ]
              : []
          )
        )
        const shown = store.isLiveRunVisible
          ? group.map((item) => ({ key: item.key, label: item.label, variableLabel: item.label, values: align(live, item.values), slot: slots.get(item.key), run: null }))
          : []
        result.push({
          key: `${id}#${index}`,
          plotId: plot,
          ...title,
          // Each variable's colour, for the title to show it.
          titleParts: title.titleParts?.map((part, partIndex) => ({ ...part, slot: slots.get(group[partIndex].key) })) ?? null,
          // The plot's name, with what tells its charts apart when it makes several.
          plotLabel: chartsPerPlot.get(plot) > 1 && parts.length ? `${plotName} (${parts.join(', ')})` : plotName,
          unit,
          series: [...tracked, ...shown],
        })
      })
    }
    store.setSeriesSlots(new Map([...previousSlots, ...nextSlots]))
    return result
  })

  return { xAxis, charts }
}
