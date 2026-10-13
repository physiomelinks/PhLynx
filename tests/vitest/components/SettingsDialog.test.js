// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import SettingsDialog from '../../../src/components/SettingsDialog.vue'
import { useAppSettings } from '../../../src/composables/useAppSettings'
import { SETTING_SECTIONS, defaultAppSettings } from '../../../src/utils/appSettings'

const { settings, saveAppSettings } = useAppSettings()

let wrapper
afterEach(() => wrapper?.unmount())
beforeEach(() => {
  window.localStorage.clear()
  saveAppSettings(defaultAppSettings())
})

/** Mounts the dialog open, its content kept in place rather than teleported. */
async function mountDialog() {
  wrapper = mount(SettingsDialog, {
    props: { modelValue: true },
    global: { plugins: [PrimeVue], stubs: { teleport: true } },
  })
  await nextTick()
  return wrapper
}

const button = (label) => wrapper.findAll('button').find((b) => b.text() === label)

describe('SettingsDialog', () => {
  it('shows a row per setting, with its name and description beside its control', async () => {
    await mountDialog()
    const settingsCount = SETTING_SECTIONS.flatMap((section) => section.settings).length
    expect(wrapper.findAll('.setting-row')).toHaveLength(settingsCount)
    expect(wrapper.find('h4').text()).toBe('Units')

    const row = wrapper.find('.setting-row')
    expect(row.find('.setting-text label').text()).toBe('Units suggestion format')
    expect(row.find('.setting-text p').text()).toContain('nothing is worked out from base units')
    expect(row.find('.setting-hint').text()).toBe('mV = 10⁻³ V')
  })

  it('labels each control with its setting name', async () => {
    await mountDialog()
    const combobox = wrapper.find('[role="combobox"]')
    const label = wrapper.find(`#${combobox.attributes('aria-labelledby')}`)
    expect(label.text()).toBe('Units suggestion format')
  })

  it('starts from the saved settings', async () => {
    saveAppSettings({ unitDisplay: 'base' })
    await mountDialog()
    expect(wrapper.findComponent(Select).props('modelValue')).toBe('base')
    expect(wrapper.find('.setting-hint').text()).toBe('mV = 10⁻³ kg·m²·s⁻³·A⁻¹')
  })

  it('applies changes on Save', async () => {
    await mountDialog()
    await wrapper.findComponent(Select).setValue('base')
    await button('Save Changes').trigger('click')

    expect(settings.unitDisplay).toBe('base')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('discards changes on Cancel, and starts again from the saved settings when reopened', async () => {
    await mountDialog()
    await wrapper.findComponent(Select).setValue('base')
    await button('Cancel').trigger('click')
    expect(settings.unitDisplay).toBe('builtIn')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])

    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    expect(wrapper.findComponent(Select).props('modelValue')).toBe('builtIn')
  })

  it('saves the image export choices', async () => {
    await mountDialog()
    const formatRow = wrapper.findAll('.setting-row').find((row) => row.text().includes('Image format'))
    await formatRow.findComponent(Select).setValue('svg')
    const warningsRow = wrapper.findAll('.setting-row').find((row) => row.text().includes('Include warning symbols'))
    const toggle = warningsRow.findComponent(ToggleSwitch)
    expect(toggle.props('modelValue')).toBe(false)
    await toggle.setValue(true)
    await button('Save Changes').trigger('click')

    expect(settings).toMatchObject({ imageExportFormat: 'svg', imageExportWarnings: true })
    expect(JSON.parse(window.localStorage.getItem('phlynx-settings'))).toMatchObject({
      imageExportFormat: 'svg',
      imageExportWarnings: true,
    })
  })

  it('turns the data items off', async () => {
    await mountDialog()
    const row = wrapper.findAll('.setting-row').find((row) => row.text().includes('Show data items'))
    const toggle = row.findComponent(ToggleSwitch)
    expect(toggle.props('modelValue')).toBe(true)
    await toggle.setValue(false)
    await button('Save Changes').trigger('click')

    expect(settings.showDataItems).toBe(false)
    expect(JSON.parse(window.localStorage.getItem('phlynx-settings'))).toMatchObject({ showDataItems: false })
  })
})
