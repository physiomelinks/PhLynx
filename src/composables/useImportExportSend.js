import { computed, h, markRaw, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import {
  ZIP_FILE_TYPES,
  CELLML_FILE_TYPES,
  OMEX_FILE_TYPES,
  IMPORT_KEYS,
  EXPORT_KEYS,
  SEND_KEYS,
} from '../utils/constants'

import CellMLIcon from '../components/icons/CellMLIcon.vue'
import CUFLynxIcon from '../components/icons/CUFLynxIcon.vue'
import OpenCORIcon from '../components/icons/OpenCORIcon.vue'
import CombineIcon from '../components/icons/CombineIcon.vue'

import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useOmexStore } from '../stores/omexStore'
import { useProtocolStore } from '../stores/protocolStore'

import { createCellMLDataFragment, generateOmexArchive, createOmexDataFragment } from '../services/compress'
import { CA_ARRAY_FORMATS, caExportProblems, generateExportZip } from '../services/export/ca'
import { generateHierarchicalCellMLZip } from '../services/export/cellmlHierarchical'
import { caIdentityProblems, caIdentityRequests, takenIdentities, withCaIdentities } from '../services/export/caNative'
import { createExportReport, ExportBlockedError, reportSummary } from '../services/export/diagnostics'
import { summariseExpansionErrors } from '../services/hierarchy/errors'
import { isNestedModelId } from '../services/hierarchy/expand'
import { resolvePlotConfig } from '../services/simulation/plotSelections'
import { buildScopedModel, checkScope, resolveScope, summariseScopeReport } from '../services/simulation/scopedModel'
import { useConfirmDialog } from './useConfirmDialog'
import { notify } from '../utils/notify'
import { generateFlattenedModel, extractVoiAndParametersFromModel } from '../utils/cellml'
import { readFileAsText } from '../utils/misc'
import { getFileHandle } from '../utils/save'
import { getImportConfig } from '../utils/import'

/**
 * Gives the workspace's import, export and send menus and actions. Exports build the model (see useModelGraph).
 *
 * @param {Object} options
 * @param {import('vue').Ref<Array>} options.nodes - The model's nodes.
 * @param {import('vue').Ref<Array>} options.edges - The model's edges.
 * @param {import('vue').Ref<string[]>} options.selectedNodeIds - The model nodes the canvas selection stands for.
 * @param {import('vue').Ref<Array>} [options.modelErrors] - The problems expanding super instances found (useModelGraph's
 *   `errors`): errors stop an export, warnings are shown with it.
 * @param {import('vue').Ref<boolean>} [options.isHierarchical] - Whether the workspace has super instances (useModelGraph's).
 * @param {() => {nodes: Array, edges: Array}} [options.storeGraph] - The store's nodes and edges, super-modules
 *   unexpanded, which the native circulatory_autogen export writes from.
 * @param {import('vue').Ref<Object>} [options.modelGraph] - expandHierarchy's of storeGraph's (useModelGraph's `graph`),
 *   which the native export writes the model from rather than expanding it again.
 * @param {Object} [options.caIdentities] - How super-modules get circulatory_autogen identities before a native
 *   export: `ask(requests, problemsOf)` resolves with them by smId, empty to export flat, or null to cancel
 *   (useCaIdentityPrompt); `save(identities)` stores them as one undo step (useSupermodules setCaIdentities), once
 *   the export is written. Without it, none is asked for.
 * @returns {Object} The menus, the current modes and their triggers.
 */
export function useImportExportSend({
  libcellml,
  nodes: modelNodes,
  edges: modelEdges,
  importDialogVisible,
  exportDialogVisible,
  currentImportConfig,
  onExportConfirm,
  hasModelChanged,
  snapshotFlowState,
  selectedNodeIds,
  modelErrors = { value: [] },
  isHierarchical = { value: false },
  storeGraph = () => ({ nodes: modelNodes.value, edges: modelEdges.value }),
  modelGraph = null,
  caIdentities = null,
}) {
  const simulationSettingsStore = useSimulationSettingsStore()
  const libraryStore = useLibraryStore()
  const inspectionModuleStore = useInspectionModuleStore()
  const sessionMetadataStore = useSessionMetadataStore()
  const omexStore = useOmexStore()
  const protocolStore = useProtocolStore()
  const { confirm } = useConfirmDialog()

  const currentImportKey = ref(IMPORT_KEYS.INSTANCE_ARRAY)
  const currentExportKey = ref(EXPORT_KEYS.CELLML)
  const currentSendKey = ref(SEND_KEYS.OPENCOR)

  const { simulationSettings, plotConfig, parameterScanConfig } = storeToRefs(simulationSettingsStore)

  const importOptions = computed(() => [
    {
      key: IMPORT_KEYS.INSTANCE_ARRAY,
      label: 'Instance Array',
      icon: 'pi pi-th-large',
      disabled: false,
    },
    {
      key: IMPORT_KEYS.CELLML_FILE,
      label: 'CellML File',
      icon: CellMLIcon,
      disabled: libcellml.status !== 'ready',
    },
    {
      key: IMPORT_KEYS.MODULE_CONFIG,
      label: 'Module Config',
      icon: 'pi pi-wrench',
      disabled: libcellml.status !== 'ready',
    },
    {
      key: IMPORT_KEYS.PARAMETER,
      label: 'Parameters',
      icon: 'pi pi-sliders-h',
      disabled: false,
    },
    {
      key: IMPORT_KEYS.OMEX,
      label: 'COMBINE Archive',
      icon: CombineIcon,
      disabled: libcellml.status !== 'ready',
    },
  ])

  const currentImportMode = computed(
    () => importOptions.value.find((option) => option.key === currentImportKey.value) ?? importOptions.value[0] ?? null
  )

  /** Resolves the selected nodes into a scope, to export on their own. */
  const resolveSelectionScope = () =>
    resolveScope(selectedNodeIds.value, modelNodes.value, modelEdges.value, inspectionModuleStore.modules, {
      modelErrors: modelErrors.value,
    })

  /**
   * Gets the whole model to export. Problems expanding its super instances stop the export, and their warnings are shown
   * once, as it starts, or added to a report the caller shows.
   *
   * @param {import('../services/export/diagnostics').ExportReport} [report]
   * @returns {{nodes: Array, edges: Array}}
   * @throws {ExportBlockedError} Listing the errors.
   */
  const buildWholeModel = (report = null) => {
    const { errors, warnings } = summariseExpansionErrors(modelErrors.value)
    if (errors.length) throw new ExportBlockedError(errors)
    if (warnings.length) {
      const note = { title: 'Model Warnings', items: warnings }
      if (report) report.warnings.push(note)
      else notify.warning(note)
    }
    return { nodes: modelNodes.value, edges: modelEdges.value }
  }

  /**
   * Names slider selections as the model exports their modules: a module inside a super instance is renamed with any
   * super instance it is in, which its stored name doesn't follow. A root module's selection, and any in a workspace without
   * super instances, is kept as stored, as before.
   *
   * @param {Array<Object>} selections - parameterScanConfig.selections.
   * @returns {Array<Object>}
   */
  const withModelNames = (selections) => {
    if (!isHierarchical.value) return selections
    const nameById = new Map(modelNodes.value.map((node) => [node.id, node.data?.name]))
    return selections.map((selection) => {
      const name = isNestedModelId(selection.nodeId) && nameById.get(selection.nodeId)
      return name ? { ...selection, nodeName: name } : selection
    })
  }

  /**
   * Checks the selection before it is exported: errors stop the export, and warnings ask to go on.
   *
   * @returns {Promise<boolean>} Whether to export.
   */
  const confirmSelectionExport = async () => {
    const { errors, warnings } = summariseScopeReport(checkScope(resolveSelectionScope(), libraryStore))
    if (errors.length) {
      notify.error({ title: 'Selection can’t be exported', items: errors })
      return false
    }
    if (!warnings.length) return true
    return confirm({
      header: 'Export Selection',
      message: warnings.map((warning) => `• ${warning}`).join('\n'),
      severity: 'warning',
      acceptLabel: 'Export',
      rejectLabel: 'Cancel',
    })
  }

  /**
   * Builds the OMEX archive of the whole model, or of a scope on its own: its model, its instances'
   * plotted variables and parameter scans, and a snapshot of just its nodes.
   *
   * @param {string} finalName
   * @param {ReturnType<typeof resolveScope>|null} [scope]
   * @returns {Promise<Blob>}
   */
  const generateOmexArchiveAction = async (finalName, scope = null) => {
    const model = scope ? null : buildWholeModel()
    const blob = scope
      ? await buildScopedModel(scope, libraryStore)
      : await generateFlattenedModel(model.nodes, model.edges, libraryStore, inspectionModuleStore.modules)
    const inScope = (selection) => !scope || scope.nodeIds.includes(selection.nodeId)
    const selections = withModelNames((parameterScanConfig.value?.selections ?? []).filter(inScope))
    const scanConfig = { ...parameterScanConfig.value, selections }
    const rehydratedModel = await readFileAsText(blob)
    const extractedData = extractVoiAndParametersFromModel(rehydratedModel, scanConfig)
    const snapshot = snapshotFlowState(scope?.nodeIds ?? null)
    const cellmlFileName = omexStore.cellmlFileName

    return generateOmexArchive(
      { blob },
      snapshot,
      {
        simulationSettings: simulationSettings.value,
        plotConfig: resolvePlotConfig(plotConfig.value, scope?.nodes ?? modelNodes.value),
        parameterScanConfig: scanConfig,
      },
      // A selection is never the model as imported.
      { extractedData, modified: scope ? true : hasModelChanged.value, cellmlFileName }
    )
  }

  const hasSelection = computed(() => (selectedNodeIds.value?.length ?? 0) > 0)

  const selectionOmexOption = (key) => ({
    key,
    label: 'OpenCOR (selection)',
    icon: OpenCORIcon,
    disabled: libcellml.status !== 'ready' || !hasSelection.value,
    isSelection: true,
    suffix: '.omex',
    fileTypes: OMEX_FILE_TYPES,
    message: 'Generating OMEX archive of the selection for Web OpenCOR.',
    preflight: confirmSelectionExport,
    action: (finalName) => generateOmexArchiveAction(finalName, resolveSelectionScope()),
  })

  // The identities given for the native export about to be written, stored once it is.
  let pendingCaIdentities = null

  /**
   * Checks the model for what would stop a Circulatory Autogen export, then asks, in one question, for the identities of
   * the super-modules the native export needs one for. Nothing is stored yet: the export stores them once written.
   *
   * @returns {Promise<boolean>} Whether to export: not when the model can't be, or the question is cancelled.
   */
  const prepareNativeCaExport = async () => {
    pendingCaIdentities = null
    const { errors } = summariseExpansionErrors(modelErrors.value)
    const problems = errors.length ? errors : caExportProblems(modelNodes.value, modelEdges.value, libraryStore)
    if (problems.length) {
      notify.error({ title: 'Export failed', items: problems })
      return false
    }
    if (!caIdentities || !isHierarchical.value) return true
    const { nodes, edges } = storeGraph()
    const requests = caIdentityRequests(nodes, edges, libraryStore)
    if (!requests.length) return true
    const taken = takenIdentities(nodes, edges, libraryStore)
    const identities = await caIdentities.ask(requests, (given) => caIdentityProblems(requests, given, { library: libraryStore, taken }))
    if (!identities) return false
    pendingCaIdentities = identities
    return true
  }

  /**
   * Writes a Circulatory Autogen export, showing its warnings and notes as one summary once it is written.
   *
   * @param {string} finalName
   * @param {string} arrayFormat
   * @param {boolean} native - Whether to write super-modules natively, with the identities just given.
   * @returns {Promise<Blob>}
   * @throws {ExportBlockedError} Listing what stops it.
   */
  const writeCaExport = async (finalName, arrayFormat, native) => {
    const report = createExportReport()
    // CA's own checks, such as its one heart, run on the model's rows.
    const model = buildWholeModel(report)
    // Taken once: a later export asks again.
    const identities = native ? pendingCaIdentities : null
    pendingCaIdentities = null
    let hierarchy = null
    if (native && isHierarchical.value) {
      const graph = storeGraph()
      hierarchy = { nodes: withCaIdentities(graph.nodes, identities), edges: graph.edges }
      if (modelGraph?.value) hierarchy.expansion = modelGraph.value
    }
    const blob = await generateExportZip(finalName, model.nodes, model.edges, libraryStore, protocolStore.source?.entry.payload ?? null, { arrayFormat, hierarchy, report })
    if (identities?.size) await caIdentities.save(identities)
    const summary = reportSummary(report, 'Circulatory Autogen Export')
    if (summary) (summary.type === 'warning' ? notify.warning : notify.info)(summary)
    return blob
  }

  /**
   * The Circulatory Autogen export, its module array written in a format of CA_ARRAY_FORMATS; native, it writes the
   * super-modules CA can read as super-modules, else every super instance as its modules.
   *
   * @param {string} key
   * @param {string} label
   * @param {string} arrayFormat
   * @param {Object} [options]
   * @param {boolean} [options.native=false]
   * @returns {Object}
   */
  const caExportOption = (key, label, arrayFormat, { native = false } = {}) => ({
    key,
    label,
    icon: 'pi pi-box',
    disabled: libcellml.status !== 'ready',
    suffix: '.zip',
    fileTypes: ZIP_FILE_TYPES,
    message: 'Generating and zipping CA files.',
    ...(native && { preflight: prepareNativeCaExport }),
    action: (finalName) => writeCaExport(finalName, arrayFormat, native),
    successMessage: () => 'Circulatory Autogen export zip generated.',
  })

  const exportOptions = computed(() => [
    {
      key: EXPORT_KEYS.CELLML,
      label: 'CellML',
      icon: CellMLIcon,
      disabled: libcellml.status !== 'ready',
      suffix: '.cellml',
      fileTypes: CELLML_FILE_TYPES,
      message: 'Generating flattened CellML model.',
      action: () => {
        const model = buildWholeModel()
        return generateFlattenedModel(model.nodes, model.edges, libraryStore, inspectionModuleStore.modules)
      },
      successMessage: async (blob, finalName) => {
        const dataUri = await createCellMLDataFragment(blob, finalName)
        return h('div', null, [
          'Model exported to CellML. Open this model directly in ',
          h(
            'a',
            {
              href: `https://opencor.ws/app/?opencor://openFile/#${dataUri}`,
              rel: 'noopener noreferrer',
              style: { color: 'var(--p-primary-color)', fontWeight: 'bold' },
              target: '_blank',
            },
            'OpenCOR'
          ),
        ])
      },
    },
    {
      key: EXPORT_KEYS.CELLML_HIERARCHICAL,
      label: 'CellML (with imports)',
      icon: CellMLIcon,
      disabled: libcellml.status !== 'ready',
      suffix: '.zip',
      fileTypes: ZIP_FILE_TYPES,
      message: 'Generating CellML files with imports.',
      // Written from the store: the model, a file per super-module and per module, and one of units; the model's checks run
      // first, as for the flat export.
      action: (finalName) => {
        buildWholeModel()
        const { nodes, edges } = storeGraph()
        return generateHierarchicalCellMLZip(finalName, nodes, edges, libraryStore)
      },
      successMessage: () => 'Model exported to CellML with imports: the model, a file per super-module, a file per module and a units file.',
    },
    caExportOption(EXPORT_KEYS.CA, 'Circulatory Autogen', CA_ARRAY_FORMATS.JSON, { native: true }),
    caExportOption(EXPORT_KEYS.CA_FLAT, 'Circulatory Autogen (flat)', CA_ARRAY_FORMATS.JSON),
    caExportOption(EXPORT_KEYS.CA_CSV, 'Circulatory Autogen (legacy CSV)', CA_ARRAY_FORMATS.CSV),
    {
      key: EXPORT_KEYS.OMEX,
      label: 'OpenCOR',
      icon: OpenCORIcon,
      disabled: libcellml.status !== 'ready',
      suffix: '.omex',
      fileTypes: OMEX_FILE_TYPES,
      message: 'Generating OMEX archive for Web OpenCOR.',
      action: generateOmexArchiveAction,
      successMessage: async (blob, finalName) => {
        const dataUri = await createOmexDataFragment(blob)
        return h('div', null, [
          'OMEX archive generated for Web OpenCOR. Open this model directly in ',
          h(
            'a',
            {
              href: `https://opencor.ws/app/?opencor://openFile/#${dataUri}`,
              rel: 'noopener noreferrer',
              style: { color: 'var(--p-primary-color)', fontWeight: 'bold' },
              target: '_blank',
            },
            'OpenCOR'
          ),
        ])
      },
    },
    {
      key: EXPORT_KEYS.CUFLYNX,
      label: 'CUFLynx',
      icon: CUFLynxIcon,
      disabled: libcellml.status !== 'ready',
      suffix: '.omex',
      fileTypes: OMEX_FILE_TYPES,
      message: 'Generating OMEX archive for CUFLynx.',
      action: generateOmexArchiveAction,
      successMessage: () => 'CUFLynx export OMEX generated.',
      // Temporarily disabled until CUFLynx can register the protocol handler.
      // successMessage: async (blob, finalName) => {
      //   const dataUri = await createOmexDataFragment(blob)
      //   return h('div', null, [
      //     'OMEX archive generated for CUFLynx. Open this model directly in ',
      //     h(
      //       'a',
      //       {
      //         href: `cuflynx://api?import=omex#${dataUri}`,
      //         rel: 'noopener noreferrer',
      //         style: { color: 'var(--p-primary-color)', fontWeight: 'bold' },
      //         target: '_blank',
      //       },
      //       'CUFLynx'
      //     ),
      //   ])
      // },
    },
    {
      key: EXPORT_KEYS.CELLML_SELECTION,
      label: 'CellML (selection)',
      icon: CellMLIcon,
      disabled: libcellml.status !== 'ready' || !hasSelection.value,
      isSelection: true,
      suffix: '.cellml',
      fileTypes: CELLML_FILE_TYPES,
      message: 'Generating flattened CellML model of the selection.',
      preflight: confirmSelectionExport,
      action: () => buildScopedModel(resolveSelectionScope(), libraryStore),
      successMessage: () => 'Selection exported to CellML.',
    },
    selectionOmexOption(EXPORT_KEYS.OMEX_SELECTION),
  ])

  const currentExportMode = computed(
    () => exportOptions.value.find((option) => option.key === currentExportKey.value) ?? exportOptions.value[0] ?? null
  )

  const sendOptions = computed(() => [
    {
      key: SEND_KEYS.OPENCOR,
      label: 'OpenCOR',
      icon: OpenCORIcon,
      disabled: libcellml.status !== 'ready',
      suffix: '.omex',
      fileTypes: OMEX_FILE_TYPES,
      message: 'Generating OMEX archive for Web OpenCOR.',
      action: generateOmexArchiveAction,
    },
    selectionOmexOption(SEND_KEYS.OPENCOR_SELECTION),
  ])

  const currentSendMode = computed(
    () => sendOptions.value.find((option) => option.key === currentSendKey.value) ?? sendOptions.value[0] ?? null
  )

  const importMenuItems = computed(() =>
    importOptions.value.map((opt) => ({
      label: opt.label,
      icon: opt.icon,
      disabled: opt.disabled,
      command: () => performImport(opt),
    }))
  )

  /**
   * Builds menu items for options, with a separator before the selection-only ones.
   *
   * @param {Array<Object>} options
   * @param {Function} onSelect - Called with the chosen option.
   * @returns {Array<Object>}
   */
  const buildMenuItems = (options, onSelect) =>
    options.flatMap((opt, index) => [
      ...(opt.isSelection && !options[index - 1]?.isSelection ? [{ separator: true }] : []),
      {
        label: opt.label,
        icon: opt.icon,
        disabled: opt.disabled || !opt.action,
        command: () => onSelect(opt),
      },
    ])

  // The whole-model modes to fall back to when a remembered selection mode has nothing selected.
  let wholeModelExportKey = currentExportKey.value
  let wholeModelSendKey = currentSendKey.value

  const exportMenuItems = computed(() =>
    buildMenuItems(exportOptions.value, (opt) => {
      currentExportKey.value = opt.key
      if (!opt.isSelection) wholeModelExportKey = opt.key
      return performExport(opt)
    })
  )

  const sendMenuItems = computed(() =>
    buildMenuItems(sendOptions.value, (opt) => {
      currentSendKey.value = opt.key
      if (!opt.isSelection) wholeModelSendKey = opt.key
      return performSend(opt)
    })
  )

  watch(hasSelection, (isSelected) => {
    if (isSelected) return
    if (currentExportMode.value?.isSelection) currentExportKey.value = wholeModelExportKey
    if (currentSendMode.value?.isSelection) currentSendKey.value = wholeModelSendKey
  })

  const currentExportDisabled = computed(() => !currentExportMode.value || currentExportMode.value.disabled)

  const currentImportDisabled = computed(() => !currentImportMode.value || currentImportMode.value.disabled)

  const currentSendDisabled = computed(() => !currentSendMode.value || currentSendMode.value.disabled)

  const triggerCurrentImport = () => {
    performImport(currentImportMode.value)
  }

  const triggerCurrentSend = () => {
    performSend(currentSendMode.value)
  }

  const performImport = (mode) => {
    currentImportKey.value = mode.key
    currentImportConfig.value = getImportConfig(mode.key)

    if (currentImportConfig.value) {
      importDialogVisible.value = true
    }
  }

  const performExport = async (mode) => {
    if (mode.preflight && !(await mode.preflight())) return
    const baseName = sessionMetadataStore.lastSaveName
    const fileTypes = mode.fileTypes || ZIP_FILE_TYPES

    const result = await getFileHandle(baseName, fileTypes, mode.suffix)
    if (result.success && result.handle) {
      onExportConfirm(result.cleanName, result.handle)
    } else if (result.needsLegacyDialog) {
      exportDialogVisible.value = true
    }
  }

  const performSend = async (mode) => {
    if (mode.preflight && !(await mode.preflight())) return
    const baseName = sessionMetadataStore.lastSaveName

    const notification = notify.info({ title: 'Sending...', message: mode.message, duration: 0 })
    try {
      const blob = await mode.action(baseName)
      const dataUri = await createOmexDataFragment(blob)
      // Open the generated OMEX archive in Web OpenCOR
      // This needs to change to support other send modes in the future, but for now we only have OpenCOR.
      const url = `https://opencor.ws/app/?opencor://openFile/#${dataUri}`
      window.open(url, '_blank', 'noreferrer')
    } catch (error) {
      notify.error({ title: 'Send failed', items: [error.message] })
    } finally {
      notification?.close?.()
    }
  }

  const triggerCurrentExport = () => {
    if (currentExportMode.value) {
      performExport(currentExportMode.value)
    }
  }

  return {
    currentExportMode,
    currentImportMode,
    currentSendMode,
    exportMenuItems,
    importMenuItems,
    sendMenuItems,
    currentExportDisabled,
    currentImportDisabled,
    currentSendDisabled,
    triggerCurrentExport,
    triggerCurrentImport,
    triggerCurrentSend,
  }
}
