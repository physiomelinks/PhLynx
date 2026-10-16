import { useGtm } from './useGtm'
import { useClearWorkspace } from './useClearWorkspace'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useOmexStore } from '../stores/omexStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { useWorkspaceAppearanceStore } from '../stores/workspaceAppearanceStore'
import { buildWorkspaceFile } from '../services/workspaceFile'
import { migrateWorkspace } from '../services/workspaceMigrator'
import { JSON_FILE_TYPES } from '../utils/constants'
import { notify } from '../utils/notify'
import { ensureExtension, legacyDownload, saveFileHandle, writeFileHandle } from '../utils/save'

/**
 * Saves the workspace to a JSON file and restores it from a loaded one.
 *
 * @param {Object} options
 * @param {import('vue').Ref<boolean>} options.saveDialogVisible - Opened when the browser has no native save dialog.
 * @param {import('vue').Ref<Array>} options.nodes - Vue Flow nodes.
 * @param {import('vue').Ref<Array>} options.edges - Vue Flow edges.
 * @param {Function} options.toObject - Vue Flow `toObject`.
 * @param {Function} options.fromObject - Vue Flow `fromObject`.
 * @param {Function} options.setViewport - Vue Flow `setViewport`.
 * @param {Function} options.rebuildNodeEdgeIndex - Rebuilds the view's node-to-edge index.
 * @param {Function} options.recomputeMissingCouplings - Recomputes the view's missing couplings.
 * @returns {{
 *   handleSaveWorkspace: () => Promise<void>,
 *   onSaveConfirm: (fileName: string) => Promise<void>,
 *   applyWorkspaceState: (loadedState: Object, options?: { source?: string }) => Promise<void>,
 * }}
 */
export function useWorkspaceSaveLoad({
  saveDialogVisible,
  nodes,
  edges,
  toObject,
  fromObject,
  setViewport,
  rebuildNodeEdgeIndex,
  recomputeMissingCouplings,
}) {
  const libraryStore = useLibraryStore()
  const sessionMetadataStore = useSessionMetadataStore()
  const inspectionModuleStore = useInspectionModuleStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const omexStore = useOmexStore()
  const appearanceStore = useWorkspaceAppearanceStore()
  const { trackEvent } = useGtm()

  /**
   * Saves with the native file picker, or opens the save dialog when the browser has none.
   */
  async function handleSaveWorkspace() {
    const safeName = ensureExtension(sessionMetadataStore.lastSaveName, '.json')
    const result = await saveFileHandle(safeName, JSON_FILE_TYPES)
    if (result.status) {
      if (result.handle) {
        const blob = createSaveBlob()
        try {
          writeFileHandle(result.handle, blob)
          sessionMetadataStore.setLastSaveName(result.handle.name)
          trackEvent('save_action', {
            category: 'Save',
            action: 'save_workflow',
            label: `File: ${result.handle.name}`,
            file_type: 'json',
          })
          notify.success({ title: 'Workflow saved!' })
        } catch (err) {
          trackEvent('save_action', {
            category: 'Save',
            action: 'save_workflow',
            label: `Error: ${err.message}`,
            file_type: 'json',
          })
          notify.error({
            title: 'Error Saving Workflow',
            message: err.message,
          })
        }
      }
    } else {
      saveDialogVisible.value = true
    }
  }

  /**
   * Collects all state and creates blob from it.
   */
  function createSaveBlob() {
    const saveState = buildWorkspaceFile({
      flow: toObject(),
      library: libraryStore,
      simulation: simulationSettingsStore,
      inspectionModules: inspectionModuleStore,
      omex: omexStore,
      appearance: appearanceStore,
    })

    const jsonString = JSON.stringify(saveState, null, 2)
    return new Blob([jsonString], { type: 'application/json' })
  }

  /**
   * Collects all state and downloads it as a JSON file.
   */
  const onSaveConfirm = async (fileName) => {
    const baseName = fileName || sessionMetadataStore.lastSaveName
    const finalName = ensureExtension(baseName, '.json')
    const blob = createSaveBlob()

    legacyDownload(finalName, blob)

    sessionMetadataStore.setLastSaveName(fileName)
    notify.success({ title: 'Workflow saved!' })
  }

  /**
   * Restores the application state from a loaded workspace. Errors are rethrown for the caller to report.
   */
  async function applyWorkspaceState(loadedState, { source = 'json' } = {}) {
    const { clearWorkspace } = useClearWorkspace()

    try {
      // Validate the loaded file
      if (!loadedState.flow || !loadedState.store) {
        throw new Error('Invalid workflow file format.')
      }

      // Handles legacy formats if needed
      const migratedState = migrateWorkspace(loadedState)

      // Clear the current Vue Flow state without creating a history step for this load action.
      await clearWorkspace({ recordHistory: false })

      setViewport(migratedState.flow.viewport)
      fromObject(migratedState.flow)

      // Rebuild the edge index so the EdgeConnectionDialog subgraph is correct.
      rebuildNodeEdgeIndex()
      recomputeMissingCouplings()

      // Restore Pinia store state.
      libraryStore.loadState(migratedState.store)
      simulationSettingsStore.loadState(migratedState.simulation)
      inspectionModuleStore.loadState(migratedState.inspectionModules)
      omexStore.loadState(migratedState.workspace)
      appearanceStore.loadState(migratedState.appearance)

      trackEvent('workflow_load_action', {
        category: 'Workflow',
        action: 'load_workflow',
        label: `Nodes: ${nodes.value.length}, Edges: ${edges.value.length}`,
        file_type: source,
      })
      notify.success({
        title: 'Workflow loaded successfully!',
      })
    } catch (error) {
      trackEvent('workflow_load_action', {
        category: 'Workflow',
        action: 'load_workflow',
        label: `Error: ${error.message}`,
        file_type: source,
      })
      throw error
    }
  }

  return { handleSaveWorkspace, onSaveConfirm, applyWorkspaceState }
}
