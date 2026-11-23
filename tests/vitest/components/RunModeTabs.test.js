// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { beforeEach, describe, expect, it } from 'vitest'

import RunModeTabs from '../../../src/components/simulation/RunModeTabs.vue'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useProtocolStore } from '../../../src/stores/protocolStore.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'

const SWEEP = { key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', from: 1, to: 3, points: 3 }
const PROTOCOL = {
  protocol_info: { pre_times: [0], sim_times: [[1]], params_to_change: { 'a/k': [[1]] }, experiment_labels: ['One'] },
  data_items: [],
}

// Keeps each tooltip's text on its element, for the tests to read.
const tooltip = {
  mounted: (el, binding) => (el.dataset.tooltip = binding.value),
  updated: (el, binding) => (el.dataset.tooltip = binding.value),
}

const mountTabs = (props = {}) => mount(RunModeTabs, { props, global: { plugins: [PrimeVue], directives: { tooltip } } })
const tab = (wrapper, mode) => wrapper.find(`[data-testid="sim-${mode}-mode"]`)

/** Gives the workspace an obs_data file holding a protocol. */
function addProtocol() {
  const payload = new TextEncoder().encode(JSON.stringify(PROTOCOL)).buffer
  useOmexStore().setArchive({ extras: [{ location: 'obs_data.json', format: 'application/json', payload }] })
}

describe('RunModeTabs', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows every mode, the time course on, and says why a mode not set up is disabled', () => {
    const wrapper = mountTabs()
    expect(tab(wrapper, 'run').attributes('aria-pressed')).toBe('true')
    for (const mode of ['protocol', 'sweep']) {
      const button = tab(wrapper, mode)
      expect(button.attributes('aria-disabled')).toBe('true')
      expect(wrapper.find(`[id="${button.attributes('aria-describedby')}"]`).text()).toBe(button.attributes('data-tooltip'))
    }
    expect(tab(wrapper, 'protocol').attributes('data-tooltip')).toBe('No protocol yet: add one with Edit protocol')
    expect(tab(wrapper, 'sweep').attributes('data-tooltip')).toBe('No sweep yet: set one up in the Sweep tab')
    wrapper.unmount()
  })

  it('does nothing when a disabled mode is clicked', async () => {
    const wrapper = mountTabs()
    await tab(wrapper, 'sweep').trigger('click')
    expect(useSimulationResultsStore().isSweepMode).toBe(false)
    expect(wrapper.emitted('play')).toBeUndefined()
    wrapper.unmount()
  })

  it('switches one mode at a time, playing each, and back to the time course', async () => {
    const settingsStore = useSimulationSettingsStore()
    settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, sweep: SWEEP })
    addProtocol()
    const protocolStore = useProtocolStore()
    const resultsStore = useSimulationResultsStore()
    const wrapper = mountTabs()

    await tab(wrapper, 'protocol').trigger('click')
    expect(protocolStore.isProtocolMode).toBe(true)
    await tab(wrapper, 'sweep').trigger('click')
    expect([protocolStore.isProtocolMode, resultsStore.isSweepMode]).toEqual([false, true])
    expect(tab(wrapper, 'sweep').attributes('aria-pressed')).toBe('true')
    await tab(wrapper, 'run').trigger('click')
    expect([protocolStore.isProtocolMode, resultsStore.isSweepMode]).toEqual([false, false])
    expect(wrapper.emitted('play')).toHaveLength(3)
    wrapper.unmount()
  })

  it('switches without playing while play can’t run', async () => {
    const settingsStore = useSimulationSettingsStore()
    settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, sweep: SWEEP })
    const wrapper = mountTabs({ isRunning: true })
    await tab(wrapper, 'sweep').trigger('click')
    expect(useSimulationResultsStore().isSweepMode).toBe(true)
    expect(wrapper.emitted('play')).toBeUndefined()
    wrapper.unmount()
  })

  it('turns sweep mode off once the sweep is removed', async () => {
    const settingsStore = useSimulationSettingsStore()
    settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, sweep: SWEEP })
    const resultsStore = useSimulationResultsStore()
    const wrapper = mountTabs()
    await tab(wrapper, 'sweep').trigger('click')
    settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, sweep: null })
    await wrapper.vm.$nextTick()
    expect(resultsStore.isSweepMode).toBe(false)
    expect(tab(wrapper, 'sweep').attributes('aria-disabled')).toBe('true')
    wrapper.unmount()
  })
})
