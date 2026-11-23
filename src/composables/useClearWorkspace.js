import { useVueFlow } from '@vue-flow/core'
import { nextTick } from 'vue'

import { useDefaultParametersStore } from '../stores/defaultParametersStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useOmexStore } from '../stores/omexStore'
import { useBioPiecesStore } from '../stores/bioPiecesStore'
import { useGlyphLibraryStore } from '../stores/glyphLibraryStore'
import { useNodeThemeStore } from '../stores/nodeThemeStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useProtocolStore } from '../stores/protocolStore'
import { useViewModeStore } from '../stores/viewModeStore'
import { cancelSimulation, forgetSimulationSession } from './useSimulation'
import { resetSliderReruns } from './useSliderReruns'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useWorkspaceAppearanceStore } from '../stores/workspaceAppearanceStore'

import { FLOW_IDS } from '../utils/constants'

export function useClearWorkspace(flowId = FLOW_IDS.MAIN) {
  const { nodes, edges, setViewport, getViewport } = useVueFlow(flowId)

  const libraryStore = useLibraryStore()
  const history = useFlowHistoryStore()
  const inspectionStore = useInspectionModuleStore()
  const simStore = useSimulationSettingsStore()
  const omexStore = useOmexStore()
  const bioPiecesStore = useBioPiecesStore()
  const glyphLibraryStore = useGlyphLibraryStore()
  const nodeThemeStore = useNodeThemeStore()
  const sessionMetadataStore = useSessionMetadataStore()
  const defaultParametersStore = useDefaultParametersStore()
  const appearanceStore = useWorkspaceAppearanceStore()

  const clearWorkspace = async ({ recordHistory = true } = {}) => {
    const oldNodes = nodes.value
    const oldEdges = edges.value
    const oldInspectStore = inspectionStore.getState()
    const oldSimStore = simStore.getState()
    const oldGlobalConstants = Array.from(libraryStore.globalVariables.entries())
    const oldViewport = getViewport()
    const oldOmexState = omexStore.getState()
    const oldBioPiecesState = bioPiecesStore.snapshot()
    const oldBioSkins = bioPiecesStore.skins
    const oldGlyphState = glyphLibraryStore.snapshot()
    const oldThemeState = nodeThemeStore.snapshot()
    const oldSessionMetadata = sessionMetadataStore.getState()
    const oldParameters = defaultParametersStore.getState()
    const oldAppearance = appearanceStore.getState()

    const undoState = () => {
      nodes.value = oldNodes
      edges.value = oldEdges
      if (flowId === FLOW_IDS.MAIN) {
        omexStore.loadState(oldOmexState)
        bioPiecesStore.restoreSnapshot(oldBioPiecesState)
        bioPiecesStore.skins = oldBioSkins
        glyphLibraryStore.restoreSnapshot(oldGlyphState)
        nodeThemeStore.restoreSnapshot(oldThemeState)
        inspectionStore.loadState(oldInspectStore)
        sessionMetadataStore.loadState(oldSessionMetadata)
        simStore.loadState(oldSimStore)
        defaultParametersStore.loadState(oldParameters)
        appearanceStore.loadState(oldAppearance)
        for (const [name, data] of oldGlobalConstants) {
          libraryStore.assignGlobalConstant(name, data.value, data.units, data.data_reference)
        }
        setViewport(oldViewport)
      }
    }

    // A load clears without history and keeps the parameter sets: a workspace load replaces them itself, and a
    // folder import adds its sets before the model it holds clears the canvas.
    const resetState = ({ keepParameters = false } = {}) => {
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
        bioPiecesStore.resetState()
        glyphLibraryStore.resetState()
        nodeThemeStore.resetState()
        sessionMetadataStore.resetState()
        // Another workspace's species are not this one's to hide.
        useViewModeStore().hiddenSpecies = []
        appearanceStore.resetState()
        libraryStore.resetGlobalConstants()
        if (!keepParameters) defaultParametersStore.resetState()
      }
      setViewport({ x: 0, y: 0, zoom: 1 })
    }

    if (!recordHistory) {
      resetState({ keepParameters: true })
      await nextTick()
      return
    }

    history.executeAndAddCommand({
      type: 'clear-workspace',
      undo: undoState,
      redo: () => resetState(),
    })

    await nextTick()
  }

  return { clearWorkspace }
}
