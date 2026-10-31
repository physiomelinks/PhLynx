import { useAnnotationStore } from '../stores/annotationStore'
import { useLibraryStore } from '../stores/libraryStore'
import { buildCouplingContext } from '../services/annotations/couple'

/**
 * The annotation context canCouple reads, from the loaded instance files and the library's sidecars.
 *
 * @returns {{ getContext: (nodes?: Array<Object>) => Object, ensureContext: (nodes?: Array<Object>) => Promise<Object> }}
 *   getContext is synchronous and reactive: it reads only what is already parsed. ensureContext parses the
 *   instance files and the given nodes' sidecars first.
 */
export function useCouplingContext() {
  const annotationStore = useAnnotationStore()
  const libraryStore = useLibraryStore()

  /**
   * @param {Array<Object>} [nodes] - Workspace nodes; without them the instance files' instances are used.
   * @returns {Object} From buildCouplingContext.
   */
  function getContext(nodes) {
    return buildCouplingContext({
      apiCoords: annotationStore.getApiCoords(),
      sidecarFor: (mathRef) => libraryStore.getParsedModuleAnnotations(mathRef),
      nodes,
    })
  }

  /**
   * @param {Array<Object>} [nodes] - The nodes whose sidecars to parse, also passed to getContext.
   * @returns {Promise<Object>} From buildCouplingContext.
   */
  async function ensureContext(nodes = []) {
    const mathRefs = [...new Set(nodes.map((node) => node.data?.mathRef).filter(Boolean))]
    await Promise.all([
      annotationStore.ensureApiCoords(),
      ...mathRefs.map((mathRef) => libraryStore.ensureModuleAnnotations(mathRef)),
    ])
    return getContext(nodes.length ? nodes : undefined)
  }

  return { getContext, ensureContext }
}
