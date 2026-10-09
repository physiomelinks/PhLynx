// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { findSegments, mergeTimes, spreadValues, useSimulationCharts } from '../../../src/composables/useSimulationCharts.js'
import { ALL_EXPERIMENTS, useProtocolStore } from '../../../src/stores/protocolStore.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'

const NODE = { id: 'n1', data: { name: 'soma' } }

/**
 * Gives an experiment's results: g, a constant the protocol set, and V, plotted.
 *
 * @returns {Object}
 */
const experiment = () => ({
  voi: { name: 'environment/time', unit: 'second', values: Float64Array.of(0, 1, 2, 3, 4) },
  variables: new Map([
    ['instance_parameters/g', { kind: 'constant', unit: 'siemens', values: Float64Array.of(1, 1, 1, 2, 2) }],
    ['soma/V', { kind: 'state', unit: 'volt', values: Float64Array.of(0, 1, 2, 3, 4) }],
  ]),
  subs: [
    { startIndex: 0, endIndex: 2 },
    { startIndex: 2, endIndex: 4 },
  ],
})

describe('useSimulationCharts', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("shows a protocol's run on its own time, with its sub-experiments, then the values it set when asked", () => {
    useSimulationSettingsStore().setSimulationSettings({ initialPoint: 0, startingPoint: 0 })
    useSimulationSettingsStore().plotConfig = { groups: [], selections: [{ key: 'n1::V', nodeId: 'n1', variableName: 'V', groupId: '' }] }
    const store = useSimulationResultsStore()
    store.finishProtocolRun({
      protocolResults: { experiments: [experiment()], issues: [], elapsedMs: 1, isStopped: false },
      inputs: new Map([['soma/g', { name: 'instance_parameters/g', isStepped: true }]]),
      experiment: 0,
      mapping: new Map([['n1::V', 'soma/V']]),
      signature: 's',
    })
    const { xAxis, charts } = useSimulationCharts([NODE])

    expect(xAxis.value.segments).toEqual([
      { from: 0, to: 2, number: 1 },
      { from: 2, to: 4, number: 2 },
    ])
    // The results only, at first.
    expect(charts.value.map(({ plotLabel }) => plotLabel)).toEqual(['Ungrouped'])
    // A view showing one chart at a time has them as a plot to pick.
    expect(useSimulationCharts([NODE], { hasInputs: true }).charts.value.map(({ plotLabel }) => plotLabel)).toEqual(['Ungrouped', 'Protocol inputs'])

    useProtocolStore().isShowingInputs = true
    expect(charts.value.map(({ series }) => series.map(({ isStepped }) => isStepped))).toEqual([[false], [true]])
    expect(charts.value.map(({ plotLabel, title, unit }) => [plotLabel, title, unit])).toEqual([
      ['Ungrouped', 'soma/V', 'volt'],
      ['Protocol inputs', 'soma/g', 'siemens'],
    ])
  })

  it("doesn't count a protocol's time again from where the plots start", () => {
    useSimulationSettingsStore().setSimulationSettings({ initialPoint: -1, startingPoint: 0 })
    const store = useSimulationResultsStore()
    store.finishProtocolRun({ protocolResults: { experiments: [experiment()], issues: [], elapsedMs: 1, isStopped: false }, experiment: 0, mapping: new Map(), signature: 's' })

    expect([...useSimulationCharts([NODE]).xAxis.value.values]).toEqual([0, 1, 2, 3, 4])
  })
})

describe('every experiment at once', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('puts each experiment on one time axis, named after it, its line unbroken across the others\' times', () => {
    useSimulationSettingsStore().plotConfig = { groups: [], selections: [{ key: 'n1::V', nodeId: 'n1', variableName: 'V', groupId: '' }] }
    const short = { ...experiment(), voi: { name: 'environment/time', unit: 'second', values: Float64Array.of(0, 0.5, 1) } }
    short.variables = new Map([['soma/V', { kind: 'state', unit: 'volt', values: Float64Array.of(5, 6, 7) }]])
    useSimulationResultsStore().finishProtocolRun({
      protocolResults: { experiments: [experiment(), short], issues: [], elapsedMs: 1, isStopped: false },
      experiment: 0,
      mapping: new Map([['n1::V', 'soma/V']]),
      signature: 's',
    })
    useProtocolStore().setActiveExperiment(ALL_EXPERIMENTS)
    const { xAxis, charts } = useSimulationCharts([NODE])

    expect(xAxis.value.values).toEqual([0, 0.5, 1, 2, 3, 4])
    expect(xAxis.value.segments).toEqual([])
    const [chart] = charts.value
    // One variable: named once, its lines by experiment, each in its experiment's colour.
    expect(chart.title).toBe('soma/V')
    expect(chart.series.map(({ label, slot }) => [label, slot])).toEqual([
      ['Experiment 1', 0],
      ['Experiment 2', 1],
    ])
    expect(chart.series.map(({ values }) => values)).toEqual([
      [0, null, 1, 2, 3, 4],
      [5, 6, 7, null, null, null],
    ])
  })
})

describe('mergeTimes and spreadValues', () => {
  it('merges times once each, close ones as one, and spreads values over them with gaps', () => {
    const { times, positions } = mergeTimes([Float64Array.of(0, 0.1 + 0.2, 1), Float64Array.of(0, 0.3, 0.5)])
    expect(times).toEqual([0, 0.30000000000000004, 0.5, 1])
    expect([...positions[1]]).toEqual([0, 1, 2])
    expect(spreadValues(Float64Array.of(9, 8, 7), positions[0], times.length)).toEqual([9, 8, null, 7])
  })
})

describe('findSegments', () => {
  it('finds no segments in a run of one, and only those a stopped run reached', () => {
    expect(findSegments(undefined, Float64Array.of(0, 1))).toEqual([])
    expect(findSegments([{ startIndex: 0, endIndex: 1 }], Float64Array.of(0, 1))).toEqual([])
    const subs = [
      { startIndex: 0, endIndex: 2 },
      { startIndex: 2, endIndex: 4 },
      { startIndex: 4, endIndex: 6 },
    ]
    expect(findSegments(subs, Float64Array.of(0, 1, 2, 3))).toEqual([
      { from: 0, to: 2, number: 1 },
      { from: 2, to: 3, number: 2 },
    ])
  })
})
