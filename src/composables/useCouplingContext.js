import { useLibraryStore } from '../stores/libraryStore'
import { useBioTemplateStore } from '../stores/bioTemplateStore'
import { buildCouplingContext } from '../services/annotations/couple'
import { locationSource } from '../services/annotations/locationSources'

/**
 * The annotation context canCouple and the matcher read: the library's side-cars, and the places the location
 * source gives nodes (by default where they sit in the physiology view).
 *
 * @returns {{ getContext: (nodes?: Array<Object>) => Object, ensureContext: (nodes?: Array<Object>) => Promise<Object> }}
 *   getContext is synchronous and reactive: it reads only what is already parsed. ensureContext parses the given
 *   nodes' side-cars, and loads what the location source reads, first.
 */
export function useCouplingContext() {
  const libraryStore = useLibraryStore()
  const bioTemplateStore = useBioTemplateStore()

  /**
   * @param {Array<Object>} [nodes] - Workspace nodes: every node, so a node's places can name the cell it is on.
   * @param {Object} [options]
   * @param {(mathRef: string) => Object|null|undefined} [options.sidecarFor] - Side-cars to read first, e.g. as a
   *   save leaves them; undefined falls back to the library's.
   * @returns {Object} From buildCouplingContext.
   */
  function getContext(nodes, { sidecarFor } = {}) {
    const source = locationSource()
    return buildCouplingContext({
      sidecarFor: (mathRef) => sidecarFor?.(mathRef) ?? libraryStore.getParsedModuleAnnotations(mathRef),
      nodes,
      source,
      data: {
        instances: bioTemplateStore.instances ?? [],
        definitions: bioTemplateStore.definitions ?? new Map(),
        ...(source.read?.() ?? {}),
      },
    })
  }

  /**
   * @param {Array<Object>} [nodes] - The nodes whose side-cars to parse, also passed to getContext.
   * @returns {Promise<Object>} From buildCouplingContext.
   */
  async function ensureContext(nodes = []) {
    const mathRefs = [...new Set(nodes.map((node) => node.data?.mathRef).filter(Boolean))]
    await Promise.all([
      locationSource().ensure?.(),
      ...mathRefs.map((mathRef) => libraryStore.ensureModuleAnnotations(mathRef)),
    ])
    return getContext(nodes)
  }

  return { getContext, ensureContext }
}
