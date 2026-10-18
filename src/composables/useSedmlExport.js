/**
 * The run as SED-ML, a zip of the SED-ML and the model it runs, with the results view's plots: with the protocol on,
 * protocol.sedml, with the protocol's inputs too; otherwise the time course's, or a steady state's single solve. PhLynx
 * must be able to plan the run; when it can't, the export says why. A sweep isn't exported yet.
 */
import { computed, ref, watch } from 'vue'
import { nameExperiment } from '@physiomelinks/protocol-kit'

import { useAppSettings } from './useAppSettings'
import { useModelGraph } from './useModelGraph'
import { useSimulation } from './useSimulation'
import { generateProtocolZip, generateSedmlZip } from '../services/export/protocolExport'
import { buildProtocolSedml } from '../services/export/protocolSedml'
import { RUN_SEDML_MODEL, buildRunSedml } from '../services/export/runSedml'
import { resolveGroups, resolvePlotConfig } from '../services/simulation/plotSelections'
import { INSPECTION_COMPONENT, isInspectionNodeId, readInspectionOutputId } from '../services/simulation/variableIndex'
import { mappingKey } from '../services/simulation/variableMapping'
import { ALL_EXPERIMENTS, useProtocolStore } from '../stores/protocolStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { ZIP_FILE_TYPES } from '../utils/constants'
import { notify } from '../utils/notify'
import { getFileHandle, saveWithDialog, stripExtension } from '../utils/save'

// The plot of variables on no plot, and of the inspection modules' outputs, as the results view names them.
const UNGROUPED = { id: '__ungrouped__', name: 'Ungrouped' }
const INSPECTION = { id: '__inspection_modules__', name: 'Inspection modules' }

/**
 * Gives the SED-ML export's state and action.
 *
 * @returns {{isExporting: import('vue').Ref<boolean>, isProtocol: import('vue').ComputedRef<boolean>,
 *   reason: import('vue').ComputedRef<string|null>, canExport: import('vue').ComputedRef<boolean>, exportZip: Function}}
 *   `isProtocol` whether it exports the protocol's run; `reason` says why it can't export, or is null.
 */
export function useSedmlExport() {
  const { modelNodes } = useModelGraph()
  const { prepareProtocolExport, prepareRunExport } = useSimulation()
  const protocolStore = useProtocolStore()
  const resultsStore = useSimulationResultsStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const sessionMetadataStore = useSessionMetadataStore()
  const { settings: appSettings } = useAppSettings()

  const isExporting = ref(false)
  // What play runs, and so what is exported: the protocol's experiments, a sweep, or the time course.
  const isProtocol = computed(() => protocolStore.isActive)
  const isSweep = computed(() => !isProtocol.value && resultsStore.isSweepMode && !!simulationSettingsStore.simulationSettings.sweep)
  // Why the last export couldn't plan the run, until the protocol or the run changes.
  const problem = ref(null)
  watch([() => protocolStore.source, isProtocol, () => resultsStore.signature, () => resultsStore.status], () => (problem.value = null))

  const reason = computed(() => {
    if (resultsStore.status === 'running') return 'Export the run as SED-ML once it finishes'
    if (!modelNodes.value.length) return 'Add instances to export their run as SED-ML'
    if (isSweep.value) return 'A sweep can’t be exported as SED-ML yet: switch back to the time course to export it'
    if (isProtocol.value && (protocolStore.validation.errors.length || !protocolStore.view)) return 'Fix the protocol’s errors to export its run as SED-ML'
    // The last run's plan couldn't be made.
    if (resultsStore.status === 'blocked' && resultsStore.report.errors.length) return `PhLynx can’t plan the run: ${resultsStore.report.errors.join(' ')}`
    return problem.value && `PhLynx can’t plan the run: ${problem.value}`
  })
  const canExport = computed(() => !reason.value && !isExporting.value)

  /**
   * Gets the plotted variables of the results view, by the names the exported model reports, plot by plot, for the
   * SED-ML's trace plots. Time, which every trace is plotted against, and variables outside the model are left out.
   *
   * A plot against another variable, as a phase plot is, has it as its `xAxis`, while it is in the model. A run's
   * inspection modules' outputs are found by the names it reports them by, plotted where the results view plots them.
   *
   * @param {Object} source - From prepareProtocolExport or prepareRunExport.
   * @returns {{groups: Array<{id: string, name: string, xAxis: {name: string, label: string, unit: string}|null}>,
   *   traces: Array<{name: string, label: string, unit: string, groupId: string}>}}
   */
  function collectTraces(source) {
    const plotConfig = simulationSettingsStore.plotConfig
    // Instances renamed or removed since are as the results view shows them.
    const resolved = resolvePlotConfig(plotConfig, modelNodes.value)
    const resolvedByKey = new Map(resolved.selections.map((selection) => [selection.key, selection]))
    const outputs = source.inspectionOutputs ?? []
    const outputsById = new Map(outputs.map((output) => [output.id, output]))
    /** Gives an inspection module's output's reported name, label and unit, or null when the model doesn't report it. */
    const reportedOutput = (output) =>
      output && source.variables.has(output.reportedName)
        ? { name: output.reportedName, unit: output.units || source.variables.get(output.reportedName).unit || 'dimensionless' }
        : null
    /** Gives a resolved plot variable's reported name, label and unit, or null when it's outside the model. */
    const reportedOf = (current) => {
      if (current && isInspectionNodeId(current.nodeId)) {
        const output = outputsById.get(readInspectionOutputId(current.nodeId))
        const reported = reportedOutput(output)
        return reported && { ...reported, label: `${INSPECTION_COMPONENT}/${output.name}` }
      }
      const name = current && source.mapping?.get(mappingKey(current.nodeId, current.variableName))
      if (!name || !source.variables.has(name)) return null
      return { name, label: `${current.nodeName}/${current.variableName}`, unit: source.variables.get(name).unit || current.units || 'dimensionless' }
    }
    const xAxisById = new Map(resolved.groups.map((group) => [group.id, group.xAxis ? reportedOf(group.xAxis) : null]))
    // An inspection module's output isn't an instance's, so it's read from the config as it is.
    const xAxisOf = (group) => (group.xAxis && isInspectionNodeId(group.xAxis.nodeId) ? reportedOf(group.xAxis) : xAxisById.get(group.id)) ?? null
    const allGroups = [
      ...resolveGroups(plotConfig).map((group) => ({ ...group, xAxis: xAxisOf(group) })),
      { ...UNGROUPED, xAxis: null },
      { ...INSPECTION, xAxis: null },
    ]
    const groupIds = new Set(allGroups.map(({ id }) => id))
    const found = []
    for (const selection of plotConfig?.selections ?? []) {
      const groupId = groupIds.has(selection.groupId) ? selection.groupId : UNGROUPED.id
      const reported = reportedOf(isInspectionNodeId(selection.nodeId) ? selection : resolvedByKey.get(selection.key))
      if (reported && reported.name !== source.voi?.name) found.push({ ...reported, groupId })
    }
    // As the results view plots them, when the settings ask for it.
    if (appSettings.plotInspectionModules) {
      for (const output of outputs) {
        const reported = reportedOutput(output)
        if (reported) found.push({ ...reported, label: output.name, groupId: INSPECTION.id })
      }
    }
    // Once per plot, however many instances share the variable.
    const seen = new Set()
    const unique = found.filter(({ name, groupId }) => !seen.has(`${groupId}#${name}`) && seen.add(`${groupId}#${name}`))
    const byGroup = allGroups.map((group) => unique.filter((trace) => trace.groupId === group.id))
    return { groups: allGroups.filter((_, index) => byGroup[index].length), traces: byGroup.flat() }
  }

  /**
   * Writes the SED-ML of PhLynx's run of the protocol, as the results view shows it.
   *
   * @param {Object} source - From prepareProtocolExport.
   * @returns {string}
   */
  function writeProtocolSedml(source) {
    const { groups, traces } = collectTraces(source)
    const inputs = protocolStore.isShowingInputs
      ? [...source.sedml.inputs].map(([parameter, { name }]) => ({ name, label: parameter, unit: source.variables.get(name)?.unit ?? '' }))
      : null
    return buildProtocolSedml({
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
      needsNlaSolver: source.needsNlaSolver,
    })
  }

  /**
   * Writes the SED-ML of PhLynx's run of the model, as the results view shows it.
   *
   * @param {Object} source - From prepareRunExport.
   * @returns {string}
   */
  function writeRunSedml(source) {
    const { groups, traces } = collectTraces(source)
    return buildRunSedml({ settings: source.settings, isSteadyState: source.isSteadyState, needsNlaSolver: source.needsNlaSolver, voi: source.voi, groups, traces })
  }

  /**
   * Plans the run, builds the zip and saves it. The save dialog opens first, while the click that asked for it still
   * counts; a run PhLynx can't plan saves nothing, and says why.
   *
   * @returns {Promise<void>}
   */
  async function exportZip() {
    if (!canExport.value) return
    // Read once, so a mode switched while the save dialog is open can't mix the two.
    const isProtocolRun = isProtocol.value
    const defaultStem = `${stripExtension(sessionMetadataStore.lastSaveName || 'model')}_${isProtocolRun ? 'protocol' : 'simulation'}`
    // Before any await: the browser lets only a click open the save dialog.
    const picking = getFileHandle(defaultStem, ZIP_FILE_TYPES, '.zip')
    isExporting.value = true
    try {
      const picked = await picking
      if (picked.cancelled) return
      // The whole model, as the simulation page's play runs it, whatever the sidebar ran last.
      const source = await (isProtocolRun ? prepareProtocolExport({ nodeIds: null }) : prepareRunExport({ nodeIds: null }))
      let sedml = null
      try {
        sedml = !source.errors.length && (isProtocolRun ? writeProtocolSedml(source) : writeRunSedml(source))
      } catch (error) {
        source.errors = [error.message]
      }
      if (!sedml) {
        problem.value = source.errors.join(' ')
        notify.error({ title: 'Export failed', items: [`PhLynx can’t plan the run: ${problem.value}`] })
        return
      }
      const blob = isProtocolRun
        ? await generateProtocolZip({ sedml, cellml: source.sedml.cellml })
        : await generateSedmlZip({ sedml, cellml: source.cellml, sedmlName: 'simulation.sedml', modelName: RUN_SEDML_MODEL })
      await saveWithDialog(blob, picked.handle ?? null, picked.cleanName ?? defaultStem, '.zip')
      notify.success({ title: 'Export successful!', message: isProtocolRun ? 'The protocol’s run exported as SED-ML.' : 'The run exported as SED-ML.' })
    } catch (error) {
      notify.error({ title: 'Export failed', items: [error.message] })
    } finally {
      isExporting.value = false
    }
  }

  return { isExporting, isProtocol, reason, canExport, exportZip }
}
