/**
 * Promise wrapper around the steady-state worker. Where Workers are unavailable (tests, a failed start), calls
 * run inline instead, so callers need no separate code path.
 */
import { analyseSteadyState } from './steadyState'

let activeWorker = null
let isWorkerUnavailable = false
let nextRequestId = 1
const pendingRequests = new Map() // request id -> { resolve, reject, runInline }

function getWorker() {
  if (activeWorker || isWorkerUnavailable || typeof Worker === 'undefined') return activeWorker
  try {
    activeWorker = new Worker(new URL('../../workers/steadyStateWorker.js', import.meta.url), { type: 'module' })
    activeWorker.onmessage = ({ data }) => {
      const request = pendingRequests.get(data.id)
      if (!request) return
      pendingRequests.delete(data.id)
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.result)
    }
    activeWorker.onerror = (event) => {
      console.error('Steady-state worker failed; falling back to the main thread', event)
      for (const request of pendingRequests.values()) request.runInline()
      pendingRequests.clear()
      activeWorker?.terminate()
      activeWorker = null
      isWorkerUnavailable = true
    }
  } catch (error) {
    console.warn('Could not start the steady-state worker; reducing on the main thread', error)
    activeWorker = null
    isWorkerUnavailable = true
  }
  return activeWorker
}

/**
 * Finds a module's cycles and reduces one, off the main thread.
 *
 * @param {Parameters<typeof analyseSteadyState>[0]} options - Plain data: it is posted to the worker.
 * @returns {Promise<import('./steadyState').SteadyStateAnalysis>}
 */
export function analyseSteadyStateInBackground(options) {
  const runInline = () => analyseSteadyState(options)
  const worker = getWorker()
  if (!worker) return Promise.resolve().then(runInline)

  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pendingRequests.set(id, {
      resolve,
      reject,
      runInline: () => Promise.resolve().then(runInline).then(resolve, reject),
    })
    worker.postMessage({ id, options })
  })
}
