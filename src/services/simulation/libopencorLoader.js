/**
 * Loads libOpenCOR, the simulator, in the background, in a worker (see workers/simulationWorker.js) so
 * that reading and running large models never freezes the page. Its WebAssembly build needs
 * SharedArrayBuffer, so it loads only in a cross-origin isolated page (see utils/isolation.js).
 */
import { markRaw, reactive } from 'vue'

import { SimulationError } from './engine'
import { getIsolationStatus } from '../../utils/isolation'

// Defined by scripts/libopencorAssets.js; builds without it (Electron) have no simulator.
const LIBOPENCOR_BASE = typeof __LIBOPENCOR_BASE__ === 'undefined' ? null : __LIBOPENCOR_BASE__

/**
 * The simulator's state: `status` is 'idle', 'loading', 'ready', 'unavailable' (it can't load here, with
 * `reason` saying why) or 'error' (it failed to load, with `reason` giving the error).
 */
export const libopencor = reactive({ status: 'idle', reason: null, versionString: null })

let loading = null

/** Starts the simulator's worker. */
const createSimulationWorker = () => new Worker(new URL('../../workers/simulationWorker.js', import.meta.url), { type: 'module' })

/**
 * Rebuilds a run's results as posted: its variables as a Map.
 *
 * @param {Object} results
 * @returns {Object}
 */
const decodeRunResults = (results) => ({ ...results, variables: new Map(results.variables) })

/**
 * Rebuilds a protocol's results as posted: each experiment's as a run's.
 *
 * @param {Object} results
 * @returns {Object}
 */
const decodeProtocolResults = (results) => ({ ...results, experiments: results.experiments.map(decodeRunResults) })

/**
 * Wraps the worker in a client: the engine's startSimulation shape, plus describeModel and startProtocol.
 *
 * @param {Worker} worker
 * @param {Function} onReady - Called with the worker's ready or failed message.
 * @returns {{startSimulation: Function, describeModel: Function, startProtocol: Function}}
 */
function createClient(worker, onReady) {
  const pending = new Map()
  let nextId = 1

  worker.onmessage = ({ data }) => {
    if (data.type === 'ready' || data.type === 'failed') {
      onReady(data)
      return
    }
    const run = pending.get(data.id)
    if (!run) return
    if (data.type === 'progress') run.onProgress(data.value)
    else if (data.type === 'done') {
      pending.delete(data.id)
      run.resolve(run.decode(data.results))
    } else if (data.type === 'error') {
      pending.delete(data.id)
      run.reject(new SimulationError(data.message, data.issues, data.partialResults && run.decode(data.partialResults), data.code ?? null))
    }
  }
  worker.onerror = (event) => {
    const message = event?.message || 'The simulator stopped working.'
    onReady({ type: 'failed', message })
    for (const run of pending.values()) run.reject(new SimulationError(message))
    pending.clear()
  }

  /**
   * Sends a request to the worker, settling with its decoded results.
   *
   * @param {Object} message - The request, without its id.
   * @param {Function} decode - Turns the results posted back into the caller's.
   * @param {Function} [onProgress]
   * @returns {{promise: Promise<Object>, stop: Function}}
   */
  function send(message, decode, onProgress = () => {}) {
    const id = nextId++
    const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject, onProgress, decode }))
    worker.postMessage({ ...message, id })
    return { promise, stop: () => worker.postMessage({ type: 'stop', id }) }
  }

  return markRaw({
    /**
     * Starts a simulation in the worker; see engine.js's createSimulationSession. With `cellml`, the worker
     * reads that model and keeps it under `key`; without, it reruns the model it keeps under `key`, and
     * rejects with code 'no-session' if it no longer has it.
     *
     * @param {Object} options - `{ cellml, key, settings, changes, onProgress }`.
     * @returns {{promise: Promise<Object>, stop: Function}}
     */
    startSimulation({ cellml = null, key = null, settings, changes = [], onProgress = () => {} }) {
      return send({ type: 'run', cellml, key, settings: { ...settings }, changes }, decodeRunResults, onProgress)
    },

    /**
     * Lists a model's variables without running it, reading and keeping the model as startSimulation does.
     *
     * @param {Object} options - `{ cellml, key }`.
     * @returns {Promise<{voi: Object, variables: Map<string, {kind: string, unit: string}>}>}
     */
    describeModel({ cellml = null, key = null }) {
      return send({ type: 'describe', cellml, key }, decodeRunResults).promise
    },

    /**
     * Runs a protocol's segments in the worker; see protocolRunner.js. The model is read or reused as by
     * startSimulation.
     *
     * @param {Object} options - `{ cellml, key, settings, plan, targets, baseChanges, onProgress }`, `targets`
     *   mapping each protocol parameter to its reported name.
     * @returns {{promise: Promise<Object>, stop: Function}} Resolves with `{experiments, issues, elapsedMs, isStopped}`.
     */
    startProtocol({ cellml = null, key = null, settings, plan, targets, baseChanges = [], onProgress = () => {} }) {
      const message = { type: 'runProtocol', cellml, key, settings: { ...settings }, plan, targets: [...targets], baseChanges }
      return send(message, decodeProtocolResults, onProgress)
    },
  })
}

/**
 * Starts loading libOpenCOR, once; later calls return the same promise.
 *
 * @param {Object} [options]
 * @param {Object} [options.scope=globalThis] - The window to check for isolation.
 * @param {Function} [options.createWorker] - Starts the simulator's worker.
 * @returns {Promise<Object|null>} A client to run simulations with, or null when it can't or didn't load.
 */
export function loadLibOpenCOR({ scope = globalThis, createWorker = createSimulationWorker } = {}) {
  if (loading) return loading

  const isolation = getIsolationStatus(scope)
  const reason = !LIBOPENCOR_BASE ? 'The simulator isn’t part of this build.' : isolation.reason
  if (reason) {
    Object.assign(libopencor, { status: 'unavailable', reason })
    loading = Promise.resolve(null)
    return loading
  }

  libopencor.status = 'loading'
  loading = new Promise((resolve) => {
    let isSettled = false
    try {
      const worker = createWorker()
      const client = createClient(worker, (message) => {
        if (message.type === 'ready' && !isSettled) {
          Object.assign(libopencor, { status: 'ready', reason: null, versionString: message.versionString })
          resolve(client)
        } else if (message.type === 'failed') {
          Object.assign(libopencor, { status: 'error', reason: message.message })
          if (!isSettled) resolve(null)
        }
        isSettled = true
      })
      worker.postMessage({ type: 'load', base: LIBOPENCOR_BASE })
    } catch (error) {
      Object.assign(libopencor, { status: 'error', reason: error?.message ?? String(error) })
      isSettled = true
      resolve(null)
    }
  })
  return loading
}

/**
 * Waits for libOpenCOR, starting it if nothing has.
 *
 * @returns {Promise<Object|null>} A client to run simulations with, or null when it can't or didn't load.
 */
export function whenLibOpenCORReady() {
  return loading ?? loadLibOpenCOR()
}

/** Forgets the load, so the next call starts again. For tests. */
export function resetLibOpenCORLoader() {
  loading = null
  Object.assign(libopencor, { status: 'idle', reason: null, versionString: null })
}
