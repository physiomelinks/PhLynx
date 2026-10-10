/**
 * Runs a CellML model through libOpenCOR. The only module that touches libOpenCOR's API; the rest of the
 * app gets plain results.
 */
import { buildAlgorithm, buildUniformTimeCourse, findSolverSettingsProblem, resolveSolverSettings } from './sedParameters'

// Above this, a run's results risk exhausting WebAssembly's 4 GB of memory.
export const MAX_RESULT_BYTES = 1.5 * 1024 ** 3

// libOpenCOR runs in a worker, so polling often costs the page nothing and returns results sooner.
const POLL_INTERVAL_MS = 10
const RUNNING = 1

// libOpenCOR's enum member for each SED-ML value of the CVODE settings that are enums.
const CVODE_ENUMS = {
  integrationMethod: { type: 'IntegrationMethod', values: { BDF: 'BDF', Adams: 'ADAMS_MOULTON' } },
  iterationType: { type: 'IterationType', values: { Newton: 'NEWTON', Functional: 'FUNCTIONAL' } },
  linearSolver: { type: 'LinearSolver', values: { Dense: 'DENSE', Banded: 'BANDED', Diagonal: 'DIAGONAL', GMRES: 'GMRES', BiCGStab: 'BICGSTAB', TFQMR: 'TFQMR' } },
  preconditioner: { type: 'Preconditioner', values: { Banded: 'BANDED', None: 'NO' } },
}

// The kinds of variable a task reports, with the names of libOpenCOR's accessors for each.
const VARIABLE_KINDS = [
  { kind: 'state', count: 'stateCount', name: 'stateName', unit: 'stateUnit', values: 'state' },
  { kind: 'rate', count: 'rateCount', name: 'rateName', unit: 'rateUnit', values: 'rate' },
  { kind: 'constant', count: 'constantCount', name: 'constantName', unit: 'constantUnit', values: 'constant' },
  { kind: 'computedConstant', count: 'computedConstantCount', name: 'computedConstantName', unit: 'computedConstantUnit', values: 'computedConstant' },
  { kind: 'algebraic', count: 'algebraicVariableCount', name: 'algebraicVariableName', unit: 'algebraicVariableUnit', values: 'algebraicVariable' },
]

let fileCount = 0

/**
 * A failed simulation, with libOpenCOR's issues when it gave any, and the results it computed before
 * failing when it got that far.
 */
export class SimulationError extends Error {
  /**
   * @param {string} message
   * @param {Array<{type: string, description: string}>} [issues]
   * @param {Object|null} [partialResults] - `{ voi, variables }` up to the failure.
   * @param {string|null} [code]
   */
  constructor(message, issues = [], partialResults = null, code = null) {
    super(message)
    this.name = 'SimulationError'
    this.issues = issues
    this.partialResults = partialResults
    // 'no-session' when a rerun found the worker no longer had its model.
    this.code = code
  }
}

/**
 * Lists a libOpenCOR logger's issues as plain objects.
 *
 * @param {Object} logger - A File, SedDocument or SedInstance.
 * @returns {Array<{type: string, description: string}>}
 */
function readIssues(logger) {
  return Array.from({ length: logger.issueCount }, (_, i) => {
    const issue = logger.issue(i)
    const plain = { type: issue.typeAsString, description: issue.description }
    issue.delete()
    return plain
  })
}

/**
 * Throws when a logger has errors.
 *
 * @param {Object} logger
 * @param {string} message
 */
function throwOnErrors(logger, message) {
  if (logger.hasErrors) throw new SimulationError(message, readIssues(logger))
}

/**
 * Words a failed run, explaining the solver errors users can fix.
 *
 * @param {Object} instance - A SedInstance with errors.
 * @param {Object} settings - Simulation settings.
 * @returns {string}
 */
function describeRunFailure(instance, settings) {
  const tookTooManySteps = readIssues(instance).some(({ description }) => description?.includes('mxstep'))
  return tookTooManySteps
    ? `The simulation failed: the solver needed more than ${resolveSolverSettings(settings).maxSteps} steps between two output points. Try a smaller point interval, or allow more steps in the solver settings.`
    : 'The simulation failed.'
}

/**
 * Sets up a simulation's ODE solver from the settings, as the SED-ML export writes it: CVODE's parameters,
 * or a fixed-step solver in its place with its step.
 *
 * @param {Object} loc - The libOpenCOR module.
 * @param {Object} simulation - A SedUniformTimeCourse.
 * @param {Object} settings - Simulation settings.
 * @param {Function} keep - Keeps a handle to free once the run ends.
 */
function applySolver(loc, simulation, settings, keep) {
  const { solver: definition, parameters } = buildAlgorithm(settings)
  let solver = keep(simulation.odeSolver)
  if (solver?.constructor?.name !== definition.className) {
    solver = keep(new loc[definition.className]())
    simulation.odeSolver = solver
  }
  for (const { name, value } of parameters) {
    const enumeration = CVODE_ENUMS[name]
    if (enumeration) solver[name] = loc.SolverCvode[enumeration.type][enumeration.values[value]]
    else if (value === 'true' || value === 'false') solver[name] = value === 'true'
    else solver[name] = Number(value)
  }
}

/**
 * Counts the points a run computed. A stopped run leaves the rest of its arrays unfilled, so its VOI leaves
 * the time course's grid of output times there.
 *
 * @param {Float64Array} voi
 * @param {{outputStartTime: number, outputEndTime: number, numberOfSteps: number}} timeCourse
 * @returns {number}
 */
export function countComputedPoints(voi, { outputStartTime, outputEndTime, numberOfSteps }) {
  const interval = numberOfSteps > 0 ? (outputEndTime - outputStartTime) / numberOfSteps : 0
  const tolerance = 1e-9 * Math.max(Math.abs(outputStartTime), Math.abs(outputEndTime), 1)
  let count = 0
  while (count < voi.length && Math.abs(voi[count] - (outputStartTime + count * interval)) <= tolerance) count++
  return count
}

/**
 * Copies a task's results out of WebAssembly memory, which the run's objects share.
 *
 * @param {Object} task - A SedInstanceTask.
 * @param {Object|null} stoppedTimeCourse - The time course of a stopped run, whose computed points alone are kept.
 * @param {number} [pointCount] - How many points to keep, when already known.
 * @returns {{voi: {name: string, unit: string, values: Float64Array}, variables: Map<string, Object>}}
 */
function readResults(task, stoppedTimeCourse, pointCount) {
  const voi = task.voi
  const length = pointCount ?? (stoppedTimeCourse ? countComputedPoints(voi, stoppedTimeCourse) : voi.length)
  const copy = (values) => Float64Array.from(values.subarray(0, length))
  const variables = new Map()
  for (const { kind, count, name, unit, values } of VARIABLE_KINDS) {
    for (let i = 0; i < task[count]; i++) {
      variables.set(task[name](i), { kind, unit: task[unit](i), values: copy(task[values](i)) })
    }
  }
  return { voi: { name: task.voiName, unit: task.voiUnit, values: copy(voi) }, variables }
}

/**
 * Throws unless the settings describe a time course to run (numbers throughout, an end after the start, a
 * positive point interval, and an initial time no later than the start) and a solver to run it with.
 *
 * @param {Object} settings - Simulation settings.
 */
export function checkSettings(settings) {
  const { initialPoint, startingPoint, endingPoint, pointInterval } = settings
  const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
  if (![initialPoint, startingPoint, endingPoint, pointInterval].every(isNumber)) {
    throw new SimulationError('Every time in the simulation settings needs a value.')
  }
  if (endingPoint <= startingPoint) throw new SimulationError('The simulation settings need an end after the start.')
  if (pointInterval <= 0) throw new SimulationError('The simulation settings need a point interval above 0.')
  if (pointInterval > endingPoint - startingPoint) {
    throw new SimulationError('The point interval is longer than the time between the start and the end.')
  }
  if (initialPoint > startingPoint) throw new SimulationError('The initial time can’t be after the start.')

  const solverProblem = findSolverSettingsProblem(settings)
  if (solverProblem) throw new SimulationError(solverProblem)
}

/**
 * Estimates the memory a run's results take: every variable and the VOI, at every output point.
 *
 * @param {Object} task - A SedInstanceTask.
 * @param {number} numberOfSteps
 * @returns {number} Bytes.
 */
export function estimateResultBytes(task, numberOfSteps) {
  const variableCount = 1 + VARIABLE_KINDS.reduce((total, { count }) => total + task[count], 0)
  return variableCount * (numberOfSteps + 1) * Float64Array.BYTES_PER_ELEMENT
}

/**
 * Reads a CellML model into libOpenCOR once, to run it as often as needed: each run sets its own time
 * course, solver and parameter changes, so a slider moving needs no new model. Runs on one session must
 * not overlap.
 *
 * @param {Object} options
 * @param {Object} options.module - The libOpenCOR module (see libopencorLoader.js).
 * @param {string} options.cellml - The flattened CellML model.
 * @returns {{run: Function, dispose: Function}}
 * @throws {SimulationError} When libOpenCOR can't read the model.
 */
export function createSimulationSession({ module: loc, cellml }) {
  const file = new loc.File(`phlynx-simulation-${++fileCount}.cellml`)
  // The session's handles, freed when it is disposed.
  const handles = []
  const keep = (handle) => (handle && handles.push(handle), handle)
  let document = null
  let simulation = null
  let model = null
  // A model without ODEs is algebraic: libOpenCOR solves it once, as a steady state, with no time course.
  let isSteadyState = false
  // The changes the last run applied, freed once replaced.
  let changeHandles = []

  /** Frees everything the session holds, and releases its file. */
  function dispose() {
    changeHandles.forEach((handle) => handle.delete())
    changeHandles = []
    handles.reverse().forEach((handle) => handle.delete())
    handles.length = 0
    document?.delete()
    document = null
    const fileManager = loc.FileManager.instance()
    fileManager.unmanage(file)
    fileManager.delete()
    file.delete()
  }

  try {
    file.setContents(new TextEncoder().encode(cellml))
    throwOnErrors(file, 'The model has errors.')
    document = new loc.SedDocument(file)
    throwOnErrors(document, 'The model could not be simulated.')
    simulation = keep(document.simulation(0))
    model = keep(document.model(0))
    isSteadyState = !!loc.SedSteadyState && simulation instanceof loc.SedSteadyState
  } catch (error) {
    dispose()
    throw error
  }

  /**
   * Replaces the model's parameter changes. libOpenCOR applies them as a run starts, recomputing the
   * values that depend on them.
   *
   * @param {Array<{component: string, variable: string, value: number}>} changes
   */
  function applyChanges(changes) {
    model.removeAllChanges()
    changeHandles.forEach((handle) => handle.delete())
    changeHandles = changes.map(({ component, variable, value }) => new loc.SedChangeAttribute(component, variable, String(value)))
    changeHandles.forEach((change) => model.addChange(change))
  }

  /**
   * Starts a run with the given settings and parameter changes. libOpenCOR runs it on its own threads;
   * this polls its progress until it finishes.
   *
   * @param {Object} options
   * @param {Object} options.settings - Simulation settings (simulationSettingsStore.simulationSettings).
   * @param {Array<{component: string, variable: string, value: number}>} [options.changes] - Values to run
   *   with in place of the model's, by the names libOpenCOR reports; each must be a constant or a state.
   * @param {{component: string, variable: string, values: number[]}|null} [options.sweep] - For a model without
   *   ODEs: a constant, by the name libOpenCOR reports, to solve the model at each of the values of.
   * @param {Function} [options.onProgress] - Called with the progress, from 0 to 1.
   * @returns {{promise: Promise<Object>, stop: Function}} `promise` resolves with `{ voi, variables, issues,
   *   elapsedMs, isStopped, isSteadyState, isSweep }` or rejects with a SimulationError; `stop` ends the run early,
   *   keeping what it has. A steady state has one value per variable and an empty VOI; a sweep, one value per
   *   swept value, which are its VOI.
   */
  function run({ settings, changes = [], sweep = null, onProgress = () => {} }) {
    let instance = null
    let isStopped = false

    /**
     * Solves an algebraic model: once, or once per value of a sweep. Each solve gives every variable one
     * value; a sweep's values become the results' VOI, so its results read like a time course over them.
     *
     * @param {Array} runChanges
     * @param {{component: string, variable: string, values: number[]}|null} runSweep
     * @returns {Promise<Object>} As a run's results, with `isSteadyState` set, and `isSweep` for a sweep.
     */
    async function solveSteadyState(runChanges, runSweep) {
      const isTarget = (change) => change.component === runSweep?.component && change.variable === runSweep?.variable
      const points = runSweep ? runSweep.values : [null]
      const columns = new Map()
      let solved = 0
      let elapsedMs = 0
      let issues = []

      /** The results of the points solved so far. */
      const collect = () => {
        const variables = new Map([...columns].map(([name, { kind, unit, values }]) => [name, { kind, unit, values: values.slice(0, solved) }]))
        const voi = runSweep
          ? { name: `${runSweep.component}/${runSweep.variable}`, unit: columns.get(`${runSweep.component}/${runSweep.variable}`)?.unit ?? '', values: Float64Array.from(points.slice(0, solved)) }
          : { name: '', unit: '', values: new Float64Array() }
        return { voi, variables }
      }

      for (const value of points) {
        if (isStopped) break
        applyChanges(value === null ? runChanges : [...runChanges.filter((change) => !isTarget(change)), { component: runSweep.component, variable: runSweep.variable, value }])
        instance = document.instantiate()
        try {
          throwOnErrors(instance, 'The model could not be solved.')
          const task = instance.task(0)
          try {
            if (!instance.startRun()) throw new SimulationError('The model could not be solved.', readIssues(instance))
            while (instance.status.value === RUNNING) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
            elapsedMs += instance.waitForRun()
            // A solve stopped part way may not have converged, so its values aren't kept.
            if (isStopped) break
            if (instance.hasErrors) {
              const at = runSweep ? ` at ${runSweep.component}/${runSweep.variable} = ${value}` : ''
              const partial = solved > 1 ? { ...collect(), isSteadyState, isSweep: !!runSweep } : null
              throw new SimulationError(`The model could not be solved${at}.`, readIssues(instance), partial)
            }
            for (const [variableName, { kind, unit, values }] of readResults(task, null, 1).variables) {
              if (!columns.has(variableName)) columns.set(variableName, { kind, unit, values: new Float64Array(points.length) })
              columns.get(variableName).values[solved] = values[0]
            }
            issues = readIssues(instance)
          } finally {
            task?.delete()
          }
        } finally {
          if (instance.status.value === RUNNING) {
            instance.stopRun()
            instance.waitForRun()
          }
          instance.delete()
          instance = null
        }
        solved++
        onProgress(solved / points.length)
      }

      return { ...collect(), issues, elapsedMs, isStopped: solved < points.length, isSteadyState, isSweep: !!runSweep }
    }

    const promise = (async () => {
      // Start after returning, so the caller has `stop` before the first progress report.
      await Promise.resolve()
      // The run's handles, freed once it ends.
      const runHandles = []
      const keepForRun = (handle) => (handle && runHandles.push(handle), handle)
      try {
        if (isSteadyState) return await solveSteadyState(changes, sweep)

        checkSettings(settings)
        const timeCourse = buildUniformTimeCourse(settings)
        Object.assign(simulation, timeCourse)
        // The instance takes its own copy of the solver, so the solver is set before each one. The
        // simulation holds the solver, so the run's handles on it can go once the run ends.
        applySolver(loc, simulation, settings, keepForRun)
        applyChanges(changes)

        instance = document.instantiate()
        throwOnErrors(instance, 'The model could not be simulated.')

        const task = keepForRun(instance.task(0))
        if (!task?.voiName) {
          throw new SimulationError('The model has no differential equation, so there is nothing to simulate over time.')
        }
        const bytes = estimateResultBytes(task, timeCourse.numberOfSteps)
        if (bytes > MAX_RESULT_BYTES) {
          const gigabytes = (bytes / 1024 ** 3).toFixed(1)
          throw new SimulationError(`The results would need ${gigabytes} GB of memory. Use fewer points (a larger point interval).`)
        }

        if (isStopped) return { ...readResults(task, timeCourse, 0), issues: [], elapsedMs: 0, isStopped, isSteadyState }
        if (!instance.startRun()) throw new SimulationError('The simulation could not start.', readIssues(instance))
        while (instance.status.value === RUNNING) {
          onProgress(instance.progress)
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        }
        const elapsedMs = instance.waitForRun()
        if (instance.hasErrors) {
          // The points computed before the failure help to see what went wrong.
          const partial = readResults(task, timeCourse)
          throw new SimulationError(describeRunFailure(instance, settings), readIssues(instance), partial.voi.values.length > 1 ? partial : null)
        }
        onProgress(1)

        return { ...readResults(task, isStopped ? timeCourse : null), issues: readIssues(instance), elapsedMs, isStopped, isSteadyState }
      } finally {
        // A run still going (a throwing onProgress, say) is stopped first: freeing it mid-run blocks the page.
        if (instance?.status.value === RUNNING) {
          instance.stopRun()
          instance.waitForRun()
        }
        runHandles.reverse().forEach((handle) => handle.delete())
        instance?.delete()
        instance = null
      }
    })()

    return {
      promise,
      stop: () => {
        isStopped = true
        instance?.stopRun()
      },
    }
  }

  return { run, dispose }
}

/**
 * Simulates a CellML model once with the given settings, in a session of its own.
 *
 * @param {Object} options
 * @param {Object} options.module - The libOpenCOR module (see libopencorLoader.js).
 * @param {string} options.cellml - The flattened CellML model.
 * @param {Object} options.settings - Simulation settings (simulationSettingsStore.simulationSettings).
 * @param {Function} [options.onProgress] - Called with the progress, from 0 to 1.
 * @returns {{promise: Promise<Object>, stop: Function}} As a session's run.
 */
export function startSimulation({ module, cellml, settings, onProgress = () => {} }) {
  let current = null
  let isStopped = false
  const promise = (async () => {
    await Promise.resolve()
    const session = createSimulationSession({ module, cellml })
    try {
      current = session.run({ settings, onProgress })
      if (isStopped) current.stop()
      return await current.promise
    } finally {
      session.dispose()
    }
  })()
  return {
    promise,
    stop: () => {
      isStopped = true
      current?.stop()
    },
  }
}
