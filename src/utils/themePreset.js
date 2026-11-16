import { definePreset, palette, updatePrimaryPalette } from '@primevue/themes'
import Aura from '@primevue/themes/aura'

/** The primary colour ramp for each option of the Accent colour setting, by the option's value. */
const ACCENT_PALETTES = {
  // The brown of the PhLynx icon (public/phlynxlogo.svg), with more saturation. White text on it is 5.6:1.
  copper: palette('#8c5d35'),
  // The brown of the PhLynx icon as it is. White text on it is 5.5:1.
  logoBrown: palette('#81634b'),
  // Aura's own green, the primary before the browns. White text on it is 2.5:1.
  emerald: Aura.semantic.primary,
}

// Warm greys in place of Aura's cool slate (light) and zinc (dark), so a brown primary sits on
// neutrals from the same family as the icon's taupe and off-white.
const warmSurface = {
  0: '#ffffff',
  50: '{stone.50}',
  100: '{stone.100}',
  200: '{stone.200}',
  300: '{stone.300}',
  400: '{stone.400}',
  500: '{stone.500}',
  600: '{stone.600}',
  700: '{stone.700}',
  800: '{stone.800}',
  900: '{stone.900}',
  950: '{stone.950}',
}

/**
 * @param {string} accent - An Accent colour setting value.
 * @returns {object} The PrimeVue preset the app starts with.
 */
export function createThemePreset(accent) {
  return definePreset(Aura, {
    semantic: {
      primary: ACCENT_PALETTES[accent],
      colorScheme: {
        light: { surface: warmSurface },
        dark: { surface: warmSurface },
      },
    },
  })
}

/**
 * Recolours the running app.
 *
 * @param {string} accent - An Accent colour setting value.
 */
export function applyAccentColour(accent) {
  updatePrimaryPalette(ACCENT_PALETTES[accent])
}
