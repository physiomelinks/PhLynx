import { useLibraryStore } from '../stores/libraryStore'
import { buildCouplingContext } from '../services/annotations/couple'

/**
 * The annotation context canCouple reads, from the library's side-cars.
 *
 * @returns {{ getContext: (nodes?: Array<Object>) => Object, ensureContext: (nodes?: Array<Object>) => Promise<Object> }}
 *   getContext is synchronous and reactive: it reads only what is already parsed. ensureContext parses the given
 *   nodes' side-cars first.
 */
export function useCouplingContext() {
  const libraryStore = useLibraryStore()

  /**
   * @param {Array<Object>} [nodes] - Workspace nodes.
   * @returns {Object} From buildCouplingContext.
   */
  function getContext(nodes) {
    return buildCouplingContext({
      sidecarFor: (mathRef) => libraryStore.getParsedModuleAnnotations(mathRef),
      nodes,
    })
  }

  /**
   * @param {Array<Object>} [nodes] - The nodes whose side-cars to parse, also passed to getContext.
   * @returns {Promise<Object>} From buildCouplingContext.
   */
  async function ensureContext(nodes = []) {
    const mathRefs = [...new Set(nodes.map((node) => node.data?.mathRef).filter(Boolean))]
    await Promise.all(mathRefs.map((mathRef) => libraryStore.ensureModuleAnnotations(mathRef)))
    return getContext(nodes)
  }

  return { getContext, ensureContext }
}
