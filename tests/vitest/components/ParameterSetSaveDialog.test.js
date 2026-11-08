// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ParameterSetSaveDialog from '../../../src/components/dialogs/ParameterSetSaveDialog.vue'

const DialogStub = { template: '<div><slot /><slot name="footer" /></div>' }
const changes = [
  { nodeId: 'b', nodeName: 'enterocyte_2', name: 'pH', from: '7.4', to: '6.8' },
  { nodeId: 'c', nodeName: 'lumen', name: 'pH', from: '', to: '6.8' },
]

let wrapper
afterEach(() => wrapper?.unmount())

function mountDialog(props = {}) {
  wrapper = mount(ParameterSetSaveDialog, {
    props: { modelValue: true, paramRef: 'enterocyte', newRef: 'compartment', otherCount: 2, changes, ...props },
    global: { plugins: [PrimeVue], stubs: { Dialog: DialogStub } },
  })
  return wrapper
}

const button = (label) => wrapper.findAll('button').find((b) => b.text() === label)

describe('ParameterSetSaveDialog', () => {
  it('says where the values come from, and the new set the instance would take', () => {
    mountDialog()
    expect(wrapper.find('.set-message').text()).toContain('come from enterocyte, an imported parameter set')
    expect(wrapper.text()).toContain('Update enterocyte')
    expect(wrapper.text()).toContain('Saved as compartment')
    mountDialog({ ownerName: 'lumen' })
    expect(wrapper.find('.set-message').text()).toContain('the parameter set lumen made')
  })

  it("says when the set is the instance's own that others now use, without the files note", () => {
    mountDialog({ isOwn: true, otherCount: 1, changes: [] })
    expect(wrapper.find('.set-message').text()).toContain("this instance's own parameter set, which other instances use too")
    expect(wrapper.text()).not.toContain('Your files are not changed')
  })

  it('creates a new set by default when an update would change other instances', async () => {
    mountDialog()
    expect(wrapper.find('.change-list').exists()).toBe(false)
    await button('Save').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'new' }]])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it("lists the other instances' changes once Update is chosen, and confirms it", async () => {
    mountDialog()
    await wrapper.find('#parameter-set-update').setValue(true)
    expect(wrapper.text()).toContain('Also changes 2 values on the 2 other instances using it, listed below.')
    expect(wrapper.findAll('.change-list li').map((li) => li.text())).toEqual([
      'enterocyte_2.pH: 7.4 → 6.8',
      'lumen.pH: (blank) → 6.8',
    ])
    await button('Save').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'update' }]])
  })

  it('updates by default when no other instance would change, and says files stay as they are', () => {
    mountDialog({ otherCount: 0, changes: [] })
    expect(wrapper.text()).toContain('No other instances use it. Your files are not changed')
    expect(wrapper.find('#parameter-set-update').element.checked).toBe(true)
  })

  it('cancels', async () => {
    mountDialog()
    await button('Cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
