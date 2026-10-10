// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSimulationCharts } from '../../../src/composables/useSimulationCharts.js'
import { OBS_DATA_PLOT } from '../../../src/services/simulation/protocolPlotGroups.js'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { ALL_EXPERIMENTS, useProtocolStore } from '../../../src/stores/protocolStore.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'

const NODE = { id: 'n1', data: { name: 'soma' } }
// V's trace and its peak in the second sub-experiment of each experiment, measured too, plotted against the g it set
// there.
const OBS_DATA = {
  protocol_info: { pre_times: [0, 0], sim_times: [[2, 2], [2, 2]], params_to_change: { 'soma/g': [[1, 2], [1, 3]] }, experiment_labels: ['Control', 'Raised'] },
  prediction_items: [0, 1].map((e) => ({
    data_item_name: `peak_${e}`,
    operands: ['soma/V'],
    unit: 'volt',
    operation: 'max',
    subexperiment_idx: 1,
    experiment_idx: e,
    item_name_for_plotting: 'peak',
  })),
  data_items: [{ data_item_name: 'peak_obs', operands: ['soma/V'], unit: 'volt', operation: 'max', data_type: 'constant', plot_type: 'horizontal', value: 5, std: 1, subexperiment_idx: 1 }],
  prediction_plots: [{ name: 'peak vs g', kind: 'feature_vs_input', x: { params_to_change: 'soma/g', subexperiment_idx: 1 }, y: 'peak', series: null }],
}

/**
 * Gives the workspace's archive an obs_data file.
 *
 * @param {Object} document
 */
function addObsData(document) {
  const payload = new TextEncoder().encode(JSON.stringify(document)).buffer
  useOmexStore().setArchive({ extras: [{ location: 'model_obs_data.json', format: 'application/json', payload }] })
}

/**
 * Gives an experiment's results, V rising to `peak` at its end, with V's own series in each sub-experiment.
 *
 * @param {number} g - Set in the second sub-experiment.
 * @param {number} peak
 * @returns {Object}
 */
const experiment = (g, peak) => ({
  voi: { name: 'environment/time', unit: 'second', values: Float64Array.of(0, 1, 2, 3, 4) },
  variables: new Map([
    ['instance_parameters/g', { kind: 'constant', unit: 'siemens', values: Float64Array.of(1, 1, 1, g, g) }],
    ['soma/V', { kind: 'state', unit: 'volt', values: Float64Array.of(0, 1, 2, 3, peak) }],
  ]),
  preTime: 0,
  subs: [
    { startIndex: 0, endIndex: 2, duration: 2, numberOfSteps: 2 },
    { startIndex: 2, endIndex: 4, duration: 2, numberOfSteps: 2 },
  ],
  subSeries: [{ 'soma/V': Float64Array.of(0, 1, 2) }, { 'soma/V': Float64Array.of(2, 3, peak) }],
})

/** Records a protocol run of both experiments, the first shown. */
function finishRun() {
  useSimulationResultsStore().finishProtocolRun({
    protocolResults: { experiments: [experiment(2, 4), experiment(3, 6)], issues: [], elapsedMs: 1, isStopped: false },
    inputs: new Map([['soma/g', { name: 'instance_parameters/g', isStepped: true }]]),
    featureOperands: new Map([['soma/V', 'soma/V']]),
    experiment: 0,
    mapping: new Map([['n1::V', 'soma/V']]),
    signature: 's',
  })
}

describe('useSimulationCharts: the obs_data plots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    addObsData(OBS_DATA)
  })

  it("plots the obs_data's variable after the plotted ones, with the data item's obs and calc lines and the prediction item's", () => {
    finishRun()
    const { charts } = useSimulationCharts([NODE])
    const [chart] = charts.value.filter(({ plotId }) => plotId === OBS_DATA_PLOT)
    expect(chart).toMatchObject({ title: 'soma/V', unit: 'volt', plotLabel: 'obs_data' })
    expect(chart.series.map(({ label, values }) => [label, [...values]])).toEqual([['soma/V', [0, 1, 2, 3, 4]]])
    expect(chart.references.map(({ label, from, to, value }) => [label, from, to, value])).toEqual([
      ['peak_obs (obs max)', 2, 4, 5],
      ['peak_obs (calc max)', 2, 4, 4],
      ['peak (calc max)', 2, 4, 4],
    ])
  })

  it('follows the experiment picked, and draws them all at once', () => {
    finishRun()
    const { charts } = useSimulationCharts([NODE])
    useProtocolStore().activeExperiment = 1
    const shown = () => charts.value.find(({ plotId }) => plotId === OBS_DATA_PLOT)
    // The data item is the first experiment's.
    expect(shown().references.map(({ label, value }) => [label, value])).toEqual([['peak (calc max)', 6]])
    useProtocolStore().activeExperiment = ALL_EXPERIMENTS
    expect(shown().series.map(({ label, slot }) => [label, slot])).toEqual([
      ['Control', 0],
      ['Raised', 1],
    ])
    expect(shown().references.map(({ role, slot }) => [role, slot])).toEqual([
      ['obs', 0],
      ['calc', 0],
      ['calc', 0],
      ['calc', 1],
    ])
  })

  it('pairs the features into the prediction plots, an input on x in the unit the run reported for it', () => {
    finishRun()
    const [plot] = useSimulationCharts([NODE]).predictionPlotCharts.value
    expect(plot).toMatchObject({ title: 'peak vs g', unit: 'volt', x: { label: 'soma/g (sub-experiment 2)', unit: 'siemens', values: [2, 3] } })
    expect(plot.series.filter(({ isInKey }) => isInKey).map(({ label, values }) => [label, values])).toEqual([
      ['Control', [4, null]],
      ['Raised', [null, 6]],
    ])
  })

  it("draws none without a protocol run's results", () => {
    const { charts, predictionPlotCharts } = useSimulationCharts([NODE])
    expect(charts.value).toEqual([])
    expect(predictionPlotCharts.value).toEqual([])
  })
})
