// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'

import PortRow from '../../../src/components/PortRow.vue'
import PortVariableSelect from '../../../src/components/PortVariableSelect.vue'

let wrapper

/**
 * Mounts a port row with VueFlow's handle stubbed.
 *
 * @param {Object} [props] - Props beyond the defaults.
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountRow(props = {}) {
  wrapper = mount(PortRow, {
    props: {
      side: 'source',
      port: reactive({ portType: 'exit_ports', label: 'out', variables: ['v'], multiportType: 'None' }),
      variables: [{ name: 'v' }, { name: 'q' }],
      ...props,
    },
    global: { plugins: [PrimeVue], stubs: { Handle: true }, directives: { tooltip: {} } },
  })
  return wrapper
}

describe('PortRow', () => {
  afterEach(() => wrapper?.unmount())

  it('picks variables with the searchable, compact picker', () => {
    mountRow()
    const picker = wrapper.findComponent(PortVariableSelect)
    expect(picker.props('options')).toEqual([{ name: 'v' }, { name: 'q' }])
    expect(picker.props('compact')).toBe(true)
    expect(picker.props('chipLimit')).toBe(2)
  })

  it('passes the picker’s changes on', async () => {
    mountRow()
    wrapper.findComponent(PortVariableSelect).vm.$emit('change')
    expect(wrapper.emitted('change')).toHaveLength(1)
  })
})
