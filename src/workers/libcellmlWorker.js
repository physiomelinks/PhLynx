/**
 * Runs libCellML operations off the main thread (see services/libcellml): a big model takes a second or more, which
 * would freeze the page. The worker has its own libCellML, loaded on the first request by loadLibCellML,
 * so utils/cellml runs here as on the main thread. Workers have no DOMParser or XMLSerializer, so xmldom's stand in.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { handleRequest, serialiseError } from '../services/libcellml/protocol'
import { loadLibCellML } from '../utils/cellml'

globalThis.DOMParser = DOMParser
globalThis.XMLSerializer = XMLSerializer

self.onmessage = async ({ data }) => {
  const reply = await handleRequest(data, loadLibCellML)
  try {
    self.postMessage(reply)
  } catch (error) {
    self.postMessage({ id: reply.id, error: serialiseError(error) })
  }
}
