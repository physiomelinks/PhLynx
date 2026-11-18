/**
 * Checks math with libCellML off the main thread (see checkModel): a big module takes a second or more, which
 * would freeze the page as a workspace opens. The worker has its own libCellML, loaded on the first request.
 * Requests are `{ id, xml }`, and replies are `{ id, result }` or `{ id, error }`.
 */
import createLibCellML from 'libcellml.js/libcellml.js'
import libcellmlWasm from 'libcellml.js/libcellml.wasm?url'
import { checkModel } from '../services/math/checkModel'

let libcellml = null

self.onmessage = async ({ data }) => {
  const { id, xml } = data ?? {}
  try {
    libcellml ??= createLibCellML({ locateFile: () => libcellmlWasm })
    self.postMessage({ id, result: checkModel(await libcellml, xml) })
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) })
  }
}
