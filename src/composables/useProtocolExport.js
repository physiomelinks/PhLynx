/**
 * The protocol's export: what its dialog shows and the feature plots it chooses, and the zip it saves (run_protocol.py
 * and its notes, the model, the workspace's obs_data as it is, and the SED-ML of PhLynx's run when it can be planned).
 */
import { computed, markRaw, ref, shallowRef } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { nameExperiment } from '@physiomelinks/protocol-kit'

import { useSimulation } from './useSimulation'
import {
  BUNDLE_FILES,
  CA_FEATURES_PR,
  buildBundleReadme,
  buildFeaturePlots,
  buildParameterNames,
  buildScriptHeader,
  buildSolverInfo,
  fillScriptTemplate,
  generateProtocolZip,
  readPredictionItems,
  validateFeaturePlots,
} from '../services/export/protocolExport'
import { buildProtocolSedml } from '../services/export/protocolSedml'
import { resolveGroups, resolvePlotConfig } from '../services/simulation/plotSelections'
import { CLOCK_COMPONENT, DRIVER_COMPONENT } from '../services/simulation/protocolDriverModel'
import { mappingKey } from '../services/simulation/variableMapping'
import { ALL_EXPERIMENTS, useProtocolStore } from '../stores/protocolStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { FLOW_IDS, ZIP_FILE_TYPES } from '../utils/constants'
import { notify } from '../utils/notify'
import { getFileHandle, saveWithDialog, stripExtension } from '../utils/save'

// The plot of variables on no plot, as the results view names it.
const UNGROUPED = { id: '__ungrouped__', name: 'Ungrouped' }

/**
 * Whether a variable is one the export writes into the model for the SED-ML, rather than one of the scope's.
 *
 * @param {string} name - A reported name.
 * @returns {boolean}
 */
const isAddedForSedml = (name) => name.startsWith(`${DRIVER_COMPONENT}/`) || name.startsWith(`${CLOCK_COMPONENT}/`)

/**
 * Gives the last part of a path.
 *
 * @param {string} location
 * @returns {string}
 */
const baseName = (location) => location.slice(location.lastIndexOf('/') + 1)

/**
 * Gives the export dialog's state and actions.
 *
 * @returns {{visible: import('vue').Ref<boolean>, isPreparing: import('vue').Ref<boolean>, isExporting: import('vue').Ref<boolean>,
 *   prepared: import('vue').ShallowRef<Object|null>, errors: import('vue').ComputedRef<string[]>,
 *   warnings: import('vue').ComputedRef<string[]>, featurePlots: import('vue').Ref<Array<Object>>,
 *   plotErrors: import('vue').ComputedRef<Array<{path: string, message: string}>>,
 *   featureGroups: import('vue').ComputedRef<Array<{name: string, experiments: number[]}>>,
 *   parameterNames: import('vue').ComputedRef<{names: Object, unresolved: string[]}>, solverInfo: import('vue').ComputedRef<Object>,
 *   sedml: import('vue').ComputedRef<{sedml: string|null, problem: string|null}>, files: import('vue').ComputedRef<string[]>,
 *   canExport: import('vue').ComputedRef<boolean>, open: Function, close: Function, exportZip: Function}}
 */
export function useProtocolExport() {
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
  /** `[{ title, y, x, series }]`, as buildFeaturePlots takes them. */
  const featurePlots = ref([])
  // The latest open, so an older one still preparing is ignored.
  let openToken = 0

  const isReady = computed(() => !!prepared.value?.cellml)
  const predictions = computed(() => readPredictionItems(protocolStore.source?.document))
  const featureGroups = computed(() => predictions.value.featureGroups)
  const obsDataName = computed(() => baseName(protocolStore.source?.entry.location ?? 'obs_data.json'))

  // The protocol's parameters by the plain model's names, where libcuflynx wouldn't find them itself.
  const parameterNames = computed(() => {
    if (!isReady.value || !protocolStore.view) return { names: {}, unresolved: [] }
    const { scope, mapping, variables } = prepared.value
    return buildParameterNames({
      parameters: protocolStore.view.controls.map(({ parameter }) => parameter),
      nodes: scope.nodes,
      mapping,
      variables: new Set([...variables.keys()].filter((name) => !isAddedForSedml(name))),
    })
  })
  const solverInfo = computed(() => (isReady.value ? buildSolverInfo(prepared.value.settings) : {}))

  // PhLynx's run as SED-ML, or why it's left out.
  const sedml = computed(() => {
    if (!isReady.value) return { sedml: null, problem: null }
    const source = prepared.value
    if (!source.sedml) return { sedml: null, problem: source.sedmlProblem }
    try {
      const { groups, traces } = collectTraces(source)
      const inputs = protocolStore.isShowingInputs
        ? [...source.sedml.inputs].map(([parameter, { name }]) => ({ name, label: parameter, unit: source.variables.get(name)?.unit ?? '' }))
        : null
      const document = buildProtocolSedml({
        plan: source.sedml.plan,
        targets: source.sedml.targets,
        variables: source.variables,
        settings: source.settings,
        experiments: protocolStore.view.experiments.map((experiment, index) => ({ label: experiment.label ?? nameExperiment(index), colour: experiment.colour ?? null })),
        time: { unit: source.voi?.unit ?? '' },
        groups,
        traces,
        inputs,
        // As the results view shows them.
        overlay: protocolStore.activeExperiment === ALL_EXPERIMENTS,
      })
      return { sedml: document, problem: null }
    } catch (error) {
      return { sedml: null, problem: error.message }
    }
  })

  const files = computed(() => [
    BUNDLE_FILES.script,
    BUNDLE_FILES.model,
    obsDataName.value,
    BUNDLE_FILES.requirements,
    BUNDLE_FILES.readme,
    ...(sedml.value.sedml ? [BUNDLE_FILES.sedml, BUNDLE_FILES.sedmlModel] : []),
    BUNDLE_FILES.manifest,
  ])

  const errors = computed(() => prepared.value?.errors ?? [])
  const warnings = computed(() => {
    if (!prepared.value) return []
    const { names, unresolved } = parameterNames.value
    const renamed = Object.entries(names).map(([parameter, name]) => `${parameter} → ${name}`)
    return [
      ...new Set([
        // CUFLynx's limits among them.
        ...(prepared.value.warnings ?? []),
        ...(isReady.value && !predictions.value.items.length
          ? ['The protocol records no outputs, so the script has nothing to plot. Add some under Outputs in the protocol editor (Edit the protocol).']
          : []),
        ...(predictions.value.needsFeatureRelease
          ? [
              `Some outputs are features, or of one sub-experiment, which need libcuflynx from circulatory_autogen #${CA_FEATURES_PR}. requirements.txt installs it; released libcuflynx 0.7.3 and CUFLynx refuse this obs_data until it's released.`,
            ]
          : []),
        ...(renamed.length ? [`The script gives libcuflynx the model's names for ${renamed.join(', ')}, in PARAMETER_NAMES.`] : []),
        ...(unresolved.length ? [`PhLynx found no variable in the model for ${unresolved.join(', ')}: name it in the script's PARAMETER_NAMES before running it.`] : []),
        ...(sedml.value.problem ? [`${BUNDLE_FILES.sedml}, PhLynx's own run, is left out: ${sedml.value.problem}`] : []),
      ]),
    ]
  })

  const plotErrors = computed(() =>
    protocolStore.view ? validateFeaturePlots({ view: protocolStore.view, featureGroups: featureGroups.value, featurePlots: featurePlots.value }) : []
  )

  const canExport = computed(() => isReady.value && !isPreparing.value && !isExporting.value && !errors.value.length && !plotErrors.value.length)

  /**
   * Gets the plotted variables of the results view, by the names the exported model reports, plot by plot, for the
   * SED-ML's trace plots. Time, which every trace is plotted against, and variables outside the model are left out.
   *
   * @param {Object} source - From prepareProtocolExport.
   * @returns {{groups: Array<{id: string, name: string}>, traces: Array<{name: string, label: string, unit: string, groupId: string}>}}
   */
  function collectTraces(source) {
    const plotConfig = simulationSettingsStore.plotConfig
    // Instances renamed or removed since are as the results view shows them.
    const resolvedByKey = new Map(resolvePlotConfig(plotConfig, nodes.value).selections.map((selection) => [selection.key, selection]))
    const allGroups = [...resolveGroups(plotConfig), UNGROUPED]
    const groupIds = new Set(allGroups.map(({ id }) => id))
    const found = []
    for (const selection of plotConfig?.selections ?? []) {
      const groupId = groupIds.has(selection.groupId) ? selection.groupId : UNGROUPED.id
      const current = resolvedByKey.get(selection.key)
      const name = current && source.mapping?.get(mappingKey(current.nodeId, current.variableName))
      if (name && name !== source.voi?.name && source.variables.has(name)) {
        found.push({ name, label: `${current.nodeName}/${current.variableName}`, unit: source.variables.get(name).unit || current.units || 'dimensionless', groupId })
      }
    }
    // Once per plot, however many instances share the variable.
    const seen = new Set()
    const unique = found.filter(({ name, groupId }) => !seen.has(`${groupId}#${name}`) && seen.add(`${groupId}#${name}`))
    const byGroup = allGroups.map((group) => unique.filter((trace) => trace.groupId === group.id))
    return { groups: allGroups.filter((_, index) => byGroup[index].length), traces: byGroup.flat() }
  }

  /**
   * Opens the dialog, with no feature plots chosen, and prepares the export.
   *
   * @returns {Promise<void>}
   */
  async function open() {
    const token = ++openToken
    visible.value = true
    prepared.value = null
    featurePlots.value = []
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

  /** Closes the dialog. */
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
    const defaultStem = `${stripExtension(sessionMetadataStore.lastSaveName || 'model')}_protocol`
    // Before any await: the browser lets only a click open the save dialog.
    const picking = getFileHandle(defaultStem, ZIP_FILE_TYPES, '.zip')
    isExporting.value = true
    try {
      const picked = await picking
      if (picked.cancelled) return
      const stem = picked.cleanName ?? defaultStem
      const { names, unresolved } = parameterNames.value
      const { default: template } = await import('../services/export/templates/run_protocol.py?raw')
      const header = buildScriptHeader({
        obsData: obsDataName.value,
        dt: source.settings.pointInterval,
        timeUnit: source.voi?.unit ?? '',
        solverInfo: solverInfo.value,
        parameterNames: names,
        unresolved,
        featurePlots: buildFeaturePlots(featurePlots.value),
      })
      const { sedml: document, problem } = sedml.value
      const blob = await generateProtocolZip({
        script: fillScriptTemplate(template, header),
        cellml: source.cellml,
        // As the workspace has it, byte for byte.
        obsData: { name: obsDataName.value, payload: protocolStore.source.entry.payload },
        readme: buildBundleReadme({ stem, obsData: obsDataName.value, warnings: warnings.value, sedmlProblem: problem }),
        sedml: document ? { sedml: document, cellml: source.sedml.cellml } : null,
      })
      await saveWithDialog(blob, picked.handle ?? null, stem, '.zip')
      notify.success({ title: 'Export successful!', message: 'Protocol exported, with a Python script that runs it and plots its outputs.' })
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
    featurePlots,
    plotErrors,
    featureGroups,
    parameterNames,
    solverInfo,
    sedml,
    files,
    canExport,
    open,
    close,
    exportZip,
  }
}
