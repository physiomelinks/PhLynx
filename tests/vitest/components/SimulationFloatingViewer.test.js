// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/composables/useSimulation', async () => {
  const { ref } = await import('vue')
  return { useSimulation: () => ({ run: vi.fn(), stop: vi.fn(), keepCurrent: vi.fn(), isStale: ref(false) }) }
})
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({ libopencor: { status: 'ready' } }))

const SimulationFloatingViewer = (await import('../../../src/components/simulation/SimulationFloatingViewer.vue')).default
const { useFloatingViewer } = await import('../../../src/composables/useFloatingViewer.js')

/**
 * Mounts the viewer, shown, over the canvas or not.
 *
 * @param {boolean} isCanvasShown
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountViewer(isCanvasShown) {
  return mount(SimulationFloatingViewer, {
    props: { isCanvasShown },
    attachTo: document.body,
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { SimulationPlot: true, FeaturePlot: true, SliderList: true, VariablePathPicker: true },
    },
  })
}

/**
 * Finds the viewer's window, which the Dialog renders in the document's body.
 *
 * @returns {HTMLElement|null}
 */
const findViewer = () => document.querySelector('.simulation-floating-viewer')

describe('SimulationFloatingViewer', () => {
  const { state } = useFloatingViewer()

  beforeEach(() => {
    setActivePinia(createPinia())
    state.visible = true
  })
  afterEach(() => {
    state.visible = false
    document.body.innerHTML = ''
  })

  it('hides while the canvas is away, keeping its window, and shows again on return', async () => {
    const wrapper = mountViewer(true)
    await wrapper.vm.$nextTick()
    const viewer = findViewer()
    expect(viewer).not.toBeNull()
    expect(viewer.classList.contains('simulation-floating-viewer--parked')).toBe(false)
    viewer.style.left = '120px'

    await wrapper.setProps({ isCanvasShown: false })
    expect(findViewer()).toBe(viewer)
    expect(viewer.classList.contains('simulation-floating-viewer--parked')).toBe(true)
    expect(state.visible).toBe(true)

    await wrapper.setProps({ isCanvasShown: true })
    expect(findViewer()).toBe(viewer)
    expect(viewer.classList.contains('simulation-floating-viewer--parked')).toBe(false)
    expect(viewer.style.left).toBe('120px')
    wrapper.unmount()
  })
})
