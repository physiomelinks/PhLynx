/**
 * Parameter sliders: constants and global constants whose values a run can try out without changing the
 * model. They are the parameter scan selections in simulationSettingsStore.parameterScanConfig, which
 * SimSettingsDialog also edits and the OMEX export writes for web OpenCOR.
 */

/** The row types a slider can vary. An initial value (`<state>_init`) is a constant row. */
const SLIDABLE_TYPES = new Set(['constant', 'global_constant'])

/**
 * Checks whether a row can have a slider.
 *
 * @param {Object} row
 * @returns {boolean}
 */
export function isSlidableRow(row) {
  return Boolean(row?.name) && SLIDABLE_TYPES.has(row.type)
}

/**
 * Picks a row's current value as a number.
 *
 * @param {Object} row
 * @param {Function} getGlobalConstant - libraryStore.getGlobalConstant.
 * @returns {number|null}
 */
export function pickDefaultValue(row, getGlobalConstant) {
  // A global constant's value is shared, so a node's own copy may be out of date.
  const value = row.type === 'global_constant' ? getGlobalConstant(row.name)?.value : row.value
  const candidate = row.defaultValue ?? row.initialValue ?? value
  const numeric = Number(candidate)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * Gives the range a slider starts with: 10% either side of the value.
 *
 * @param {number|null} defaultValue
 * @returns {{min: number|null, max: number|null}}
 */
export function computeScanBounds(defaultValue) {
  if (defaultValue === null || defaultValue === undefined || Number.isNaN(defaultValue)) return { min: null, max: null }
  const spread = Math.abs(defaultValue) * 0.1
  return { min: defaultValue - spread, max: defaultValue + spread }
}

/**
 * Builds a slider definition for a node's row, as a parameter scan selection.
 *
 * @param {Object} node
 * @param {Object} row
 * @param {Function} getGlobalConstant
 * @returns {Object}
 */
export function createSliderDefinition(node, row, getGlobalConstant) {
  const defaultValue = pickDefaultValue(row, getGlobalConstant)
  const bounds = computeScanBounds(defaultValue)
  return {
    key: `${node.id}::${row.name}`,
    nodeId: node.id,
    nodeName: node.data.name,
    parameterName: row.name,
    selected: true,
    units: row.units || '',
    type: row.type,
    min: bounds.min,
    default: defaultValue,
    max: bounds.max,
    step: null,
    // A display name, such as a CUFLynx params_for_id `name_for_plotting`; null falls back to nodeName/parameterName.
    label: null,
  }
}

/**
 * Builds one row per slidable variable across the nodes, carrying any existing slider's settings.
 *
 * @param {Array<Object>} nodes
 * @param {Map<string, Object>} selectedByKey - Existing selections by key.
 * @param {Function} getGlobalConstant
 * @returns {Array<Object>} Rows sorted by node name, then parameter name.
 */
export function buildParameterScanRows(nodes, selectedByKey, getGlobalConstant) {
  const rows = []
  for (const node of nodes || []) {
    if (!node?.data?.name) continue
    for (const variable of node.data.variables || []) {
      if (!isSlidableRow(variable)) continue
      const definition = createSliderDefinition(node, variable, getGlobalConstant)
      const existing = selectedByKey.get(definition.key)
      rows.push({
        ...definition,
        selected: existing?.selected ?? false,
        default: existing?.default ?? definition.default,
        min: existing?.min ?? definition.min,
        max: existing?.max ?? definition.max,
        step: existing?.step ?? null,
        label: existing?.label ?? definition.label,
      })
    }
  }
  return rows.sort((a, b) => a.nodeName.localeCompare(b.nodeName) || a.parameterName.localeCompare(b.parameterName))
}

/**
 * Adds or replaces a slider definition.
 *
 * @param {Object} scanConfig - parameterScanConfig.
 * @param {Object} definition
 * @returns {Object} The new config.
 */
export function putSlider(scanConfig, definition) {
  const selections = (scanConfig?.selections ?? []).filter((selection) => selection.key !== definition.key)
  return { ...scanConfig, selections: [...selections, definition] }
}

/**
 * Removes a slider definition.
 *
 * @param {Object} scanConfig
 * @param {string} key
 * @returns {Object} The new config.
 */
export function removeSlider(scanConfig, key) {
  return { ...scanConfig, selections: (scanConfig?.selections ?? []).filter((selection) => selection.key !== key) }
}

/**
 * Gets the key a slider's value is kept under: a global constant's sliders share one value, whichever node
 * they were added on.
 *
 * @param {Object} definition
 * @returns {string}
 */
export function sliderValueKey(definition) {
  return definition.type === 'global_constant' ? `global::${definition.parameterName}` : definition.key
}

/**
 * Turns slider values into the overrides a run applies, for the sliders still defined.
 *
 * @param {Array<Object>} definitions - parameterScanConfig.selections.
 * @param {Map<string, number>} values - Slider values by sliderValueKey.
 * @returns {{rows: Map<string, number>, globals: Map<string, number>}}
 */
export function buildParameterOverrides(definitions, values) {
  const rows = new Map()
  const globals = new Map()
  for (const definition of definitions ?? []) {
    const key = sliderValueKey(definition)
    if (!values.has(key)) continue
    const value = values.get(key)
    if (definition.type === 'global_constant') globals.set(definition.parameterName, value)
    else rows.set(definition.key, value)
  }
  return { rows, globals }
}
