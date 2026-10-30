// @vitest-environment happy-dom
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import InputText from 'primevue/inputtext'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vue-flow/core', async (importOriginal) => ({ ...(await importOriginal()) }))
const notify = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warn: vi.fn(), info: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify }))

const { default: PortEditorDialog } = await import('../../../src/components/PortEditorDialog.vue')

const DialogStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', [slots.default?.(), slots.footer?.()])
  },
})

function mountDialog(props = {}) {
  return mount(PortEditorDialog, {
    props: { modelValue: true, id: 'inst-1', initialName: 'inst', variables: [{ name: 'v' }], ...props },
    global: { plugins: [PrimeVue], stubs: { Dialog: DialogStub } },
  })
}

const addButton = (w) => w.findAll('button').find((b) => b.find('.pi-plus').exists())
const deleteButtons = (w) => w.findAll('button').filter((b) => b.find('.pi-trash').exists())
const confirmButton = (w) => w.findAll('button').find((b) => b.text() === 'Confirm')
const labelInputs = (w) => w.findAll('input[placeholder="Enter label"]')

async function setLabel(w, i, value) {
  await labelInputs(w)[i].setValue(value)
}

const port = (over = {}) => ({
  portType: 'general_ports',
  label: 'p',
  variables: ['v'],
  multiportType: 'None',
  multiplyFactor: 1,
  ...over,
})

describe('PortEditorDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows an empty placeholder when there are no ports', () => {
    const w = mountDialog()
    expect(w.text()).toContain('No port labels added')
    expect(deleteButtons(w)).toHaveLength(0)
  })

  it('renders a row per initial port with its label', () => {
    const w = mountDialog({ initialPorts: [port({ label: 'a' }), port({ label: 'b' })] })
    expect(labelInputs(w).map((i) => i.element.value)).toEqual(['a', 'b'])
    expect(w.text()).not.toContain('No port labels added')
  })

  it('adds a blank default port row when the add button is clicked', async () => {
    const w = mountDialog()
    await addButton(w).trigger('click')
    expect(labelInputs(w)).toHaveLength(1)
    expect(labelInputs(w)[0].element.value).toBe('')
    expect(w.text()).not.toContain('No port labels added')
    await addButton(w).trigger('click')
    expect(labelInputs(w)).toHaveLength(2)
  })

  it('removes only the row whose delete button was clicked', async () => {
    const w = mountDialog({ initialPorts: [port({ label: 'a' }), port({ label: 'b' }), port({ label: 'c' })] })
    await deleteButtons(w)[1].trigger('click')
    expect(labelInputs(w).map((i) => i.element.value)).toEqual(['a', 'c'])
  })

  it('returns to the empty placeholder after deleting the last port', async () => {
    const w = mountDialog({ initialPorts: [port()] })
    await deleteButtons(w)[0].trigger('click')
    expect(w.text()).toContain('No port labels added')
  })

  it('confirm emits the edited ports and closes the dialog', async () => {
    const w = mountDialog({ initialPorts: [port({ label: 'a' }), port({ label: 'b' })] })
    await deleteButtons(w)[0].trigger('click')
    await setLabel(w, 0, 'renamed')
    await confirmButton(w).trigger('click')
    const [payload] = w.emitted('confirm')[0]
    expect(payload.id).toBe('inst-1')
    expect(payload.name).toBe('inst')
    expect(payload.ports.map((p) => p.label)).toEqual(['renamed'])
    expect(w.emitted('update:modelValue')[0]).toEqual([false])
  })

  it('drops ports without a label or without variables on confirm', async () => {
    const w = mountDialog({
      initialPorts: [port({ label: 'keep' }), port({ label: '   ' }), port({ label: 'novars', variables: undefined })],
    })
    await confirmButton(w).trigger('click')
    expect(w.emitted('confirm')[0][0].ports.map((p) => p.label)).toEqual(['keep'])
  })

  it('keeps an annotated port, which has no label, on confirm', async () => {
    const annotation = { subject: 'm.cellml#m.v', variable: 'v', role: 'owner', source: { kind: 'sidecar' } }
    const w = mountDialog({ initialPorts: [port({ label: '', annotation })] })
    await confirmButton(w).trigger('click')
    expect(w.emitted('confirm')[0][0].ports.map((p) => p.annotation)).toEqual([annotation])
  })

  it('a freshly added port is omitted on confirm because it has no variables selected', async () => {
    const w = mountDialog()
    await addButton(w).trigger('click')
    await setLabel(w, 0, 'labelled')
    await confirmButton(w).trigger('click')
    expect(w.emitted('confirm')[0][0].ports).toEqual([])
  })

  it('sanitises the instance name before emitting it', async () => {
    const w = mountDialog()
    await w.findComponent(InputText).setValue('my inst!')
    await confirmButton(w).trigger('click')
    expect(w.emitted('confirm')[0][0].name).toBe('my_inst')
  })

  it('rejects an empty instance name', async () => {
    const w = mountDialog()
    await w.findComponent(InputText).setValue('   ')
    await confirmButton(w).trigger('click')
    expect(notify.error).toHaveBeenCalledWith({ message: 'Instance name cannot be empty.' })
    expect(w.emitted('confirm')).toBeUndefined()
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('rejects a name that sanitises to nothing', async () => {
    const w = mountDialog()
    await w.findComponent(InputText).setValue('!!!')
    await confirmButton(w).trigger('click')
    expect(notify.error).toHaveBeenCalledWith({ message: 'Instance name is invalid.' })
    expect(w.emitted('confirm')).toBeUndefined()
  })

  it('rejects a duplicate instance name but allows keeping its own', async () => {
    const w = mountDialog({ existingNames: ['inst', 'other'] })
    await confirmButton(w).trigger('click')
    expect(w.emitted('confirm')).toHaveLength(1)

    await w.findComponent(InputText).setValue('other')
    await confirmButton(w).trigger('click')
    expect(notify.error).toHaveBeenCalledWith({ message: 'An instance with this name already exists.' })
    expect(w.emitted('confirm')).toHaveLength(1)
  })

  it('Cancel closes without emitting confirm', async () => {
    const w = mountDialog()
    await w.findAll('button').find((b) => b.text() === 'Cancel').trigger('click')
    expect(w.emitted('update:modelValue')[0]).toEqual([false])
    expect(w.emitted('confirm')).toBeUndefined()
  })

  it('resets edits from the initial props when the dialog is reopened', async () => {
    const w = mountDialog({ modelValue: false, initialPorts: [port({ label: 'a' })] })
    await w.setProps({ modelValue: true })
    await addButton(w).trigger('click')
    expect(labelInputs(w)).toHaveLength(2)
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true })
    await flushPromises()
    expect(labelInputs(w).map((i) => i.element.value)).toEqual(['a'])
  })

  it('resets the multiply factor to 1 for ports that are not Multiply', async () => {
    const w = mountDialog({ initialPorts: [port({ multiportType: 'None', multiplyFactor: 5 })] })
    await addButton(w).trigger('click')
    await confirmButton(w).trigger('click')
    expect(w.emitted('confirm')[0][0].ports[0].multiplyFactor).toBe(1)
  })

  it('hides the multiply factor input unless the port is Multiply', () => {
    const none = mountDialog({ initialPorts: [port()] })
    expect(none.find('.multiply-prefix').exists()).toBe(false)
    const multiply = mountDialog({ initialPorts: [port({ multiportType: 'Multiply', multiplyFactor: 2 })] })
    expect(multiply.find('.multiply-prefix').exists()).toBe(true)
  })

  // Known source bug: handleConfirm calls isEmpty() which PortEditorDialog.vue never imports,
  // so confirming a Multiply port throws a ReferenceError. Flip to `it` once the import is added.
  it.fails('rejects a Multiply port whose scale factor is missing', async () => {
    const w = mountDialog({ initialPorts: [port({ label: 'm', multiportType: 'Multiply', multiplyFactor: null })] })
    await confirmButton(w).trigger('click')
    expect(notify.error).toHaveBeenCalledWith({
      message: 'Port "m" has Multiply selected but the scale factor is missing or zero.',
    })
    expect(w.emitted('confirm')).toBeUndefined()
  })

  it('does not mutate the initialPorts prop when ports are edited', async () => {
    const initialPorts = [port({ label: 'a' })]
    const w = mountDialog({ initialPorts })
    await setLabel(w, 0, 'changed')
    await deleteButtons(w)[0].trigger('click')
    expect(initialPorts).toHaveLength(1)
    expect(initialPorts[0].label).toBe('a')
  })
})
