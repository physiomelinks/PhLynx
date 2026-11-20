/**
 * Runs libCellML operations (operations.js) in the libCellML worker (workers/libcellmlWorker.js), off the main
 * thread. Where Workers are unavailable (tests, a failed start), operations run on the main thread instead, loading
 * libCellML there on first use; requests still pending when the worker fails rerun there.
 */
import { deserialiseError } from './protocol'
import { runOperation } from './operations'
import { loadLibCellML } from '../../utils/cellml'

let activeWorker = null
let isWorkerUnavailable = false
let nextRequestId = 1
const pendingRequests = new Map() // request id -> { resolve, reject, runInline }

const runInline = (op, args) => loadLibCellML().then((libcellml) => runOperation(libcellml, op, args))

/** Stops using the worker, rerunning its pending requests on the main thread. */
function abandonWorker() {
  for (const request of pendingRequests.values()) request.runInline()
  pendingRequests.clear()
  activeWorker?.terminate()
  activeWorker = null
  isWorkerUnavailable = true
}

/**
 * Starts the worker on first use.
 *
 * @returns {Worker|null} The worker, or null when it can't be used.
 */
function getWorker() {
  if (activeWorker || isWorkerUnavailable || typeof Worker === 'undefined') return activeWorker
  try {
    activeWorker = new Worker(new URL('../../workers/libcellmlWorker.js', import.meta.url), { type: 'module' })
    activeWorker.onmessage = ({ data }) => {
      const request = pendingRequests.get(data.id)
      if (!request) return
      pendingRequests.delete(data.id)
      data.error ? request.reject(deserialiseError(data.error)) : request.resolve(data.result)
    }
    activeWorker.onerror = (event) => {
      console.error('libCellML worker failed; running on the main thread', event)
      abandonWorker()
    }
  } catch (error) {
    console.warn('Could not start the libCellML worker; running on the main thread', error)
    activeWorker = null
    isWorkerUnavailable = true
  }
  return activeWorker
}

/**
 * Runs a libCellML operation off the main thread.
 *
 * @param {string} op - An operation's name, from operations.js.
 * @param {...*} args - Its arguments after libcellml, as plain data.
 * @returns {Promise<*>} What it returns; rejects with what it throws (name, message and plain-data properties).
 */
export function runLibCellML(op, ...args) {
  const worker = getWorker()
  if (!worker) return runInline(op, args)

  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pendingRequests.set(id, { resolve, reject, runInline: () => runInline(op, args).then(resolve, reject) })
    try {
      worker.postMessage({ id, op, args })
    } catch (error) {
      pendingRequests.delete(id)
      reject(error)
    }
  })
}
