// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import MultiSelect from 'primevue/multiselect'
import { afterEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'

import PortVariableSelect from '../../../src/components/PortVariableSelect.vue'

const OPTIONS = [{ name: 'v' }, { name: 'q' }, { name: 'u' }]

let wrapper

/**
 * Mounts the picker into the document, so its teleported panel can be queried.
 *
 * @param {Object} [props] - Props beyond the defaults.
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountSelect(props = {}) {
  wrapper = mount(PortVariableSelect, {
    props: { port: reactive({ variables: [], multiportType: 'None' }), options: OPTIONS, ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    attachTo: document.body,
  })
  return wrapper
}

/**
 * Opens the picker's panel.
 *
 * @returns {Promise<HTMLElement>} The panel.
 */
async function open() {
  wrapper.findComponent(MultiSelect).vm.show()
  await flushPromises()
  return document.body.querySelector('.ports-variable-overlay')
}

describe('PortVariableSelect', () => {
  afterEach(() => wrapper?.unmount())

  it('offers a search box over the options', () => {
    mountSelect()
    const select = wrapper.findComponent(MultiSelect)
    expect(select.props('filter')).toBe(true)
    expect(select.props('resetFilterOnHide')).toBe(true)
    expect(select.props('filterPlaceholder')).toBe('Search variables...')
    expect(select.props('options')).toEqual(OPTIONS)
  })

  it('sets the port’s variables and emits change', async () => {
    const port = reactive({ variables: [], multiportType: 'None' })
    mountSelect({ port })
    const select = wrapper.findComponent(MultiSelect)
    select.vm.$emit('update:modelValue', ['v', 'q'])
    select.vm.$emit('change', { value: ['v', 'q'] })
    await flushPromises()
    expect(port.variables).toEqual(['v', 'q'])
    expect(wrapper.emitted('change')).toHaveLength(1)
  })

  it('marks an empty flagged port invalid', () => {
    mountSelect({ flagged: true })
    expect(wrapper.findComponent(MultiSelect).props('invalid')).toBe(true)
  })

  it('leaves a flagged port with variables, or an unflagged empty one, valid', async () => {
    mountSelect({ flagged: true, port: reactive({ variables: ['v'], multiportType: 'None' }) })
    expect(wrapper.findComponent(MultiSelect).props('invalid')).toBe(false)
    await wrapper.setProps({ flagged: false, port: reactive({ variables: [], multiportType: 'None' }) })
    expect(wrapper.findComponent(MultiSelect).props('invalid')).toBe(false)
  })

  it('sizes the panel down when compact', async () => {
    mountSelect({ compact: true })
    const panel = await open()
    expect(panel.classList).toContain('ports-variable-overlay--compact')
  })

  it('leaves the panel full-size by default', async () => {
    mountSelect()
    const panel = await open()
    expect(panel.classList).not.toContain('ports-variable-overlay--compact')
  })

  it('clears the search from its clear icon', async () => {
    mountSelect()
    const panel = await open()
    const input = panel.querySelector('input.p-multiselect-filter')
    input.value = 'q'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(panel.querySelectorAll('.p-multiselect-option')).toHaveLength(1)

    panel.querySelector('.search-clear-input').click()
    await flushPromises()
    expect(input.value).toBe('')
    expect(panel.querySelectorAll('.p-multiselect-option')).toHaveLength(OPTIONS.length)
  })
})
