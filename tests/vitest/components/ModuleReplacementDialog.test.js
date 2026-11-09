// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/composables/useGtm', () => ({ useGtm: () => ({ trackEvent: vi.fn() }) }))

import ModuleReplacementDialog from '../../../src/components/ModuleReplacementDialog.vue'

const DialogStub = { template: '<div><slot /><slot name="footer" /></div>' }
const LibraryAreaStub = { name: 'LibraryArea', template: '<div />', emits: ['select'] }

const MODULE = {
  moduleRef: 'new:base',
  mathRef: 'file:new',
  ports: [{ label: 'in', portType: 'entrance_ports', variables: ['a'] }],
  variables: [
    { name: 'a', value: '1', units: 'metre', access: 'access', type: 'variable' },
    { name: 'b', value: '2', units: 'metre', access: 'access', type: 'variable' },
  ],
}

const INSTANCE = {
  id: '1',
  data: {
    ports: [
      { _uid: 'u1', label: 'old_b', portType: 'general_ports', variables: ['b'] },
      { _uid: 'u2', label: 'in', portType: 'general_ports', variables: ['b'] },
      { _uid: 'u3', label: 'old_c', portType: 'general_ports', variables: ['c'] },
    ],
  },
}

let wrapper
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => wrapper?.unmount())

async function confirmWith(retain) {
  wrapper = mount(ModuleReplacementDialog, {
    props: { modelValue: true, currentInstance: INSTANCE },
    global: { plugins: [PrimeVue], stubs: { Dialog: DialogStub, LibraryArea: LibraryAreaStub } },
  })
  wrapper.findComponent(LibraryAreaStub).vm.$emit('select', MODULE)
  await wrapper.vm.$nextTick()
  if (retain) await wrapper.find('#retainMatches').setValue(true)
  await wrapper.findAll('button').find((b) => b.text() === 'Confirm').trigger('click')
  return wrapper.emitted('confirm')[0][0]
}

describe('ModuleReplacementDialog', () => {
  it('gives the instance the new module ports when Retain is unticked', async () => {
    const data = await confirmWith(false)
    expect(data.moduleRef).toBe('new:base')
    expect(data.mathRef).toBe('file:new')
    expect(data.ports).toEqual(MODULE.ports)
    expect(data.variables.map((row) => row.name)).toEqual(['a', 'b'])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('adds the old ports the new module has variables for when Retain is ticked', async () => {
    const data = await confirmWith(true)
    expect(data.ports).toEqual([...MODULE.ports, { label: 'old_b', portType: 'general_ports', variables: ['b'] }])
  })
})
