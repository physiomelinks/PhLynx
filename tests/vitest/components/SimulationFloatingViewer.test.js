// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
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
      directives: { tooltip: {}, hint: {} },
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

describe('SimulationFloatingViewer header overflow menu', () => {
  const { state } = useFloatingViewer()
  // happy-dom lays nothing out, so the header is given one: each control it shows is 30px wide.
  let headWidth
  const shown = (head) => [...head.children].filter((child) => child.style.display !== 'none')
  beforeEach(() => {
    setActivePinia(createPinia())
    state.visible = true
    headWidth = 1000
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
      return this.classList.contains('viewer-head') ? shown(this).length * 30 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
      return this.classList.contains('viewer-head') ? headWidth : 0
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    state.visible = false
    document.body.innerHTML = ''
  })

  const menuLabels = (wrapper) => wrapper.vm.$.setupState.moreItems.map((item) => item.label)
  const moreButton = () => document.querySelector('button[aria-label="More viewer actions"]')

  it('has no menu while everything fits', async () => {
    const wrapper = mountViewer(true)
    await flushPromises()
    expect(moreButton()).toBeNull()
    expect(menuLabels(wrapper)).toEqual([])
    wrapper.unmount()
  })

  it('moves as few buttons as fit into the menu, the least used first, keeping play and the switch', async () => {
    // Shown, the grip, the picker, the pencil, the spacer, the switch, play, sliders, track and back to the tab: nine,
    // or 270px. Three hidden, and the more button shown, makes seven, or 210px; two hidden would make 240px.
    headWidth = 210
    const wrapper = mountViewer(true)
    await flushPromises()

    expect(menuLabels(wrapper)).toEqual(['Show the sliders', expect.stringMatching(/^Track this run/), 'Back to the Simulation tab'])
    expect(moreButton()).not.toBeNull()
    const head = document.querySelector('.viewer-head')
    expect(head.querySelector('.viewer-scope')).not.toBeNull()
    expect(head.querySelector('button[aria-label="Simulate the whole model"]').style.display).not.toBe('none')

    wrapper.vm.$.setupState.moreItems[0].command()
    expect(wrapper.vm.$.setupState.showSliders).toBe(true)
    wrapper.vm.$.setupState.moreItems[2].command()
    expect(state.visible).toBe(false)
    wrapper.unmount()
  })
})
