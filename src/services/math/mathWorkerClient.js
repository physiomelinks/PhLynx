/**
 * Promise wrapper around the shared math worker. Where Workers are unavailable (tests, a failed
 * start), every call runs inline instead, so callers need no separate code path.
 */
import { analyzeMathBatch } from './analyzeMath'

let activeWorker = null
let isWorkerUnavailable = false
let nextRequestId = 1
const pendingRequests = new Map() // request id -> { resolve, reject, runInline }

/**
 * Starts the worker on first use.
 *
 * @returns {Worker|null} The worker, or null when it can't be used.
 */
function getWorker() {
  if (activeWorker || isWorkerUnavailable || typeof Worker === 'undefined') return activeWorker
  try {
    activeWorker = new Worker(new URL('../../workers/mathWorker.js', import.meta.url), { type: 'module' })
    activeWorker.onmessage = ({ data }) => {
      const request = pendingRequests.get(data.id)
      if (!request) return
      pendingRequests.delete(data.id)
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.result)
    }
    activeWorker.onerror = (event) => {
      console.error('Math worker failed; falling back to main-thread analysis', event)
      for (const request of pendingRequests.values()) request.runInline()
      pendingRequests.clear()
      activeWorker?.terminate()
      activeWorker = null
      isWorkerUnavailable = true
    }
  } catch (error) {
    console.warn('Could not start math worker; analysing on the main thread', error)
    activeWorker = null
    isWorkerUnavailable = true
  }
  return activeWorker
}

/**
 * Analyzes several pieces of math off the main thread, or inline when the worker is unavailable.
 *
 * @param {Array<{key: string, xml: string}>} items
 * @returns {Promise<Array<{key: string, analysis: import('./analyzeMath').MathAnalysis|null}>>} Results in item order.
 */
export function analyzeBatchInBackground(items) {
  const runInline = () => analyzeMathBatch(items)
  const worker = getWorker()
  if (!worker) return Promise.resolve().then(runInline)

  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pendingRequests.set(id, {
      resolve,
      reject,
      runInline: () => Promise.resolve().then(runInline).then(resolve, reject),
    })
    worker.postMessage({ id, items })
  })
}

/**
 * Analyzes one piece of math off the main thread.
 *
 * @param {string} xml - CellML model XML.
 * @returns {Promise<import('./analyzeMath').MathAnalysis|null>}
 */
export async function analyzeInBackground(xml) {
  const [result] = await analyzeBatchInBackground([{ key: '', xml }])
  return result?.analysis ?? null
}
