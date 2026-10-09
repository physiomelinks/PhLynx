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

  it('defaults to CellML built-in units', () => {
    expect(defaultAppSettings().unitDisplay).toBe('builtIn')
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
