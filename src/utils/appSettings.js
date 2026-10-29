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
    title: 'Simulation',
    settings: [
      {
        key: 'plotInspectionModules',
        type: 'toggle',
        label: 'Plot inspection modules',
        description: 'After a run, show the outputs of the inspection modules it covered as a plot of their own.',
        default: false,
      },
      {
        key: 'showDataItems',
        type: 'toggle',
        label: 'Show data items',
        description:
          "List the obs_data's data items, the measurements a calibration fits the model to, in Edit obs_data. They are shown read-only: edit them in CUFLynx.",
        default: true,
      },
    ],
  },
  {
    title: 'CellDL diagrams',
    settings: [
      {
        key: 'arrowStyle',
        type: 'select',
        label: 'Bond arrowheads',
        description: 'How the end of each bond is drawn. Only the display changes; saved diagrams are not altered.',
        options: [
          { value: 'classic', label: 'Classic', hint: 'A closed arrowhead' },
          { value: 'bond', label: 'Bond graph', hint: 'A half arrow (⇀), one barb on the left of the bond' },
        ],
        default: 'classic',
      },
      {
        key: 'celldlWheelMode',
        type: 'select',
        label: 'Scrolling in CellDL diagrams',
        description:
          'What the mouse wheel and two-finger trackpad scrolling do over a diagram. Pinching, or scrolling with Ctrl or Cmd held, always zooms.',
        options: [
          { value: 'auto', label: 'Automatic', hint: 'A mouse wheel zooms; a trackpad pans' },
          { value: 'pan', label: 'Pan', hint: 'Scrolling moves the diagram; hold Shift to move it sideways' },
          { value: 'zoom', label: 'Zoom', hint: 'Scrolling zooms around the pointer' },
        ],
        default: 'auto',
      },
      {
        key: 'celldlLocationShading',
        type: 'toggle',
        label: 'Location shading',
        description:
          "Shade the regions of a diagram that its elements' locations mark out. Only the display changes; the CellDL tab's status bar has the same switch.",
        default: true,
      },
      {
        key: 'celldlUnitSystem',
        type: 'select',
        label: 'New CellDL modules: unit system',
        description:
          "The units a new module's diagram builds its CellML in. Each module keeps its own, which its Parameters tab changes; a diagram saved without one is SI.",
        options: [
          { value: 'cellular', label: 'Cellular (fmol, pL)', hint: 'Amounts in fmol and volumes in pL, so cell-sized values are near 1' },
          { value: 'si', label: 'SI (mol, L)', hint: "The BG-RDF templates' own units" },
        ],
        default: 'cellular',
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
