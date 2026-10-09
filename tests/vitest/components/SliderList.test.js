// @vitest-environment happy-dom
import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const history = vi.hoisted(() => ({ updateNodeData: vi.fn(), recordEdit: vi.fn((edit) => edit.apply()) }))
vi.mock('@vue-flow/core', async (importOriginal) => ({ ...(await importOriginal()), useVueFlow: () => ({ updateNodeData: history.updateNodeData }) }))
vi.mock('../../../src/composables/useNodeDataHistory', () => ({ useNodeDataHistory: () => ({ recordEdit: history.recordEdit }) }))
vi.mock('../../../src/stores/protocolStore', async () => {
  const { reactive: makeReactive } = await import('vue')
  const protocolStore = makeReactive({ areSlidersOff: false })
  return { useProtocolStore: () => protocolStore }
})

const { default: SliderList } = await import('../../../src/components/simulation/SliderList.vue')
const { useProtocolStore } = await import('../../../src/stores/protocolStore.js')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')

const NOTE = 'Sliders are off while the protocol runs. Switch to the time course to use them.'
const nodes = [{ id: 'a', data: { name: 'a', variables: [{ name: 'k', type: 'constant', value: '1', units: 'second' }] } }]

let wrapper
afterEach(() => wrapper?.unmount())

/** Mounts the list with one slider on `a/k`, from 0 to 2. */
function mountList() {
  useSimulationSettingsStore().setParameterScanConfig({
    selections: [{ key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', min: 0, default: 1, max: 2 }],
  })
  wrapper = mount(SliderList, { props: { nodes: reactive(nodes) }, global: { plugins: [PrimeVue] } })
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

describe('SliderList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useProtocolStore().areSlidersOff = false
    vi.clearAllMocks()
  })

  it('moves a slider by keys and asks for a run', async () => {
    mountList()
    const handle = wrapper.find('.p-slider-handle')
    expect(handle.attributes('tabindex')).toBe('0')
    expect(wrapper.text()).not.toContain(NOTE)

    await handle.trigger('keydown', { code: 'ArrowRight' })
    await nextFrame()
    expect(useSimulationResultsStore().sliderValues.get('a::k')).toBeCloseTo(1.002)
    expect(wrapper.emitted('change')).toHaveLength(1)
  })

  it('turns the sliders off while the protocol runs, and says why, keeping their values', async () => {
    useSimulationResultsStore().setSliderValue('a::k', 1.5)
    useProtocolStore().areSlidersOff = true
    mountList()
    const handle = wrapper.find('.p-slider-handle')
    expect(wrapper.find('.p-slider').classes()).toContain('p-disabled')
    expect(handle.attributes('tabindex')).toBe('-1')
    expect(handle.attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('[role="note"]').text()).toBe(NOTE)

    // PrimeVue's handle still takes keys when disabled.
    await handle.trigger('keydown', { code: 'ArrowRight' })
    await nextFrame()
    expect(useSimulationResultsStore().sliderValues.get('a::k')).toBe(1.5)
    expect(wrapper.emitted('change')).toBeUndefined()

    useProtocolStore().areSlidersOff = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.p-slider').classes()).not.toContain('p-disabled')
    expect(wrapper.text()).not.toContain(NOTE)
  })

  it('turns off the actions that change the model or ask for a run while the protocol runs', async () => {
    useSimulationResultsStore().setSliderValue('a::k', 1.5)
    useProtocolStore().areSlidersOff = true
    mountList()
    expect(wrapper.find('.slider-value').classes()).not.toContain('slider-value--changed')

    await wrapper.find('[aria-label="More for k"]').trigger('click')
    const items = Object.fromEntries(wrapper.vm.menuItems.filter((item) => item.label).map((item) => [item.label, !!item.disabled]))
    expect(items).toMatchObject({ 'Back to the model’s value': true, 'Apply this value to the model': true, 'Edit range…': false, 'Remove slider': false })

    wrapper.vm.applyToModel(wrapper.vm.menuSlider)
    expect(history.recordEdit).not.toHaveBeenCalled()
    expect(history.updateNodeData).not.toHaveBeenCalled()
    expect(useSimulationResultsStore().sliderValues.get('a::k')).toBe(1.5)
    expect(wrapper.emitted('change')).toBeUndefined()

    useProtocolStore().areSlidersOff = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.slider-value').classes()).toContain('slider-value--changed')
  })

  it('doesn’t ask for a waiting run on leaving once the sliders are off', async () => {
    mountList()
    await wrapper.find('.p-slider-handle').trigger('keydown', { code: 'ArrowRight' })
    useProtocolStore().areSlidersOff = true
    const list = wrapper
    wrapper = null
    list.unmount()
    await nextFrame()
    expect(list.emitted('change')).toBeUndefined()
    expect(useSimulationResultsStore().sliderValues.get('a::k')).toBeCloseTo(1.002)
  })
})
