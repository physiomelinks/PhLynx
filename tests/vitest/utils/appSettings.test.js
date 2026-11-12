import { describe, expect, it } from 'vitest'

import {
  APP_SETTINGS,
  SETTING_SECTIONS,
  defaultAppSettings,
  isValidAppSetting,
  shownToolbarDividers,
} from '../../../src/utils/appSettings'

const SETTINGS = SETTING_SECTIONS.flatMap((section) => section.settings)

describe('app settings registry', () => {
  it('gives every setting a unique key', () => {
    expect(APP_SETTINGS.size).toBe(SETTINGS.length)
  })

  it('gives every setting a known type and a valid default', () => {
    for (const setting of SETTINGS) {
      expect(['select', 'toggle'], setting.key).toContain(setting.type)
      expect(isValidAppSetting(setting.key, setting.default), setting.key).toBe(true)
    }
  })

  it('defaults to CellML built-in units, and inspection modules not plotted', () => {
    expect(defaultAppSettings().unitDisplay).toBe('builtIn')
    expect(defaultAppSettings().plotInspectionModules).toBe(false)
  })

  it('auto-plots the physiological view\'s selection unless the user chooses otherwise', () => {
    expect(defaultAppSettings().autoPlotSelection).toBe(true)
  })

  it('opens the physiological view without species mode unless the user chooses otherwise', () => {
    expect(defaultAppSettings().speciesOverlay).toBe(false)
  })

  it('keeps species flows moving unless the user chooses otherwise', () => {
    expect(defaultAppSettings().speciesFlowContinuous).toBe(true)
  })

  it('shows data items unless the user chooses otherwise, with the simulation\'s settings', () => {
    expect(defaultAppSettings().showDataItems).toBe(true)
    expect(isValidAppSetting('showDataItems', false)).toBe(true)
    expect(isValidAppSetting('showDataItems', 'no')).toBe(false)
    const keys = SETTING_SECTIONS.find((section) => section.title === 'Simulation').settings.map((setting) => setting.key)
    expect(keys).toEqual(['plotInspectionModules', 'autoPlotSelection', 'speciesOverlay', 'speciesFlowContinuous', 'showDataItems'])
  })

  it('accepts only true or false for an on/off setting', () => {
    expect(isValidAppSetting('plotInspectionModules', true)).toBe(true)
    expect(isValidAppSetting('plotInspectionModules', 'yes')).toBe(false)
  })

  it('accepts only a select setting\'s options, and nothing for unknown settings', () => {
    expect(isValidAppSetting('unitDisplay', 'base')).toBe(true)
    expect(isValidAppSetting('unitDisplay', 'simplified')).toBe(false)
    expect(isValidAppSetting('unitDisplay', undefined)).toBe(false)
    expect(isValidAppSetting('nowhere', 'base')).toBe(false)
  })

  it('exports PNG without warnings unless the user chooses otherwise', () => {
    expect(defaultAppSettings()).toMatchObject({ imageExportFormat: 'png', imageExportWarnings: false })
    expect(isValidAppSetting('imageExportFormat', 'svg')).toBe(true)
    expect(isValidAppSetting('imageExportFormat', 'jpeg')).toBe(false)
    expect(isValidAppSetting('imageExportWarnings', true)).toBe(true)
    expect(isValidAppSetting('imageExportWarnings', 'yes')).toBe(false)
  })
})

describe('bond arrowheads setting', () => {
  it('defaults to the bond-graph half arrow, offering classic as the other choice', () => {
    expect(defaultAppSettings().arrowStyle).toBe('classic')
    expect(APP_SETTINGS.get('arrowStyle').options.map((option) => option.value)).toEqual(['classic', 'bond'])
    expect(isValidAppSetting('arrowStyle', 'classic')).toBe(true)
    expect(isValidAppSetting('arrowStyle', 'notched')).toBe(false)
  })
})

describe('accent colour setting', () => {
  it('defaults to Copper, offering Logo brown and Emerald, under Appearance', () => {
    const setting = APP_SETTINGS.get('accentColour')
    expect(defaultAppSettings().accentColour).toBe('copper')
    expect(setting.options.map((option) => [option.value, option.label])).toEqual([
      ['copper', 'Copper'],
      ['logoBrown', 'Logo brown'],
      ['emerald', 'Emerald'],
    ])
    expect(SETTING_SECTIONS.find((section) => section.title === 'Appearance').settings).toEqual([setting])
    expect(isValidAppSetting('accentColour', 'emerald')).toBe(true)
    expect(isValidAppSetting('accentColour', 'purple')).toBe(false)
  })
})

describe('unit system for new CellDL modules', () => {
  it('defaults to Cellular, offering SI as the other choice', () => {
    expect(defaultAppSettings().celldlUnitSystem).toBe('cellular')
    expect(APP_SETTINGS.get('celldlUnitSystem').options.map((option) => option.value)).toEqual(['cellular', 'si'])
    expect(APP_SETTINGS.get('celldlUnitSystem').label).toBe('New CellDL modules: unit system')
    expect(isValidAppSetting('celldlUnitSystem', 'si')).toBe(true)
    expect(isValidAppSetting('celldlUnitSystem', 'fmol')).toBe(false)
  })
})

describe('scrolling in CellDL diagrams', () => {
  it('defaults to Automatic, offering Pan and Zoom, matching the editor wheel modes', () => {
    const setting = APP_SETTINGS.get('celldlWheelMode')
    expect(defaultAppSettings().celldlWheelMode).toBe('auto')
    expect(setting.label).toBe('Scrolling in CellDL diagrams')
    expect(setting.options.map((option) => [option.value, option.label])).toEqual([
      ['auto', 'Automatic'],
      ['pan', 'Pan'],
      ['zoom', 'Zoom'],
    ])
    expect(SETTING_SECTIONS.find((section) => section.title === 'CellDL diagrams').settings).toContain(setting)
    expect(isValidAppSetting('celldlWheelMode', 'zoom')).toBe(true)
    expect(isValidAppSetting('celldlWheelMode', 'scroll')).toBe(false)
  })

  it('shows every toolbar button except add handles, macro builder and send to', () => {
    const toolbar = SETTING_SECTIONS.find((section) => section.title === 'Toolbar')
    const defaults = Object.fromEntries(toolbar.settings.map((setting) => [setting.key, setting.default]))
    expect(defaults).toEqual({
      toolbarLoad: true,
      toolbarSave: true,
      toolbarCleanUp: true,
      toolbarClear: true,
      toolbarUndoRedo: true,
      toolbarAddHandles: false,
      toolbarMacroBuilder: false,
      toolbarSimulationSettings: true,
      toolbarImport: true,
      toolbarExport: true,
      toolbarSendTo: false,
    })
    expect(defaultAppSettings()).toMatchObject(defaults)
    for (const setting of toolbar.settings) {
      expect(setting.type, setting.key).toBe('toggle')
      expect(setting.description, setting.key).toMatch(/^Show the /)
    }
  })

  it('accepts only true or false for a toolbar button, and has no setting that hides Settings itself', () => {
    expect(isValidAppSetting('toolbarSendTo', true)).toBe(true)
    expect(isValidAppSetting('toolbarSendTo', 'shown')).toBe(false)
    expect(isValidAppSetting('toolbarMacroBuilder', 1)).toBe(false)
    expect(isValidAppSetting('toolbarSettings', false)).toBe(false)
  })
})

describe('shownToolbarDividers', () => {
  const allShown = Object.fromEntries(
    SETTING_SECTIONS.find((section) => section.title === 'Toolbar').settings.map((setting) => [setting.key, true])
  )

  it('divides every group when every button shows', () => {
    expect(shownToolbarDividers(allShown)).toEqual({
      cleanUp: true,
      undoRedo: true,
      addHandles: true,
      tools: true,
      toolsLead: true,
      transfer: true,
    })
  })

  it('skips the hidden add handles by default', () => {
    expect(shownToolbarDividers(defaultAppSettings())).toEqual({
      cleanUp: true,
      undoRedo: true,
      addHandles: false,
      tools: true,
      toolsLead: true,
      transfer: true,
    })
  })

  it('leaves no divider before the first shown group, nor after the last', () => {
    const onlyTools = Object.fromEntries(Object.keys(allShown).map((key) => [key, false]))
    expect(Object.values(shownToolbarDividers(onlyTools)).some(Boolean)).toBe(false)
    expect(shownToolbarDividers({ ...onlyTools, toolbarUndoRedo: true })).toMatchObject({
      undoRedo: false,
      tools: true,
    })
  })
})
