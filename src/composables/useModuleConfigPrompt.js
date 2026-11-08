import { ref } from 'vue'
import { portEditConfig } from '../services/moduleConfig'
import { useLibraryStore } from '../stores/libraryStore'
import { sanitiseName } from '../utils/identifiers'

/**
 * Asks, for ports edited outside the instance editor, whether each instance's module takes the edit or the instance
 * saves a new config. Show ModuleConfigSaveDialog bound to `configPrompt`, resolving with resolveConfigPrompt.
 *
 * @returns {Object} configPrompt, resolveConfigPrompt and resolvePortEdits.
 */
export function useModuleConfigPrompt() {
  const libraryStore = useLibraryStore()
  const configPrompt = ref({ visible: false, moduleRef: '', otherCount: 0, canUpdate: true, initialName: '', existingRefs: [] })
  let resolver = null

  /**
   * Shows the prompt.
   *
   * @param {{moduleRef: string, otherCount: number, canUpdate: boolean}} prompt
   * @param {string} name - The instance's name, for the new config's.
   * @param {Set<string>} taken - Module refs earlier choices in the edit took.
   * @returns {Promise<Object|null>} The chosen config, or null if cancelled.
   */
  function promptModuleConfig({ moduleRef, otherCount, canUpdate }, name, taken) {
    resolveConfigPrompt(null)
    const initialName = sanitiseName(`${moduleRef.split(':')[1] ?? ''}_${name ?? ''}`)
    const existingRefs = [...new Set([...libraryStore.availableModules.keys(), ...taken, moduleRef])]
    configPrompt.value = { visible: true, moduleRef, otherCount, canUpdate, initialName, existingRefs }
    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  function resolveConfigPrompt(config) {
    resolver?.(config)
    resolver = null
  }

  /**
   * Works out the module change each instance's ports edit makes (see portEditConfig), asking in turn when other
   * instances share the module. A later instance is checked against the modules earlier choices leave.
   *
   * @param {Array<{node: Object, ports: Array}>} edits - Each instance as it was, with its edited ports.
   * @param {Array} nodes - Every node.
   * @returns {Promise<Map<string, Object>|null>} Each changed instance's config by id, or null if cancelled.
   */
  async function resolvePortEdits(edits, nodes) {
    const configs = new Map()
    const modules = new Map()
    const taken = new Set()
    let current = nodes.map(({ id, data }) => ({ id, data: { moduleRef: data?.moduleRef } }))
    for (const { node, ports } of edits) {
      const moduleRef = node.data?.moduleRef
      const module = modules.get(moduleRef) ?? libraryStore.availableModules.get(moduleRef)
      const result = portEditConfig(node, ports, current, libraryStore, module)
      if (!result) continue
      const config = result.prompt ? await promptModuleConfig(result.prompt, node.data.name, taken) : result
      if (!config) return null
      configs.set(node.id, config)
      if (config.action === 'update') {
        modules.set(moduleRef, { ...module, mathRef: node.data.mathRef, ports, variables: node.data.variables })
      } else {
        taken.add(config.moduleRef)
        current = current.map((other) => (other.id === node.id ? { id: other.id, data: { moduleRef: config.moduleRef } } : other))
      }
    }
    return configs
  }

  return { configPrompt, resolveConfigPrompt, resolvePortEdits }
}
