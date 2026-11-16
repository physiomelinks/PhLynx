import { describe, expect, it, vi } from 'vitest'

const updatePrimaryPalette = vi.hoisted(() => vi.fn())
vi.mock('@primevue/themes', async (importOriginal) => ({ ...(await importOriginal()), updatePrimaryPalette }))

import Aura from '@primevue/themes/aura'

import { APP_SETTINGS } from '../../../src/utils/appSettings'
import { applyAccentColour, createThemePreset } from '../../../src/utils/themePreset'

const ACCENTS = APP_SETTINGS.get('accentColour').options.map((option) => option.value)
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']

describe('createThemePreset', () => {
  it('has a full primary ramp for every Accent colour option', () => {
    for (const accent of ACCENTS) {
      expect(Object.keys(createThemePreset(accent).semantic.primary), accent).toEqual(SHADES)
    }
  })

  it('centres each brown on its own colour, and keeps Aura\'s green for Emerald', () => {
    expect(createThemePreset('copper').semantic.primary[500]).toBe('#8c5d35')
    expect(createThemePreset('logoBrown').semantic.primary[500]).toBe('#81634b')
    expect(createThemePreset('emerald').semantic.primary).toEqual(Aura.semantic.primary)
  })

  it('puts warm stone greys under both colour schemes, keeping the rest of Aura', () => {
    const { colorScheme } = createThemePreset('copper').semantic
    for (const scheme of ['light', 'dark']) {
      expect(colorScheme[scheme].surface[500], scheme).toBe('{stone.500}')
      expect(colorScheme[scheme].primary, scheme).toEqual(Aura.semantic.colorScheme[scheme].primary)
    }
  })
})

describe('applyAccentColour', () => {
  it('recolours the running app with the chosen ramp', () => {
    applyAccentColour('logoBrown')
    expect(updatePrimaryPalette).toHaveBeenCalledWith(createThemePreset('logoBrown').semantic.primary)
  })
})
