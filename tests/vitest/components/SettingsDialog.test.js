// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import Checkbox from 'primevue/checkbox'
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
const tabs = () => wrapper.findAll('[role="tab"]')
const tab = (title) => tabs().find((t) => t.text().startsWith(title))
const row = (label) => wrapper.findAll('.setting-row').find((r) => r.text().includes(label))
const stored = () => JSON.parse(window.localStorage.getItem('phlynx-settings'))

describe('SettingsDialog', () => {
  it('lists the sections in a rail, showing the first', async () => {
    await mountDialog()
    expect(tabs().map((t) => t.text())).toEqual(SETTING_SECTIONS.map((section) => section.title))
    expect(tab('Units').attributes('aria-selected')).toBe('true')
    expect(tab('Toolbar').attributes('aria-selected')).toBe('false')

    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.attributes('aria-labelledby')).toBe(tab('Units').attributes('id'))
    expect(panel.find('h4').text()).toBe('Units')
    expect(wrapper.findAll('.setting-row')).toHaveLength(1)
  })

  it('shows a row per setting of the section, with its name and description beside its control', async () => {
    await mountDialog()
    const first = wrapper.find('.setting-row')
    expect(first.find('.setting-text label').text()).toBe('Units suggestion format')
    expect(first.find('.setting-text p').text()).toContain('nothing is worked out from base units')
    expect(first.find('.setting-hint').text()).toBe('mV = 10⁻³ V')

    await tab('CellDL diagrams').trigger('click')
    expect(wrapper.find('[role="tabpanel"] h4').text()).toBe('CellDL diagrams')
    expect(wrapper.findAll('.setting-row').map((r) => r.find('label').text())).toEqual([
      'Bond arrowheads',
      'Scrolling in CellDL diagrams',
      'New CellDL modules: unit system',
    ])
  })

  it('moves between sections with the arrow keys, Home and End', async () => {
    await mountDialog()
    const rail = wrapper.find('[role="tablist"]')
    const selected = () => tabs().find((t) => t.attributes('aria-selected') === 'true').text()

    await rail.trigger('keydown', { key: 'ArrowDown' })
    expect(selected()).toBe('Simulation')
    expect(tab('Simulation').attributes('tabindex')).toBe('0')
    expect(tab('Units').attributes('tabindex')).toBe('-1')
    await rail.trigger('keydown', { key: 'End' })
    expect(selected()).toBe('Toolbar')
    await rail.trigger('keydown', { key: 'ArrowDown' })
    expect(selected()).toBe('Toolbar')
    await rail.trigger('keydown', { key: 'ArrowUp' })
    expect(selected()).toBe('Appearance')
    await rail.trigger('keydown', { key: 'Home' })
    expect(selected()).toBe('Units')
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

  it('applies a change as it is made, and keeps it on Done', async () => {
    await mountDialog()
    await wrapper.findComponent(Select).setValue('base')
    expect(settings.unitDisplay).toBe('base')
    expect(stored()).toMatchObject({ unitDisplay: 'base' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await button('Done').trigger('click')
    expect(settings.unitDisplay).toBe('base')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('applies the image export choices', async () => {
    await mountDialog()
    await tab('Image export').trigger('click')
    await row('Image format').findComponent(Select).setValue('svg')
    const toggle = row('Include warning symbols').findComponent(ToggleSwitch)
    expect(toggle.props('modelValue')).toBe(false)
    await toggle.setValue(true)

    expect(settings).toMatchObject({ imageExportFormat: 'svg', imageExportWarnings: true })
    expect(stored()).toMatchObject({ imageExportFormat: 'svg', imageExportWarnings: true })
  })

  it('turns the data items off', async () => {
    await mountDialog()
    await tab('Simulation').trigger('click')
    const toggle = row('Show data items').findComponent(ToggleSwitch)
    expect(toggle.props('modelValue')).toBe(true)
    await toggle.setValue(false)

    expect(settings.showDataItems).toBe(false)
    expect(stored()).toMatchObject({ showDataItems: false })
  })

  it('leaves species mode and location shading to the switches in their own views', async () => {
    await mountDialog()
    for (const t of tabs()) {
      await t.trigger('click')
      expect(wrapper.find('[role="tabpanel"]').text()).not.toMatch(/Species mode|Location shading/)
    }
  })
})

describe('SettingsDialog toolbar section', () => {
  const checks = () => wrapper.findAll('.setting-check')
  const check = (label) => checks().find((c) => c.find('label').text() === label)

  it('lists the toolbar buttons as checkboxes, each described for assistive technology', async () => {
    await mountDialog()
    await tab('Toolbar').trigger('click')
    const toolbar = SETTING_SECTIONS.find((section) => section.title === 'Toolbar')

    expect(wrapper.findAll('.setting-row')).toHaveLength(0)
    expect(checks().map((c) => c.find('label').text())).toEqual(toolbar.settings.map((setting) => setting.label))
    expect(wrapper.find('.settings-intro').text()).toMatch(/Settings is always shown/)

    const sendTo = check('Send to')
    const input = sendTo.find('input[type="checkbox"]')
    expect(sendTo.find('label').attributes('for')).toBe(input.attributes('id'))
    expect(wrapper.find(`#${input.attributes('aria-describedby')}`).text()).toBe(
      'Show the Send menu, which sends the model to another tool.'
    )
    expect(sendTo.findComponent(Checkbox).props('modelValue')).toBe(false)
    expect(check('Load workspace').findComponent(Checkbox).props('modelValue')).toBe(true)
  })

  it('shows and hides a button as its box is ticked', async () => {
    await mountDialog()
    await tab('Toolbar').trigger('click')
    await check('Send to').findComponent(Checkbox).setValue(true)
    await check('Undo and redo').findComponent(Checkbox).setValue(false)

    expect(settings).toMatchObject({ toolbarSendTo: true, toolbarUndoRedo: false })
    expect(stored()).toMatchObject({ toolbarSendTo: true, toolbarUndoRedo: false })
  })
})

describe('SettingsDialog revert and defaults', () => {
  it('offers nothing to revert until a setting changes', async () => {
    await mountDialog()
    expect(button('Revert changes').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.changed-dot')).toHaveLength(0)

    await wrapper.findComponent(Select).setValue('base')
    expect(button('Revert changes').attributes('disabled')).toBeUndefined()
  })

  it('marks a changed setting and its section, and clears the mark when it is put back by hand', async () => {
    await mountDialog()
    await wrapper.findComponent(Select).setValue('base')
    expect(tab('Units').find('.changed-dot').exists()).toBe(true)
    expect(tab('Simulation').find('.changed-dot').exists()).toBe(false)
    expect(row('Units suggestion format').find('.changed-dot').exists()).toBe(true)

    await wrapper.findComponent(Select).setValue('builtIn')
    expect(wrapper.findAll('.changed-dot')).toHaveLength(0)
    expect(button('Revert changes').attributes('disabled')).toBeDefined()
  })

  it('puts every section back as it was when the dialog opened', async () => {
    saveAppSettings({ unitDisplay: 'base', toolbarSendTo: true })
    await mountDialog()
    await wrapper.findComponent(Select).setValue('builtIn')
    await tab('Toolbar').trigger('click')
    await wrapper.findAll('.setting-check')[0].findComponent(Checkbox).setValue(false)
    await wrapper.findAll('.setting-check')[10].findComponent(Checkbox).setValue(false)
    expect(settings).toMatchObject({ unitDisplay: 'builtIn', toolbarLoad: false, toolbarSendTo: false })
    expect(tab('Units').find('.changed-dot').exists()).toBe(true)
    expect(tab('Toolbar').find('.changed-dot').exists()).toBe(true)

    await button('Revert changes').trigger('click')
    expect(settings).toMatchObject({ unitDisplay: 'base', toolbarLoad: true, toolbarSendTo: true })
    expect(stored()).toMatchObject({ unitDisplay: 'base', toolbarLoad: true, toolbarSendTo: true })
    expect(wrapper.findAll('.changed-dot')).toHaveLength(0)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('reverts only to how the settings were at the latest opening', async () => {
    await mountDialog()
    await wrapper.findComponent(Select).setValue('base')
    await button('Done').trigger('click')
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })

    expect(button('Revert changes').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.changed-dot')).toHaveLength(0)
    expect(settings.unitDisplay).toBe('base')
  })

  it('leaves a setting changed from its own view alone when reverting', async () => {
    await mountDialog()
    saveAppSettings({ speciesOverlay: true, celldlLocationShading: false })
    await nextTick()
    expect(button('Revert changes').attributes('disabled')).toBeDefined()

    await wrapper.findComponent(Select).setValue('base')
    await button('Revert changes').trigger('click')
    expect(settings).toMatchObject({ unitDisplay: 'builtIn', speciesOverlay: true, celldlLocationShading: false })
  })

  it('restores the defaults of the section shown only, which Revert changes undoes', async () => {
    saveAppSettings({ unitDisplay: 'base', toolbarSendTo: true, toolbarSave: false })
    await mountDialog()
    await tab('Toolbar').trigger('click')
    expect(button('Restore defaults').attributes('disabled')).toBeUndefined()

    await button('Restore defaults').trigger('click')
    expect(settings).toMatchObject({ unitDisplay: 'base', toolbarSendTo: false, toolbarSave: true })
    expect(button('Restore defaults').attributes('disabled')).toBeDefined()

    await button('Revert changes').trigger('click')
    expect(settings).toMatchObject({ unitDisplay: 'base', toolbarSendTo: true, toolbarSave: false })
  })

  it('has no defaults to restore in a section already at them', async () => {
    await mountDialog()
    expect(button('Restore defaults').attributes('disabled')).toBeDefined()
  })
})
