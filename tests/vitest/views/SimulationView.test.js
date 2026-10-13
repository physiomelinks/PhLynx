// @vitest-environment happy-dom
import { computed, defineComponent, h, KeepAlive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const charts = ref([])
const predictionPlotCharts = ref([])
vi.mock('../../../src/composables/useSimulationCharts', () => ({
  useSimulationCharts: () => ({
    xAxis: computed(() => ({ label: 't', unit: 'second', values: new Float64Array([0, 1]), isSteadyState: false })),
    charts,
    predictionPlotCharts,
  }),
}))
const run = vi.hoisted(() => vi.fn())
vi.mock('../../../src/composables/useSimulation', async () => {
  const { ref } = await import('vue')
  return { useSimulation: () => ({ run, stop: vi.fn(), keepCurrent: vi.fn(), isStale: ref(false) }) }
})
vi.mock('../../../src/composables/useSedmlExport', async () => {
  const { ref } = await import('vue')
  return { useSedmlExport: () => ({ isProtocol: ref(false), reason: ref(null), canExport: ref(false), isExporting: ref(false), exportZip: vi.fn() }) }
})
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({ libopencor: { status: 'ready' } }))
const legacyDownload = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/save', () => ({ legacyDownload }))

const SimulationView = (await import('../../../src/views/SimulationView.vue')).default

// Keeps each tooltip's text on its element.
const tooltip = {
  mounted: (el, binding) => (el.dataset.tooltip = binding.value?.value ?? binding.value),
  updated: (el, binding) => (el.dataset.tooltip = binding.value?.value ?? binding.value),
}
const PlotStub = defineComponent({
  name: 'SimulationPlot',
  props: ['zoomKey', 'syncKey', 'title', 'height'],
  setup: (props) => () => h('div', { class: 'plot-stub' }, props.title),
})

/**
 * Mounts the page on /simulation, with a router whose other routes render nothing.
 *
 * @param {{isKeptAlive?: boolean}} [options] - Whether to keep it alive, as the app does.
 * @returns {Promise<{wrapper: import('@vue/test-utils').VueWrapper, router: import('vue-router').Router}>}
 */
async function mountPage({ isKeptAlive = false } = {}) {
  const Empty = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'workspace', component: Empty },
      { path: '/simulation', name: 'simulation', component: Empty },
    ],
  })
  await router.push('/simulation')
  const page = isKeptAlive ? defineComponent({ setup: () => () => h(KeepAlive, null, () => h(SimulationView)) }) : SimulationView
  const wrapper = mount(page, {
    attachTo: document.body,
    global: {
      plugins: [PrimeVue, router],
      directives: { tooltip },
      stubs: { SimulationPlot: PlotStub, FeaturePlot: true, SimulationControls: { template: '<div class="controls-stub" />' } },
    },
  })
  return { wrapper, router }
}

describe('SimulationView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    charts.value = []
    predictionPlotCharts.value = []
    legacyDownload.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('has the toolbar, without the float button or the scope switch, and the controls beside', async () => {
    const { wrapper } = await mountPage()
    const labels = wrapper.findAll('button').map((button) => button.attributes('aria-label'))
    expect(labels).toContain('Simulate the whole model')
    expect(labels).toContain('Track this run')
    expect(labels).toContain('Simulation settings')
    expect(labels).not.toContain('Float the results over the canvas')
    // With no canvas to select from, it runs the whole model, with no switch to the selection.
    expect(wrapper.find('.toolbar-scope').exists()).toBe(false)
    expect(wrapper.find('.controls-stub').exists()).toBe(true)
    wrapper.unmount()
  })

  it('prompts to run before there are results, with nothing to download', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.find('.page-empty').text()).toContain('No results yet')
    expect(wrapper.find('button[aria-label="Download the results as CSV"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('button[aria-label="Download the charts as a PNG image"]').attributes('disabled')).toBeDefined()
    // Without a protocol, the SED-ML download is there, for the time course.
    const sedml = wrapper.find('button[aria-label="Download the run as SED-ML"]')
    expect(sedml.attributes('disabled')).toBeDefined()
    expect(sedml.element.parentElement.dataset.tooltip).toBe('Download the run as SED-ML, with the model it runs and its plots')
    wrapper.unmount()
  })

  it('shows each chart with the page’s own zoom and cursor keys, and downloads them as CSV', async () => {
    charts.value = [
      { key: 'p1', title: 'Voltage', unit: 'mV', series: [{ label: 'v', values: [1, 2] }] },
      { key: 'p2', title: 'Current', unit: 'nA', series: [{ label: 'i', values: [3, 4] }] },
    ]
    const { wrapper } = await mountPage()
    const plots = wrapper.findAllComponents(PlotStub)
    expect(plots.map((plot) => plot.props('zoomKey'))).toEqual(['page:p1', 'page:p2'])
    expect(plots.every((plot) => plot.props('syncKey') === 'simulation-page')).toBe(true)
    expect(wrapper.find('.page-empty').exists()).toBe(false)

    await wrapper.find('button[aria-label="Download the results as CSV"]').trigger('click')
    expect(legacyDownload).toHaveBeenCalledWith('simulation-results.csv', expect.any(Blob))
    wrapper.unmount()
  })

  it('focuses its heading on arrival', async () => {
    const { wrapper } = await mountPage({ isKeptAlive: true })
    expect(document.activeElement).toBe(wrapper.find('h1.page-title').element)
    wrapper.unmount()
  })

  it('sizes the charts to fill the pane, less the gaps and the prediction plots’ heading', async () => {
    // Reports the charts' pane as 800px tall.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback) {
          this.callback = callback
        }
        observe() {
          this.callback([{ contentRect: { height: 800 } }])
        }
        disconnect() {}
      }
    )
    charts.value = [{ key: 'p1', title: 'Voltage', unit: 'mV', series: [] }]
    const { wrapper } = await mountPage()
    const heightOf = () => wrapper.findComponent(PlotStub).props('height')
    expect(heightOf()).toBe(800 - 64)

    charts.value = [...charts.value, { key: 'p2', title: 'Current', unit: 'nA', series: [] }]
    await wrapper.vm.$nextTick()
    expect(heightOf()).toBe((800 - 16) / 2 - 64)

    charts.value = charts.value.slice(0, 1)
    predictionPlotCharts.value = [{ key: 'f1', title: 'Peak', series: [] }]
    await wrapper.vm.$nextTick()
    expect(heightOf()).toBe((800 - 16 - 34 - 16) / 2 - 64)
    wrapper.unmount()
  })

  it('goes back to the workspace', async () => {
    const { wrapper, router } = await mountPage()
    await wrapper.find('button[aria-label="Back to the workspace"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    wrapper.unmount()
  })

  it('hides and shows the controls', async () => {
    const { wrapper } = await mountPage()
    const toggle = wrapper.find('.aside-collapse-toggle')
    await toggle.trigger('click')
    expect(wrapper.find('.controls-stub').exists()).toBe(false)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(wrapper.find('.controls-stub').exists()).toBe(true)
    wrapper.unmount()
  })
})
