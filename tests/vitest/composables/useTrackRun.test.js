import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useTrackRun } from '../../../src/composables/useTrackRun.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'

const SWEEP = { key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', from: 1, to: 3, points: 3 }

describe('useTrackRun', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSimulationSettingsStore().setParameterScanConfig({
      selections: [
        { key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', units: 'second' },
        { key: 'a::g', nodeId: 'a', nodeName: 'a', parameterName: 'g', type: 'constant', units: 'siemens' },
      ],
    })
  })

  /**
   * Finishes a run with slider values on both a/k and a/g.
   *
   * @param {Object} results
   * @param {Object} settings
   */
  const finish = (results, settings) => {
    const store = useSimulationResultsStore()
    store.startRun(null)
    store.finishRun({
      results: { voi: { name: '', unit: '', values: new Float64Array() }, variables: new Map(), isStopped: false, ...results },
      mapping: new Map(),
      signature: 's',
      inspectionOutputs: [],
      inputs: { settings, overrides: { rows: new Map([['a::k', 2], ['a::g', 5]]), globals: new Map() } },
    })
  }

  it('lists the slider values a run ran with, but not the one its sweep set', () => {
    const { liveInputs } = useTrackRun()
    finish({}, { sweep: SWEEP })
    expect(liveInputs.value.map(({ label }) => label)).toEqual(['a/k', 'a/g'])

    finish({ isSweep: true }, { sweep: SWEEP })
    expect(liveInputs.value.map(({ label }) => label)).toEqual(['a/g'])
  })
})
