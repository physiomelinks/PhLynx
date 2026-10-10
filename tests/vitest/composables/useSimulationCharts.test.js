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
    expect(trackedV.run).toEqual({ number: 1, dash: runDash(1) })
    expect(liveV.run).toBeNull()
    expect(Array.from(trackedV.values)).toEqual([0, 1])
    expect(Array.from(liveV.values)).toEqual([10, 11])
    expect(chart.titleParts.map((part) => part.slot)).toEqual([chart.series[2].slot, chart.series[3].slot])
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
})
