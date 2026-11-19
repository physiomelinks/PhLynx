/**
 * Runs libCellML operations off the main thread (see services/libcellml): a big model takes a second or more, which
 * would freeze the page. The worker has its own libCellML, loaded on the first request and bound with initLibCellML,
 * so utils/cellml runs here as on the main thread. Workers have no DOMParser or XMLSerializer, so xmldom's stand in.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js/libcellml.js'
import libcellmlWasm from 'libcellml.js/libcellml.wasm?url'
import { handleRequest, serialiseError } from '../services/libcellml/protocol'
import { initLibCellML } from '../utils/cellml'

globalThis.DOMParser = DOMParser
globalThis.XMLSerializer = XMLSerializer

let libcellmlLoading = null

/** Loads libCellML once; a failed load is tried again on the next request. */
function loadLibCellML() {
  libcellmlLoading ??= createLibCellML({ locateFile: () => libcellmlWasm }).then(
    (instance) => {
      initLibCellML(instance)
      return instance
    },
    (error) => {
      libcellmlLoading = null
      throw error
    }
  )
  return libcellmlLoading
}

self.onmessage = async ({ data }) => {
  const reply = await handleRequest(data, loadLibCellML)
  try {
    self.postMessage(reply)
  } catch (error) {
    self.postMessage({ id: reply.id, error: serialiseError(error) })
  }
}
