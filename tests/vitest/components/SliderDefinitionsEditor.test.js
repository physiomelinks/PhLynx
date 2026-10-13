// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import SliderDefinitionsEditor from '../../../src/components/simulation/SliderDefinitionsEditor.vue'
import VariablePathPicker from '../../../src/components/simulation/VariablePathPicker.vue'

const nodes = [{ id: 'n1', data: { name: 'channel', variables: [{ name: 'g', type: 'constant', units: 'siemens', value: '2' }] } }]

let wrapper
afterEach(() => wrapper?.unmount())

const addButton = () => wrapper.findAll('button').find((button) => button.text() === 'Add slider')

describe('SliderDefinitionsEditor', () => {
  it('adds a slider from the Add slider button, then tucks the search away', async () => {
    wrapper = mount(SliderDefinitionsEditor, {
      props: {
        nodes,
        scanConfig: { selections: [] },
        getGlobalConstant: () => null,
        'onUpdate:scanConfig': (next) => wrapper.setProps({ scanConfig: next }),
      },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    })
    expect(wrapper.findComponent(VariablePathPicker).exists()).toBe(false)

    await addButton().trigger('click')
    const picker = wrapper.findComponent(VariablePathPicker)
    picker.vm.$emit('pick', picker.props('index').find((entry) => entry.path === 'channel/g'))
    await flushPromises()

    expect(wrapper.props('scanConfig').selections).toHaveLength(1)
    expect(wrapper.findComponent(VariablePathPicker).exists()).toBe(false)
    expect(addButton()).toBeDefined()
  })
})
