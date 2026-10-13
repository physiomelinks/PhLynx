// @vitest-environment happy-dom
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
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
      directives: { tooltip: {} },
      stubs: { SimulationPlot: true, FeaturePlot: true, SimulationControls: true },
    },
  })
}

describe('SimulationPanel', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => (document.body.innerHTML = ''))

  it('opens the simulation page from the sidebar', async () => {
    const router = await buildRouter()
    const wrapper = mountWith(SimulationPanel, { router })
    await wrapper.find(PAGE_BUTTON).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('simulation')
    wrapper.unmount()
  })

  it('doesn’t offer the simulation page in the instance editor', async () => {
    const router = await buildRouter()
    const wrapper = mountWith(SimulationPanel, { props: { instanceId: 'a' }, router })
    expect(wrapper.find(PAGE_BUTTON).exists()).toBe(false)
    wrapper.unmount()
  })

  it('gives the focus back to the page button on returning from the page', async () => {
    const router = await buildRouter()
    const isPanelShown = ref(true)
    // Kept alive, as the workspace is behind the simulation page.
    const Host = defineComponent({
      setup: () => () => h(KeepAlive, null, () => (isPanelShown.value ? h(SimulationPanel) : h('div', 'page'))),
    })
    const wrapper = mountWith(Host, { router })
    const button = wrapper.find(PAGE_BUTTON).element
    button.focus()
    await wrapper.find(PAGE_BUTTON).trigger('click')
    isPanelShown.value = false
    await nextTick()
    expect(document.activeElement).not.toBe(button)

    isPanelShown.value = true
    await flushPromises()
    expect(document.activeElement).toBe(button)
    wrapper.unmount()
  })
})
