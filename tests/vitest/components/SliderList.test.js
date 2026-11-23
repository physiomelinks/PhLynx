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

  it('turns off the slider of the parameter the sweep sets, in sweep mode', async () => {
    const settingsStore = useSimulationSettingsStore()
    settingsStore.setSimulationSettings({
      ...settingsStore.simulationSettings,
      sweep: { key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', from: 0, to: 2, points: 3 },
    })
    mountList()
    expect(wrapper.find('.slider-swept').exists()).toBe(false)

    useSimulationResultsStore().isSweepMode = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.slider-swept').text()).toBe('swept')
    expect(wrapper.find('.p-slider').classes()).toContain('p-disabled')
    await wrapper.find('.p-slider-handle').trigger('keydown', { code: 'ArrowRight' })
    await nextFrame()
    expect(useSimulationResultsStore().sliderValues.has('a::k')).toBe(false)
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('turns off the slider of the parameter the sweep’s curves vary', async () => {
    const settingsStore = useSimulationSettingsStore()
    settingsStore.setSimulationSettings({
      ...settingsStore.simulationSettings,
      sweep: {
        key: 'a::q', nodeId: 'a', nodeName: 'a', parameterName: 'q', type: 'constant', from: 0, to: 2, points: 3,
        family: { key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', values: [1, 2] },
      },
    })
    useSimulationResultsStore().isSweepMode = true
    mountList()
    expect(wrapper.find('.slider-swept').text()).toBe('swept')
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

describe('SliderList sweep button', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useProtocolStore().areSlidersOff = false
    vi.clearAllMocks()
  })

  const sweepButton = () => wrapper.find('[data-testid="slider-sweep-k"]')

  it('sweeps the parameter across the slider’s range, turning sweep mode on', async () => {
    mountList()
    expect(sweepButton().attributes('aria-pressed')).toBe('false')
    await sweepButton().trigger('click')
    const sweep = useSimulationSettingsStore().simulationSettings.sweep
    expect([sweep.key, sweep.from, sweep.to]).toEqual(['a::k', 0, 2])
    expect(useSimulationResultsStore().isSweepMode).toBe(true)
    expect(sweepButton().attributes('aria-pressed')).toBe('true')
  })

  it('draws a curve for each of the range’s ends and middle of another slider’s parameter', async () => {
    const twoNodes = [
      ...nodes,
      { id: 'b', data: { name: 'b', variables: [{ name: 'g', type: 'constant', value: '4', units: 'second' }] } },
    ]
    const settingsStore = useSimulationSettingsStore()
    settingsStore.setParameterScanConfig({
      selections: [
        { key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', min: 0, default: 1, max: 2 },
        { key: 'b::g', nodeId: 'b', nodeName: 'b', parameterName: 'g', type: 'constant', min: 2, default: 4, max: 6 },
      ],
    })
    wrapper = mount(SliderList, { props: { nodes: reactive(twoNodes) }, global: { plugins: [PrimeVue] } })
    await wrapper.find('[data-testid="slider-sweep-k"]').trigger('click')

    await wrapper.find('[data-testid="slider-sweep-g"]').trigger('click')
    const items = wrapper.vm.$.setupState.sweepMenuItems
    expect(items.map(({ label }) => label)).toEqual(['A curve for each value of g', 'Sweep g instead'])
    items[0].command()
    await wrapper.vm.$nextTick()

    const sweep = settingsStore.simulationSettings.sweep
    expect(sweep.key).toBe('a::k')
    expect([sweep.family.key, sweep.family.values]).toEqual(['b::g', [2, 4, 6]])
    expect(wrapper.find('.slider-sweep-count').text()).toBe('×3')
  })

  it('stops sweeping from the swept slider’s button', async () => {
    mountList()
    await wrapper.setProps({ hasSweepView: true })
    await sweepButton().trigger('click')
    await sweepButton().trigger('click')
    const items = wrapper.vm.$.setupState.sweepMenuItems
    expect(items.map(({ label }) => label)).toEqual(['Edit in the Sweep tab', 'Stop sweeping'])
    items[0].command()
    expect(wrapper.emitted('edit-sweep')).toHaveLength(1)
    items[1].command()
    expect(useSimulationSettingsStore().simulationSettings.sweep).toBeNull()
  })
})
