// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSimulationCharts } from '../../../src/composables/useSimulationCharts.js'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useProtocolStore } from '../../../src/stores/protocolStore.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'

const NODE = { id: 'n1', data: { name: 'soma' } }
// A peak of V in the second sub-experiment, plotted against the g it set there.
const OBS_DATA = {
  protocol_info: { pre_times: [0], sim_times: [[2, 2]], params_to_change: { 'soma/g': [[1, 2]] } },
  prediction_items: [{ data_item_name: 'peak', operands: ['soma/V'], unit: 'volt', operation: 'max', subexperiment_idx: 1, item_name_for_plotting: 'peak' }],
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
 * Records a protocol run of one experiment, with V's own series in each sub-experiment.
 *
 * @param {Map<string, string>} [featureOperands]
 */
function finishRun(featureOperands = new Map([['soma/V', 'soma/V']])) {
  const experiment = {
    voi: { name: 'environment/time', unit: 'second', values: Float64Array.of(0, 1, 2, 3, 4) },
    variables: new Map([
      ['instance_parameters/g', { kind: 'constant', unit: 'siemens', values: Float64Array.of(1, 1, 1, 2, 2) }],
      ['soma/V', { kind: 'state', unit: 'volt', values: Float64Array.of(0, 1, 2, 3, 4) }],
    ]),
    preTime: 0,
    subs: [
      { startIndex: 0, endIndex: 2, duration: 2, numberOfSteps: 2 },
      { startIndex: 2, endIndex: 4, duration: 2, numberOfSteps: 2 },
    ],
    subSeries: [{ 'soma/V': Float64Array.of(0, 1, 2) }, { 'soma/V': Float64Array.of(2, 3, 4) }],
  }
  useSimulationResultsStore().finishProtocolRun({
    protocolResults: { experiments: [experiment], issues: [], elapsedMs: 1, isStopped: false },
    inputs: new Map([['soma/g', { name: 'instance_parameters/g', isStepped: true }]]),
    featureOperands,
    experiment: 0,
    mapping: new Map(),
    signature: 's',
  })
}

describe('useSimulationCharts: feature plots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    addObsData(OBS_DATA)
  })

  it('draws none until asked for: by the setting or the view’s Features, or by a view that picks one plot at a time', () => {
    const { featureCharts } = useSimulationCharts([NODE])
    finishRun()
    expect(useProtocolStore().isShowingFeatures).toBe(false)
    expect(featureCharts.value).toEqual([])
    expect(useSimulationCharts([NODE], { hasFeatures: true }).featureCharts.value.map(({ title }) => title)).toEqual(['peak', 'peak vs g'])
    useProtocolStore().isShowingFeatures = true
    expect(featureCharts.value.map(({ title }) => title)).toEqual(['peak', 'peak vs g'])
  })

  it("draws none without a protocol run's results", () => {
    useProtocolStore().isShowingFeatures = true
    expect(useSimulationCharts([NODE]).featureCharts.value).toEqual([])
  })

  it('gives an input on x the unit the run reported for it', () => {
    finishRun()
    const [group, plot] = useSimulationCharts([NODE], { hasFeatures: true }).featureCharts.value
    expect(group.series.find(({ isInKey }) => isInKey).values).toEqual([4])
    expect(plot.x).toMatchObject({ label: 'soma/g (sub-experiment 2)', unit: 'siemens', values: [2] })
  })
})
