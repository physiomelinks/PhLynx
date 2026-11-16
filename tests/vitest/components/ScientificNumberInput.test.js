// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ScientificNumberInput from '../../../src/components/ScientificNumberInput.vue'

let wrapper
afterEach(() => wrapper?.unmount())

/**
 * Mounts the input with its v-model wired up, so emitted values come back as the prop.
 *
 * @param {Object} props
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountInput(props = {}) {
  wrapper = mount(ScientificNumberInput, {
    props: {
      modelValue: null,
      inputId: 'tol',
      testId: 'tol',
      'onUpdate:modelValue': (value) => wrapper.setProps({ modelValue: value }),
      ...props,
    },
    global: { plugins: [PrimeVue] },
  })
  return wrapper
}

const input = () => wrapper.find('[data-testid="tol"]')
const emitted = () => wrapper.emitted('update:modelValue').map(([value]) => value)

describe('ScientificNumberInput', () => {
  it('shows the value in its shortest form, with the id and test id on the input', () => {
    mountInput({ modelValue: 1e-7 })
    expect(input().element.value).toBe('1e-7')
    expect(input().attributes('id')).toBe('tol')
  })

  it('emits a number typed in scientific notation', async () => {
    mountInput({ modelValue: 1e-7 })
    await input().setValue('1e-20')
    expect(emitted().at(-1)).toBe(1e-20)
  })

  it('keeps the text as typed until the field is left, then writes it in its shortest form', async () => {
    mountInput()
    await input().setValue('0.00000001')
    expect(input().element.value).toBe('0.00000001')
    expect(emitted().at(-1)).toBe(1e-8)
    await input().trigger('blur')
    expect(input().element.value).toBe('1e-8')
  })

  it('emits null while the text is not yet a number, and says what it needs', async () => {
    mountInput({ modelValue: 1e-7 })
    await input().setValue('1e-')
    expect(emitted().at(-1)).toBeNull()
    expect(input().element.value).toBe('1e-')
    expect(input().attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[role="alert"]').text()).toContain('1e-20')

    await input().trigger('blur')
    expect(input().element.value).toBe('1e-')
  })

  it('emits null for a cleared field without flagging it', async () => {
    mountInput({ modelValue: 0.5 })
    await input().setValue('')
    expect(emitted().at(-1)).toBeNull()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('flags a value below its minimum but still emits it', async () => {
    mountInput({ modelValue: 1, min: 0 })
    await input().setValue('-1')
    expect(emitted().at(-1)).toBe(-1)
    expect(wrapper.find('[role="alert"]').text()).toContain('0 or more')
  })

  it('takes a value set from outside', async () => {
    mountInput({ modelValue: 1e-7 })
    await wrapper.setProps({ modelValue: 1e-12 })
    expect(input().element.value).toBe('1e-12')
  })

  it('shows a suffix beside the field', () => {
    mountInput({ modelValue: 2, suffix: 's' })
    expect(wrapper.text()).toContain('s')
    expect(input().element.value).toBe('2')
  })
})
