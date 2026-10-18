import { useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { useFlowHistoryFor } from './useFlowHistoryFor'
import { useGtm } from './useGtm'
import { useClearWorkspace } from '../composables/useClearWorkspace'
import { buildWorkflowGraph } from '../services/import/buildWorkflow'
import { importCaModuleArray } from '../services/import/caFold'
import { looksLikeSupermoduleInstance } from '../services/import/caModuleArray'
import { moduleRefOf } from '../services/import/caModuleConfig'
import { layoutSupermoduleScopes } from '../services/layouts/scopes'
import { warnDeprecatedJunctions } from '../services/caRules'
import { notify } from '../utils/notify'
import { skippedParametersMessage } from '../utils/parameters'
import { useWorkflowLayout } from './useWorkflowLayout'

/**
 * @param {object} [options]
 * @param {object|import('vue').Ref<object>} [options.fitViewParams] fitView options applied after layout.
 */
export function useLoadFromInstanceArray({ fitViewParams } = {}) {
  const { addNodes, addEdges } = useVueFlow()
  const store = useLibraryStore()
  const { trackEvent } = useGtm()
  const { clearWorkspace } = useClearWorkspace()
  const { prepareLayout } = useWorkflowLayout({ fitViewParams })
  const history = useFlowHistoryFor()

  /** Whether a module array instantiates super-modules, which are imported as super instances. */
  const hasSupermodules = (rows) =>
    rows.some((row) => !!store.availableSupermodules?.has(moduleRefOf(row.module_type, row.module_subtype)) || looksLikeSupermoduleInstance(row))

  /**
   * Builds a module array with super-modules as super instances (see caFold.importCaModuleArray), its parameters applied:
   * the host file's, and the super-modules' parameterisations the library holds. It reads the workspace it replaces
   * as empty, and sets nothing, so a module array it can't build leaves the workspace as it was.
   */
  const buildFolded = async (instanceArray) => {
    const folded = importCaModuleArray(
      instanceArray.instances,
      {
        supermodules: store.availableSupermodules,
        modules: store.availableModules,
        getMathAnalysis: store.getMathAnalysis,
        getMathDefaults: store.getMathDefaults,
        variants: store.caVariants,
      },
      { source: instanceArray.source, load: store.caParameterLoader(), hostRows: instanceArray.parameters ?? [], currentNodes: [] }
    )
    await layoutSupermoduleScopes(folded.nodes, folded.edges, { keep: folded.positioned })
    const rootIds = new Set(folded.nodes.filter((node) => !node.hidden).map((node) => node.id))
    const isRoot = (edge) => rootIds.has(edge.source) && rootIds.has(edge.target)
    return {
      pendingInstances: folded.nodes,
      pendingEdges: folded.edges.filter(isRoot),
      scopeEdges: folded.edges.filter((edge) => !isRoot(edge)),
      conflicts: folded.conflicts,
      globals: folded.globals,
      warnings: folded.warnings,
      skipped: folded.skipped,
      ivcZeroedHearts: [],
      parametersApplied: true,
    }
  }

  /**
   * Replaces the workspace with a CA module array's modules and connections. Super-module instances become
   * super instances, with the module array's parameters applied (see buildFolded); a flat array is built as it always was.
   * The workspace is cleared only once the module array is built, so one that fails leaves it as it was.
   *
   * @param {{instances: Array, parameters?: Array, source?: string}} instanceArray - The module array rows, and the
   *   host parameters file's rows, which a module array with super-modules applies itself.
   * @param {Function|null} [progressCallback]
   * @returns {Promise<{ivcZeroedHearts: string[], parametersApplied: boolean}>} The hearts whose ivc flow CA's rule
   *   set to 0, which the module array's parameters file must not set (see withoutZeroedIvcRows); and whether the
   *   parameters were applied already.
   * @throws {Error} when the module array can't be built; the caller reports it.
   */
  const loadFromInstanceArray = async (instanceArray, progressCallback = null) => {
    try {
      if (progressCallback) {
        progressCallback(0, instanceArray.instances.length, 'Building graph...')
      }

      const result = hasSupermodules(instanceArray.instances) ? await buildFolded(instanceArray) : buildWorkflowGraph(
        instanceArray.instances,
        store.availableModules,
        store.getMathAnalysis,
        // The workspace is replaced, so no id is taken.
        [],
        progressCallback,
        store.getMathDefaults,
        { caRules: true, variants: store.caVariants }
      )

      if (progressCallback) {
        progressCallback(
          instanceArray.instances.length,
          instanceArray.instances.length,
          'Graph built, calculating layout...'
        )
      }

      await clearWorkspace({ recordHistory: false })
      for (const { name, value, units, data_reference } of result.globals ?? []) store.assignGlobalConstant(name, value, units, data_reference)

      if (result.warnings?.length) {
        notify.warning({ title: 'Module Array Imported With Warnings', items: result.warnings, sticky: true })
      }
      // As loading the parameters file warns for a flat module array.
      if (result.skipped?.length) {
        notify.warning({ title: 'Some Parameters Not Applied', items: [skippedParametersMessage(result.skipped)], sticky: true })
      }
      if (result.conflicts.length) {
        notify.warning({ title: 'Connections Not Made', items: result.conflicts, sticky: true })
      }
      warnDeprecatedJunctions(instanceArray.instances.map((instance) => instance.module_type ?? ''))

      // 1. Prepare the layout promise chain
      const layoutPromise = prepareLayout(result.pendingEdges, progressCallback)

      // 2. Add nodes as a single undoable batch so this import is not split into
      //    separate node and edge history entries.
      history.startBatch()
      try {
        addNodes(result.pendingInstances)
        // The edges inside super-modules join nodes not drawn, so the root's layout leaves them out.
        if (result.scopeEdges?.length) addEdges(result.scopeEdges)
      } finally {
        history.endBatch()
      }

      // 3. Await the layout completion
      await layoutPromise

      trackEvent('workflow_load_action', {
        category: 'Workflow',
        action: 'load_from_instance_array',
        label: `Modules: ${instanceArray.instances.length}`,
        file_type: 'instance_array',
      })
      return { ivcZeroedHearts: result.ivcZeroedHearts ?? [], parametersApplied: !!result.parametersApplied }
    } catch (error) {
      trackEvent('workflow_load_action', {
        category: 'Workflow',
        action: 'load_from_instance_array',
        label: `Error: ${error.message}`,
        file_type: 'instance_array',
      })
      throw error
    }
  }

  return { loadFromInstanceArray }
}
