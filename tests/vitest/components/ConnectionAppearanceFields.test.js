// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ConnectionAppearanceFields from '../../../src/components/ConnectionAppearanceFields.vue'
import ThemeColourButton from '../../../src/components/ThemeColourButton.vue'
import { resolveEdgeAppearance } from '../../../src/utils/edges.js'

let wrapper

function mountFields(props = {}) {
  wrapper = mount(ConnectionAppearanceFields, {
    props: { appearance: resolveEdgeAppearance(), ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  return wrapper
}

const colourButton = () => wrapper.findComponent(ThemeColourButton)

describe('ConnectionAppearanceFields', () => {
  afterEach(() => wrapper?.unmount())

  it('emits a patch when a path, arrow or width is picked', async () => {
    mountFields()
    const option = wrapper.find('[data-testid="appearance-width"]').findAll('button').find((b) => b.text() === 'Thick')
    await option.trigger('click')
    expect(wrapper.emitted('change')).toEqual([[{ width: 'thick' }]])
  })

  it('previews a picked colour, then emits it once on Apply', async () => {
    mountFields()
    colourButton().vm.$emit('update:modelValue', '#ef4444')
    await flushPromises()
    expect(wrapper.emitted('preview')).toEqual([['#ef4444']])
    expect(colourButton().props('modelValue')).toBe('#ef4444')

    colourButton().vm.$emit('apply', '#ef4444')
    await flushPromises()
    expect(wrapper.emitted('preview-end')).toHaveLength(1)
    expect(wrapper.emitted('change')).toEqual([[{ colour: '#ef4444' }]])
    expect(colourButton().props('modelValue')).toBeUndefined()
  })

  it('emits automatic as a null colour, and nothing on cancel', async () => {
    mountFields({ appearance: resolveEdgeAppearance({ colour: '#ef4444' }) })
    colourButton().vm.$emit('update:modelValue', undefined)
    colourButton().vm.$emit('apply', undefined)
    expect(wrapper.emitted('change')).toEqual([[{ colour: null }]])

    colourButton().vm.$emit('update:modelValue', '#22c55e')
    colourButton().vm.$emit('cancel')
    expect(wrapper.emitted('change')).toHaveLength(1)
    expect(wrapper.emitted('preview-end')).toHaveLength(2)
  })

  it('shows mixed values as unset', () => {
    mountFields({ mixed: ['colour', 'arrow'] })
    expect(wrapper.text()).toContain('Mixed')
    expect(wrapper.find('[data-testid="appearance-arrow"] [aria-pressed="true"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="appearance-path"] [aria-pressed="true"]').exists()).toBe(true)
  })
})
