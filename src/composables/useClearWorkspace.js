import { useVueFlow } from '@vue-flow/core'
import { nextTick } from 'vue'

import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useOmexStore } from '../stores/omexStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useProtocolStore } from '../stores/protocolStore'
import { cancelSimulation, forgetSimulationSession } from './useSimulation'
import { resetSliderReruns } from './useSliderReruns'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'

import { FLOW_IDS } from '../utils/constants'

export function useClearWorkspace(flowId = FLOW_IDS.MAIN) {
  const { nodes, edges, setViewport, getViewport } = useVueFlow(flowId)

  const libraryStore = useLibraryStore()
  const history = useFlowHistoryStore()
  const inspectionStore = useInspectionModuleStore()
  const simStore = useSimulationSettingsStore()
  const omexStore = useOmexStore()
  const sessionMetadataStore = useSessionMetadataStore()

  const clearWorkspace = async ({ recordHistory = true } = {}) => {
    const oldNodes = nodes.value
    const oldEdges = edges.value
    const oldInspectStore = inspectionStore.getState()
    const oldSimStore = simStore.getState()
    const oldGlobalConstants = Array.from(libraryStore.globalVariables.entries())
    const oldViewport = getViewport()
    const oldOmexState = omexStore.getState()
    const oldSessionMetadata = sessionMetadataStore.getState()

    const undoState = () => {
      nodes.value = oldNodes
      edges.value = oldEdges
      if (flowId === FLOW_IDS.MAIN) {
        omexStore.loadState(oldOmexState)
        inspectionStore.loadState(oldInspectStore)
        sessionMetadataStore.loadState(oldSessionMetadata)
        simStore.loadState(oldSimStore)
        for (const [name, data] of oldGlobalConstants) {
          libraryStore.assignGlobalConstant(name, data.value, data.units, data.data_reference)
        }
        setViewport(oldViewport)
      }
    }

    const resetState = () => {
      nodes.value = []
      edges.value = []
      if (flowId === FLOW_IDS.MAIN) {
        simStore.resetState()
        cancelSimulation()
        forgetSimulationSession()
        resetSliderReruns()
        useSimulationResultsStore().resetState()
        useProtocolStore().resetState()
        inspectionStore.resetState()
        omexStore.resetState()
        sessionMetadataStore.resetState()
        libraryStore.resetGlobalConstants()
      }
      setViewport({ x: 0, y: 0, zoom: 1 })
    }

    if (!recordHistory) {
      resetState()
      await nextTick()
      return
    }

    history.executeAndAddCommand({
      type: 'clear-workspace',
      undo: undoState,
      redo: resetState,
    })

    await nextTick()
  }

  return { clearWorkspace }
}
