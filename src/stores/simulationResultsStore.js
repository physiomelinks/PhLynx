import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'

import { computeRunFeatures } from '../services/simulation/protocolFeatures'
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
  /** The pre-flight report, worded: `{ errors, warnings }`. */
  const report = ref({ errors: [], warnings: [] })
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
   * are now; one whose variables the run didn't keep has an error. One of the time alone needs no variable kept.
   */
  const features = computed(() => (protocolResults.value ? computeRunFeatures(protocolStore.source?.document, protocolResults.value, featureOperands.value) : []))
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

  function startRun(nodeIds) {
    const isSameScope = JSON.stringify(nodeIds) === JSON.stringify(scopeNodeIds.value)
    status.value = 'running'
    progress.value = 0
    scopeNodeIds.value = nodeIds
    report.value = { errors: [], warnings: [] }
    error.value = null
    signature.value = null
    if (!isSameScope) {
      results.value = null
      protocolResults.value = null
      mapping.value = null
      seriesSlots = markRaw(new Map())
      inspectionOutputs.value = []
    }
  }

  /**
   * Records a finished run.
   *
   * @param {Object} run - `{ results, mapping, signature, inspectionOutputs }`.
   */
  function finishRun(run) {
    status.value = run.results.isStopped ? 'stopped' : 'done'
    progress.value = 1
    results.value = markRaw(run.results)
    protocolResults.value = null
    mapping.value = markRaw(run.mapping)
    inspectionOutputs.value = run.inspectionOutputs ?? []
    signature.value = run.signature
  }

  /**
   * Records a finished protocol run, showing one of its experiments as `results`.
   *
   * @param {Object} run - `{ protocolResults, inputs, featureOperands, experiment, mapping, signature, inspectionOutputs }`.
   */
  function finishProtocolRun(run) {
    finishRun({ ...run, results: selectExperiment(run.protocolResults, run.experiment) })
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
    report.value = { errors: [], warnings: [] }
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
    mapping,
    inspectionOutputs,
    signature,
    getSeriesSlots,
    setSeriesSlots,
    sliderValues,
    setSliderValue,
    scopeMode,
    startRun,
    finishRun,
    finishProtocolRun,
    showExperiment,
    failRun,
    resetState,
  }
})
