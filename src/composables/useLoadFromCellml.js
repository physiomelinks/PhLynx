import { useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { notify } from '../utils/notify'
import { useGtm } from './useGtm'
import { useClearWorkspace } from '../composables/useClearWorkspace'
import { buildWorkflowGraph } from '../services/import/buildWorkflow'
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
  const { nodes: currentNodes, addNodes } = useVueFlow()
  const store = useLibraryStore()
  const { trackEvent } = useGtm()
  const { clearWorkspace } = useClearWorkspace()
  const { prepareLayout } = useWorkflowLayout({ fitViewParams })

  const loadFromCellML = async (parsedCellmlPayload, componentFile, parameterData = null) => {
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

      const layoutPromise = prepareLayout(result.pendingEdges)
      const history = useFlowHistoryStore()
      history.startBatch()
      try {
        addNodes(result.pendingInstances)
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
