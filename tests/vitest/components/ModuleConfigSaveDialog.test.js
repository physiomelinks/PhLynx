// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ModuleConfigSaveDialog from '../../../src/components/dialogs/ModuleConfigSaveDialog.vue'

const DialogStub = { template: '<div><slot /><slot name="footer" /></div>' }

let wrapper
afterEach(() => wrapper?.unmount())

function mountDialog(props = {}) {
  wrapper = mount(ModuleConfigSaveDialog, {
    props: { modelValue: true, moduleRef: 'glut:base', otherCount: 2, newRef: 'glut:a', ...props },
    global: { plugins: [PrimeVue], stubs: { Dialog: DialogStub } },
  })
  return wrapper
}

const button = (label) => wrapper.findAll('button').find((b) => b.text() === label)

describe('ModuleConfigSaveDialog', () => {
  it('says how many other instances an overwrite changes', () => {
    mountDialog()
    expect(wrapper.text()).toContain('Overwrite glut:base')
    expect(wrapper.text()).toContain('the 2 other instances using it')
  })

  it('names the module the instance no longer matches when it is not the one overwritten', () => {
    mountDialog({ moduleRef: 'glut2:default', matchRef: 'glut:base' })
    expect(wrapper.find('.config-message').text()).toContain('no longer match glut:base')
    expect(wrapper.text()).toContain('Overwrite glut2:default')
  })

  it('creates the new config, named after the instance, by default and without asking for a name', async () => {
    mountDialog()
    expect(wrapper.text()).toContain('Create new config')
    expect(wrapper.text()).toContain('as glut:a')
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    await button('Save').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'new', moduleRef: 'glut:a' }]])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('overwrites the module when chosen', async () => {
    mountDialog()
    await wrapper.find('#module-config-update').setValue(true)
    await button('Save').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'update' }]])
  })

  it('still asks, creating a new config by default, when no other instance uses the module', async () => {
    mountDialog({ otherCount: 0 })
    expect(wrapper.text()).toContain('No other instances use it')
    await button('Save').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'new', moduleRef: 'glut:a' }]])
  })

  it('offers only a new config when the module cannot take this instance’s math', () => {
    mountDialog({ canUpdate: false })
    expect(wrapper.find('#module-config-update').exists()).toBe(false)
    expect(wrapper.text()).toContain('Create new config')
  })

  it('emits cancel when cancelled', async () => {
    mountDialog()
    await button('Cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
