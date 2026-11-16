// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const choose = vi.fn()
const confirm = vi.fn()
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm, choose }) }))

import EdgeConnectionDialog from '../../../src/components/EdgeConnectionDialog.vue'
import ModuleConfigSaveDialog from '../../../src/components/dialogs/ModuleConfigSaveDialog.vue'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { resolvePortCouplings } from '../../../src/utils/edges.js'

const port = (label, variables, multiportType = 'None') => ({ label, portType: 'general_ports', variables, multiportType })
const sum = port('v_tot', ['v_tot'], 'Sum')
const pump = [port('v_tot', ['v_K'], 'True'), port('v_tot', ['v_Na'], 'True')]

const DialogStub = { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' }

let wrapper

/** Opens the dialog on a sum → pump edge storing the given couplings. */
async function openDialog(couplings, { targetModuleRef } = {}) {
  const edge = { id: 's--t', source: 's', target: 't', data: { couplings } }
  wrapper = mount(EdgeConnectionDialog, {
    props: {
      modelValue: false,
      sourceNode: { id: 's', data: { name: 'membrane', ports: [sum], variables: [] } },
      targetNode: { id: 't', data: { name: 'pump', ports: pump, variables: [], moduleRef: targetModuleRef } },
      activeEdge: edge,
      subgraph: new Map([[edge.id, edge]]),
    },
    global: {
      plugins: [PrimeVue],
      stubs: { Dialog: DialogStub, VueFlow: true, Handle: true, MultiportKey: true },
      directives: { tooltip: {}, hint: {} },
    },
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

const done = () => wrapper.findAll('button').find((button) => button.text() === 'Done')

describe('EdgeConnectionDialog Done', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    choose.mockReset()
    confirm.mockReset()
  })

  afterEach(() => wrapper?.unmount())

  it('closes without a confirm when nothing was edited, so no history step is recorded', async () => {
    await openDialog(resolvePortCouplings([sum], pump))
    await done().trigger('click')
    await flushPromises()
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([false])
    expect(choose).not.toHaveBeenCalled()
  })

  it('asks no config question when nothing was edited, even for an instance whose ports differ from its module', async () => {
    useLibraryStore().availableModules.set('pump:base', { moduleRef: 'pump:base', mathRef: 'pump:pump', ports: [], variables: [] })
    await openDialog(resolvePortCouplings([sum], pump), { targetModuleRef: 'pump:base' })
    await done().trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(ModuleConfigSaveDialog).exists()).toBe(false)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([false])
  })

  it('asks before replacing stored couplings that differ from those shown, and keeps them on Keep', async () => {
    choose.mockResolvedValue('reject')
    await openDialog([{ sourcePort: sum, targetPort: pump[0] }])
    await done().trigger('click')
    await flushPromises()
    expect(choose).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Replace the 1 stored coupling with the 2 shown (what export uses)?',
        acceptLabel: 'Replace',
        rejectLabel: 'Keep stored',
      })
    )
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([false])
  })

  it('replaces the stored couplings with those shown on Replace', async () => {
    choose.mockResolvedValue('accept')
    await openDialog([{ sourcePort: sum, targetPort: pump[0] }])
    await done().trigger('click')
    await flushPromises()
    const [payload] = wrapper.emitted('confirm')[0]
    expect(payload.couplings.map((c) => c.targetPort.variables[0])).toEqual(['v_K', 'v_Na'])
  })
})
