import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'

const PROTOCOL = { pre_times: [0], sim_times: [[1, 1]], params_to_change: { 'a/k': [[1, 2]] } }

/**
 * Gives the workspace's archive an obs_data file.
 *
 * @param {Object} document
 */
function addObsData(document) {
  const payload = new TextEncoder().encode(JSON.stringify(document)).buffer
  useOmexStore().setArchive({ extras: [{ location: 'model_obs_data.json', format: 'application/json', payload }] })
}

// A run of one experiment, whose second sub-experiment's own series starts at its own k.
const PROTOCOL_RESULTS = {
  experiments: [
    {
      voi: { name: 't', unit: 's', values: new Float64Array([0, 1, 2]) },
      variables: new Map([['a/y', { kind: 'algebraic', unit: 'm', values: new Float64Array([1, 1, 2]) }]]),
      preTime: 0,
      subs: [
        { startIndex: 0, endIndex: 1, duration: 1, numberOfSteps: 1 },
        { startIndex: 1, endIndex: 2, duration: 1, numberOfSteps: 1 },
      ],
      subSeries: [{ 'a/y': new Float64Array([1, 1]) }, { 'a/y': new Float64Array([4, 2]) }],
    },
  ],
  issues: [],
  elapsedMs: 1,
  isStopped: false,
}

describe('simulationResultsStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("computes a protocol run's features from the obs_data as it is, and forgets them with the run", () => {
    const peak = { data_item_name: 'peak', operands: ['a/y'], unit: 'm', operation: 'max', subexperiment_idx: 1 }
    addObsData({ protocol_info: PROTOCOL, prediction_items: [peak] })
    const store = useSimulationResultsStore()
    expect(store.features).toEqual([])

    store.finishProtocolRun({ protocolResults: PROTOCOL_RESULTS, inputs: new Map(), featureOperands: new Map([['a/y', 'a/y']]), experiment: 0, mapping: new Map(), signature: 's' })
    expect(store.features.map(({ name, value }) => [name, value])).toEqual([['peak', 4]])

    addObsData({ protocol_info: PROTOCOL, prediction_items: [{ ...peak, operation: 'min' }] })
    expect(store.features[0].value).toBe(2)

    store.finishRun({ results: PROTOCOL_RESULTS.experiments[0], mapping: new Map(), signature: 's' })
    expect(store.features).toEqual([])
  })

  it('computes a feature of the time alone, which keeps no variable', () => {
    const timeMean = { data_item_name: 'time_mean', operands: ['time'], unit: 's', operation: 'mean', subexperiment_idx: 1 }
    addObsData({ protocol_info: PROTOCOL, prediction_items: [timeMean] })
    const store = useSimulationResultsStore()
    store.finishProtocolRun({ protocolResults: PROTOCOL_RESULTS, inputs: new Map(), featureOperands: new Map(), experiment: 0, mapping: new Map(), signature: 's' })
    // CA's time for a later sub-experiment runs from the start of the warm-up: 1 and 2 here.
    expect(store.features.map(({ name, value, error }) => [name, value, error])).toEqual([['time_mean', 1.5, null]])
  })
})
