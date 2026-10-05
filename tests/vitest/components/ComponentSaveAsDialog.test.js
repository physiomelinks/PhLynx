// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ComponentSaveAsDialog from '../../../src/components/dialogs/ComponentSaveAsDialog.vue'

const DialogStub = { template: '<div><slot /><slot name="footer" /></div>' }
const isTaken = (name) => (['new_module', 'existing'].includes(name) ? `"${name}" is taken.` : '')

let wrapper
afterEach(() => wrapper?.unmount())

function mountDialog(initialName) {
  wrapper = mount(ComponentSaveAsDialog, {
    props: { modelValue: true, initialName, isTaken },
    global: { plugins: [PrimeVue], stubs: { Dialog: DialogStub } },
  })
  return wrapper
}

const saveButton = () => wrapper.findAll('button').find((b) => b.text() === 'Save')

describe('ComponentSaveAsDialog', () => {
  it.each([
    ['new_module', 'is taken'],
    ['existing', 'is taken'],
    ['', 'cannot be empty'],
  ])('rejects "%s"', async (name, reason) => {
    mountDialog(name)
    expect(wrapper.find('.error-text').text()).toContain(reason)
    await saveButton().trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('emits the sanitised name on confirm', async () => {
    mountDialog('my comp')
    await saveButton().trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['my_comp']])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('emits cancel when cancelled', async () => {
    mountDialog('my_comp')
    await wrapper.findAll('button').find((b) => b.text() === 'Cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
