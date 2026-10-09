// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ThemeColourButton from '../../../src/components/ThemeColourButton.vue'

let wrapper

function mountButton(props = {}) {
  wrapper = mount(ThemeColourButton, {
    props: {
      modelValue: '#ffe2ec',
      textColour: '#334155',
      'onUpdate:modelValue': (value) => wrapper.setProps({ modelValue: value }),
      ...props,
    },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    attachTo: document.body,
  })
  return wrapper
}

async function open() {
  await wrapper.find('button.colour-chip').trigger('click')
  await flushPromises()
}

const popoverButton = (label) => [...document.body.querySelectorAll('.colour-popover button')].find((b) => b.textContent.trim() === label)

describe('ThemeColourButton', () => {
  afterEach(() => wrapper?.unmount())

  it('updates live, and Apply keeps the new colour', async () => {
    mountButton()
    await open()
    document.body.querySelector('.colour-popover button.preset[aria-label="#dbeafe"]').click()
    await flushPromises()
    expect(wrapper.props('modelValue')).toBe('#dbeafe')

    popoverButton('Apply').click()
    await flushPromises()
    expect(wrapper.props('modelValue')).toBe('#dbeafe')
  })

  it('puts the original colour back on Cancel', async () => {
    mountButton()
    await open()
    document.body.querySelector('.colour-popover button.preset[aria-label="#dbeafe"]').click()
    await flushPromises()

    popoverButton('Cancel').click()
    await flushPromises()
    expect(wrapper.props('modelValue')).toBe('#ffe2ec')
  })

  it('shows the automatic colour when no value is set', () => {
    mountButton({ modelValue: undefined, autoColour: '#2c3a4d' })
    expect(wrapper.find('button.colour-chip').classes()).toContain('colour-chip--auto')
    expect(wrapper.find('button.colour-chip').attributes('aria-label')).toContain('automatic')
  })
})
