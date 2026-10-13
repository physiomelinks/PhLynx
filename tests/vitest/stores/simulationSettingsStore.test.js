import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { cloneSimulationSettings, useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'

const SWEEP = { key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', units: 'mM', type: 'constant', from: 1, to: 3, points: 3, readout: 'min' }

describe('simulationSettingsStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('saves and loads a sweep, with its reading', () => {
    const store = useSimulationSettingsStore()
    store.setSimulationSettings({ ...store.simulationSettings, sweep: SWEEP })
    const saved = store.getState()
    expect(saved.simulationSettings.sweep).toEqual(SWEEP)

    const loaded = useSimulationSettingsStore()
    loaded.resetState()
    loaded.loadState(JSON.parse(JSON.stringify(saved)))
    expect(loaded.simulationSettings.sweep).toEqual(SWEEP)
  })

  it('copies a sweep and its curves, so a draft of them is its own', () => {
    const family = { key: 'a::g', nodeId: 'a', nodeName: 'a', parameterName: 'g', units: '', type: 'constant', values: [1, 2] }
    const sweep = { ...SWEEP, family }
    const copy = cloneSimulationSettings({ sweep })
    expect(copy.sweep).toEqual(sweep)
    expect(copy.sweep).not.toBe(sweep)
    expect(copy.sweep.family).not.toBe(family)
    expect(copy.sweep.family.values).not.toBe(family.values)
  })
})
