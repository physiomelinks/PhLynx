import { reactive, readonly } from 'vue'

import { APP_SETTINGS, defaultAppSettings, isValidAppSetting } from '../utils/appSettings'

const STORAGE_KEY = 'phlynx-settings'

/** Reads the stored settings, each falling back to its default when missing or invalid. */
function loadStoredSettings() {
  const settings = defaultAppSettings()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY))
    const stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    for (const key of APP_SETTINGS.keys()) {
      if (Object.hasOwn(stored, key) && isValidAppSetting(key, stored[key])) settings[key] = stored[key]
    }
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) or unreadable - fall back to defaults
  }
  return settings
}

const settings = reactive(loadStoredSettings())

/**
 * Applies the valid settings in `values`, keeping the rest, and remembers them all.
 *
 * @param {Object<string, *>} values - By setting key; unknown keys and invalid values are ignored.
 */
function saveAppSettings(values) {
  for (const key of APP_SETTINGS.keys()) {
    if (Object.hasOwn(values, key) && isValidAppSetting(key, values[key])) settings[key] = values[key]
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    // ignore storage errors
  }
}

/** App-wide settings from the Settings dialog, shared and read-only; change them with saveAppSettings. */
export function useAppSettings() {
  return { settings: readonly(settings), saveAppSettings }
}
