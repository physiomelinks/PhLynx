import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { resolveBoundaryValues } from '../services/export/boundaryValues'
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
import { NO_CLOCK, addProtocolClock, addProtocolDrivers } from '../services/simulation/protocolDriverModel'
import { listFeatureOperands, resolveFeatureOperands } from '../services/simulation/protocolFeatures'
import { clampSolverSettings, prepareProtocolRun } from '../services/simulation/protocolRun'
import { familyValues, findBoundarySweepProblem, findSweepProblem, listSweptBoundaries, resolveSweepTarget, splitFamily, sweepLabel, sweepReadout, sweepValues } from '../services/simulation/sweep'
import { buildVariableMapping, mapInspectionModules } from '../services/simulation/variableMapping'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useProtocolStore } from '../stores/protocolStore'
import { selectExperiment, useSimulationResultsStore } from '../stores/simulationResultsStore'
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

/**
 * Names a sweep's results as the variable search names its parameters, and splits a family's into its curves.
 *
 * @param {Object} results - A sweep's, finished or cut short.
 * @param {Object} sweep - The sweep it ran (simulationSettings.sweep).
 * @returns {Object}
 */
function labelSweepResults(results, sweep) {
  const labelled = { ...results, sweepLabel: sweepLabel(sweep) }
  return results.family && sweep.family ? splitFamily({ ...labelled, familyLabel: sweepLabel(sweep.family) }) : labelled
}

/** Forgets the model the worker keeps, so the next run flattens afresh. For a workspace cleared or replaced. */
export function forgetSimulationSession() {
  session = null
}

/**
 * Runs scoped simulations of the workspace and keeps their results in simulationResultsStore.
 *
 * @returns {{run: Function, stop: Function, keepCurrent: Function, prepareProtocolExport: Function,
 *   prepareRunExport: Function,
 *   isStale: import('vue').ComputedRef<boolean>}}
 */
export function useSimulation() {
  const { nodes, edges } = useVueFlow(FLOW_IDS.MAIN)
  const libraryStore = useLibraryStore()
  const inspectionModuleStore = useInspectionModuleStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const store = useSimulationResultsStore()
  const protocolStore = useProtocolStore()

  /**
   * Resolves the scope of some nodes, or of every node.
   *
   * @param {string[]|null} nodeIds
   * @returns {ReturnType<typeof resolveScope>}
   */
  const resolveCurrentScope = (nodeIds) => resolveScope(nodeIds, nodes.value, edges.value, inspectionModuleStore.modules)

  /**
   * Signs a run's inputs: its scope, the simulation settings, the slider values, any protocol it runs, and whether it
   * sweeps.
   *
   * @param {ReturnType<typeof resolveScope>} scope
   * @returns {string}
   */
  const signRun = (scope, overrides) =>
    [
      buildScopeSignature(scope, libraryStore),
      JSON.stringify(simulationSettingsStore.simulationSettings),
      JSON.stringify([[...overrides.rows], [...overrides.globals]]),
      protocolStore.signature,
      isSweeping() ? 'sweep' : '',
    ].join(':')

  /**
   * Tells whether play runs the sweep: in sweep mode, with a sweep set, and the protocol off.
   *
   * @param {boolean} [isProtocolRun]
   * @returns {boolean}
   */
  const isSweeping = (isProtocolRun = protocolStore.isActive) => !isProtocolRun && store.isSweepMode && !!simulationSettingsStore.simulationSettings.sweep

  /**
   * Selects the slider values a run tries out, for the sliders still defined: none while the sliders are off, as a
   * protocol runs the model as it is.
   *
   * @param {boolean} [areSlidersOff] - Whether the sliders are off, for a run that has already read the mode.
   * @returns {{rows: Map<string, number>, globals: Map<string, number>}}
   */
  const selectRunOverrides = (areSlidersOff = protocolStore.areSlidersOff) =>
    areSlidersOff
      ? { rows: new Map(), globals: new Map() }
      : buildParameterOverrides(simulationSettingsStore.parameterScanConfig?.selections, store.sliderValues)

  /**
   * Simulates some nodes, or the whole model, and maps its results back to the nodes. When nothing but
   * slider values has changed since the model the simulator keeps was flattened, it reruns that model with
   * the new values; otherwise it checks the scope, flattens it with the sliders' values and runs it. With the
   * protocol on, it runs the protocol's experiments on the model as it is instead, without the sliders' values (see
   * runProtocolOn). A pre-flight with errors stops it before it runs. In sweep mode, the model is instead solved
   * once per value of the swept parameter, or with ODEs, its time course run once per value.
   *
   * @param {string[]|null} [nodeIds] - The nodes to simulate, or null for every node.
   * @returns {Promise<void>}
   */
  async function run(nodeIds = null) {
    cancelSimulation()
    const token = runToken
    store.startRun(nodeIds)

    // Declared before the try, for its catch to map what a failed run computed. A throw before the run starts fails it
    // too, rather than leaving it running.
    let scope = null
    let settings = null
    let kept = null
    let changes = null
    let built = null
    try {
      scope = resolveCurrentScope(nodeIds)
      // Read once, so a mode switched while the simulator loads can't mix the time course's inputs into a protocol run.
      const isProtocolRun = protocolStore.isActive
      // A protocol's ramps and traces are written into the model, so they are part of what it was flattened from. Read
      // once too, so a protocol saved while the model flattens can't mix into this run.
      const drivers = isProtocolRun ? protocolStore.drivers : []
      const view = isProtocolRun ? protocolStore.view : null
      const featureOperandNames = isProtocolRun ? listFeatureOperands(protocolStore.source?.document) : []
      const structure = [buildScopeSignature(scope, libraryStore), ...(drivers.length ? [protocolStore.driverSignature] : [])].join(':')
      const overrides = selectRunOverrides(isProtocolRun)
      settings = { ...simulationSettingsStore.simulationSettings }
      const isSweepRun = isSweeping(isProtocolRun)
      const signature = signRun(scope, overrides)

      /**
       * Gets the sweep a kept model runs: none outside sweep mode.
       *
       * @param {Object} source - The kept model (see mapResults).
       * @returns {{component: string, variable: string, values: number[]}|null}
       * @throws {SimulationError} When the sweep can't run.
       */
      const sweepFor = (source) => {
        if (!isSweepRun) return null
        const problem = findSweepProblem(settings.sweep)
        if (problem) throw new SimulationError(problem)
        // A boundary condition a connection in the scope supplies would sweep what supplies it instead.
        const { status } = resolveBoundaryValues(scope.nodes, scope.internalEdges)
        const boundaryProblem = findBoundarySweepProblem(settings.sweep, { nodes: scope.nodes, status })
        if (boundaryProblem) throw new SimulationError(boundaryProblem)
        const found = { nodes: scope.nodes, mapping: source.mapping, variables: source.variables }
        const target = resolveSweepTarget({ sweep: settings.sweep, ...found })
        if (target.problem) throw new SimulationError(target.problem)
        const { family } = settings.sweep
        const familyTarget = family && resolveSweepTarget({ sweep: family, role: 'varied across curves', ...found })
        if (familyTarget?.problem) throw new SimulationError(familyTarget.problem)
        return {
          ...target,
          values: sweepValues(settings.sweep),
          // A model without ODEs has no time course to read.
          ...(!source.isSteadyState && { readout: sweepReadout(settings.sweep) }),
          ...(familyTarget && { family: { ...familyTarget, values: familyValues(family) } }),
        }
      }

      // Reusing the kept model, if its scope and everything it was flattened from are unchanged.
      kept = session?.scopeKey === JSON.stringify(nodeIds) && session.structure === structure ? session : null
      changes =
        kept &&
        buildParameterChanges({
          nodes: scope.nodes,
          overrides,
          flattenedWith: kept.flattenedWith,
          mapping: kept.mapping,
          variables: kept.variables,
          getGlobalConstant: libraryStore.getGlobalConstant,
        })

      // Checked every run, since cut connections and inspection modules outside the scope change its warnings. A swept
      // boundary condition takes the sweep's values, so it isn't left at 0.
      const suppliedKeys = isSweepRun ? listSweptBoundaries(settings.sweep) : new Set()
      store.report = summariseScopeReport(checkScope(scope, libraryStore, { suppliedKeys }))
      if (isProtocolRun) {
        const { errors, warnings } = protocolStore.validation
        store.report = { ...store.report, errors: [...store.report.errors, ...errors], warnings: [...store.report.warnings, ...warnings] }
      }
      if (store.report.errors.length) {
        store.failRun('blocked')
        return
      }

      const simulator = await whenLibOpenCORReady()
      if (token !== runToken) return
      if (!simulator) {
        store.failRun('error', { message: libopencor.reason ?? 'The simulator couldn’t load.', issues: [] })
        return
      }

      const onProgress = (progress) => token === runToken && (store.progress = progress)
      if (isProtocolRun) {
        await runProtocolOn({
          simulator,
          token,
          nodeIds,
          scope,
          structure,
          view,
          drivers,
          featureOperandNames,
          overrides,
          settings,
          signature,
          kept: changes ? kept : null,
          changes,
          onProgress,
        })
        return
      }
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
        if (isSweepRun) {
          // A sweep needs only the model's variables, to find the swept parameter in it, before it runs. Until it
          // starts there is no run to stop, so Stop abandons it.
          results = await simulator.describeModel({ cellml, key: built.key })
        } else {
          currentRun = simulator.startSimulation({ cellml, key: built.key, settings, onProgress })
          results = await currentRun.promise
        }
      }
      if (token !== runToken) return

      if (!mapped) {
        mapped = await mapResults(built, scope, results)
        if (token !== runToken) return
        // A run stopped early may not have read its model, so only a finished one is kept.
        if (!results.isStopped) session = mapped
        // A sweep needs the swept parameter's name in the model, known only once the model is mapped.
        const sweep = !results.isStopped && sweepFor(mapped)
        if (sweep) {
          currentRun = simulator.startSimulation({ key: mapped.key, settings, sweep, onProgress })
          results = await currentRun.promise
          if (token !== runToken) return
        }
      }
      if (results.isSweep) results = labelSweepResults(results, settings.sweep)
      store.finishRun({ results, mapping: mapped.mapping, signature, inspectionOutputs: mapped.inspectionOutputs, inputs: { settings, overrides } })
    } catch (error) {
      if (token === runToken) {
        const source = changes ? kept : built
        let partial = null
        try {
          const partialResults = error.partialResults?.isSweep ? labelSweepResults(error.partialResults, settings.sweep) : error.partialResults
          partial = partialResults && source && (await mapPartialResults(source, scope, partialResults))
        } catch (mapError) {
          // The failure is still reported, without the points it computed.
          console.error(mapError)
        }
        if (token === runToken) store.failRun('error', { message: error.message, issues: error.issues ?? [] }, partial)
      }
    } finally {
      if (token === runToken) currentRun = null
    }
  }

  /**
   * Runs the protocol's experiments on the scope. The kept model is rerun when it can be, its changes putting back
   * the model's values of any slider values it was flattened with; otherwise the scope is flattened, and the
   * simulator reads it and lists its variables, so the protocol's parameters can be found in it before anything runs.
   *
   * @param {Object} options - What run worked out: `{ simulator, token, nodeIds, scope, structure, view, drivers,
   *   featureOperandNames, overrides, settings, signature, kept, changes, onProgress }`, `kept` and `changes` null when
   *   the model needs flattening, and `view`, `drivers` and `featureOperandNames` (see listFeatureOperands) the
   *   protocol's as the run started.
   * @returns {Promise<void>}
   */
  async function runProtocolOn({
    simulator,
    token,
    nodeIds,
    scope,
    structure,
    view,
    drivers,
    featureOperandNames,
    overrides,
    settings: givenSettings,
    signature,
    kept,
    changes,
    onProgress,
  }) {
    let settings = givenSettings
    let source = kept
    if (!source) {
      const withOverrides = applyParameterOverrides(scope, libraryStore, overrides)
      let cellml = await buildScopedModel(withOverrides.scope, withOverrides.libraryStore, { check: false }).text()
      if (token !== runToken) return
      if (drivers.length) {
        const added = addProtocolDrivers({ libcellml: await whenLibCellMLReady(), cellml, drivers })
        if (token !== runToken) return
        if (added.errors.length) {
          store.report = { ...store.report, errors: added.errors }
          store.failRun('blocked')
          return
        }
        cellml = added.cellml
      }
      const built = {
        key: ++sessionCount,
        scopeKey: JSON.stringify(nodeIds),
        structure,
        cellml,
        flattenedWith: { rows: new Set(overrides.rows.keys()), globals: new Set(overrides.globals.keys()) },
      }
      session = null
      const described = await simulator.describeModel({ cellml, key: built.key })
      if (token !== runToken) return
      source = await mapResults(built, scope, described)
      if (token !== runToken) return
      session = source
    }
    // A model without ODEs is solved once, with no time course for a protocol's sub-experiments to follow.
    if (source.isSteadyState) {
      store.report = { ...store.report, errors: [NO_CLOCK] }
      store.failRun('blocked')
      return
    }

    const prepared = prepareProtocolRun({
      view,
      drivers,
      nodes: scope.nodes,
      mapping: source.mapping,
      variables: source.variables,
      settings,
    })
    const { plan, targets, inputs, errors } = prepared
    settings = prepared.settings
    store.report = { ...store.report, errors, warnings: [...store.report.warnings, ...prepared.warnings.filter((message) => !store.report.warnings.includes(message))] }
    if (errors.length) {
      store.failRun('blocked')
      return
    }

    // Each sub-experiment's own series of what the features reduce, as circulatory_autogen records them.
    const featureOperands = resolveFeatureOperands({ operands: featureOperandNames, nodes: scope.nodes, mapping: source.mapping, variables: source.variables })
    const recorded = [...new Set(featureOperands.values())]
    isCurrentRunKept = !!kept
    currentRun = simulator.startProtocol({ key: source.key, settings, plan, targets, baseChanges: changes ?? [], recorded, onProgress })
    try {
      const protocolResults = await currentRun.promise
      if (token !== runToken) return
      store.finishProtocolRun({
        protocolResults,
        inputs,
        featureOperands,
        experiment: protocolStore.activeExperiment,
        mapping: source.mapping,
        signature,
        inspectionOutputs: source.inspectionOutputs,
      })
    } catch (error) {
      if (error.code === 'no-session') session = null
      if (token !== runToken) return
      let shown = null
      try {
        const partial = error.partialResults && { experiments: error.partialResults.experiments, issues: [], elapsedMs: 0, isStopped: false }
        shown = partial && { results: selectExperiment(partial, protocolStore.activeExperiment), protocolResults: partial, inputs, featureOperands, mapping: source.mapping }
      } catch (mapError) {
        // The failure is still reported, without the experiments it computed.
        console.error(mapError)
      }
      store.failRun('error', { message: error.message, issues: error.issues ?? [] }, shown)
    }
  }

  /**
   * Prepares the protocol's run for its SED-ML: the scope flattened as runProtocolOn flattens it, with its drivers and
   * the protocol's clock (see addProtocolClock) written in, which the simulator reads to find the protocol's parameters
   * in it and plan the run. Refused while a run is going, as the simulator reads one model at a time.
   *
   * @param {Object} [options]
   * @param {string[]|null} [options.nodeIds] - The nodes to export, or null for every node; by default the last run's.
   * @returns {Promise<{errors: string[], settings?: Object, mapping?: Map<string, string>,
   *   variables?: Map<string, {kind: string, unit: string}>, voi?: {name: string, unit: string}, sedml?: {cellml: string,
   *   plan: Object, targets: Map<string, string>, inputs: Map<string, Object>}}>} Only `errors`, saying why, when
   *   PhLynx can't plan the run. `settings` are the run's, with CVODE's step clamped for the drivers.
   */
  async function prepareProtocolExport({ nodeIds = store.scopeNodeIds } = {}) {
    // A run still flattening its model hasn't started yet, but will read it with the simulator.
    const busy = () => !!currentRun || store.status === 'running'
    const refusal = { errors: ['Wait for the run to finish, or stop it, before exporting the protocol.'] }
    if (busy()) return refusal
    const scope = resolveCurrentScope(nodeIds)
    const report = summariseScopeReport(checkScope(scope, libraryStore))
    const errors = [...report.errors, ...protocolStore.validation.errors]
    if (errors.length || !protocolStore.view) return { errors: errors.length ? errors : ['The workspace has no protocol to export.'] }

    const simulator = await whenLibOpenCORReady()
    if (!simulator) return { errors: [libopencor.reason ?? 'The simulator couldn’t load.'] }
    // As runProtocolOn flattens it: the model as it is, without the sliders' values.
    const withOverrides = applyParameterOverrides(scope, libraryStore, selectRunOverrides(true))
    let cellml = await buildScopedModel(withOverrides.scope, withOverrides.libraryStore, { check: false }).text()
    const libcellml = await whenLibCellMLReady()
    const { drivers } = protocolStore
    if (drivers.length) {
      const added = addProtocolDrivers({ libcellml, cellml, drivers })
      if (added.errors.length) return { errors: added.errors }
      cellml = added.cellml
    }
    // Each experiment's own time, from the end of its warm-up, for the SED-ML's time axes.
    const clocked = addProtocolClock({ libcellml, cellml })
    if (clocked.errors.length) return { errors: clocked.errors }
    cellml = clocked.cellml
    if (busy()) return refusal

    const built = { key: ++sessionCount, cellml }
    // The worker keeps one model, and reading this one replaces the one kept, so the next run flattens afresh. Forgotten
    // before reading, so a run started meanwhile doesn't rerun a model the worker no longer has.
    session = null
    let described
    try {
      described = await simulator.describeModel({ cellml, key: built.key })
    } catch (error) {
      return { errors: [error.message] }
    }
    const mapped = await mapResults(built, scope, described)
    const settings = clampSolverSettings({ ...simulationSettingsStore.simulationSettings }, drivers)
    const prepared = prepareProtocolRun({ view: protocolStore.view, drivers, nodes: scope.nodes, mapping: mapped.mapping, variables: described.variables, settings })
    if (prepared.errors.length) return { errors: prepared.errors }
    return {
      errors: [],
      settings,
      mapping: mapped.mapping,
      // With their units, unlike the kept model's, for the SED-ML's axes.
      variables: new Map([...described.variables].map(([name, { kind, unit }]) => [name, { kind, unit }])),
      voi: { name: described.voi?.name ?? '', unit: described.voi?.unit ?? '' },
      needsNlaSolver: !!described.needsNlaSolver,
      // What the SED-ML runs: PhLynx's plan, on the model with its drivers and clock written in.
      sedml: { cellml, plan: prepared.plan, targets: prepared.targets, inputs: prepared.inputs },
    }
  }

  /**
   * Prepares a run of the model for its SED-ML: the scope flattened as run flattens it, with the sliders' values, which
   * the simulator reads for its variables' names and units. Refused while a run is going, as the simulator reads one
   * model at a time.
   *
   * @param {Object} [options]
   * @param {string[]|null} [options.nodeIds] - The nodes to export, or null for every node; by default the last run's.
   * @returns {Promise<{errors: string[], settings?: Object, mapping?: Map<string, string>,
   *   variables?: Map<string, {kind: string, unit: string}>, voi?: {name: string, unit: string}, isSteadyState?: boolean,
   *   needsNlaSolver?: boolean, inspectionOutputs?: Array, cellml?: string}>} Only `errors`, saying why, when the model
   *   can't be flattened or read.
   */
  async function prepareRunExport({ nodeIds = store.scopeNodeIds } = {}) {
    const busy = () => !!currentRun || store.status === 'running'
    const refusal = { errors: ['Wait for the run to finish, or stop it, before exporting it.'] }
    if (busy()) return refusal
    const scope = resolveCurrentScope(nodeIds)
    const { errors } = summariseScopeReport(checkScope(scope, libraryStore))
    if (errors.length) return { errors }

    const simulator = await whenLibOpenCORReady()
    if (!simulator) return { errors: [libopencor.reason ?? 'The simulator couldn’t load.'] }
    // As run flattens it: with the sliders' values, as the results show them.
    const withOverrides = applyParameterOverrides(scope, libraryStore, selectRunOverrides(false))
    const cellml = await buildScopedModel(withOverrides.scope, withOverrides.libraryStore, { check: false }).text()
    if (busy()) return refusal

    const built = { key: ++sessionCount, cellml }
    // As prepareProtocolExport does: reading this model replaces the one the worker keeps.
    session = null
    let described
    try {
      described = await simulator.describeModel({ cellml, key: built.key })
    } catch (error) {
      return { errors: [error.message] }
    }
    const mapped = await mapResults(built, scope, described)
    return {
      errors: [],
      settings: { ...simulationSettingsStore.simulationSettings },
      mapping: mapped.mapping,
      variables: new Map([...described.variables].map(([name, { kind, unit }]) => [name, { kind, unit }])),
      voi: { name: described.voi?.name ?? '', unit: described.voi?.unit ?? '' },
      isSteadyState: !!described.isSteadyState,
      needsNlaSolver: !!described.needsNlaSolver,
      inspectionOutputs: mapped.inspectionOutputs,
      cellml,
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
    if (wasCurrent) store.signature = signRun(resolveCurrentScope(store.scopeNodeIds), selectRunOverrides())
  }

  /** Whether the scope or the settings have changed since the shown results were computed. */
  const isStale = computed(() => {
    if (!store.signature || !store.results) return false
    return signRun(resolveCurrentScope(store.scopeNodeIds), selectRunOverrides()) !== store.signature
  })

  return { run, stop, keepCurrent, prepareProtocolExport, prepareRunExport, isStale }
}
