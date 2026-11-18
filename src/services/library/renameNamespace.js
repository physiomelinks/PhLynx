/**
 * Renames a namespace across saved state: the library's math, modules and units, the parameter sets for that math,
 * and the workspace nodes using them. Each works on a state as getState gives it, and returns a new one.
 */
import { renameFileNamespace, renameModuleNamespace } from '../../utils/namespaces'

const renameEntries = (entries, renameKey) => (entries ?? []).map(([key, value]) => [renameKey(key), value])

/**
 * Renames a namespace in a library state (libraryStore.getState).
 *
 * @param {Object} state
 * @param {string|null} from - '' or null for none.
 * @param {string|null} to - '' or null for none.
 * @returns {Object}
 */
export function renameNamespaceInLibrary(state, from, to) {
  const file = (key) => renameFileNamespace(key, from, to)
  const module = (ref) => renameModuleNamespace(ref, from, to)
  return {
    ...state,
    availableCollections: (state.availableCollections ?? []).map(([mathRef, refs]) => [file(mathRef), refs.map(module)]),
    availableMath: renameEntries(state.availableMath, file),
    availableModules: (state.availableModules ?? []).map(([ref, value]) => [
      module(ref),
      { ...value, moduleRef: module(value.moduleRef), mathRef: file(value.mathRef) },
    ]),
    availableUnits: (state.availableUnits ?? []).map((units) => ({ ...units, componentFile: file(units.componentFile) })),
    mathDefaults: renameEntries(state.mathDefaults, file),
    mathLayouts: renameEntries(state.mathLayouts, file),
    mathSources: renameEntries(state.mathSources, file),
    ...(state.moduleAnnotations && { moduleAnnotations: renameEntries(state.moduleAnnotations, file) }),
    ...(state.steadyStateConfigs && { steadyStateConfigs: renameEntries(state.steadyStateConfigs, file) }),
  }
}

/**
 * Renames a namespace in a default-parameters state (defaultParametersStore.getState): the sets of its math, and the
 * unlinked sets waiting for its configs.
 *
 * @param {{ sets?: Array, unlinked?: Array }} state
 * @param {string|null} from
 * @param {string|null} to
 * @returns {Object}
 */
export function renameNamespaceInParameters(state, from, to) {
  const renameSetKey = (key) => {
    const at = key.lastIndexOf(':')
    return `${renameFileNamespace(key.slice(0, at), from, to)}${key.slice(at)}`
  }
  const target = (namespace) => (namespace === (from || '') ? to || '' : namespace)
  return {
    ...state,
    sets: renameEntries(state.sets, renameSetKey),
    unlinked: (state.unlinked ?? []).map(([ref, set]) => [
      ref,
      typeof set?.namespace === 'string' ? { ...set, namespace: target(set.namespace) } : set,
    ]),
  }
}

/**
 * The data a node has once a namespace is renamed, or null when the node uses nothing in it.
 *
 * @param {Object} data - A node's data.
 * @param {string|null} from
 * @param {string|null} to
 * @returns {Object|null}
 */
export function renameNamespaceInNodeData(data, from, to) {
  const mathRef = renameFileNamespace(data?.mathRef, from, to)
  const moduleRef = renameModuleNamespace(data?.moduleRef, from, to)
  if (mathRef === data?.mathRef && moduleRef === data?.moduleRef) return null
  return { ...data, mathRef, moduleRef }
}
