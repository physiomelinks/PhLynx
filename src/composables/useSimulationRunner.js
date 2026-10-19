/**
 * Playing simulations from a view with the simulation toolbar (the Simulation tab, the instance editor's Plot tab, the
 * simulation page): what play runs, why it can't, whether the shown results are out of date, and the summary and
 * status line describing them.
 */
import { computed, ref, unref } from 'vue'

import { useCanvasLevel } from './useCanvasLevel'
import { useModelGraph } from './useModelGraph'
import { useSimulation } from './useSimulation'
import { libopencor } from '../services/simulation/libopencorLoader'
import { READOUTS } from '../services/simulation/sweepReadouts'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'

/**
 * Gives what playing simulations from a view needs. The nodes are the model's (see useModelGraph): a selected super instance
 * plays as the modules it expands to.
 *
 * @param {{instanceId?: import('vue').Ref<string|null>|string|null, isWholeModelOnly?: boolean}} [options] - The
 *   instance an instance editor runs on its own, or none for the canvas selection; and whether the view only runs the
 *   whole model, as the simulation page, with no canvas to select from, does.
 * @returns {Object} The run state, `play`, `stop`, `keepCurrent`, `scopeMode`, `playScopeNodeIds` (what play
 *   simulates) and `statusLine`; `isOtherRun` says an instance editor shows another scope's results.
 */
export function useSimulationRunner({ instanceId = null, isWholeModelOnly = false } = {}) {
  // The canvas selection and an instance editor's node, as the model nodes they stand for at the canvas's level.
  const { selectedModelIds: selectedNodeIds, modelIdsOf } = useCanvasLevel()
  const { modelNodes } = useModelGraph()
  const store = useSimulationResultsStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const { run, stop, keepCurrent, isStale } = useSimulation()
  const getInstanceId = () => unref(instanceId)

  const isRunning = computed(() => store.status === 'running')
  // A run has been asked for, so its scope's instances, plotted variables and sliders can be shown.
  const hasScope = computed(() => store.status !== 'idle')
  const isLoading = computed(() => libopencor.status === 'loading')
  const isSimulatorMissing = computed(() => ['unavailable', 'error'].includes(libopencor.status))

  const scopeNodes = computed(() => {
    if (!store.scopeNodeIds) return modelNodes.value
    const ids = new Set(store.scopeNodeIds)
    return modelNodes.value.filter((node) => ids.has(node.id))
  })
  // Without ODEs there is no time course: the model is solved once, or once per value of a sweep. With them, a sweep
  // runs a time course per value, and reads each one.
  const isSteadyState = computed(() => !!store.results?.isSteadyState)
  const isSweep = computed(() => !!store.results?.isSweep)
  const scopeSummary = computed(() => {
    const experiments = store.protocolResults?.experiments.length
    const verb = isSteadyState.value ? 'Solved' : 'Simulated'
    const ran = experiments ? `Ran ${experiments} protocol ${experiments === 1 ? 'experiment' : 'experiments'} on` : verb
    if (!store.scopeNodeIds) return `${ran} the whole model`
    const count = store.scopeNodeIds.length
    return `${ran} ${count} ${count === 1 ? 'instance' : 'instances'} on their own`
  })
  const stoppedAt = computed(() => {
    const voi = store.results?.voi
    if (!voi?.values.length) return 'the start'
    const format = (point, unit) => `${point.toPrecision(4)} ${unit}`.trim()
    const family = store.results.family
    if (isSweep.value && family?.curves?.length) {
      // The last curve reached, as far as it got.
      const last = family.curves.at(-1)
      const first = last.variables.values().next().value?.values ?? []
      const reached = Array.from(first).filter((point) => point != null).length
      const at = reached ? `, ${store.results.sweepLabel} = ${format(voi.values[reached - 1], voi.unit)}` : ''
      return `${store.results.familyLabel} = ${format(last.value, family.unit)}${at}`
    }
    const value = format(voi.values.at(-1), voi.unit)
    return isSweep.value ? `${store.results.sweepLabel} = ${value}` : value
  })

  // A solve that starts before the plots do, to let the model settle, says so; a sweep plots against its parameter.
  const settleNote = computed(() => {
    const { initialPoint, startingPoint } = simulationSettingsStore.simulationSettings
    return !isSteadyState.value && !isSweep.value && initialPoint < startingPoint ? ` from ${initialPoint} s, plotted from ${startingPoint} s` : ''
  })
  const sweepNote = computed(() => {
    const values = store.results?.voi?.values
    if (!isSweep.value || !values?.length) return ''
    const unit = store.results.voi.unit ? ` ${store.results.voi.unit}` : ''
    const at = ` at ${values.length} values of ${store.results.sweepLabel}, from ${values[0]} to ${values.at(-1)}${unit}`
    const curves = store.results.family?.values.length
    const family = curves ? `${at}, a curve for each of ${curves} values of ${store.results.familyLabel}` : at
    const readout = READOUTS.find(({ id }) => id === store.results.readout)
    return readout ? `${family}, reading the ${readout.label.toLowerCase()} of each time course` : family
  })
  const resultsSummary = computed(() => {
    if (isSweep.value && store.status === 'done') return `${scopeSummary.value}${sweepNote.value}.`
    if (isSteadyState.value && store.status === 'done') return `${scopeSummary.value}, once: without differential equations, nothing changes over time.`
    if (store.status === 'stopped') return `${scopeSummary.value}${settleNote.value}, stopped at ${stoppedAt.value}.`
    if (store.status === 'error') return `${scopeSummary.value}${settleNote.value}, up to ${stoppedAt.value} before the solver failed.`
    return `${scopeSummary.value}${settleNote.value}.`
  })

  // Whether play runs the part (the selection, or the edited instance) or the whole model. The sidebar's choice lasts
  // for the session; the instance editor's starts on the whole model each time; the page's is always the whole model.
  const editorScopeMode = ref('model')
  const scopeMode = computed({
    get: () => (isWholeModelOnly ? 'model' : getInstanceId() ? editorScopeMode.value : store.scopeMode),
    set: (mode) => {
      if (isWholeModelOnly || mode === scopeMode.value) return
      if (getInstanceId()) editorScopeMode.value = mode
      else store.scopeMode = mode
      // Flipping the switch runs at once, as the user asked for that scope. Only the flip: picking instances on the
      // canvas never runs, so highlighting a model doesn't flatten it over and over. A run going is stopped for the
      // new scope's.
      if (!blockedReason.value && !isLoading.value) play()
    },
  })

  // The canvas selection, sorted, as play runs it in Selection mode.
  const sortedSelectedIds = computed(() => [...selectedNodeIds.value].sort())
  // Why play can't run, if it can't.
  const blockedReason = computed(() => {
    if (isSimulatorMissing.value) return libopencor.reason ?? 'The simulator isn’t available.'
    if (!modelNodes.value.length) return 'Add instances to simulate'
    if (!getInstanceId() && scopeMode.value === 'selection' && !selectedNodeIds.value.length) return 'Select instances on the canvas'
    return null
  })
  const canPlay = computed(() => !isRunning.value && !blockedReason.value && !isLoading.value)
  // In Selection mode, the results show a selection other than the one on the canvas now.
  const isSelectionChanged = computed(
    () =>
      !getInstanceId() &&
      scopeMode.value === 'selection' &&
      !!store.results &&
      sortedSelectedIds.value.length > 0 &&
      JSON.stringify(sortedSelectedIds.value) !== JSON.stringify(store.scopeNodeIds ? [...store.scopeNodeIds].sort() : null)
  )
  // In the instance editor, results of another run than this instance on its own, or the whole model; on the page,
  // results of a selection's run, from the sidebar.
  const isOtherRun = computed(() => {
    if (!store.results) return false
    if (isWholeModelOnly) return store.scopeNodeIds !== null
    if (!getInstanceId()) return false
    const expected = scopeMode.value === 'model' ? null : modelIdsOf([getInstanceId()])
    return JSON.stringify(store.scopeNodeIds) !== JSON.stringify(expected)
  })
  const isOutdated = computed(() => !!store.results && (isStale.value || isSelectionChanged.value || isOtherRun.value))

  // The instances play simulates, as the switch says: the edited instance or the selection, or null for the whole model.
  const playScopeNodeIds = computed(() => {
    if (scopeMode.value === 'model') return null
    return getInstanceId() ? modelIdsOf([getInstanceId()]) : sortedSelectedIds.value
  })

  /** Simulates the whole model or the part, as the switch says. */
  function play() {
    run(playScopeNodeIds.value)
  }

  // What the status line says: the most pressing thing first, with the full lists a click away. Notes, such as a
  // boundary condition using its own value, are expected, so they neither warn nor count as warnings.
  const statusLine = computed(() => {
    const warnings = store.report.warnings.length ? [{ title: 'Warnings', lines: store.report.warnings }] : []
    const notes = store.report.notes ?? []
    if (isSimulatorMissing.value) return { severity: 'error', icon: 'pi-exclamation-circle', text: libopencor.reason ?? 'The simulator isn’t available.', details: [] }
    if (store.status === 'blocked') {
      const count = store.report.errors.length
      return { severity: 'error', icon: 'pi-exclamation-circle', text: `Can’t simulate yet: ${count} ${count === 1 ? 'problem' : 'problems'}`, details: [{ title: 'Problems', lines: store.report.errors }] }
    }
    if (store.status === 'error') {
      const issues = (store.error?.issues ?? []).map((issue) => issue.description)
      return {
        severity: 'error',
        icon: 'pi-exclamation-circle',
        text: store.results ? `${store.error?.message} ${resultsSummary.value}` : store.error?.message ?? 'The simulation failed.',
        details: [...(issues.length ? [{ title: 'Solver messages', lines: issues }] : []), ...warnings],
        notes,
      }
    }
    // The progress bar shows how far; announcing each percent would flood a screen reader.
    if (isRunning.value) return { severity: 'info', icon: null, text: 'Running…', details: warnings, notes }
    if (isLoading.value) return { severity: 'info', icon: 'pi-spin pi-spinner', text: 'Loading the simulator…', details: [] }
    if (isStale.value && store.results) return { severity: 'warn', icon: 'pi-refresh', text: 'The model or settings changed · press play to update', details: warnings, notes }
    if (isSelectionChanged.value) return { severity: 'warn', icon: 'pi-refresh', text: 'The selection changed · press play to update', details: warnings, notes }
    if (isOtherRun.value) return { severity: 'warn', icon: 'pi-refresh', text: 'These results are from another run · press play to update', details: warnings, notes }
    if (store.results) {
      const count = store.report.warnings.length
      const text = count ? `${resultsSummary.value} ${count} ${count === 1 ? 'warning' : 'warnings'}.` : resultsSummary.value
      return { severity: count ? 'warn' : 'info', icon: count ? 'pi-exclamation-triangle' : null, text, details: warnings, notes }
    }
    if (isWholeModelOnly) return { severity: 'info', icon: null, text: 'Press play to simulate the whole model.', details: [] }
    const part = getInstanceId() ? 'this instance' : 'the selected instances'
    return { severity: 'info', icon: null, text: `Press play to simulate the whole model or ${part}.`, details: [] }
  })

  return {
    nodes: modelNodes,
    store,
    scopeNodes,
    selectedNodeIds,
    isRunning,
    isLoading,
    hasScope,
    isSteadyState,
    blockedReason,
    canPlay,
    isOutdated,
    scopeMode,
    playScopeNodeIds,
    statusLine,
    play,
    stop,
    keepCurrent,
  }
}
