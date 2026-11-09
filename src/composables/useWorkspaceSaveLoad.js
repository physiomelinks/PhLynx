import { useGtm } from './useGtm'
import { useClearWorkspace } from './useClearWorkspace'
import { useDefaultParametersStore } from '../stores/defaultParametersStore'
import { useCouplingContext } from './useCouplingContext'
import { useBioTemplateStore } from '../stores/bioTemplateStore'
import { useGlyphLibraryStore } from '../stores/glyphLibraryStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useOmexStore } from '../stores/omexStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { driveEdgesByAnnotations, drivenSummary, withCouplings } from '../services/annotations/edgeCouplings'
import { dropStaleAnnotatedPorts } from '../services/annotations/reconcileNodes'
import { buildWorkspaceFile } from '../services/workspaceFile'
import { migrateWorkspace } from '../services/workspaceMigrator'
import { JSON_FILE_TYPES } from '../utils/constants'
import { notify } from '../utils/notify'
import { isAnnotatedPort } from '../utils/portIdentity'
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
  const defaultParametersStore = useDefaultParametersStore()
  const bioTemplateStore = useBioTemplateStore()
  const glyphLibraryStore = useGlyphLibraryStore()
  const { trackEvent } = useGtm()
  const historyStore = useFlowHistoryStore()
  const { ensureContext } = useCouplingContext()

  /**
   * Saves with the native file picker, or opens the save dialog when the browser has none.
   *
   * @returns {Promise<'saved'|'cancelled'|'failed'|'dialog'>}
   */
  async function handleSaveWorkspace() {
    const safeName = ensureExtension(sessionMetadataStore.lastSaveName, '.json')
    const result = await saveFileHandle(safeName, JSON_FILE_TYPES)
    if (result.status) {
      if (result.handle) {
        const blob = createSaveBlob()
        try {
          await writeFileHandle(result.handle, blob)
          sessionMetadataStore.setLastSaveName(result.handle.name)
          trackEvent('save_action', {
            category: 'Save',
            action: 'save_workflow',
            label: `File: ${result.handle.name}`,
            file_type: 'json',
          })
          historyStore.markSaved()
          notify.success({ title: 'Workflow saved!' })
          return 'saved'
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
          return 'failed'
        }
      }
      return 'cancelled'
    }
    saveDialogVisible.value = true
    return 'dialog'
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
      parameters: defaultParametersStore,
      bioTemplates: bioTemplateStore,
      bioGlyphs: glyphLibraryStore,
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
    historyStore.markSaved()
    notify.success({ title: 'Workflow saved!' })
  }

  /**
   * Makes connections between placed nodes with annotated ports couple through them (see driveEdgesByAnnotations).
   *
   * @returns {Promise<string|null>} From drivenSummary; null when nothing switched or the side-cars can't be read.
   */
  async function driveLoadedEdges() {
    const hasAnnotatedPorts = (node) => (node.data?.ports ?? []).some(isAnnotatedPort)
    if (!nodes.value.some(hasAnnotatedPorts) && !edges.value.some((edge) => edge.data?.manualCouplings)) return null
    let context
    try {
      context = await ensureContext(nodes.value)
    } catch (error) {
      console.warn('Annotated couplings unavailable:', error)
      return null
    }
    const result = driveEdgesByAnnotations({ nodes: nodes.value, edges: edges.value, context })
    for (const node of nodes.value) {
      if (result.ports.has(node.id)) node.data = { ...node.data, ports: result.ports.get(node.id) }
    }
    const changes = new Map(result.changed.map((change) => [change.edgeId, change.after]))
    for (const edge of edges.value) {
      if (changes.has(edge.id)) edge.data = withCouplings(edge.data, changes.get(edge.id))
    }
    return drivenSummary(result.changed)
  }

  /**
   * Drops annotated ports on variables their math lacks, which would stop the model from running, and says which.
   */
  function dropStalePorts() {
    const { ports, couplings, dropped } = dropStaleAnnotatedPorts(nodes.value, edges.value)
    if (!dropped.length) return
    for (const node of nodes.value) {
      if (ports.has(node.id)) node.data = { ...node.data, ports: ports.get(node.id) }
    }
    for (const edge of edges.value) {
      if (couplings.has(edge.id)) edge.data = { ...edge.data, couplings: couplings.get(edge.id) }
    }
    const names = dropped.map(({ name, variables }) => `${name}.${variables.join(', ')}`)
    notify.warning({
      title: 'Annotation ports dropped',
      message: `Their math has no such variable: ${names.join('; ')}.`,
    })
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
      dropStalePorts()

      // Rebuild the edge index so the EdgeConnectionDialog subgraph is correct.
      rebuildNodeEdgeIndex()
      recomputeMissingCouplings()

      // Restore Pinia store state.
      libraryStore.loadState(migratedState.store)
      simulationSettingsStore.loadState(migratedState.simulation)
      inspectionModuleStore.loadState(migratedState.inspectionModules)
      omexStore.loadState(migratedState.workspace)
      defaultParametersStore.loadState(migratedState.parameters)
      bioTemplateStore.loadState(migratedState.bioTemplates)
      glyphLibraryStore.loadState(migratedState.bioGlyphs)
      // After the templates, which place the nodes.
      const driven = await driveLoadedEdges()
      // A loaded workspace is as saved as its file.
      historyStore.markSaved()

      trackEvent('workflow_load_action', {
        category: 'Workflow',
        action: 'load_workflow',
        label: `Nodes: ${nodes.value.length}, Edges: ${edges.value.length}`,
        file_type: source,
      })
      notify.success({
        title: 'Workflow loaded successfully!',
        ...(driven ? { message: driven } : {}),
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
