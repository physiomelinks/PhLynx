/**
 * Runs libOpenCOR off the main thread. Reading a large model alone takes seconds, which would freeze the
 * page. Messages: `load` → `ready`/`failed`; `run` → `progress`… then `done`/`error`; `stop`.
 *
 * The worker keeps the last model it read, as a session: a `run` with `cellml` reads a new one, and a run
 * without reuses it, changing only parameter values, as a slider moving needs. Runs take turns.
 */
import { createSimulationSession } from '../services/simulation/engine'

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
 * Runs a simulation and posts its results, reading the model first when the message brings one.
 *
 * @param {Object} message - `{ id, cellml, key, settings, changes, sweep }`; without `cellml`, `key` must name the
 *   session to reuse.
 */
async function run({ id, cellml, key, settings, changes, sweep }) {
  // Asked to stop before its turn, as when a newer run took its place: reading its model would be wasted.
  if (cellml != null && runs.get(id)?.isStopped) {
    runs.delete(id)
    const results = { voi: { name: '', unit: '', values: new Float64Array() }, variables: [], issues: [], elapsedMs: 0, isStopped: true }
    self.postMessage({ type: 'done', id, results })
    return
  }
  try {
    if (cellml != null) {
      session?.dispose()
      session = null
      sessionKey = null
      session = createSimulationSession({ module, cellml })
      sessionKey = key
    } else if (!session || sessionKey !== key) {
      self.postMessage({ type: 'error', id, message: 'The model needs reading again.', issues: [], code: 'no-session' })
      return
    }
    const simulation = session.run({
      settings,
      changes,
      sweep,
      onProgress: (value) => self.postMessage({ type: 'progress', id, value }),
    })
    // Asked to stop while waiting its turn, it stops at once, with no points.
    const waiting = runs.get(id)
    runs.set(id, simulation)
    if (waiting?.isStopped) simulation.stop()
    const posting = forPosting(await simulation.promise)
    self.postMessage({ type: 'done', id, results: posting.results }, posting.buffers)
  } catch (error) {
    const partial = error.partialResults ? forPosting(error.partialResults) : null
    self.postMessage(
      { type: 'error', id, message: error.message, issues: error.issues ?? [], partialResults: partial?.results ?? null },
      partial?.buffers ?? []
    )
  } finally {
    runs.delete(id)
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'load') load(data.base)
  else if (data.type === 'run') {
    // Until its turn comes, a run can only be marked to stop.
    runs.set(data.id, {
      isStopped: false,
      stop() {
        this.isStopped = true
      },
    })
    queue = queue.then(() => run(data))
  } else if (data.type === 'stop') runs.get(data.id)?.stop()
}
