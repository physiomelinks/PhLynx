/**
 * Reads and writes circulatory_autogen's obs_data.json, which carries a study's protocol, and finds it among an
 * archive's files the way CUFLynx does (apps/api/omex_import.py).
 */
import { isMapping } from './protocolShapes.js'

export const OBS_DATA_FORMAT = 'application/json'
// PhLynx's module config, by the name CUFLynx knows it by.
const MODULE_CONFIG_NAME = 'module_config.json'
// Formats whose files are never observations: PhLynx's own state, and SED-ML.
const NON_OBS_FORMAT_MARKERS = ['x.vnd.phlynx-flow+json', 'x.vnd.phlynx-changes+json', 'sed-ml', 'sedml']

/**
 * Gives a file's name without its folders.
 *
 * @param {string} location
 * @returns {string}
 */
const baseName = (location) => location.split('/').at(-1)

/**
 * Reads a file's contents as text.
 *
 * @param {ArrayBuffer|ArrayBufferView|string} payload
 * @returns {string}
 */
function readText(payload) {
  if (typeof payload === 'string') return payload
  return new TextDecoder().decode(payload)
}

/**
 * Parses an obs_data file. A bare list is a list of data items with no protocol.
 *
 * @param {ArrayBuffer|ArrayBufferView|string} payload
 * @returns {{document: Object|Array, protocolInfo: Object|null, dataItems: Array, predictionItems: Array}}
 * @throws {SyntaxError} When it isn't JSON.
 */
export function parseObsData(payload) {
  const document = JSON.parse(readText(payload))
  return { document, ...readObsDataParts(document) }
}

/**
 * Picks out an obs_data document's protocol, data items and prediction items.
 *
 * @param {Object|Array} document
 * @returns {{protocolInfo: Object|null, dataItems: Array, predictionItems: Array}}
 */
export function readObsDataParts(document) {
  if (Array.isArray(document)) return { protocolInfo: null, dataItems: document, predictionItems: [] }
  if (!isMapping(document)) return { protocolInfo: null, dataItems: [], predictionItems: [] }
  const list = (value) => (Array.isArray(value) ? value : [])
  return {
    protocolInfo: document.protocol_info ?? null,
    dataItems: list(document.data_items ?? document.data_item),
    predictionItems: list(document.prediction_items),
  }
}

/**
 * Whether a JSON document looks like obs_data: data items, or a protocol.
 *
 * @param {*} document
 * @returns {boolean}
 */
const looksLikeObsData = (document) => Array.isArray(document) || (isMapping(document) && ('data_items' in document || 'protocol_info' in document))

/**
 * Finds the obs_data among an archive's extra files, as CUFLynx picks it: a JSON file named with "obs" wins, whatever
 * it holds, or else the first whose contents look like obs_data. Files named with "param", PhLynx's module config and
 * its own state files are passed over.
 *
 * @param {Array<{location: string, format: string, payload: *}>} extras - omexStore's preserved extras.
 * @returns {{index: number, entry: Object, document: Object|Array|undefined, parseError: Error|null}|null} The
 *   document is undefined, with the reason, when the file chosen isn't JSON.
 */
export function findObsDataExtra(extras) {
  const candidates = extras
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const name = baseName(entry.location)
      const format = (entry.format ?? '').toLowerCase()
      return (
        /\.json$/i.test(name) &&
        !/param/i.test(name) &&
        name !== MODULE_CONFIG_NAME &&
        !NON_OBS_FORMAT_MARKERS.some((marker) => format.includes(marker))
      )
    })
    .map((candidate) => {
      try {
        return { ...candidate, document: JSON.parse(readText(candidate.entry.payload ?? '')), parseError: null }
      } catch (error) {
        return { ...candidate, document: undefined, parseError: error }
      }
    })
  return (
    candidates.find(({ entry }) => /obs/i.test(baseName(entry.location))) ??
    candidates.find(({ document }) => looksLikeObsData(document)) ??
    null
  )
}

/**
 * Writes an obs_data document as a file's contents, indented as CA and CUFLynx write it.
 *
 * @param {Object|Array} document
 * @returns {ArrayBuffer}
 */
export function serialiseObsData(document) {
  return new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`).buffer
}

/**
 * Names a new obs_data file after the model, as CA does.
 *
 * @param {string} stem - The model's name, without an extension.
 * @returns {string}
 */
export const buildObsDataLocation = (stem) => `${stem || 'model'}_obs_data.json`
