import { parseMathRef, parseModuleRef, restorePorts, restoreVariables } from '../utils/config'
import { detachReactivity } from '../utils/reactivity'
import { syncInitialiserUnits } from '../utils/variables'
import { buildInstance } from './import/buildWorkflow'

/**
 * Makes a module's CA config entry.
 *
 * @param {{moduleRef: string, mathRef: string, ports: Array, variables: Array}} module - A node's data or a library module.
 * @returns {Object}
 */
export function moduleConfigEntry(module) {
  const portsByType = restorePorts(module.ports)
  const { componentFile, componentName } = parseMathRef(module.mathRef)
  const { moduleType, moduleSubtype } = parseModuleRef(module.moduleRef)
  return {
    module_type: moduleType,
    module_subtype: moduleSubtype,
    module_format: 'cellml', // TODO - will need to generalise
    component_file: componentFile,
    component_type: componentName,
    entrance_ports: portsByType.entrance_ports || [],
    exit_ports: portsByType.exit_ports || [],
    general_ports: portsByType.general_ports || [],
    variables_and_units: restoreVariables(module.variables),
  }
}

/**
 * Identifies a config entry by everything but its subtype and its variables' order, so instances with the same edits
 * share one.
 *
 * @param {Object} entry - A config entry (see moduleConfigEntry).
 * @returns {string}
 */
export function configSignature(entry) {
  const { module_subtype, variables_and_units, ...rest } = entry
  const variables = [...variables_and_units].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify({ ...rest, variables_and_units: variables })
}

/**
 * Gets the signatures of an untouched instance of a module: a fresh drop's, whose rows the math's analysis fills out,
 * then the module's own.
 *
 * @param {Object|undefined} module
 * @param {Object|null} analysis - The analysis of the module's math.
 * @param {Map<string, string>} [defaults]
 * @returns {string[]}
 */
export function moduleSignatures(module, analysis, defaults = new Map()) {
  if (!module) return []
  const dropped = buildInstance(null, '', null, module, [], null, analysis, defaults).data
  return [dropped, module].map((config) => configSignature(moduleConfigEntry(config)))
}

/**
 * Gets the signatures of an untouched instance of a library module (see moduleSignatures).
 *
 * @param {Object|undefined} libraryModule
 * @param {Object} libraryStore - The library, for its math's analysis and defaults.
 * @returns {string[]}
 */
export function librarySignatures(libraryModule, libraryStore) {
  if (!libraryModule) return []
  const analysis = libraryStore.getMathAnalysis?.(libraryModule.mathRef) ?? null
  const defaults = libraryStore.getMathDefaults?.(libraryModule.mathRef) ?? new Map()
  return moduleSignatures(libraryModule, analysis, defaults)
}

/**
 * Checks whether an instance's config (ports, math, variable names, units, access and types) is its module's. Values
 * don't count. The editor gives each state and its initialiser the same units, so a drop whose rows differ only by
 * that still matches.
 *
 * @param {{moduleRef: string, mathRef: string, ports: Array, variables: Array}} config - The instance's.
 * @param {Object|undefined} module
 * @param {Object|null} analysis - The analysis of the module's math.
 * @returns {boolean}
 */
export function isModuleConfig(config, module, analysis) {
  if (!module) return false
  const signature = configSignature(moduleConfigEntry(config))
  if (moduleSignatures(module, analysis).includes(signature)) return true
  const dropped = buildInstance(null, '', null, module, [], null, analysis).data
  return [false, true].some((overwrite) => {
    const variables = syncInitialiserUnits(detachReactivity(dropped.variables), { overwrite })
    return configSignature(moduleConfigEntry({ ...dropped, variables })) === signature
  })
}
