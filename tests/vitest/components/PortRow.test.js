// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'

import AnnotationChips from '../../../src/components/AnnotationChips.vue'
import PortRow from '../../../src/components/PortRow.vue'
import PortVariableChips from '../../../src/components/PortVariableChips.vue'
import PortVariableSelect from '../../../src/components/PortVariableSelect.vue'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'

const annotation = (source) => ({
  subject: 'pump.cellml#pump.v_Na',
  variable: 'v_Na',
  property: 'OPB:00592',
  species: ['CHEBI:29101'],
  location: 'GO:0005737',
  role: 'contributor',
  source,
})
const sidecarPort = () =>
  reactive({
    portType: 'general_ports',
    label: '',
    variables: ['v'],
    multiportType: 'None',
    annotation: annotation({ kind: 'sidecar', mathRef: 'pump.cellml:pump' }),
  })
const mirroredPort = () =>
  reactive({
    portType: 'general_ports',
    label: '',
    variables: [],
    multiportType: 'Sum',
    annotation: { ...annotation({ kind: 'copied', copiedFrom: { subject: 'x' } }), role: 'aggregator' },
  })

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

  it('shows an annotated port’s meaning as chips, never as a label to edit', () => {
    mountRow({ port: sidecarPort() })
    expect(wrapper.findComponent(AnnotationChips).exists()).toBe(true)
    expect(wrapper.findComponent(InputText).exists()).toBe(false)
  })

  it('locks an annotated port’s type and mode, saying they come from the annotation', () => {
    mountRow({ port: sidecarPort() })
    expect(wrapper.findComponent(Select).props('disabled')).toBe(true)
    expect(wrapper.find('.port-type').attributes('title')).toMatch(/^From annotation/)
    const toggle = wrapper.find('.multiport-toggle')
    expect(toggle.attributes('disabled')).toBeDefined()
    expect(toggle.attributes('title')).toBe('From annotation: contributor, basicport')
  })

  it('shows a sidecar port’s variable as a read-only chip', () => {
    mountRow({ port: sidecarPort() })
    expect(wrapper.findComponent(PortVariableSelect).exists()).toBe(false)
    expect(wrapper.findComponent(PortVariableChips).props('locked')).toBe(true)
  })

  it('lets the user pick a mirrored port’s variable, with its multiport types locked', () => {
    mountRow({ port: mirroredPort() })
    const picker = wrapper.findComponent(PortVariableSelect)
    expect(picker.exists()).toBe(true)
    expect(picker.props('locked')).toBe(true)
    expect(wrapper.findComponent(AnnotationChips).exists()).toBe(true)
  })

  it('keeps an unannotated port editable', () => {
    mountRow()
    expect(wrapper.findComponent(InputText).exists()).toBe(true)
    expect(wrapper.findComponent(Select).props('disabled')).toBe(false)
    expect(wrapper.findComponent(PortVariableSelect).props('locked')).toBe(false)
  })
})
