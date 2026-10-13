// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SimulationToolbar from '../../../src/components/simulation/SimulationToolbar.vue'
import { useFloatingViewer } from '../../../src/composables/useFloatingViewer.js'
import { useProtocolStore } from '../../../src/stores/protocolStore.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'

const SWEEP = { key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', from: 1, to: 3, points: 3 }

// Keeps each tooltip's text on its element, for the tests to read.
const tooltip = {
  mounted: (el, binding) => (el.dataset.tooltip = binding.value),
  updated: (el, binding) => (el.dataset.tooltip = binding.value),
}

/**
 * Mounts the toolbar.
 *
 * @param {Object} [props]
 * @returns {import('@vue/test-utils').VueWrapper}
 */
const mountToolbar = (props = {}) => mount(SimulationToolbar, { props, global: { plugins: [PrimeVue], directives: { tooltip } } })

describe('SimulationToolbar sweep mode', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('offers sweep mode only once a sweep is set', async () => {
    const wrapper = mountToolbar()
    expect(wrapper.find('[data-testid="sim-sweep-mode"]').exists()).toBe(false)

    const settingsStore = useSimulationSettingsStore()
    settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, sweep: SWEEP })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="sim-sweep-mode"]').attributes('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('switches to the sweep, turning the protocol off, and plays', async () => {
    const settingsStore = useSimulationSettingsStore()
    settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, sweep: SWEEP })
    const protocolStore = useProtocolStore()
    protocolStore.isProtocolMode = true
    const resultsStore = useSimulationResultsStore()
    const wrapper = mountToolbar()

    await wrapper.find('[data-testid="sim-sweep-mode"]').trigger('click')

    expect(resultsStore.isSweepMode).toBe(true)
    expect(protocolStore.isProtocolMode).toBe(false)
    expect(wrapper.emitted('play')).toHaveLength(1)
    expect(wrapper.find('[data-testid="sim-sweep-mode"]').attributes('aria-pressed')).toBe('true')

    // Removing the sweep, from whichever view, turns sweep mode off.
    settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, sweep: null })
    await wrapper.vm.$nextTick()
    expect(resultsStore.isSweepMode).toBe(false)
    wrapper.unmount()
  })
})

describe('SimulationToolbar track run', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const findTrack = (wrapper) => wrapper.find('button[aria-label="Track this run"]')

  it('sits beside the float button, and is disabled until a run can be tracked', () => {
    const wrapper = mountToolbar()
    const labels = wrapper.findAll('button').map((button) => button.attributes('aria-label'))
    expect(labels.indexOf('Float the results over the canvas')).toBe(labels.indexOf('Track this run') + 1)
    expect(findTrack(wrapper).attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('says why it can’t track the run, in its tooltip and to screen readers', async () => {
    const store = useSimulationResultsStore()
    const wrapper = mountToolbar()
    expect(wrapper.find('.toolbar-track').attributes('data-tooltip')).toBe('Run the simulation first')
    const describedBy = findTrack(wrapper).attributes('aria-describedby')
    expect(wrapper.find(`[id="${describedBy}"]`).text()).toBe('Run the simulation first')

    store.startRun(null)
    store.finishRun({
      results: { voi: { name: 'm/t', unit: 'second', values: new Float64Array([0, 1]) }, variables: new Map(), isStopped: false },
      mapping: new Map(),
      signature: 's',
      inspectionOutputs: [],
      inputs: { settings: {}, overrides: null },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.toolbar-track').attributes('data-tooltip')).toBe('Track this run: keep its lines on the charts')
    expect(findTrack(wrapper).attributes('aria-describedby')).toBeUndefined()
    wrapper.unmount()
  })

  it('tracks the shown run', async () => {
    const store = useSimulationResultsStore()
    store.startRun(null)
    store.finishRun({
      results: { voi: { name: 'm/t', unit: 'second', values: new Float64Array([0, 1]) }, variables: new Map(), isStopped: false },
      mapping: new Map(),
      signature: 's',
      inspectionOutputs: [],
      inputs: { settings: {}, overrides: null },
    })
    const wrapper = mountToolbar()

    await findTrack(wrapper).trigger('click')
    expect(store.trackedRuns.map((run) => run.number)).toEqual([1])
    wrapper.unmount()
  })
})

describe('SimulationToolbar float', () => {
  const viewer = useFloatingViewer()
  const collapse = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    viewer.setSidebarCollapser(collapse)
  })

  afterEach(() => {
    viewer.state.visible = false
    viewer.setSidebarCollapser(() => {})
    collapse.mockClear()
  })

  const findFloat = (wrapper) => wrapper.find('button[aria-label="Float the results over the canvas"]')

  it('hides the sidebar as the sidebar’s results float', async () => {
    const wrapper = mountToolbar({ isInSidebar: true })
    await findFloat(wrapper).trigger('click')
    expect(viewer.state.visible).toBe(true)
    expect(collapse).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('leaves the sidebar open as an instance editor’s results float', async () => {
    const wrapper = mountToolbar()
    await findFloat(wrapper).trigger('click')
    expect(viewer.state.visible).toBe(true)
    expect(collapse).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('SimulationToolbar placement', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const labelsOf = (wrapper) => wrapper.findAll('button').map((button) => button.attributes('aria-label'))

  it('offers the simulation page where asked, and opens it', async () => {
    const wrapper = mountToolbar({ hasPageLink: true })
    const open = wrapper.find('button[aria-label="Open the simulation page"]')
    expect(open.find('.pi-external-link').exists()).toBe(true)
    await open.trigger('click')
    expect(wrapper.emitted('open-page')).toHaveLength(1)
    wrapper.unmount()
  })

  it('offers neither the page nor floating on the simulation page', () => {
    const wrapper = mountToolbar({ hasFloat: false })
    expect(labelsOf(wrapper)).not.toContain('Open the simulation page')
    expect(labelsOf(wrapper)).not.toContain('Float the results over the canvas')
    expect(labelsOf(wrapper)).toContain('Track this run')
    wrapper.unmount()
  })
})

describe('SimulationToolbar slot', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('puts a view’s own controls right after the scope switch', () => {
    const wrapper = mount(SimulationToolbar, {
      global: { plugins: [PrimeVue], directives: { tooltip } },
      slots: { default: '<span class="own-control">Mine</span>' },
    })
    expect(wrapper.find('.toolbar-scope').element.nextElementSibling.classList.contains('own-control')).toBe(true)
    wrapper.unmount()
  })
})
