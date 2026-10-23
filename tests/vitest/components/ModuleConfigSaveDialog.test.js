// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ModuleConfigSaveDialog from '../../../src/components/dialogs/ModuleConfigSaveDialog.vue'

const DialogStub = { template: '<div><slot /><slot name="footer" /></div>' }
const existingRefs = ['glut:base', 'glut:taken', 'other:free']

let wrapper
afterEach(() => wrapper?.unmount())

function mountDialog(props = {}) {
  wrapper = mount(ModuleConfigSaveDialog, {
    props: { modelValue: true, moduleRef: 'glut:base', otherCount: 2, initialName: 'base_a', existingRefs, ...props },
    global: { plugins: [PrimeVue], stubs: { Dialog: DialogStub } },
  })
  return wrapper
}

const button = (label) => wrapper.findAll('button').find((b) => b.text() === label)
const setName = (name) => wrapper.find('#module-config-name').setValue(name)

describe('ModuleConfigSaveDialog', () => {
  it('says how many other instances an update changes', () => {
    mountDialog()
    expect(wrapper.text()).toContain('Update glut:base')
    expect(wrapper.text()).toContain('the 2 other instances using it')
  })

  it('names the module the instance no longer matches when it is not the one updated', () => {
    mountDialog({ moduleRef: 'glut2:default', matchRef: 'glut:base' })
    expect(wrapper.find('.config-message').text()).toContain('no longer match glut:base')
    expect(wrapper.text()).toContain('Update glut2:default')
  })

  it('saves as a new config by default when other instances use the module', async () => {
    mountDialog()
    await button('Save').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'new', moduleRef: 'glut:base_a' }]])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('updates the module when chosen', async () => {
    mountDialog()
    await wrapper.find('#module-config-update').setValue(true)
    expect(wrapper.find('#module-config-name').exists()).toBe(false)
    await button('Save').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'update' }]])
  })

  it('updates by default when no other instance uses the module', () => {
    mountDialog({ otherCount: 0 })
    expect(wrapper.text()).toContain('No other instances use it.')
    expect(wrapper.find('#module-config-name').exists()).toBe(false)
  })

  it.each([
    ['taken', 'already exists'],
    ['base', 'already exists'],
    ['', 'cannot be empty'],
  ])('rejects "%s"', async (name, reason) => {
    mountDialog()
    await setName(name)
    expect(wrapper.find('.error-text').text()).toContain(reason)
    await button('Save').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('allows a name only another module type uses, sanitised', async () => {
    mountDialog()
    await setName('free')
    expect(wrapper.find('.error-text').exists()).toBe(false)
    await setName('my config')
    await button('Save').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'new', moduleRef: 'glut:my_config' }]])
  })

  it('offers only a new config when the module cannot take this instance’s math', () => {
    mountDialog({ canUpdate: false })
    expect(wrapper.find('#module-config-update').exists()).toBe(false)
    expect(wrapper.find('#module-config-name').exists()).toBe(true)
  })

  it('emits cancel when cancelled', async () => {
    mountDialog()
    await button('Cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
