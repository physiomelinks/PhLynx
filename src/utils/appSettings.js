/**
 * A toolbar button's show/hide setting. The Settings button itself is always shown, so hidden buttons can come back.
 *
 * @param {string} key
 * @param {string} label
 * @param {string} description
 * @param {boolean} shown - Whether the button is shown by default.
 */
function toolbarToggle(key, label, description, shown) {
  return { key, type: 'toggle', label, description: `Show ${description}`, default: shown }
}

/**
 * The settings, by section, in the order the dialog lists its sections. Each `select` setting offers `options`, each
 * with an optional `hint` shown beneath its label; a `toggle` setting is on or off. A section may open with an `intro`,
 * and one whose `layout` is 'checklist' shows its toggles as a compact list of checkboxes.
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
    title: 'Physiological view',
    settings: [
      {
        key: 'autoPlotSelection',
        type: 'toggle',
        label: 'Auto-plot selection',
        description:
          'Plot what is selected from its annotations: a protein’s flows, a compartment’s concentrations, ' +
          'a membrane’s potential.',
        default: true,
      },
      {
        key: 'speciesFlowContinuous',
        type: 'toggle',
        label: 'Keep species flows moving',
        description:
          'In species mode, keep the dashes on each path running the way its species flows. Off, they run a few ' +
          'times and then rest, which is lighter on slower machines; a selected species’ paths always run.',
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
  {
    title: 'Appearance',
    settings: [
      {
        key: 'accentColour',
        type: 'select',
        label: 'Accent colour',
        description: 'The colour of the main buttons, links, selections and highlights.',
        options: [
          { value: 'copper', label: 'Copper', hint: 'The brown of the PhLynx icon, more saturated' },
          { value: 'logoBrown', label: 'Logo brown', hint: 'The brown of the PhLynx icon' },
          { value: 'emerald', label: 'Emerald', hint: 'The green PhLynx used before' },
        ],
        default: 'copper',
      },
      {
        key: 'showHints',
        type: 'toggle',
        label: 'Show hints',
        description:
          'Name a button, such as Save workspace, when the pointer rests on it. Tooltips that warn, or say why ' +
          'something is unavailable, show either way.',
        default: true,
      },
    ],
  },
  {
    title: 'Toolbar',
    layout: 'checklist',
    intro: 'The buttons the workspace toolbar shows. Settings is always shown, so hidden buttons can come back.',
    settings: [
      toolbarToggle('toolbarLoad', 'Load workspace', 'the folder button that opens a saved workspace.', true),
      toolbarToggle(
        'toolbarSave',
        'Save workspace',
        'the disk button that saves the workspace. Ctrl/Cmd+S saves either way.',
        true
      ),
      toolbarToggle(
        'toolbarCleanUp',
        'Clean up workspace',
        'the brush button that lays the instances out again.',
        true
      ),
      toolbarToggle(
        'toolbarClear',
        'Clear workspace',
        'the eraser button that removes everything from the canvas.',
        true
      ),
      toolbarToggle(
        'toolbarUndoRedo',
        'Undo and redo',
        'the undo and redo buttons. Their shortcuts work either way.',
        true
      ),
      toolbarToggle(
        'toolbarAddHandles',
        'Add handles',
        'the four buttons that add a handle to one side of the selected instances.',
        false
      ),
      toolbarToggle('toolbarMacroBuilder', 'Macro builder', 'the hammer button that opens the macro builder.', false),
      toolbarToggle(
        'toolbarSimulationSettings',
        'Simulation settings',
        'the button that opens the simulation settings.',
        true
      ),
      toolbarToggle('toolbarImport', 'Import', 'the Import menu. Ctrl/Cmd+I imports either way.', true),
      toolbarToggle('toolbarExport', 'Export', 'the Export menu. Ctrl/Cmd+E exports either way.', true),
      toolbarToggle('toolbarSendTo', 'Send to', 'the Send menu, which sends the model to another tool.', false),
    ],
  },
]

/**
 * Settings the dialog does not list: each is a switch in the view it changes, remembered as it was last left.
 */
export const REMEMBERED_SETTINGS = [
  // The physiological view's Show species button, and Species Mode on its right-click menu.
  { key: 'speciesOverlay', type: 'toggle', label: 'Species mode', default: false },
  // The Shading switch in the CellDL tab's status bar.
  { key: 'celldlLocationShading', type: 'toggle', label: 'Location shading', default: true },
  // The button on the corner of a view's minimap, and the map button that brings the minimap back.
  { key: 'showMiniMap', type: 'toggle', label: 'Minimap', default: true },
]

/** Each setting's definition, by key. */
export const APP_SETTINGS = new Map(
  [...SETTING_SECTIONS.flatMap((section) => section.settings), ...REMEMBERED_SETTINGS].map((setting) => [
    setting.key,
    setting,
  ])
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

/**
 * Which workspace toolbar dividers show: one before each shown group that follows another shown group.
 *
 * @param {Object<string, *>} settings - The app settings.
 * @returns {Object<string, boolean>} By the group each divider comes before; `toolsLead` is whether a tools button
 *   precedes Settings, which then needs its gap.
 */
export function shownToolbarDividers(settings) {
  const file = settings.toolbarLoad || settings.toolbarSave
  const edit = settings.toolbarCleanUp || settings.toolbarClear
  const undoRedo = settings.toolbarUndoRedo
  const addHandles = settings.toolbarAddHandles
  return {
    cleanUp: edit && file,
    undoRedo: undoRedo && (file || edit),
    addHandles: addHandles && (file || edit || undoRedo),
    // The tools group always holds the Settings button.
    tools: file || edit || undoRedo || addHandles,
    toolsLead: settings.toolbarMacroBuilder || settings.toolbarSimulationSettings,
    transfer: settings.toolbarImport || settings.toolbarExport || settings.toolbarSendTo,
  }
}
