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

  it('shows the rename popover only while the field has focus', async () => {
    wrapper = mount(SanitisedInput, {
      props: { modelValue: 'mV/ms', sanitise: (value) => value.replace(/\W/g, '_') },
      global: { plugins: [PrimeVue] },
    })
    const popover = () => wrapper.find('[role="alert"]')
    expect(popover().exists()).toBe(false)

    await wrapper.find('input').trigger('focus')
    expect(popover().text()).toContain('Will be renamed to mV_ms')
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

  it('lists suggestions for text that is not a name yet, warning of the rename instead of the popover', async () => {
    const created = []
    const suggest = () => [{ value: 'mV_per_ms', detail: 'new', onPick: () => created.push('mV_per_ms') }]
    wrapper = mount(SanitisedInput, {
      props: { modelValue: '', sanitise: (value) => value.replace(/[^A-Za-z0-9_]/g, ''), suggest },
      global: { plugins: [PrimeVue] },
    })
    await wrapper.find('input').setValue('mV/ms')
    await wrapper.setProps({ modelValue: 'mV/ms' })

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.sanitised-input__rename').text()).toContain('mVms')

    await wrapper.find('[role="option"]').trigger('click')
    expect(created).toEqual(['mV_per_ms'])
    expect(wrapper.emitted('commit').at(-1)).toEqual(['mV_per_ms'])
  })

  for (const keyName of ['Tab', 'Enter']) {
    it(`commits the highlighted suggestion on ${keyName}`, async () => {
      wrapper = mount(SanitisedInput, {
        props: { modelValue: '', suggest: (typed) => ['millivolt', 'millisecond'].filter((n) => typed && n.startsWith(typed)) },
        global: { plugins: [PrimeVue] },
      })
      const input = wrapper.find('input')
      await input.setValue('mil')
      await wrapper.setProps({ modelValue: 'mil' })

      await input.trigger('keydown', { key: keyName })
      expect(wrapper.emitted('commit').at(-1)).toEqual(['millivolt'])
      expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    })
  }

  it('keeps the text as typed on Enter after Escape closes the list', async () => {
    wrapper = mount(SanitisedInput, {
      props: { modelValue: '', suggest: (typed) => ['millivolt'].filter((n) => typed && n.startsWith(typed)) },
      global: { plugins: [PrimeVue] },
    })
    const input = wrapper.find('input')
    await input.setValue('mil')
    await wrapper.setProps({ modelValue: 'mil' })

    await input.trigger('keydown', { key: 'Escape' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('commit').at(-1)).toEqual(['mil'])
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
