// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ConnectionAppearanceFields from '../../../src/components/ConnectionAppearanceFields.vue'
import { resolveEdgeAppearance } from '../../../src/utils/edges.js'

let wrapper

function mountFields(props = {}) {
  wrapper = mount(ConnectionAppearanceFields, {
    props: { appearance: resolveEdgeAppearance(), ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  return wrapper
}

describe('ConnectionAppearanceFields', () => {
  afterEach(() => wrapper?.unmount())

  it('emits a patch when a corner style, arrow or width is picked', async () => {
    mountFields()
    const option = wrapper.find('[data-testid="appearance-width"]').findAll('button').find((b) => b.text() === 'Thick')
    await option.trigger('click')
    expect(wrapper.emitted('change')).toEqual([[{ width: 'thick' }]])
  })

  it('offers no colour, which shows conflicts and uncoupled connections', () => {
    mountFields()
    expect(wrapper.text()).not.toContain('Colour')
    expect(wrapper.find('[data-testid="appearance-path"]').text()).toBe('RoundedSquare')
  })

  it('shows mixed values as unset', () => {
    mountFields({ mixed: ['arrow'] })
    expect(wrapper.text()).toContain('Mixed')
    expect(wrapper.find('[data-testid="appearance-arrow"] [aria-pressed="true"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="appearance-path"] [aria-pressed="true"]').exists()).toBe(true)
  })
})
