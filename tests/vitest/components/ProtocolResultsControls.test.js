// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import ProtocolResultsControls from '../../../src/components/simulation/ProtocolResultsControls.vue'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useProtocolStore } from '../../../src/stores/protocolStore.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'

const PROTOCOL = { pre_times: [0], sim_times: [[1, 1]], params_to_change: { 'a/k': [[1, 2]] } }
const RESULTS = {
  experiments: [
    {
      voi: { name: 't', unit: 's', values: Float64Array.of(0, 1, 2) },
      variables: new Map([['a/y', { kind: 'algebraic', unit: 'm', values: Float64Array.of(1, 1, 2) }]]),
      preTime: 0,
      subs: [
        { startIndex: 0, endIndex: 1, duration: 1, numberOfSteps: 1 },
        { startIndex: 1, endIndex: 2, duration: 1, numberOfSteps: 1 },
      ],
      subSeries: [{ 'a/y': Float64Array.of(1, 1) }, { 'a/y': Float64Array.of(4, 2) }],
    },
  ],
  issues: [],
  elapsedMs: 1,
  isStopped: false,
}

let wrapper

/**
 * Records a run of an obs_data with a peak of an operand, which the run kept or didn't.
 *
 * @param {string} operand
 */
function runWith(operand) {
  const payload = new TextEncoder().encode(JSON.stringify({ protocol_info: PROTOCOL, prediction_items: [{ data_item_name: 'peak', operands: [operand], unit: 'm', operation: 'max' }] })).buffer
  useOmexStore().setArchive({ extras: [{ location: 'model_obs_data.json', format: 'application/json', payload }] })
  useSimulationResultsStore().finishProtocolRun({ protocolResults: RESULTS, inputs: new Map(), featureOperands: new Map([['a/y', 'a/y']]), experiment: 0, mapping: new Map(), signature: 's' })
}

const mountControls = (props = {}) => (wrapper = mount(ProtocolResultsControls, { props, global: { plugins: [PrimeVue], directives: { tooltip: {} } } }))
const featuresButton = () => wrapper.find('button[aria-label="Show the feature plots"]')

describe('ProtocolResultsControls', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => wrapper?.unmount())

  it('offers Features once a feature has a value to plot, and switches them', async () => {
    runWith('a/y')
    mountControls()
    expect(featuresButton().attributes('aria-pressed')).toBe('false')
    await featuresButton().trigger('click')
    expect(useProtocolStore().isShowingFeatures).toBe(true)
    expect(featuresButton().attributes('aria-pressed')).toBe('true')
  })

  it('offers no Features when no feature has a value, nor in a view that picks its plots', () => {
    runWith('a/missing')
    expect(useSimulationResultsStore().features.map(({ error }) => error)).toEqual(["a/missing wasn't recorded."])
    mountControls()
    expect(featuresButton().exists()).toBe(false)
    wrapper.unmount()
    runWith('a/y')
    mountControls({ withFeatures: false })
    expect(featuresButton().exists()).toBe(false)
  })
})
