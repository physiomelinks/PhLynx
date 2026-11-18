/**
 * Promise wrapper around the math check worker (workers/mathCheckWorker.js). Where Workers are unavailable (tests,
 * a failed start), checks run on the main thread instead, once the page's libCellML has loaded.
 */
import { withLibraryUnits } from './checkMath'
import { checkModel } from './checkModel'
import { getLibCellML, whenLibCellMLReady } from '../../utils/cellml'

let activeWorker = null
let isWorkerUnavailable = false
let nextRequestId = 1
const pendingRequests = new Map() // request id -> { resolve, reject, runInline }

const checkInline = (xml) => whenLibCellMLReady().then(() => checkModel(getLibCellML(), xml))

/**
 * Starts the worker on first use.
 *
 * @returns {Worker|null} The worker, or null when it can't be used.
 */
function getWorker() {
  if (activeWorker || isWorkerUnavailable || typeof Worker === 'undefined') return activeWorker
  try {
    activeWorker = new Worker(new URL('../../workers/mathCheckWorker.js', import.meta.url), { type: 'module' })
    activeWorker.onmessage = ({ data }) => {
      const request = pendingRequests.get(data.id)
      if (!request) return
      pendingRequests.delete(data.id)
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.result)
    }
    activeWorker.onerror = (event) => {
      console.error('Math check worker failed; checking on the main thread', event)
      for (const request of pendingRequests.values()) request.runInline()
      pendingRequests.clear()
      activeWorker?.terminate()
      activeWorker = null
      isWorkerUnavailable = true
    }
  } catch (error) {
    console.warn('Could not start the math check worker; checking on the main thread', error)
    activeWorker = null
    isWorkerUnavailable = true
  }
  return activeWorker
}

/**
 * Checks a math on its own, with the library's units, off the main thread (see checkModel for what it finds).
 *
 * @param {string} mathXml - A math as libraryStore keeps it.
 * @param {Map<string, Array<Object>>} unitDefinitions - The library's, as libraryStore.unitDefinitions.
 * @returns {Promise<{ invalid: string[], imbalances: string[] }>}
 */
export function checkMathInBackground(mathXml, unitDefinitions) {
  const xml = withLibraryUnits(mathXml, unitDefinitions)
  const worker = getWorker()
  if (!worker) return checkInline(xml)

  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pendingRequests.set(id, { resolve, reject, runInline: () => checkInline(xml).then(resolve, reject) })
    worker.postMessage({ id, xml })
  })
}
