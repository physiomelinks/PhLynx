/**
 * The protocol's SED-ML export: what its dialog shows and edits, prefilled from the results view, and the zip it
 * saves (protocol.sedml, the model, the Python runner and its notes, and the obs_data file as it is).
 */
import { computed, markRaw, ref, shallowRef, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useSimulation } from './useSimulation'
import {
  buildBundleReadme,
  buildProtocolSedml,
  generateProtocolSedmlZip,
  validateExportFeatures,
} from '../services/export/protocolSedml'
import { nameExperiment } from '../services/protocol/protocolModel'
import { resolveGroups, resolvePlotConfig } from '../services/simulation/plotSelections'
import { CLOCK_COMPONENT } from '../services/simulation/protocolDriverModel'
import { isInspectionNodeId, readInspectionOutputId } from '../services/simulation/variableIndex'
import { mappingKey } from '../services/simulation/variableMapping'
import { ALL_EXPERIMENTS, useProtocolStore } from '../stores/protocolStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { FLOW_IDS, ZIP_FILE_TYPES } from '../utils/constants'
import { cyrb53 } from '../utils/misc'
import { notify } from '../utils/notify'
import { getFileHandle, saveWithDialog, stripExtension } from '../utils/save'

// The plot of variables on no plot, as the results view names it.
const UNGROUPED = { id: '__ungrouped__', name: 'Ungrouped' }

// The features and feature plots chosen for each protocol, by its signature: kept for the session, never saved.
const remembered = new Map()

/**
 * Signs the protocol, as protocolStore.signature does while play runs it, whichever play runs.
 *
 * @param {Object|null} protocolInfo
 * @returns {string}
 */
const signProtocol = (protocolInfo) => String(cyrb53(JSON.stringify(protocolInfo)))

/**
 * Copies plain data, so what's remembered isn't changed by later edits.
 *
 * @param {*} value
 * @returns {*}
 */
const clonePlain = (value) => JSON.parse(JSON.stringify(value))

/**
 * Gives the export dialog's state and actions.
 *
 * @returns {{visible: import('vue').Ref<boolean>, isPreparing: import('vue').Ref<boolean>, isExporting: import('vue').Ref<boolean>,
 *   prepared: import('vue').ShallowRef<Object|null>, errors: import('vue').ComputedRef<string[]>,
 *   warnings: import('vue').ComputedRef<string[]>, overlay: import('vue').Ref<boolean>, includeInputs: import('vue').Ref<boolean>,
 *   features: import('vue').Ref<Array<Object>>, featurePlots: import('vue').Ref<Array<Object>>,
 *   featureErrors: import('vue').ComputedRef<Array<{path: string, message: string}>>, groups: import('vue').ComputedRef<Array<Object>>,
 *   traces: import('vue').ComputedRef<Array<Object>>, inputs: import('vue').ComputedRef<Array<Object>|null>,
 *   operands: import('vue').ComputedRef<Array<Object>>, canExport: import('vue').ComputedRef<boolean>, open: Function,
 *   close: Function, exportZip: Function}}
 */
export function useProtocolSedmlExport() {
  const { nodes } = useVueFlow(FLOW_IDS.MAIN)
  const { prepareProtocolExport } = useSimulation()
  const protocolStore = useProtocolStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const sessionMetadataStore = useSessionMetadataStore()

  const visible = ref(false)
  const isPreparing = ref(false)
  const isExporting = ref(false)
  /** What prepareProtocolExport gave, or null while it prepares. */
  const prepared = shallowRef(null)
  const overlay = ref(false)
  const includeInputs = ref(false)
  /** `[{ name, operation, operand, subexperiment }]`, `operand` a reported name and `subexperiment` from 0. */
  const features = ref([])
  /** `[{ title, y, x, series }]`, as buildProtocolSedml takes them. */
  const featurePlots = ref([])
  // The protocol the features shown were chosen for, to remember them by.
  let rememberedKey = null
  // The latest open, so an older one still preparing is ignored.
  let openToken = 0

  // The plotted variables, as the export names them, and why any are left out.
  const plotted = computed(() => (prepared.value?.plan ? collectTraces(prepared.value) : { groups: [], traces: [], warnings: [] }))
  const groups = computed(() => plotted.value.groups)
  const traces = computed(() => plotted.value.traces)

  const errors = computed(() => prepared.value?.errors ?? [])
  const warnings = computed(() => [...(prepared.value?.warnings ?? []), ...plotted.value.warnings])

  // The values the protocol sets, as the inputs chart shows them, when asked for.
  const inputs = computed(() => {
    if (!includeInputs.value || !prepared.value?.inputs) return null
    return [...prepared.value.inputs].map(([parameter, { name }]) => ({ name, label: parameter, unit: prepared.value.variables.get(name)?.unit ?? '' }))
  })

  // The variables a feature can reduce: every one the model reports but time and the protocol's clock, which is time.
  const operands = computed(() => {
    const { variables, voi } = prepared.value ?? {}
    if (!variables) return []
    return [...variables]
      .filter(([name]) => name !== voi?.name && !name.startsWith(`${CLOCK_COMPONENT}/`))
      .map(([name, { kind, unit }]) => ({ name, kind, unit: unit ?? '' }))
  })

  const featureErrors = computed(() => {
    if (!prepared.value?.plan || !protocolStore.view) return []
    const operandNames = new Set(operands.value.map(({ name }) => name))
    return validateExportFeatures({ view: protocolStore.view, features: features.value, featurePlots: featurePlots.value, operandNames }).errors
  })

  const canExport = computed(
    () => !!prepared.value?.plan && !isPreparing.value && !isExporting.value && !errors.value.length && !featureErrors.value.length
  )

  // The features chosen are remembered for the protocol they were chosen for, for the session.
  watch(
    [features, featurePlots],
    () => rememberedKey && remembered.set(rememberedKey, clonePlain({ features: features.value, featurePlots: featurePlots.value })),
    { deep: true }
  )

  /**
   * Gets the plotted variables of the plot config, by the names the exported model reports, plot by plot. Time, which
   * every trace is plotted against, and variables outside the exported model are left out, with a warning.
   *
   * @param {Object} source - From prepareProtocolExport.
   * @returns {{groups: Array<{id: string, name: string}>, traces: Array<{name: string, label: string, unit: string,
   *   groupId: string}>, warnings: string[]}}
   */
  function collectTraces(source) {
    const plotConfig = simulationSettingsStore.plotConfig
    // Instances renamed or removed since are as the results view shows them.
    const resolvedByKey = new Map(resolvePlotConfig(plotConfig, nodes.value).selections.map((selection) => [selection.key, selection]))
    const allGroups = [...resolveGroups(plotConfig), UNGROUPED]
    const groupIds = new Set(allGroups.map(({ id }) => id))
    const found = []
    const left = []
    for (const selection of plotConfig?.selections ?? []) {
      const groupId = groupIds.has(selection.groupId) ? selection.groupId : UNGROUPED.id
      if (isInspectionNodeId(selection.nodeId)) {
        const output = source.inspectionOutputs?.find(({ id }) => id === readInspectionOutputId(selection.nodeId))
        if (output?.reportedName) found.push({ name: output.reportedName, label: output.name, unit: output.units ?? '', groupId })
        else left.push(`The inspection module output ${selection.variableName} isn't in the exported model, so it isn't plotted.`)
        continue
      }
      const current = resolvedByKey.get(selection.key)
      if (!current) continue
      const label = `${current.nodeName}/${current.variableName}`
      const name = source.mapping?.get(mappingKey(current.nodeId, current.variableName))
      // Time is reported apart from the variables, so it's told apart first.
      if (name && name === source.voi?.name) left.push(`${label} is time, which every plot has along its x axis, so it isn't plotted.`)
      else if (!name || !source.variables.has(name)) left.push(`${label} isn't in the exported model, so it isn't plotted.`)
      else found.push({ name, label, unit: source.variables.get(name).unit || current.units || 'dimensionless', groupId })
    }
    // Once per plot, however many instances share the variable.
    const seen = new Set()
    const unique = found.filter(({ name, groupId }) => !seen.has(`${groupId}#${name}`) && seen.add(`${groupId}#${name}`))
    const byGroup = allGroups.map((group) => unique.filter((trace) => trace.groupId === group.id))
    return {
      groups: allGroups.filter((_, index) => byGroup[index].length),
      traces: byGroup.flat(),
      warnings: left,
    }
  }

  /**
   * Opens the dialog, prefilled from the results view, and prepares the export.
   *
   * @returns {Promise<void>}
   */
  async function open() {
    const token = ++openToken
    visible.value = true
    prepared.value = null
    overlay.value = protocolStore.activeExperiment === ALL_EXPERIMENTS
    includeInputs.value = protocolStore.isShowingInputs
    rememberedKey = signProtocol(protocolStore.protocolInfo)
    const saved = remembered.get(rememberedKey)
    features.value = saved ? clonePlain(saved.features) : []
    featurePlots.value = saved ? clonePlain(saved.featurePlots) : []
    isPreparing.value = true
    try {
      const result = await prepareProtocolExport()
      if (token === openToken) prepared.value = markRaw(result)
    } catch (error) {
      if (token === openToken) prepared.value = { errors: [error.message], warnings: [] }
    } finally {
      if (token === openToken) isPreparing.value = false
    }
  }

  /** Closes the dialog; the features chosen stay remembered. */
  function close() {
    openToken++
    visible.value = false
    isPreparing.value = false
  }

  /**
   * Builds the zip and saves it. The save dialog opens first, while the click that asked for it still counts.
   *
   * @returns {Promise<void>}
   */
  async function exportZip() {
    if (!canExport.value) return
    const source = prepared.value
    const baseName = `${stripExtension(sessionMetadataStore.lastSaveName || 'model')}_protocol`
    // Before any await: the browser lets only a click open the save dialog.
    const picking = getFileHandle(baseName, ZIP_FILE_TYPES, '.zip')
    isExporting.value = true
    try {
      const picked = await picking
      if (picked.cancelled) return
      const stem = picked.cleanName ?? baseName
      const view = protocolStore.view
      const sedml = buildProtocolSedml({
        plan: source.plan,
        targets: source.targets,
        variables: source.variables,
        settings: source.settings,
        experiments: view.experiments.map((experiment, index) => ({ label: experiment.label ?? nameExperiment(index), colour: experiment.colour ?? null })),
        time: { unit: source.voi?.unit ?? '' },
        groups: groups.value,
        traces: traces.value,
        inputs: inputs.value,
        features: features.value,
        featurePlots: featurePlots.value,
        overlay: overlay.value,
        drivers: source.drivers ?? [],
      })
      const { default: script } = await import('../services/export/templates/run_sedml.py?raw')
      const readme = buildBundleReadme({ stem, warnings: warnings.value, hasDrivers: (source.drivers ?? []).length > 0 })
      const blob = await generateProtocolSedmlZip({
        sedml,
        cellml: source.cellml,
        script,
        // As the workspace has it, byte for byte.
        obsDataPayload: protocolStore.source?.entry.payload ?? null,
        readme,
      })
      await saveWithDialog(blob, picked.handle ?? null, stem, '.zip')
      notify.success({ title: 'Export successful!', message: 'Protocol exported as SED-ML, with a Python script to run it.' })
      visible.value = false
    } catch (error) {
      notify.error({ title: 'Export failed', message: error.message })
    } finally {
      isExporting.value = false
    }
  }

  return {
    visible,
    isPreparing,
    isExporting,
    prepared,
    errors,
    warnings,
    overlay,
    includeInputs,
    features,
    featurePlots,
    featureErrors,
    groups,
    traces,
    inputs,
    operands,
    canExport,
    open,
    close,
    exportZip,
  }
}
