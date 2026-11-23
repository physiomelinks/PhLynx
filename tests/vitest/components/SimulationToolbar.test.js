// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SimulationToolbar from '../../../src/components/simulation/SimulationToolbar.vue'
import { useFloatingViewer } from '../../../src/composables/useFloatingViewer.js'
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
const mountToolbar = (props = {}) => mount(SimulationToolbar, { props, global: { plugins: [PrimeVue], directives: { tooltip, hint: tooltip } } })

describe('SimulationToolbar run modes', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('always shows the three modes beside play, those not set up disabled', () => {
    const wrapper = mountToolbar()
    const tabs = wrapper.find('.run-mode-tabs')
    expect(wrapper.find('.toolbar-run-wrap').element.nextElementSibling.nextElementSibling).toBe(tabs.element)
    expect(tabs.findAll('button').map((button) => button.attributes('aria-label'))).toEqual(['Time course', 'Protocol', 'Sweep'])
    expect(wrapper.find('[data-testid="sim-sweep-mode"]').attributes('aria-disabled')).toBe('true')
    wrapper.unmount()
  })

  it('plays when a mode is switched to', async () => {
    const settingsStore = useSimulationSettingsStore()
    settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, sweep: SWEEP })
    const wrapper = mountToolbar()
    await wrapper.find('[data-testid="sim-sweep-mode"]').trigger('click')
    expect(useSimulationResultsStore().isSweepMode).toBe(true)
    expect(wrapper.emitted('play')).toHaveLength(1)
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

  it('has no simulation page button: the global nav has the page', () => {
    const wrapper = mountToolbar()
    expect(labelsOf(wrapper)).not.toContain('Open the simulation page')
    expect(wrapper.find('.pi-external-link').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers neither floating nor the settings on the simulation page', () => {
    const wrapper = mountToolbar({ hasFloat: false, hasSettings: false })
    expect(labelsOf(wrapper)).not.toContain('Float the results over the canvas')
    expect(labelsOf(wrapper)).not.toContain('Simulation settings')
    expect(labelsOf(wrapper)).toContain('Track this run')
    expect(labelsOf(wrapper)).toContain('Edit protocol')
    wrapper.unmount()
  })

  it('names the scope in the switch’s tooltip alone', () => {
    const wrapper = mountToolbar({ partLabel: 'This instance', partName: 'this instance' })
    expect(wrapper.find('.toolbar-scope').text()).toBe('')
    expect(wrapper.find('.toolbar-scope').attributes('data-tooltip')).toBe('Whole model')
    wrapper.unmount()
  })

  it('shows a runner on play', () => {
    const wrapper = mountToolbar()
    expect(wrapper.find('.toolbar-run .toolbar-run-icon').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('SimulationToolbar overflow menu', () => {
  // happy-dom lays nothing out, so the row is given one: each control it shows is 30px wide.
  let rowWidth
  beforeEach(() => {
    setActivePinia(createPinia())
    rowWidth = 1000
    const shown = (row) => [...row.children].filter((child) => child.style.display !== 'none' && child.tagName !== 'TEMPLATE')
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
      return this.classList.contains('toolbar-row') ? shown(this).length * 30 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
      return this.classList.contains('toolbar-row') ? rowWidth : 0
    })
  })
  afterEach(() => vi.restoreAllMocks())

  const shownLabels = (wrapper) =>
    wrapper.findAll('.toolbar-row > *').filter((el) => el.element.style.display !== 'none').map((el) => el.attributes('aria-label') ?? el.classes()[0])
  const menuLabels = (wrapper) => wrapper.vm.$.setupState.moreItems.map((item) => item.label)

  it('has no menu while everything fits', async () => {
    const wrapper = mountToolbar()
    await flushPromises()
    expect(wrapper.find('button[aria-label="More simulation actions"]').exists()).toBe(false)
    expect(menuLabels(wrapper)).toEqual([])
    wrapper.unmount()
  })

  it('moves as few buttons as fit into the menu, the least used first, never the run modes', async () => {
    // Shown, the run, the switch, the modes, the spacer, track, float, the protocol and settings: eight, or 240px.
    rowWidth = 190
    const wrapper = mountToolbar({ isRunning: true })
    await flushPromises()

    // Three hidden, and the more button shown, makes six, or 180px; two hidden would make 210px.
    expect(menuLabels(wrapper)).toEqual(['Float over the canvas', 'Edit protocol', 'Simulation settings'])
    expect(wrapper.vm.$.setupState.moreItems.map((item) => !!item.disabled)).toEqual([false, true, true])
    expect(shownLabels(wrapper)).toEqual(['toolbar-run-wrap', 'toolbar-scope', 'What play runs', 'toolbar-spacer', 'toolbar-track', 'More simulation actions'])
    wrapper.unmount()
  })
})

describe('SimulationToolbar slots', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('puts a view’s own actions after the spacer, and its end ones last', () => {
    const wrapper = mount(SimulationToolbar, {
      global: { plugins: [PrimeVue], directives: { tooltip, hint: tooltip } },
      slots: { default: '<span class="own-action">Mine</span>', end: '<span class="own-end">End</span>' },
    })
    expect(wrapper.find('.toolbar-spacer').element.nextElementSibling.classList.contains('own-action')).toBe(true)
    expect(wrapper.find('.toolbar-row').element.lastElementChild.classList.contains('own-end')).toBe(true)
    wrapper.unmount()
  })
})
