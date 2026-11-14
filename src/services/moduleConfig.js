import { parseMathRef, parseModuleRef, restorePorts, restoreVariables } from '../utils/config'
import { isAnnotatedPort } from '../utils/portIdentity'
import { detachReactivity } from '../utils/reactivity'
import { syncInitialiserUnits } from '../utils/variables'
import { isSoleOwnConfig } from './configOwnership'
import { buildInstance } from './import/buildWorkflow'
import { getModuleFormat } from './moduleFormats'

/**
 * Makes a module's CA config entry. Annotated ports are left out: each instance's side-car gives them, and CA pairs
 * ports by label, which they have none of, so they are never part of a config.
 *
 * @param {{moduleRef: string, mathRef: string, ports: Array, variables: Array}} module - A node's data or a library module;
 *   its library module gives `default_parameterisation` when it names none.
 * @param {Object} [libraryStore] - The library, for the math's format, default set and the keys its config had that
 *   PhLynx doesn't edit (api, delay_info, ...), which the entry keeps; without it, the default format's and none of those.
 * @returns {Object}
 */
export function moduleConfigEntry(module, libraryStore) {
  const portsByType = restorePorts((module.ports ?? []).filter((port) => !isAnnotatedPort(port)))
  const { componentFile, componentName } = parseMathRef(module.mathRef)
  const { moduleType, moduleSubtype } = parseModuleRef(module.moduleRef)
  const defaultParameterisation =
    module.defaultParameterisation ?? libraryStore?.availableModules?.get(module.moduleRef)?.defaultParameterisation
  const extras = libraryStore?.availableModules?.get(module.moduleRef)?.configExtras
  const moduleFormat = getModuleFormat(libraryStore?.getMathFormat?.(module.mathRef)).caModuleFormat
  return {
    ...extras,
    module_type: moduleType,
    module_subtype: moduleSubtype,
    module_format: extras?.module_format && moduleFormat === 'cellml' ? extras.module_format : moduleFormat,
    component_file: componentFile,
    component_type: componentName,
    ...(defaultParameterisation && { default_parameterisation: defaultParameterisation }),
    entrance_ports: portsByType.entrance_ports || [],
    exit_ports: portsByType.exit_ports || [],
    general_ports: portsByType.general_ports || [],
    variables_and_units: restoreVariables(module.variables),
  }
}

/**
 * Identifies a config entry by everything but its subtype, its default parameter set and its variables' order, so
 * instances with the same edits share one.
 *
 * @param {Object} entry - A config entry (see moduleConfigEntry).
 * @returns {string}
 */
export function configSignature(entry) {
  const { module_subtype, default_parameterisation, variables_and_units, ...rest } = entry
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
 * @param {Object} [libraryStore] - The library, for the math's format (see moduleConfigEntry).
 * @returns {string[]}
 */
export function moduleSignatures(module, analysis, defaults = new Map(), libraryStore) {
  if (!module) return []
  const dropped = buildInstance(null, '', null, module, [], null, analysis, defaults).data
  return [dropped, module].map((config) => configSignature(moduleConfigEntry(config, libraryStore)))
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
  return moduleSignatures(libraryModule, analysis, defaults, libraryStore)
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

/**
 * Works out what an edit to an instance's ports outside the instance editor, such as in the connection dialog, does
 * to its module. Couplings don't count: an edit that leaves the instance's config as it was, or makes it its
 * module's again, needs no change. A config the instance made, and alone uses, is updated without asking (see
 * configOwnership); any other config asks, even one no other instance uses.
 *
 * @param {{id: string, data: Object}} node - The instance as it was.
 * @param {Array} ports - Its ports after the edit.
 * @param {Array} nodes - Every node, for the module's other instances.
 * @param {Object} libraryStore - The library, for the module and its math's analysis.
 * @param {Object} [module] - The module as earlier choices in the same edit leave it, the stored one by default.
 * @returns {{action: 'update'}|{prompt: {moduleRef: string, otherCount: number, canUpdate: boolean}}|null} The
 *   module change, what to ask about it, or null when the module needs no change.
 */
export function portEditConfig(node, ports, nodes, libraryStore, module = libraryStore.availableModules.get(node.data?.moduleRef)) {
  if (!module) return null
  const edited = { ...node.data, ports }
  const signature = (config) => configSignature(moduleConfigEntry(config))
  if (signature(node.data) === signature(edited)) return null
  if (isModuleConfig(edited, module, libraryStore.getMathAnalysis?.(module.mathRef) ?? null)) return null

  const otherCount = nodes.filter((other) => other.id !== node.id && other.data?.moduleRef === module.moduleRef).length
  if (isSoleOwnConfig(module, node.id, otherCount)) return { action: 'update' }
  return { prompt: { moduleRef: module.moduleRef, otherCount, canUpdate: node.data.mathRef === module.mathRef } }
}
