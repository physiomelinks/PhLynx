// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/composables/useSimulation', async () => {
  const { ref } = await import('vue')
  return { useSimulation: () => ({ run: vi.fn(), stop: vi.fn(), keepCurrent: vi.fn(), isStale: ref(false) }) }
})
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({ libopencor: { status: 'ready' } }))

const SimulationPanel = (await import('../../../src/components/simulation/SimulationPanel.vue')).default
const { useViewModeStore } = await import('../../../src/stores/viewModeStore.js')

const PAGE_BUTTON = 'button[aria-label="Open the simulation page"]'

/**
 * Builds a router on the workspace, with the simulation page beside it.
 *
 * @returns {Promise<import('vue-router').Router>}
 */
async function buildRouter() {
  const Empty = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'workspace', component: Empty },
      { path: '/simulation', name: 'simulation', component: Empty },
    ],
  })
  await router.push('/')
  return router
}

/**
 * Mounts a component with the panel's plugins, its plots and controls stubbed.
 *
 * @param {Object} component
 * @param {{props?: Object, router: import('vue-router').Router}} options
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountWith(component, { props = {}, router }) {
  return mount(component, {
    props,
    attachTo: document.body,
    global: {
      plugins: [PrimeVue, router],
      directives: { tooltip: {}, hint: {} },
      stubs: { SimulationPlot: true, FeaturePlot: true, SimulationControls: true },
    },
  })
}

describe('SimulationPanel', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => (document.body.innerHTML = ''))

  it('offers no simulation page button, in the sidebar or the instance editor', async () => {
    const router = await buildRouter()
    for (const props of [{}, { instanceId: 'a' }]) {
      const wrapper = mountWith(SimulationPanel, { props, router })
      expect(wrapper.find(PAGE_BUTTON).exists()).toBe(false)
      wrapper.unmount()
    }
  })

  it('names the scope only in its switch’s tooltip, in the sidebar and the instance editor', async () => {
    const router = await buildRouter()
    for (const props of [{}, { instanceId: 'a' }]) {
      const wrapper = mountWith(SimulationPanel, { props, router })
      expect(wrapper.find('.toolbar-scope').text()).toBe('')
      wrapper.unmount()
    }
  })

  it('shows the selection plot only in the physiological view, and never in the instance editor', async () => {
    const router = await buildRouter()
    const wrapper = mountWith(SimulationPanel, { router })
    expect(wrapper.find('#panel-selection-plot-title').exists()).toBe(false)

    useViewModeStore().mode = 'bio'
    await nextTick()
    expect(wrapper.find('#panel-selection-plot-title').exists()).toBe(true)
    expect(wrapper.find('[data-testid="auto-plot-selection"]').exists()).toBe(true)
    expect(wrapper.find('.panel-selection-hint').text()).toMatch(/^Select a protein/)
    wrapper.unmount()

    const editor = mountWith(SimulationPanel, { props: { instanceId: 'a' }, router })
    expect(editor.find('#panel-selection-plot-title').exists()).toBe(false)
    editor.unmount()
  })

  it('hides the workspace’s plots while the physiological view plots its selection', async () => {
    const router = await buildRouter()
    const wrapper = mountWith(SimulationPanel, { router })
    expect(wrapper.find('.panel-empty').exists()).toBe(true)

    useViewModeStore().mode = 'bio'
    await nextTick()
    expect(wrapper.find('.panel-empty').exists()).toBe(false)

    await wrapper.find('[data-testid="auto-plot-selection"] input').setValue(false)
    await nextTick()
    expect(wrapper.find('.panel-empty').exists()).toBe(true)

    useViewModeStore().mode = 'diagram'
    await nextTick()
    expect(wrapper.find('.panel-empty').exists()).toBe(true)
    wrapper.unmount()
  })
})
