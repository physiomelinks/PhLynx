/**
 * Runs libOpenCOR off the main thread. Reading a large model alone takes seconds, which would freeze the
 * page. Messages: `load` → `ready`/`failed`; `run` or `runProtocol` → `progress`… then `done`/`error`; `describe` →
 * `done`/`error`; `stop`.
 *
 * The worker keeps the last model it read, as a session: a `run` with `cellml` reads a new one, and a run
 * without reuses it, changing only parameter values, as a slider moving needs. Runs take turns.
 */
import { createSimulationSession } from '../services/simulation/engine'
import { runProtocol } from '../services/simulation/protocolRunner'

let module = null
// The model read last, with the key the page knows it by.
let session = null
let sessionKey = null
const runs = new Map()
// Each run waits for the one before, so no two share the session at once.
let queue = Promise.resolve()

/**
 * Loads libOpenCOR from where the build serves it.
 *
 * @param {string} base - The URL of its folder.
 */
async function load(base) {
  try {
    const { default: createModule } = await import(/* @vite-ignore */ `${base}libopencor.js`)
    module = await createModule({ locateFile: (file) => `${base}${file}` })
    self.postMessage({ type: 'ready', versionString: module.versionString() })
  } catch (error) {
    self.postMessage({ type: 'failed', message: error?.message ?? String(error) })
  }
}

/**
 * Lists results for posting, with the buffers to hand over rather than copy.
 *
 * @param {Object} results - `{ voi, variables }`, variables as a Map.
 * @returns {{results: Object, buffers: ArrayBuffer[]}}
 */
function forPosting(results) {
  const variables = [...results.variables]
  const buffers = [results.voi.values.buffer, ...variables.map(([, series]) => series.values.buffer)]
  return { results: { ...results, variables }, buffers }
}

/**
 * Lists a protocol's results for posting, each experiment's as forPosting lists a run's.
 *
 * @param {{experiments: Array}} results
 * @returns {{results: Object, buffers: ArrayBuffer[]}}
 */
function forPostingProtocol(results) {
  const postings = results.experiments.map(forPosting)
  return { results: { ...results, experiments: postings.map(({ results: experiment }) => experiment) }, buffers: postings.flatMap(({ buffers }) => buffers) }
}

/**
 * Gives the session a message runs on: a new one when it brings a model, else the one kept under its key.
 *
 * @param {Object} message - `{ id, cellml, key }`.
 * @returns {Object|null} Null, having said so, when the worker no longer has the model.
 */
function findSession({ id, cellml, key }) {
  if (cellml != null) {
    session?.dispose()
    session = null
    sessionKey = null
    session = createSimulationSession({ module, cellml })
    sessionKey = key
  } else if (!session || sessionKey !== key) {
    self.postMessage({ type: 'error', id, message: 'The model needs reading again.', issues: [], code: 'no-session' })
    return null
  }
  return session
}

/**
 * Runs a simulation, or a protocol's segments, and posts its results, reading the model first when the message
 * brings one.
 *
 * @param {Object} message - `{ type, id, cellml, key, settings, changes }`, and for a protocol `{ plan, targets,
 *   baseChanges }`; without `cellml`, `key` must name the session to reuse.
 */
async function run(message) {
  const { type, id, cellml, settings } = message
  // Asked to stop before its turn, as when a newer run took its place: reading its model would be wasted.
  if (cellml != null && runs.get(id)?.isStopped) {
    runs.delete(id)
    const results =
      type === 'runProtocol'
        ? { experiments: [], issues: [], elapsedMs: 0, isStopped: true }
        : { voi: { name: '', unit: '', values: new Float64Array() }, variables: [], issues: [], elapsedMs: 0, isStopped: true }
    self.postMessage({ type: 'done', id, results })
    return
  }
  const prepareForPosting = type === 'runProtocol' ? forPostingProtocol : forPosting
  try {
    const current = findSession(message)
    if (!current) return
    const onProgress = (value) => self.postMessage({ type: 'progress', id, value })
    const simulation =
      type === 'runProtocol'
        ? runProtocol({ session: current, plan: message.plan, settings, targets: new Map(message.targets), baseChanges: message.baseChanges, onProgress })
        : current.run({ settings, changes: message.changes, onProgress })
    // Asked to stop while waiting its turn, it stops at once, with no points.
    const waiting = runs.get(id)
    runs.set(id, simulation)
    if (waiting?.isStopped) simulation.stop()
    const posting = prepareForPosting(await simulation.promise)
    self.postMessage({ type: 'done', id, results: posting.results }, posting.buffers)
  } catch (error) {
    const partial = error.partialResults ? prepareForPosting(error.partialResults) : null
    self.postMessage(
      { type: 'error', id, message: error.message, issues: error.issues ?? [], partialResults: partial?.results ?? null, code: error.code ?? null },
      partial?.buffers ?? []
    )
  } finally {
    runs.delete(id)
  }
}

/**
 * Lists a model's variables without running it, reading the model first when the message brings one.
 *
 * @param {Object} message - `{ id, cellml, key }`.
 */
function describe(message) {
  try {
    const current = findSession(message)
    if (!current) return
    const { voi, variables } = current.describe()
    self.postMessage({ type: 'done', id: message.id, results: { voi, variables: [...variables] } })
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, message: error.message, issues: error.issues ?? [], partialResults: null })
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'load') load(data.base)
  else if (data.type === 'run' || data.type === 'runProtocol') {
    // Until its turn comes, a run can only be marked to stop.
    runs.set(data.id, {
      isStopped: false,
      stop() {
        this.isStopped = true
      },
    })
    queue = queue.then(() => run(data))
  } else if (data.type === 'describe') queue = queue.then(() => describe(data))
  else if (data.type === 'stop') runs.get(data.id)?.stop()
}
