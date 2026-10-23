// @vitest-environment happy-dom
import { computed, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => vi.fn(async () => {}))
const isStale = vi.hoisted(() => ({ value: false }))
const nodes = ref([{ id: 'a', data: { name: 'A', variables: [] } }])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes, getSelectedNodes: computed(() => []) }),
}))
vi.mock('../../../../src/composables/useSimulation', async () => {
  const { computed } = await import('vue')
  return { useSimulation: () => ({ run, stop: vi.fn(), keepCurrent: vi.fn(), isStale: computed(() => isStale.value) }) }
})
vi.mock('../../../../src/services/simulation/libopencorLoader', async () => {
  const { reactive } = await import('vue')
  return { libopencor: reactive({ status: 'ready', reason: null }), whenLibOpenCORReady: vi.fn() }
})
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../../../../src/composables/useSimulationCharts', async () => {
  const { computed } = await import('vue')
  return { useSimulationCharts: () => ({ xAxis: computed(() => ({})), charts: computed(() => []), predictionPlotCharts: computed(() => []) }) }
})
vi.mock('../../../../src/composables/useSliderReruns', () => ({ useSliderReruns: () => ({ rerunForSliders: vi.fn() }) }))

const { default: SimulationPanel } = await import('../../../../src/components/simulation/SimulationPanel.vue')
const { libopencor } = await import('../../../../src/services/simulation/libopencorLoader')
const { useSimulationResultsStore } = await import('../../../../src/stores/simulationResultsStore')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
}

const RESULTS = { voi: { name: 'm/t', unit: 'second', values: new Float64Array([0, 1]) }, variables: new Map(), isStopped: false }

/**
 * Mounts the instance editor's panel for instance a.
 *
 * @returns {import('@vue/test-utils').VueWrapper}
 */
const mountPanel = () =>
  mount(SimulationPanel, {
    props: { instanceId: 'a', plotConfig: { groups: [], groupedSelections: [], selections: [] } },
    global: {
      stubs: {
        SimulationToolbar: true,
        SimulationStatusLine: true,
        ProtocolResultsControls: true,
        SimulationControls: true,
        ProgressBar: true,
        SimulationPlot: true,
        FeaturePlot: true,
      },
    },
  })

describe('SimulationPanel ensureResults', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSimulationResultsStore()
    run.mockClear()
    libopencor.status = 'ready'
    isStale.value = false
  })

  it('plays while the simulator is still loading, as the run waits for it', () => {
    libopencor.status = 'loading'
    mountPanel().vm.ensureResults()
    expect(run).toHaveBeenCalledWith(null)
  })

  it('plays while another scope runs, for the results of its own', () => {
    const wrapper = mountPanel()
    store.startRun(['other'])
    wrapper.vm.ensureResults()
    expect(run).toHaveBeenCalledWith(null)
  })

  it('does not play while its own scope runs', () => {
    const wrapper = mountPanel()
    store.startRun(null)
    wrapper.vm.ensureResults()
    expect(run).not.toHaveBeenCalled()
  })

  it('does not play when current results are shown', () => {
    const wrapper = mountPanel()
    store.startRun(null)
    store.finishRun({ results: RESULTS, mapping: new Map(), signature: 's' })
    wrapper.vm.ensureResults()
    expect(run).not.toHaveBeenCalled()
  })

  it('plays again after a failed run, though it kept partial results', () => {
    const wrapper = mountPanel()
    store.startRun(null)
    store.failRun('error', { message: 'boom', issues: [] }, { results: RESULTS, mapping: new Map() })
    wrapper.vm.ensureResults()
    expect(run).toHaveBeenCalledWith(null)
  })

  it('does not play when the simulator is missing', () => {
    libopencor.status = 'error'
    libopencor.reason = 'No WebAssembly'
    mountPanel().vm.ensureResults()
    expect(run).not.toHaveBeenCalled()
    libopencor.reason = null
  })
})
