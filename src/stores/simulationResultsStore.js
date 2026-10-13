import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'

import { MAX_TRACKED_RUNS, nextRunNumber, runAxisKind } from '../services/simulation/trackedRuns'
import { computeRunDataItemFeatures, computeRunFeatures } from '../services/simulation/protocolFeatures'
import { useProtocolStore } from './protocolStore'

/**
 * Gives one experiment of a protocol run's results as a run's results.
 *
 * @param {{experiments: Array, issues: Array, elapsedMs: number, isStopped: boolean}} protocolResults
 * @param {number} index - Kept within the experiments run.
 * @returns {Object} `{ voi, variables, subs, issues, elapsedMs, isStopped }`.
 */
export function selectExperiment({ experiments, issues, elapsedMs, isStopped }, index) {
  const experiment = experiments[Math.min(Math.max(index, 0), experiments.length - 1)] ?? { voi: { name: '', unit: '', values: new Float64Array() }, variables: new Map(), subs: [] }
  return { ...experiment, issues, elapsedMs, isStopped }
}

/**
 * The latest in-app simulation: its scope, status and results. Never saved with the workspace.
 */
export const useSimulationResultsStore = defineStore('simulationResults', () => {
  const protocolStore = useProtocolStore()
  /** 'idle', 'blocked' (the pre-flight found errors), 'running', 'done', 'stopped' or 'error'. */
  const status = ref('idle')
  const progress = ref(0)
  /** The node ids the run covered, or null for the whole model. */
  const scopeNodeIds = ref(null)
  /** The pre-flight report, worded: `{ errors, warnings, notes }`. */
  const report = ref({ errors: [], warnings: [], notes: [] })
  const error = ref(null)
  const results = shallowRef(null)
  /** A protocol run's results, every experiment's: `{ experiments, issues, elapsedMs, isStopped }`, or null. */
  const protocolResults = shallowRef(null)
  /** What shows each of the protocol's parameters, as `parameter → { name, isStepped }`, `name` as reported. */
  const protocolInputs = shallowRef(new Map())
  /** The variables a protocol run kept for its features, as `operand → reported name` (see resolveFeatureOperands). */
  const featureOperands = shallowRef(new Map())
  /**
   * The protocol run's features, as circulatory_autogen computes them from the obs_data's prediction items as they
   * are now; one whose variables the run didn't keep has an error.
   */
  const features = computed(() =>
    protocolResults.value && featureOperands.value.size ? computeRunFeatures(protocolStore.source?.document, protocolResults.value, featureOperands.value) : []
  )
  /** The features the run gives the obs_data's data items, as circulatory_autogen scores them, computed as `features` are. */
  const dataItemFeatures = computed(() =>
    protocolResults.value && featureOperands.value.size ? computeRunDataItemFeatures(protocolStore.source?.document, protocolResults.value, featureOperands.value) : []
  )
  const mapping = shallowRef(null)
  /** The run's inspection module outputs: `[{ id, name, units, reportedName }]`. */
  const inspectionOutputs = shallowRef([])
  /** The run's inputs, to tell when its results have gone stale. */
  const signature = ref(null)
  // Colour slots of the plotted series by key, kept for the run so a series keeps its colour when the tab is
  // reopened. Not reactive: the charts read and update it as they are drawn.
  let seriesSlots = markRaw(new Map())
  const getSeriesSlots = () => seriesSlots
  const setSeriesSlots = (slots) => (seriesSlots = markRaw(slots))
  /** What the shown results were computed with: `{ settings, overrides }`, for tracking them. */
  const runInputs = shallowRef(null)
  /**
   * Earlier results kept on the charts beside the live run's: `[{ id, number, name, isVisible, results, mapping,
   * inspectionOutputs, settings, inputs }]`, at most MAX_TRACKED_RUNS. Kept while the scope stays the same.
   */
  const trackedRuns = shallowRef([])
  /** Whether the charts show the live run, which can be hidden to compare tracked runs alone. */
  const isLiveRunVisible = ref(true)
  let trackedRunCount = 0
  /** Slider values by parameter key, tried out in runs without changing the model. Kept across runs. */
  const sliderValues = ref(new Map())

  /**
   * Sets a slider's value, or clears it with null.
   *
   * @param {string} key
   * @param {number|null} value
   */
  function setSliderValue(key, value) {
    const next = new Map(sliderValues.value)
    if (value === null) next.delete(key)
    else next.set(key, value)
    sliderValues.value = next
  }

  /**
   * Records a run starting. A rerun of the same scope keeps showing the previous results until it finishes.
   *
   * @param {string[]|null} nodeIds
   */
  // Whether play runs the canvas selection or the whole model; the session's choice, never saved.
  const scopeMode = ref('model')
  // Whether play runs the sweep (see services/simulation/sweep.js) rather than one run; the session's choice, never
  // saved, as the protocol's is (protocolStore.isProtocolMode). Only one of them is on at once.
  const isSweepMode = ref(false)

  function startRun(nodeIds) {
    const isSameScope = JSON.stringify(nodeIds) === JSON.stringify(scopeNodeIds.value)
    status.value = 'running'
    progress.value = 0
    scopeNodeIds.value = nodeIds
    report.value = { errors: [], warnings: [], notes: [] }
    error.value = null
    signature.value = null
    if (!isSameScope) {
      results.value = null
      protocolResults.value = null
      mapping.value = null
      seriesSlots = markRaw(new Map())
      inspectionOutputs.value = []
      runInputs.value = null
      // Another scope plots other variables: the tracked runs have nothing to compare.
      removeAllTrackedRuns()
    }
  }

  /**
   * Records a finished run.
   *
   * @param {Object} run - `{ results, mapping, signature, inspectionOutputs, inputs }`, inputs being the run's
   *   `{ settings, overrides }`.
   */
  function finishRun(run) {
    status.value = run.results.isStopped ? 'stopped' : 'done'
    progress.value = 1
    results.value = markRaw(run.results)
    protocolResults.value = null
    mapping.value = markRaw(run.mapping)
    inspectionOutputs.value = run.inspectionOutputs ?? []
    signature.value = run.signature
    runInputs.value = run.inputs ? markRaw(run.inputs) : null
    // A steady state's values, a sweep's lines and a course over the VoI can't share a chart, nor can sweeps
    // of different parameters.
    if (trackedRuns.value.some((tracked) => runAxisKind(tracked.results) !== runAxisKind(run.results))) removeAllTrackedRuns()
  }

  /** Why the shown results can't be tracked, or null when they can: a run finished or stopped, with room for another. */
  const trackBlocker = computed(() => {
    if (status.value === 'running') return 'Wait for the run to finish'
    if (!results.value) return 'Run the simulation first'
    if (!['done', 'stopped'].includes(status.value)) return 'The last run didn’t finish'
    if (protocolResults.value) return 'A protocol run can’t be tracked: show all its experiments to compare them'
    if (results.value.family) return 'A sweep with curves can’t be tracked: it compares its curves already'
    if (trackedRuns.value.length >= MAX_TRACKED_RUNS) return `Up to ${MAX_TRACKED_RUNS} runs can be tracked: stop tracking one to track another`
    return null
  })
  const canTrackRun = () => !trackBlocker.value

  /**
   * Keeps the shown results on the charts as a tracked run.
   *
   * @param {Array<{key: string, label: string, value: number, units: string}>} [inputs] - The slider values
   *   it tried out, described for the runs list.
   * @returns {Object|null} The tracked run, or null when it couldn't be tracked.
   */
  function trackRun(inputs = []) {
    if (!canTrackRun()) return null
    const run = markRaw({
      id: `run_${++trackedRunCount}`,
      number: nextRunNumber(trackedRuns.value),
      // The name it's given, or null to go by its number.
      name: null,
      isVisible: true,
      results: results.value,
      mapping: mapping.value,
      inspectionOutputs: inspectionOutputs.value,
      settings: runInputs.value?.settings ?? null,
      inputs,
    })
    trackedRuns.value = [...trackedRuns.value, run]
    return run
  }

  /**
   * Stops tracking a run.
   *
   * @param {string} id
   */
  function removeTrackedRun(id) {
    trackedRuns.value = trackedRuns.value.filter((run) => run.id !== id)
    // With nothing else to show, the live run shows again.
    if (!trackedRuns.value.length) isLiveRunVisible.value = true
  }

  /** Stops tracking every run. */
  function removeAllTrackedRuns() {
    if (trackedRuns.value.length) trackedRuns.value = []
    isLiveRunVisible.value = true
  }

  /**
   * Shows or hides a tracked run's lines.
   *
   * @param {string} id
   */
  function toggleTrackedRun(id) {
    trackedRuns.value = trackedRuns.value.map((run) => (run.id === id ? markRaw({ ...run, isVisible: !run.isVisible }) : run))
  }

  /**
   * Names a tracked run, or, given a blank name, has it go by its number again.
   *
   * @param {string} id
   * @param {string|null} name
   */
  function renameTrackedRun(id, name) {
    const trimmed = name?.trim() || null
    trackedRuns.value = trackedRuns.value.map((run) => (run.id === id ? markRaw({ ...run, name: trimmed }) : run))
  }

  /**
   * Records a finished protocol run, showing one of its experiments as `results`.
   *
   * @param {Object} run - `{ protocolResults, inputs, featureOperands, experiment, mapping, signature, inspectionOutputs }`.
   */
  function finishProtocolRun(run) {
    finishRun({ ...run, results: selectExperiment(run.protocolResults, run.experiment) })
    // A protocol's experiments are compared with each other, not with tracked runs.
    removeAllTrackedRuns()
    protocolResults.value = markRaw(run.protocolResults)
    protocolInputs.value = markRaw(run.inputs ?? new Map())
    featureOperands.value = markRaw(run.featureOperands ?? new Map())
  }

  /**
   * Shows another experiment of the protocol run's results.
   *
   * @param {number} index
   */
  function showExperiment(index) {
    if (protocolResults.value) results.value = markRaw(selectExperiment(protocolResults.value, index))
  }

  /**
   * Records a run that couldn't start, failed, or was abandoned before it started ('idle'). A failed run's
   * partial results are kept, to show where it got to.
   *
   * @param {'blocked'|'error'|'idle'} nextStatus
   * @param {{message: string, issues?: Array}|null} [nextError]
   * @param {{results: Object, mapping: Map, protocolResults?: Object, inputs?: Map, featureOperands?: Map}|null} [partial] -
   *   The results computed before the failure.
   */
  function failRun(nextStatus, nextError = null, partial = null) {
    status.value = nextStatus
    error.value = nextError
    protocolResults.value = partial?.protocolResults ? markRaw(partial.protocolResults) : null
    // As for a finished protocol run, its experiments are shown without tracked runs.
    if (partial?.protocolResults) removeAllTrackedRuns()
    protocolInputs.value = markRaw(partial?.inputs ?? new Map())
    featureOperands.value = markRaw(partial?.featureOperands ?? new Map())
    results.value = partial ? markRaw(partial.results) : null
    mapping.value = partial ? markRaw(partial.mapping) : null
    inspectionOutputs.value = []
  }

  function resetState() {
    status.value = 'idle'
    progress.value = 0
    scopeNodeIds.value = null
    report.value = { errors: [], warnings: [], notes: [] }
    error.value = null
    results.value = null
    protocolResults.value = null
    featureOperands.value = markRaw(new Map())
    mapping.value = null
    signature.value = null
    seriesSlots = markRaw(new Map())
    sliderValues.value = new Map()
    inspectionOutputs.value = []
    scopeMode.value = 'model'
    isSweepMode.value = false
    runInputs.value = null
    trackedRuns.value = []
    isLiveRunVisible.value = true
  }

  return {
    status,
    progress,
    scopeNodeIds,
    report,
    error,
    results,
    protocolResults,
    protocolInputs,
    featureOperands,
    features,
    dataItemFeatures,
    mapping,
    inspectionOutputs,
    signature,
    getSeriesSlots,
    setSeriesSlots,
    sliderValues,
    setSliderValue,
    scopeMode,
    isSweepMode,
    runInputs,
    trackedRuns,
    isLiveRunVisible,
    trackBlocker,
    canTrackRun,
    trackRun,
    removeTrackedRun,
    removeAllTrackedRuns,
    toggleTrackedRun,
    renameTrackedRun,
    startRun,
    finishRun,
    finishProtocolRun,
    showExperiment,
    failRun,
    resetState,
  }
})
