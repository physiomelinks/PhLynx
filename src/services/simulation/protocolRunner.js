/**
 * Runs a protocol's planned segments (see services/protocol/libopencorEngine/protocolPlan.js) on a simulation session, one after
 * another, each later one starting from the states the one before ended with, and joins each experiment's results.
 * Some variables also keep each sub-experiment's own series, as circulatory_autogen records it for its features.
 */
import { MAX_RESULT_BYTES, SimulationError } from './engine'
import { buildExperimentTime, joinSegmentValues } from '../protocol/libopencorEngine/protocolPlan.js'

/**
 * Splits a reported name into the component and variable libOpenCOR changes it by.
 *
 * @param {string} name - `component/variable`.
 * @returns {{component: string, variable: string}}
 */
const splitName = (name) => ({ component: name.slice(0, name.indexOf('/')), variable: name.slice(name.indexOf('/') + 1) })

/**
 * Combines lists of changes into one change per variable, later lists winning: the base changes, then the protocol's
 * values, then the states carried over.
 *
 * @param {Array<Array<{component: string, variable: string, value: number}>>} lists
 * @returns {Array<{component: string, variable: string, value: number}>}
 */
export function mergeChanges(lists) {
  const byName = new Map()
  for (const change of lists.flat()) byName.set(`${change.component}/${change.variable}`, change)
  return [...byName.values()]
}

/**
 * Lists a segment's protocol values as changes to the variables they target.
 *
 * @param {Array<{parameter: string, value: number}>} values
 * @param {Map<string, string>} targets - Each protocol parameter's reported name, `component/variable`.
 * @returns {Array<{component: string, variable: string, value: number}>}
 */
function buildValueChanges(values, targets) {
  return values.map(({ parameter, value }) => {
    const target = targets.get(parameter)
    if (!target) throw new SimulationError(`The protocol sets ${parameter}, which isn't in the model.`)
    return { ...splitName(target), value }
  })
}

/**
 * Lists the states a segment ended with, as changes for the next one to start from.
 *
 * @param {Map<string, Object>} variables - The segment's results.
 * @returns {Array<{component: string, variable: string, value: number}>}
 */
function buildCarriedStates(variables) {
  return [...variables].filter(([, { kind }]) => kind === 'state').map(([name, { values }]) => ({ ...splitName(name), value: values.at(-1) }))
}

/**
 * Sets up an experiment's joined results from its first segment's: every variable, at every point it will have, and
 * each sub-experiment's own series of the variables recorded.
 *
 * @param {Object} experimentPlan
 * @param {Object} results - The first segment's results.
 * @param {string[]} recorded - Reported names.
 * @returns {Object} `{voi, variables, preTime, subs, filledCount, subSeries, subFilledCounts}`.
 */
function createExperimentResults(experimentPlan, results, recorded) {
  const variables = new Map()
  for (const [name, { kind, unit }] of results.variables) variables.set(name, { kind, unit, values: new Float64Array(experimentPlan.pointCount) })
  const names = recorded.filter((name) => results.variables.has(name))
  return {
    voi: { name: results.voi.name, unit: results.voi.unit, values: buildExperimentTime(experimentPlan) },
    variables,
    preTime: experimentPlan.preTime,
    subs: experimentPlan.subs,
    filledCount: 0,
    subSeries: experimentPlan.subs.map(({ numberOfSteps }) => Object.fromEntries(names.map((name) => [name, new Float64Array(numberOfSteps + 1)]))),
    subFilledCounts: experimentPlan.subs.map(() => 0),
  }
}

/**
 * Adds a segment's results to its experiment's. Its sub-experiment's own series start with the segment that starts
 * it, its first point included: CA records it once the sub-experiment's values are set, where the joined series keep
 * the last point of the one before.
 *
 * @param {Object} experiment - From createExperimentResults.
 * @param {Object} results - The segment's.
 * @param {Object} segment - The segment's plan.
 */
function joinSegment(experiment, results, segment) {
  const computed = results.voi.values.length
  if (!segment.isLogged || !computed) return
  for (const [name, series] of experiment.variables) {
    const values = results.variables.get(name)?.values
    if (values) joinSegmentValues(series.values, values, segment.startIndex, segment.dropsFirstPoint)
  }
  experiment.filledCount = segment.startIndex + computed
  const offset = segment.startIndex - experiment.subs[segment.sub].startIndex
  for (const [name, own] of Object.entries(experiment.subSeries[segment.sub])) {
    const values = results.variables.get(name)?.values
    if (values) joinSegmentValues(own, values, offset, offset > 0 && segment.dropsFirstPoint)
  }
  experiment.subFilledCounts[segment.sub] = offset + computed
}

/**
 * Gives an experiment's results as a run's: only its computed points, without the bookkeeping, and the own series of
 * each sub-experiment run to its end.
 *
 * @param {Object} experiment
 * @returns {{voi: Object, variables: Map<string, Object>, preTime: number, subs: Array, subSeries: Array<Object<string,
 *   Float64Array>|null>}}
 */
function finishExperiment({ voi, variables, preTime, subs, filledCount, subSeries, subFilledCounts }) {
  const trim = (values) => (filledCount === values.length ? values : values.slice(0, filledCount))
  const trimmed = new Map([...variables].map(([name, series]) => [name, { ...series, values: trim(series.values) }]))
  const finished = subSeries.map((series, s) => (subFilledCounts[s] === subs[s].numberOfSteps + 1 ? series : null))
  return { voi: { ...voi, values: trim(voi.values) }, variables: trimmed, preTime, subs, subSeries: finished }
}

/**
 * Runs a protocol on a session.
 *
 * @param {Object} options
 * @param {Object} options.session - From createSimulationSession; runs on it must not overlap.
 * @param {{experiments: Array}} options.plan - From compileProtocolPlan.
 * @param {Object} options.settings - Simulation settings, for the solver.
 * @param {Map<string, string>} options.targets - Each protocol parameter's reported name.
 * @param {Array<{component: string, variable: string, value: number}>} [options.baseChanges] - Changes applied to
 *   every segment, such as putting back the model's values; the protocol's own values win over them.
 * @param {string[]} [options.recorded] - The reported names whose own series each sub-experiment keeps, as a
 *   feature reduces them; only these, to keep memory down.
 * @param {Function} [options.onProgress] - Called with the progress, from 0 to 1, by model time.
 * @returns {{promise: Promise<Object>, stop: Function}} `promise` resolves with `{experiments: [{voi, variables,
 *   preTime, subs, subSeries}], issues, elapsedMs, isStopped}`, `subSeries` by sub-experiment, `{name: values}` or null for
 *   one not run to its end; or rejects with a SimulationError whose partial results are `{experiments}` so far;
 *   `stop` ends the run after keeping what the segment running has computed.
 */
export function runProtocol({ session, plan, settings, targets, baseChanges = [], recorded = [], onProgress = () => {} }) {
  let current = null
  let isStopped = false

  const promise = (async () => {
    await Promise.resolve()
    const totalTime = plan.experiments.reduce((total, { modelTime }) => total + modelTime, 0)
    const finished = []
    const issues = []
    let doneTime = 0
    let elapsedMs = 0
    let experiment = null

    for (const experimentPlan of plan.experiments) {
      if (isStopped) break
      experiment = null
      let carried = []
      for (const segment of experimentPlan.segments) {
        if (isStopped) break
        const segmentTime = segment.duration
        let results
        try {
          current = session.run({
            settings,
            timeCourse: segment.timeCourse,
            changes: mergeChanges([baseChanges, buildValueChanges(segment.values, targets), carried]),
            onProgress: (value) => onProgress(totalTime ? (doneTime + value * segmentTime) / totalTime : 0),
          })
          if (isStopped) current.stop()
          results = await current.promise
        } catch (error) {
          if (error.partialResults && experiment) joinSegment(experiment, error.partialResults, segment)
          const experiments = [...finished, ...(experiment ? [finishExperiment(experiment)] : [])]
          const message = plan.experiments.length > 1 ? `Experiment ${finished.length + 1}: ${error.message}` : error.message
          throw new SimulationError(message, error.issues ?? [], experiments.length ? { experiments } : null, error.code ?? null)
        }
        if (!experiment) {
          experiment = createExperimentResults(experimentPlan, results, recorded)
          const variableCount = experiment.variables.size + 1
          const pointCount = plan.experiments.reduce((total, { pointCount: count }) => total + count, 0)
          const bytes = variableCount * pointCount * Float64Array.BYTES_PER_ELEMENT
          if (finished.length === 0 && bytes > MAX_RESULT_BYTES) {
            throw new SimulationError(`The results would need ${(bytes / 1024 ** 3).toFixed(1)} GB of memory. Use fewer points (a larger point interval).`)
          }
        }
        joinSegment(experiment, results, segment)
        issues.push(...results.issues)
        elapsedMs += results.elapsedMs
        doneTime += segmentTime
        if (results.isStopped) isStopped = true
        carried = buildCarriedStates(results.variables)
      }
      if (experiment) finished.push(finishExperiment(experiment))
    }
    onProgress(1)
    return { experiments: finished, issues, elapsedMs, isStopped }
  })()

  return {
    promise,
    stop: () => {
      isStopped = true
      current?.stop()
    },
  }
}
