import { useCanvasLevel } from './useCanvasLevel'
import { useGtm } from './useGtm'
import { useClearWorkspace } from './useClearWorkspace'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useOmexStore } from '../stores/omexStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { buildWorkspaceFile, withoutHidden } from '../services/workspaceFile'
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
  const { trackEvent } = useGtm()
  const canvasLevel = useCanvasLevel()

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
            items: [err.message],
          })
        }
      }
    } else {
      saveDialogVisible.value = true
    }
  }

  /**
   * Collects all state and creates blob from it. Nodes and edges are saved without `hidden` (see buildWorkspaceFile),
   * and the viewport saved is the root's, wherever the canvas is.
   */
  function createSaveBlob() {
    const flow = toObject()
    if (!canvasLevel.isAtRoot.value) {
      // fromObject falls back to `position` and `zoom` where the viewport's are 0, so they are the root's too.
      const root = canvasLevel.rootViewport()
      Object.assign(flow, { viewport: root, position: [root.x, root.y], zoom: root.zoom })
    }
    const saveState = buildWorkspaceFile({
      flow,
      library: libraryStore,
      simulation: simulationSettingsStore,
      inspectionModules: inspectionModuleStore,
      omex: omexStore,
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
   * Restores the application state from a loaded workspace. Errors are rethrown for the caller to report. The canvas
   * starts at the root: what the file holds as `hidden` is ignored, and what is inside super-modules is hidden before
   * it is loaded, so it is never drawn. Ids the migration rewrote are reported.
   */
  async function applyWorkspaceState(loadedState, { source = 'json' } = {}) {
    const { clearWorkspace } = useClearWorkspace()

    try {
      // Validate the loaded file
      if (!loadedState.flow || !loadedState.store) {
        throw new Error('Invalid workflow file format.')
      }

      // Handles legacy formats if needed
      const notes = []
      const migratedState = migrateWorkspace(loadedState, { notes })

      // Clear the current Vue Flow state without creating a history step for this load action.
      await clearWorkspace({ recordHistory: false })

      canvasLevel.reset()
      setViewport(migratedState.flow.viewport)
      fromObject(canvasLevel.withVisibility(withoutHidden(migratedState.flow)))

      // Rebuild the edge index so the EdgeConnectionDialog subgraph is correct.
      rebuildNodeEdgeIndex()
      recomputeMissingCouplings()

      // Restore Pinia store state.
      libraryStore.loadState(migratedState.store)
      simulationSettingsStore.loadState(migratedState.simulation)
      inspectionModuleStore.loadState(migratedState.inspectionModules)
      omexStore.loadState(migratedState.workspace)

      trackEvent('workflow_load_action', {
        category: 'Workflow',
        action: 'load_workflow',
        label: `Nodes: ${nodes.value.length}, Edges: ${edges.value.length}`,
        file_type: source,
      })
      notify.success({
        title: 'Workflow loaded successfully!',
      })
      if (notes.length) notify.warning({ title: 'Workflow updated', items: notes })
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
