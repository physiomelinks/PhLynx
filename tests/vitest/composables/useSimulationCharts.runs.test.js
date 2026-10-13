// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSimulationCharts } from '../../../src/composables/useSimulationCharts.js'
import { runDash } from '../../../src/services/simulation/trackedRuns.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'

const NODES = [{ id: 'a', data: { name: 'cell' } }]
const MAPPING = new Map([
  ['a::V', 'cell/V'],
  ['a::w', 'cell/w'],
])

/**
 * Makes results with V and w over some values of the VoI.
 *
 * @param {number[]} voi
 * @param {number} offset - Added to each value, to tell runs apart.
 * @returns {Object}
 */
const makeResults = (voi, offset) => ({
  voi: { name: 'cell/t', unit: 'second', values: new Float64Array(voi) },
  variables: new Map([
    ['cell/V', { unit: 'mV', values: new Float64Array(voi.map((point) => point + offset)) }],
    ['cell/w', { unit: 'mV', values: new Float64Array(voi.map(() => offset)) }],
  ]),
  isStopped: false,
})

describe('useSimulationCharts with tracked runs', () => {
  let store
  let settingsStore

  /**
   * Finishes a run with some results.
   *
   * @param {Object} results
   */
  const finish = (results) => {
    store.startRun(null)
    store.finishRun({ results, mapping: MAPPING, signature: 's', inspectionOutputs: [], inputs: { settings: { ...settingsStore.simulationSettings }, overrides: null } })
  }

  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
    store = useSimulationResultsStore()
    settingsStore = useSimulationSettingsStore()
    settingsStore.simulationSettings = { ...settingsStore.simulationSettings, initialPoint: 0, startingPoint: 0 }
    settingsStore.setPlotConfig({
      groups: [{ id: 'p1', name: 'Plot 1' }],
      selections: [
        { key: 'a::V', nodeId: 'a', variableName: 'V', groupId: 'p1' },
        { key: 'a::w', nodeId: 'a', variableName: 'w', groupId: 'p1' },
      ],
    })
  })

  it('draws each tracked run’s lines under the live run’s, in its variable’s colour and the run’s dash', () => {
    const { charts } = useSimulationCharts(NODES)
    finish(makeResults([0, 1], 0))
    store.trackRun()
    finish(makeResults([0, 1], 10))
    const [chart] = charts.value
    expect(chart.series.map((series) => series.label)).toEqual(['cell/V [#1]', 'cell/w [#1]', 'cell/V', 'cell/w'])
    const [trackedV, , liveV] = chart.series
    expect(trackedV.slot).toBe(liveV.slot)
    expect(trackedV.run).toEqual({ number: 1, name: null, dash: runDash(1) })
    expect(trackedV.liveKey).toBe(liveV.key)
    expect(liveV.run).toBeNull()
    expect(Array.from(trackedV.values)).toEqual([0, 1])
    expect(Array.from(liveV.values)).toEqual([10, 11])
    expect(chart.titleParts.map((part) => part.slot)).toEqual([chart.series[2].slot, chart.series[3].slot])
    expect(chart.titleParts.map((part) => part.key)).toEqual([chart.series[2].key, chart.series[3].key])
  })

  it('names a tracked run’s lines by the name it was given', () => {
    const { charts } = useSimulationCharts(NODES)
    finish(makeResults([0, 1], 0))
    const run = store.trackRun()
    store.renameTrackedRun(run.id, 'Low gain')
    const [trackedV] = charts.value[0].series
    expect(trackedV.label).toBe('cell/V [Low gain]')
    expect(trackedV.run.name).toBe('Low gain')
  })

  it('leaves out hidden runs, and the live run when it is hidden', () => {
    const { charts } = useSimulationCharts(NODES)
    finish(makeResults([0, 1], 0))
    const run = store.trackRun()
    store.isLiveRunVisible = false
    expect(charts.value[0].series.every((series) => series.run)).toBe(true)
    store.toggleTrackedRun(run.id)
    expect(charts.value[0].series).toEqual([])
  })

  it('puts runs with other output points on one VoI axis', () => {
    const { xAxis, charts } = useSimulationCharts(NODES)
    finish(makeResults([0, 1], 0))
    store.trackRun()
    finish(makeResults([0, 0.5, 1], 10))
    expect(Array.from(xAxis.value.values)).toEqual([0, 0.5, 1])
    const tracked = charts.value[0].series.find((series) => series.key === 'run_1::a::V')
    expect(Array.from(tracked.values)).toEqual([0, null, 1])
  })

  it('leaves a hidden live run’s points off the VoI axis', () => {
    const { xAxis, charts } = useSimulationCharts(NODES)
    finish(makeResults([0, 1], 0))
    store.trackRun()
    finish(makeResults([0, 1], 5))
    store.trackRun()
    finish(makeResults([0, 0.5, 1], 10))
    store.isLiveRunVisible = false
    expect(Array.from(xAxis.value.values)).toEqual([0, 1])
    expect(charts.value[0].series.every((series) => !series.values.includes(null))).toBe(true)
  })

  it('plots a tracked run of a phase plot against its own x values, not aligned to the VoI', () => {
    settingsStore.setPlotConfig({
      groups: [{ id: 'p1', name: 'Plot 1', xAxis: { key: 'a::V', nodeId: 'a', nodeName: 'cell', variableName: 'V', units: 'mV' } }],
      selections: [{ key: 'a::w', nodeId: 'a', variableName: 'w', groupId: 'p1' }],
    })
    const { charts } = useSimulationCharts(NODES)
    finish(makeResults([0, 1], 0))
    store.trackRun()
    finish(makeResults([0, 0.5, 1], 10))
    const [chart] = charts.value
    expect(chart.x).toMatchObject({ key: 'a::V', label: 'cell/V', isPhase: true })
    expect(Array.from(chart.x.values)).toEqual([10, 10.5, 11])
    const [tracked, live] = chart.series
    expect(Array.from(tracked.xValues)).toEqual([0, 1])
    expect(Array.from(tracked.values)).toEqual([0, 0])
    expect(Array.from(tracked.runValues)).toEqual([0, 1])
    expect(Array.from(live.values)).toEqual([10, 10, 10])
    expect(live.xValues).toBeUndefined()
  })

  it('names a sweep’s x-axis after its parameter, and doesn’t settle its values', () => {
    settingsStore.simulationSettings = { ...settingsStore.simulationSettings, initialPoint: 0, startingPoint: 1 }
    const { xAxis } = useSimulationCharts(NODES)
    finish({ ...makeResults([1, 2, 3], 0), isSteadyState: true, isSweep: true, sweepLabel: 'cell/g' })
    expect(xAxis.value).toMatchObject({ label: 'cell/g', isSweep: true, isSteadyState: false, offset: 0 })
    expect(Array.from(xAxis.value.values)).toEqual([1, 2, 3])
  })

  describe('a sweep with curves', () => {
    /**
     * Makes a sweep's results with V and w at three values of cell/k, a curve per value of cell/Ko.
     *
     * @returns {Object}
     */
    const makeFamily = () => {
      const curve = (offset) => new Map([
        ['cell/V', { unit: 'mV', values: Float64Array.of(1, 2, 3).map((value) => value + offset) }],
        ['cell/w', { unit: 'mV', values: Float64Array.of(offset, offset, offset) }],
      ])
      const curves = [{ value: 2, variables: curve(0) }, { value: 5.4, variables: curve(10) }]
      return {
        voi: { name: 'cell/k', unit: '', values: Float64Array.of(1, 2, 3) },
        variables: curves[0].variables,
        isStopped: false,
        isSweep: true,
        isSteadyState: true,
        sweepLabel: 'cell/k',
        familyLabel: 'cell/Ko',
        family: { name: 'cell/Ko', unit: 'mM', values: [2, 5.4], curves },
      }
    }

    it('draws each variable on a chart of its own, a curve per value, coloured by the value', () => {
      const { charts } = useSimulationCharts(NODES)
      finish(makeFamily())

      expect(charts.value.map((chart) => chart.title)).toEqual(['cell/V', 'cell/w'])
      const [v, w] = charts.value
      expect(v.series.map(({ label, slot }) => [label, slot])).toEqual([
        ['cell/Ko = 2 mM', 0],
        ['cell/Ko = 5.4 mM', 1],
      ])
      expect(w.series.map(({ slot }) => slot)).toEqual([0, 1])
      expect(Array.from(v.series[1].values)).toEqual([11, 12, 13])
      expect(v.titleParts).toEqual([{ component: 'cell', name: 'V', key: v.series[0].key, slot: 0 }])
      // The plot list shows no one colour for a variable drawn as curves.
      expect(store.getSeriesSlots().has('a::V')).toBe(false)
    })
  })
})
