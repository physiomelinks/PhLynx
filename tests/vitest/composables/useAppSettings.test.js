// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'phlynx-settings'

/** A fresh copy of the module, so it reads localStorage again. */
async function load() {
  vi.resetModules()
  const { useAppSettings } = await import('../../../src/composables/useAppSettings')
  return useAppSettings()
}

const store = (value) => window.localStorage.setItem(STORAGE_KEY, value)
const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY))

describe('useAppSettings', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('starts from the defaults', async () => {
    expect((await load()).settings).toEqual({ unitDisplay: 'builtIn' })
  })

  it('reads the stored settings', async () => {
    store(JSON.stringify({ unitDisplay: 'base' }))
    expect((await load()).settings.unitDisplay).toBe('base')
  })

  it('falls back to the default for an invalid value, and drops unknown settings', async () => {
    store(JSON.stringify({ unitDisplay: 'simplified', retired: true }))
    expect((await load()).settings).toEqual({ unitDisplay: 'builtIn' })
  })

  it.each(['null', '"base"', '[]', '{not json'])('falls back to the defaults for %s', async (value) => {
    store(value)
    expect((await load()).settings).toEqual({ unitDisplay: 'builtIn' })
  })

  it('falls back to the defaults when storage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect((await load()).settings.unitDisplay).toBe('builtIn')
  })

  it('shares and remembers saved settings', async () => {
    const { settings, saveAppSettings } = await load()
    saveAppSettings({ unitDisplay: 'base' })
    expect(settings.unitDisplay).toBe('base')
    expect(stored()).toEqual({ unitDisplay: 'base' })

    const { useAppSettings } = await import('../../../src/composables/useAppSettings')
    expect(useAppSettings().settings.unitDisplay).toBe('base')
  })

  it('keeps the current value for an invalid one, and ignores unknown settings', async () => {
    const { settings, saveAppSettings } = await load()
    saveAppSettings({ unitDisplay: 'base' })
    saveAppSettings({ unitDisplay: 'simplified', retired: true })
    expect(settings).toEqual({ unitDisplay: 'base' })
    expect(stored()).toEqual({ unitDisplay: 'base' })
  })

  it('still applies settings when storage cannot be written', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const { settings, saveAppSettings } = await load()
    expect(() => saveAppSettings({ unitDisplay: 'base' })).not.toThrow()
    expect(settings.unitDisplay).toBe('base')
  })
})
