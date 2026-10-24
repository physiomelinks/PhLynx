import { describe, expect, it } from 'vitest'

import { APP_SETTINGS, SETTING_SECTIONS, defaultAppSettings, isValidAppSetting } from '../../../src/utils/appSettings'

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

  it('shows data items unless the user chooses otherwise, with the simulation\'s settings', () => {
    expect(defaultAppSettings().showDataItems).toBe(true)
    expect(isValidAppSetting('showDataItems', false)).toBe(true)
    expect(isValidAppSetting('showDataItems', 'no')).toBe(false)
    const keys = SETTING_SECTIONS.find((section) => section.title === 'Simulation').settings.map((setting) => setting.key)
    expect(keys).toEqual(['plotInspectionModules', 'showDataItems'])
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

describe('unit system for new CellDL modules', () => {
  it('defaults to Cellular, offering SI as the other choice', () => {
    expect(defaultAppSettings().celldlUnitSystem).toBe('cellular')
    expect(APP_SETTINGS.get('celldlUnitSystem').options.map((option) => option.value)).toEqual(['cellular', 'si'])
    expect(APP_SETTINGS.get('celldlUnitSystem').label).toBe('New CellDL modules: unit system')
    expect(isValidAppSetting('celldlUnitSystem', 'si')).toBe(true)
    expect(isValidAppSetting('celldlUnitSystem', 'fmol')).toBe(false)
  })
})
