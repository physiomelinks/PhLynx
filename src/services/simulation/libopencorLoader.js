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
 * Wraps the worker in a client with the engine's startSimulation shape.
 *
 * @param {Worker} worker
 * @param {Function} onReady - Called with the worker's ready or failed message.
 * @returns {{startSimulation: Function}}
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
      run.resolve({ ...data.results, variables: new Map(data.results.variables) })
    } else if (data.type === 'error') {
      pending.delete(data.id)
      const partial = data.partialResults && { ...data.partialResults, variables: new Map(data.partialResults.variables) }
      run.reject(new SimulationError(data.message, data.issues, partial, data.code ?? null))
    }
  }
  worker.onerror = (event) => {
    const message = event?.message || 'The simulator stopped working.'
    onReady({ type: 'failed', message })
    for (const run of pending.values()) run.reject(new SimulationError(message))
    pending.clear()
  }

  return markRaw({
    /**
     * Starts a simulation in the worker; see engine.js's createSimulationSession. With `cellml`, the worker
     * reads that model and keeps it under `key`; without, it reruns the model it keeps under `key`, and
     * rejects with code 'no-session' if it no longer has it.
     *
     * @param {Object} options - `{ cellml, key, settings, changes, sweep, onProgress }`.
     * @returns {{promise: Promise<Object>, stop: Function}}
     */
    startSimulation({ cellml = null, key = null, settings, changes = [], sweep = null, onProgress = () => {} }) {
      const id = nextId++
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject, onProgress }))
      // Plain copies: a store's settings are reactive proxies, which a worker message can't carry.
      worker.postMessage({ type: 'run', id, cellml, key, settings: JSON.parse(JSON.stringify(settings)), changes, sweep })
      return { promise, stop: () => worker.postMessage({ type: 'stop', id }) }
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
