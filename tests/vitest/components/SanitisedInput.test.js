// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import SanitisedInput from '../../../src/components/SanitisedInput.vue'

let wrapper
afterEach(() => wrapper?.unmount())

describe('SanitisedInput', () => {
  it('puts the id and autofocus on the input, so a label and a dialog can find it', () => {
    wrapper = mount(SanitisedInput, {
      props: { modelValue: 'name', inputId: 'module-name', autofocus: true },
      global: { plugins: [PrimeVue] },
    })
    const input = wrapper.find('input')
    expect(input.attributes('id')).toBe('module-name')
    expect(input.attributes()).toHaveProperty('autofocus')
  })

  it('exposes updatePosition for callers that move the field', () => {
    wrapper = mount(SanitisedInput, { props: { modelValue: 'x', floating: true }, global: { plugins: [PrimeVue] } })
    expect(typeof wrapper.vm.updatePosition).toBe('function')
  })

  it('lists suggestions as the user types and fills the field on a click', async () => {
    wrapper = mount(SanitisedInput, {
      props: { modelValue: '', suggest: (typed) => ['millivolt', 'millisecond'].filter((n) => typed && n.startsWith(typed)) },
      global: { plugins: [PrimeVue] },
    })
    await wrapper.find('input').setValue('mil')
    await wrapper.setProps({ modelValue: 'mil' })

    const options = wrapper.findAll('[role="option"]')
    expect(options.map((option) => option.text())).toEqual(['millivolt', 'millisecond'])

    await options[1].trigger('click')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['millisecond'])
    expect(wrapper.emitted('commit').at(-1)).toEqual(['millisecond'])
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('shows no list without a suggest function', async () => {
    wrapper = mount(SanitisedInput, { props: { modelValue: '' }, global: { plugins: [PrimeVue] } })
    await wrapper.find('input').setValue('mil')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(wrapper.find('input').attributes('role')).toBeUndefined()
  })

  it('shows each suggestion\'s detail beside it, in two columns', async () => {
    wrapper = mount(SanitisedInput, {
      props: { modelValue: '', suggest: () => [{ value: 'mV', detail: '10⁻³ kg·m²·s⁻³·A⁻¹' }, 'mmHg'] },
      global: { plugins: [PrimeVue] },
    })
    await wrapper.find('input').setValue('m')

    const detail = wrapper.find('.sanitised-input__option-detail')
    expect(detail.text()).toBe('10⁻³ kg·m²·s⁻³·A⁻¹')
    expect(detail.attributes('title')).toBe('10⁻³ kg·m²·s⁻³·A⁻¹')
    expect(wrapper.find('.sanitised-input__suggestions--detailed').exists()).toBe(true)

    await wrapper.findAll('[role="option"]')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['mV'])
  })

  it('keeps a single column when no suggestion has a detail', async () => {
    wrapper = mount(SanitisedInput, { props: { modelValue: '', suggest: () => ['mV'] }, global: { plugins: [PrimeVue] } })
    await wrapper.find('input').setValue('m')
    expect(wrapper.find('[role="option"]').exists()).toBe(true)
    expect(wrapper.find('.sanitised-input__suggestions--detailed').exists()).toBe(false)
    expect(wrapper.find('.sanitised-input__option-detail').exists()).toBe(false)
  })
})
