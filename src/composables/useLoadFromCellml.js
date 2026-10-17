import { useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { useFlowHistoryFor } from './useFlowHistoryFor'
import { notify } from '../utils/notify'
import { useGtm } from './useGtm'
import { useClearWorkspace } from '../composables/useClearWorkspace'
import { buildWorkflowGraph } from '../services/import/buildWorkflow'
import { foldEncapsulation } from '../services/import/cellmlFold'
import { layoutSupermoduleScopes } from '../services/layouts/scopes'
import { escapeHtml } from '../utils/importBatch'
import { useWorkflowLayout } from './useWorkflowLayout'
import { PARAMETER_COMPONENT_NAMES } from '../utils/constants'

function applyParameterTypes(mod, parameterData) {
  const localParams = parameterData.parameters?.[mod.name] ?? []
  const globalParamNames = new Set((parameterData.globalParameters ?? []).map((p) => p.name?.trim()).filter(Boolean))

  mod.variables = mod.variables.map((variable) => {
    const trimmedName = variable.name.trim()

    const localParam = localParams.find((p) => p.name?.trim() === trimmedName)
    if (localParam) {
      return {
        ...variable,
        value: localParam.value?.trim() ?? variable.value,
        data_reference: localParam.data_reference?.trim() ?? variable.data_reference,
        type: 'constant',
      }
    }

    if (globalParamNames.has(trimmedName)) {
      return {
        ...variable,
        type: 'global_constant',
      }
    }

    return variable
  })

  return mod
}

/**
 * @param {object} [options]
 * @param {object|import('vue').Ref<object>} [options.fitViewParams] fitView options applied after layout.
 */
export function useLoadFromCellML({ fitViewParams } = {}) {
  const { nodes: currentNodes, addNodes, addEdges } = useVueFlow()
  const store = useLibraryStore()
  const { trackEvent } = useGtm()
  const { clearWorkspace } = useClearWorkspace()
  const { prepareLayout } = useWorkflowLayout({ fitViewParams })
  const history = useFlowHistoryFor()

  /**
   * Replaces the workspace with a CellML model's components and connections. An encapsulating component becomes a
   * super-module with one super instance (see cellmlFold.foldEncapsulation).
   *
   * @param {Object} parsedCellmlPayload - From parseCellMLConnections, of the hoisted model.
   * @param {string} componentFile
   * @param {Object|null} [parameterData] - From loadParametersFromCellML.
   * @param {Object} [options]
   * @param {Map<string, string[]>} [options.encapsulation] - The model's encapsulation (see readEncapsulation); flat
   *   without one.
   * @param {Array} [options.reserved=[]] - Nodes about to be put back, whose ids and super-module names are taken.
   */
  const loadFromCellML = async (parsedCellmlPayload, componentFile, parameterData = null, { encapsulation, reserved = [] } = {}) => {
    try {
      await clearWorkspace({ recordHistory: false })

      const { components = [], modules = [], edges = [], cellmlModuleSubtype } = parsedCellmlPayload

      if (edges.length === 0) {
        notify.info({
          title: 'No Connections Found',
          message: `${componentFile} contains no inter-component connections.`,
        })
        return
      }

      let liveComponents = new Set(components.filter((name) => !PARAMETER_COMPONENT_NAMES.has(name)))
      const liveEdges = edges.filter(
        (e) => !PARAMETER_COMPONENT_NAMES.has(e.source) && !PARAMETER_COMPONENT_NAMES.has(e.target)
      )

      const namesWithEdges = new Set(liveEdges.flatMap((e) => [e.source, e.target]))
      liveComponents = new Set([...liveComponents].filter((name) => namesWithEdges.has(name)))

      const prunedComponents = components.filter((name) => liveComponents.has(name))
      const prunedModules = modules.filter((mod) => liveComponents.has(mod.name))
      const prunedEdges = liveEdges

      if (parameterData) {
        prunedModules.forEach((mod) => applyParameterTypes(mod, parameterData))

        for (const p of parameterData.globalParameters ?? []) {
          store.assignGlobalConstant(p.name, p.value, p.units, p.data_reference)
        }
      }

      prunedModules.forEach((mod) => {
        store.addModule(mod)
      })

      const instanceRefs = prunedComponents.map((compName) => {
        const outInstances = prunedEdges
          .filter((e) => e.source === compName)
          .map((e) => e.target)
          .join(' ')

        const inInstances = prunedEdges
          .filter((e) => e.target === compName)
          .map((e) => e.source)
          .join(' ')

        return {
          name: compName,
          module_type: `${compName}`,
          module_subtype: cellmlModuleSubtype,
          out_instances: outInstances,
          inp_instances: inInstances,
        }
      })

      const result = buildWorkflowGraph(
        instanceRefs,
        store.availableModules,
        store.getMathAnalysis,
        currentNodes.value,
        null,
        store.getMathDefaults
      )

      if (result.conflicts.length) {
        notify.warning({ title: 'Connections Not Made', message: result.conflicts.join(' ') })
      }

      let { pendingInstances, pendingEdges } = result
      let scopeEdges = []
      const folded = encapsulation?.size ? foldEncapsulation(pendingInstances, pendingEdges, encapsulation, { file: componentFile, reserved }) : null
      if (folded?.supermodules.length) {
        if (folded.warnings.length) notify.warning({ title: 'Encapsulation Imported With Warnings', message: folded.warnings.map(escapeHtml).join('<br>') })
        await layoutSupermoduleScopes(folded.nodes, folded.edges)
        pendingInstances = folded.nodes
        pendingEdges = folded.edges.filter((edge) => !edge.hidden)
        scopeEdges = folded.edges.filter((edge) => edge.hidden)
      }

      const layoutPromise = prepareLayout(pendingEdges)
      history.startBatch()
      try {
        addNodes(pendingInstances)
        // The edges inside super-modules join nodes not drawn, so the root's layout leaves them out.
        if (scopeEdges.length) addEdges(scopeEdges)
      } finally {
        history.endBatch()
      }

      await layoutPromise

      trackEvent('cellml_connection_load', {
        category: 'CellML',
        action: 'load_from_cellml_connections',
        label: `Components: ${prunedComponents.length}, Edges: ${prunedEdges.length}`,
        file_type: 'cellml',
      })
    } catch (error) {
      notify.error({ message: `Failed to load CellML connections: ${error.message}` })
      throw error
    }
  }

  return { loadFromCellML }
}
