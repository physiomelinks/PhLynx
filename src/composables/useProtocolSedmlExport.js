/**
 * The protocol's run as SED-ML: a zip of protocol.sedml, with the results view's trace plots and the protocol's inputs,
 * and the model it runs. PhLynx must be able to plan the run; when it can't, the export says why.
 */
import { computed, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { nameExperiment } from '@physiomelinks/protocol-kit'

import { useSimulation } from './useSimulation'
import { generateProtocolZip } from '../services/export/protocolExport'
import { buildProtocolSedml } from '../services/export/protocolSedml'
import { resolveGroups, resolvePlotConfig } from '../services/simulation/plotSelections'
import { mappingKey } from '../services/simulation/variableMapping'
import { ALL_EXPERIMENTS, useProtocolStore } from '../stores/protocolStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { FLOW_IDS, ZIP_FILE_TYPES } from '../utils/constants'
import { notify } from '../utils/notify'
import { getFileHandle, saveWithDialog, stripExtension } from '../utils/save'

// The plot of variables on no plot, as the results view names it.
const UNGROUPED = { id: '__ungrouped__', name: 'Ungrouped' }

/**
 * Gives the SED-ML export's state and action.
 *
 * @returns {{isExporting: import('vue').Ref<boolean>, reason: import('vue').ComputedRef<string|null>,
 *   canExport: import('vue').ComputedRef<boolean>, exportZip: Function}} `reason` says why it can't export, or is null.
 */
export function useProtocolSedmlExport() {
  const { nodes } = useVueFlow(FLOW_IDS.MAIN)
  const { prepareProtocolExport } = useSimulation()
  const protocolStore = useProtocolStore()
  const resultsStore = useSimulationResultsStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const sessionMetadataStore = useSessionMetadataStore()

  const isExporting = ref(false)
  // Why the last export couldn't plan the run, until the protocol or the run changes.
  const problem = ref(null)
  watch([() => protocolStore.source, () => resultsStore.signature, () => resultsStore.status], () => (problem.value = null))

  const reason = computed(() => {
    if (resultsStore.status === 'running') return 'Export the run as SED-ML once it finishes'
    if (protocolStore.validation.errors.length || !protocolStore.view) return 'Fix the protocol’s errors to export its run as SED-ML'
    // The last run's plan couldn't be made.
    if (resultsStore.status === 'blocked' && resultsStore.report.errors.length) return `PhLynx can’t plan the run: ${resultsStore.report.errors.join(' ')}`
    return problem.value && `PhLynx can’t plan the run: ${problem.value}`
  })
  const canExport = computed(() => !reason.value && !isExporting.value)

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
   * Writes the SED-ML of PhLynx's run, as the results view shows it.
   *
   * @param {Object} source - From prepareProtocolExport.
   * @returns {string}
   */
  function writeSedml(source) {
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
    })
  }

  /**
   * Plans the run, builds the zip and saves it. The save dialog opens first, while the click that asked for it still
   * counts; a run PhLynx can't plan saves nothing, and says why.
   *
   * @returns {Promise<void>}
   */
  async function exportZip() {
    if (!canExport.value) return
    const defaultStem = `${stripExtension(sessionMetadataStore.lastSaveName || 'model')}_protocol`
    // Before any await: the browser lets only a click open the save dialog.
    const picking = getFileHandle(defaultStem, ZIP_FILE_TYPES, '.zip')
    isExporting.value = true
    try {
      const picked = await picking
      if (picked.cancelled) return
      const source = await prepareProtocolExport()
      let sedml = null
      try {
        sedml = !source.errors.length && writeSedml(source)
      } catch (error) {
        source.errors = [error.message]
      }
      if (!sedml) {
        problem.value = source.errors.join(' ')
        notify.error({ title: 'Export failed', message: `PhLynx can’t plan the run: ${problem.value}` })
        return
      }
      const blob = await generateProtocolZip({ sedml, cellml: source.sedml.cellml })
      await saveWithDialog(blob, picked.handle ?? null, picked.cleanName ?? defaultStem, '.zip')
      notify.success({ title: 'Export successful!', message: 'The protocol’s run exported as SED-ML.' })
    } catch (error) {
      notify.error({ title: 'Export failed', message: error.message })
    } finally {
      isExporting.value = false
    }
  }

  return { isExporting, reason, canExport, exportZip }
}
