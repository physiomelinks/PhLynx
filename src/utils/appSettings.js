/**
 * The settings, by section, in the order the dialog shows them. Each `select` setting offers `options`, each with
 * an optional `hint` shown beneath its label; a `toggle` setting is on or off.
 */
export const SETTING_SECTIONS = [
  {
    title: 'Units',
    settings: [
      {
        key: 'unitDisplay',
        type: 'select',
        label: 'Units suggestion format',
        description:
          'How each units suggestion shows its definition. Built-in units follow the definition as written; nothing is worked out from base units.',
        options: [
          { value: 'builtIn', label: 'CellML built-in units', hint: 'mV = 10⁻³ V' },
          { value: 'base', label: 'SI base units', hint: 'mV = 10⁻³ kg·m²·s⁻³·A⁻¹' },
        ],
        default: 'builtIn',
      },
    ],
  },
  {
    title: 'Image export',
    settings: [
      {
        key: 'imageExportFormat',
        type: 'select',
        label: 'Image format',
        description: 'What the export button in the canvas controls saves. The edit buttons on instances are never included.',
        options: [
          { value: 'png', label: 'PNG', hint: 'A picture of the canvas at screen resolution' },
          { value: 'svg', label: 'SVG', hint: 'Vector shapes and text that stay sharp at any size, for posters' },
        ],
        default: 'png',
      },
      {
        key: 'imageExportWarnings',
        type: 'toggle',
        label: 'Include warning symbols',
        description: 'Show the missing-parameter and coupling warnings in exported images.',
        default: false,
      },
    ],
  },
]

/** Each setting's definition, by key. */
export const APP_SETTINGS = new Map(
  SETTING_SECTIONS.flatMap((section) => section.settings).map((setting) => [setting.key, setting])
)

/** @returns {Object<string, *>} Every setting at its default. */
export function defaultAppSettings() {
  return Object.fromEntries([...APP_SETTINGS.values()].map((setting) => [setting.key, setting.default]))
}

/**
 * @param {string} key
 * @param {*} value
 * @returns {boolean} Whether `value` is one the setting allows; false for unknown settings.
 */
export function isValidAppSetting(key, value) {
  const setting = APP_SETTINGS.get(key)
  switch (setting?.type) {
    case 'select':
      return setting.options.some((option) => option.value === value)
    case 'toggle':
      return typeof value === 'boolean'
    default:
      return false
  }
}
