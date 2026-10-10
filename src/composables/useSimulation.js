import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { SimulationError } from '../services/simulation/engine'
import { libopencor, whenLibOpenCORReady } from '../services/simulation/libopencorLoader'
import { buildParameterChanges } from '../services/simulation/parameterChanges'
import { buildParameterOverrides } from '../services/simulation/parameterSliders'
import {
  applyParameterOverrides,
  buildScopedModel,
  buildScopeSignature,
  checkScope,
  resolveScope,
  summariseScopeReport,
} from '../services/simulation/scopedModel'
import { findSweepProblem, resolveSweepTarget, sweepLabel, sweepValues } from '../services/simulation/sweep'
import { buildVariableMapping, mapInspectionModules } from '../services/simulation/variableMapping'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { whenLibCellMLReady } from '../utils/cellml'
import { FLOW_IDS } from '../utils/constants'

// One run at a time, shared by every caller; a newer run makes an older one's results irrelevant.
let currentRun = null
let runToken = 0
// The model the simulator's worker keeps, from the last run that flattened one: what it was flattened
// from, and how its results map to the nodes. A rerun of it needs only parameter changes.
let session = null
let sessionCount = 0
// Whether the run going reruns the kept model, rather than flattening it afresh.
let isCurrentRunKept = false

/**
 * Abandons the current run: stops its simulation and ignores anything it reports later. For a workspace
 * cleared or replaced mid-run.
 */
export function cancelSimulation() {
  runToken++
  currentRun?.stop()
  currentRun = null
}

/**
 * Checks whether the run going only reruns the kept model with new parameter values, so stopping it loses
 * nothing a newer run won't redo quickly.
 *
 * @returns {boolean}
 */
export const isRerunningKeptModel = () => !!currentRun && isCurrentRunKept

/**
 * Gets the latest run's token, which any newer run or cancel changes.
 *
 * @returns {number}
 */
export const getRunToken = () => runToken

/** Forgets the model the worker keeps, so the next run flattens afresh. For a workspace cleared or replaced. */
export function forgetSimulationSession() {
  session = null
}

/**
 * Runs scoped simulations of the workspace and keeps their results in simulationResultsStore.
 *
 * @returns {{run: Function, stop: Function, keepCurrent: Function, isStale: import('vue').ComputedRef<boolean>}}
 */
export function useSimulation() {
  const { nodes, edges } = useVueFlow(FLOW_IDS.MAIN)
  const libraryStore = useLibraryStore()
  const inspectionModuleStore = useInspectionModuleStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const store = useSimulationResultsStore()

  /**
   * Resolves the scope of some nodes, or of every node.
   *
   * @param {string[]|null} nodeIds
   * @returns {ReturnType<typeof resolveScope>}
   */
  const resolveCurrentScope = (nodeIds) => resolveScope(nodeIds, nodes.value, edges.value, inspectionModuleStore.modules)

  /**
   * Signs a run's inputs: its scope and the simulation settings.
   *
   * @param {ReturnType<typeof resolveScope>} scope
   * @returns {string}
   */
  const signRun = (scope, overrides) =>
    [
      buildScopeSignature(scope, libraryStore),
      JSON.stringify(simulationSettingsStore.simulationSettings),
      JSON.stringify([[...overrides.rows], [...overrides.globals]]),
    ].join(':')

  /** The slider values runs try out, for the sliders still defined. */
  const currentOverrides = () => buildParameterOverrides(simulationSettingsStore.parameterScanConfig?.selections, store.sliderValues)

  /**
   * Simulates some nodes, or the whole model, and maps its results back to the nodes. When nothing but
   * slider values has changed since the model the simulator keeps was flattened, it reruns that model with
   * the new values; otherwise it checks the scope, flattens it with the sliders' values and runs it. A
   * pre-flight with errors stops it before it runs. A model without ODEs, given a sweep, is then solved once
   * per value of the swept parameter.
   *
   * @param {string[]|null} [nodeIds] - The nodes to simulate, or null for every node.
   * @returns {Promise<void>}
   */
  async function run(nodeIds = null) {
    cancelSimulation()
    const token = runToken
    store.startRun(nodeIds)

    const scope = resolveCurrentScope(nodeIds)
    const structure = buildScopeSignature(scope, libraryStore)
    const overrides = currentOverrides()
    const settings = { ...simulationSettingsStore.simulationSettings }
    const signature = signRun(scope, overrides)

    /**
     * Gets the sweep a kept model runs: none for a model with ODEs, or without a sweep set.
     *
     * @param {Object} source - The kept model (see mapResults).
     * @returns {{component: string, variable: string, values: number[]}|null}
     * @throws {SimulationError} When the sweep can't run.
     */
    const sweepFor = (source) => {
      if (!settings.sweep || !source.isSteadyState) return null
      const problem = findSweepProblem(settings.sweep)
      if (problem) throw new SimulationError(problem)
      const target = resolveSweepTarget({ sweep: settings.sweep, nodes: scope.nodes, mapping: source.mapping, variables: source.variables })
      if (target.problem) throw new SimulationError(target.problem)
      return { ...target, values: sweepValues(settings.sweep) }
    }

    // Reusing the kept model, if its scope and everything it was flattened from are unchanged.
    const kept = session?.scopeKey === JSON.stringify(nodeIds) && session.structure === structure ? session : null
    const changes =
      kept &&
      buildParameterChanges({
        nodes: scope.nodes,
        overrides,
        flattenedWith: kept.flattenedWith,
        mapping: kept.mapping,
        variables: kept.variables,
        getGlobalConstant: libraryStore.getGlobalConstant,
      })

    let built = null
    // Checked every run, since cut connections and inspection modules outside the scope change its warnings.
    store.report = summariseScopeReport(checkScope(scope, libraryStore))
    if (store.report.errors.length) {
      store.failRun('blocked')
      return
    }

    try {
      const simulator = await whenLibOpenCORReady()
      if (token !== runToken) return
      if (!simulator) {
        store.failRun('error', { message: libopencor.reason ?? 'The simulator couldn’t load.', issues: [] })
        return
      }

      const onProgress = (progress) => token === runToken && (store.progress = progress)
      let results
      let mapped = null
      isCurrentRunKept = !!changes
      if (changes) {
        currentRun = simulator.startSimulation({ key: kept.key, settings, changes, sweep: sweepFor(kept), onProgress })
        try {
          results = await currentRun.promise
        } catch (error) {
          // The worker lost the model (it restarted, say), or the run failed: map what there is as before.
          if (error.code === 'no-session') session = null
          throw error
        }
        mapped = kept
      } else {
        const withOverrides = applyParameterOverrides(scope, libraryStore, overrides)
        // libOpenCOR checks the model and reports its issues, so the flatten's own check is skipped.
        const cellml = await buildScopedModel(withOverrides.scope, withOverrides.libraryStore, { check: false }).text()
        if (token !== runToken) return
        built = {
          key: ++sessionCount,
          scopeKey: JSON.stringify(nodeIds),
          structure,
          cellml,
          flattenedWith: { rows: new Set(overrides.rows.keys()), globals: new Set(overrides.globals.keys()) },
        }
        session = null
        // With a sweep to follow, this run only maps the model, so finishing it isn't the end of the run.
        const mapOnProgress = settings.sweep ? (progress) => progress < 1 && onProgress(progress) : onProgress
        currentRun = simulator.startSimulation({ cellml, key: built.key, settings, onProgress: mapOnProgress })
        results = await currentRun.promise
        // Until a sweep starts there is no run to stop, so Stop abandons this one.
        currentRun = null
      }
      if (token !== runToken) return

      if (!mapped) {
        mapped = await mapResults(built, scope, results)
        if (token !== runToken) return
        // A run stopped early may not have read its model, so only a finished one is kept.
        if (!results.isStopped) session = mapped
        // A sweep needs the swept parameter's name in the model, known only once a run is mapped.
        const sweep = !results.isStopped && sweepFor(mapped)
        if (sweep) {
          currentRun = simulator.startSimulation({ key: mapped.key, settings, sweep, onProgress })
          results = await currentRun.promise
          if (token !== runToken) return
        }
      }
      if (results.isSweep) results = { ...results, sweepLabel: sweepLabel(settings.sweep) }
      store.finishRun({ results, mapping: mapped.mapping, signature, inspectionOutputs: mapped.inspectionOutputs })
    } catch (error) {
      if (token === runToken) {
        const source = changes ? kept : built
        const partialResults = error.partialResults?.isSweep ? { ...error.partialResults, sweepLabel: sweepLabel(settings.sweep) } : error.partialResults
        const partial = partialResults && source && (await mapPartialResults(source, scope, partialResults))
        if (token === runToken) store.failRun('error', { message: error.message, issues: error.issues ?? [] }, partial)
      }
    } finally {
      if (token === runToken) currentRun = null
    }
  }

  /**
   * Maps a newly flattened model's results back to the nodes, making it the kept model.
   *
   * @param {Object} built - The model's details (see run).
   * @param {ReturnType<typeof resolveScope>} scope
   * @param {Object} results
   * @returns {Promise<Object>} The kept model, with its mapping, inspection outputs and variables.
   */
  async function mapResults(built, scope, results) {
    const libcellml = await whenLibCellMLReady()
    return {
      ...built,
      mapping: buildVariableMapping({ libcellml, cellml: built.cellml, nodes: scope.nodes, results }),
      inspectionOutputs: mapInspectionModules(scope.inspectionModules, scope.nodes, results),
      // Only names and kinds are kept, not values: they don't change while the model doesn't.
      variables: new Map([...results.variables].map(([name, { kind }]) => [name, { kind }])),
      isSteadyState: !!results.isSteadyState,
    }
  }

  /**
   * Maps a failed run's partial results back to the nodes, as for a finished run.
   *
   * @param {Object} source - The model run (see run).
   * @param {ReturnType<typeof resolveScope>} scope
   * @param {Object} partialResults
   * @returns {Promise<{results: Object, mapping: Map}>}
   */
  async function mapPartialResults(source, scope, partialResults) {
    if (source.mapping) return { results: partialResults, mapping: source.mapping }
    const libcellml = await whenLibCellMLReady()
    return { results: partialResults, mapping: buildVariableMapping({ libcellml, cellml: source.cellml, nodes: scope.nodes, results: partialResults }) }
  }

  /** Stops the running simulation, keeping the points it computed; before it starts, abandons it. */
  function stop() {
    if (currentRun) {
      currentRun.stop()
      return
    }
    if (store.status !== 'running') return
    cancelSimulation()
    store.failRun('idle')
  }

  /**
   * Makes a change that keeps the shown results true, such as applying a slider's value to the model, and
   * keeps them current if they were.
   *
   * @param {Function} change
   */
  function keepCurrent(change) {
    const wasCurrent = !!store.results && !isStale.value
    change()
    if (wasCurrent) store.signature = signRun(resolveCurrentScope(store.scopeNodeIds), currentOverrides())
  }

  /** Whether the scope or the settings have changed since the shown results were computed. */
  const isStale = computed(() => {
    if (!store.signature || !store.results) return false
    return signRun(resolveCurrentScope(store.scopeNodeIds), currentOverrides()) !== store.signature
  })

  return { run, stop, keepCurrent, isStale }
}
