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
 * Lists the files CUFLynx would take as the obs_data among an archive's extra files, in the order it would pick
 * them: the JSON files named with "obs", whatever they hold, or else the first whose contents look like obs_data.
 * Files named with "param", PhLynx's module config and its own state files are passed over.
 *
 * @param {Array<{location: string, format: string, payload: *}>} extras - omexStore's preserved extras.
 * @returns {Array<{index: number, entry: Object, document: Object|Array|undefined, parseError: Error|null}>} A
 *   document is undefined, with the reason, when its file isn't JSON.
 */
export function listObsDataExtras(extras) {
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
  const named = candidates.filter(({ entry }) => /obs/i.test(baseName(entry.location)))
  if (named.length) return named
  const found = candidates.find(({ document }) => looksLikeObsData(document))
  return found ? [found] : []
}

/**
 * Finds the obs_data among an archive's extra files, as CUFLynx picks it: the first of listObsDataExtras.
 *
 * @param {Array<{location: string, format: string, payload: *}>} extras - omexStore's preserved extras.
 * @returns {{index: number, entry: Object, document: Object|Array|undefined, parseError: Error|null}|null}
 */
export const findObsDataExtra = (extras) => listObsDataExtras(extras)[0] ?? null

/**
 * Writes an obs_data document as a file's contents, indented as CA and CUFLynx write it.
 *
 * @param {Object|Array} document
 * @returns {ArrayBuffer}
 */
export function serialiseObsData(document) {
  return new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`).buffer
}

/** The most characters of a protocol's name a file name keeps, well within what file systems allow. */
export const MAXIMUM_PROTOCOL_NAME_LENGTH = 64

/**
 * Turns a protocol's name into the part of a file name it is kept as: letters, digits, "_" and "-", with any run of
 * other characters as one "_", cut to MAXIMUM_PROTOCOL_NAME_LENGTH characters.
 *
 * @param {string} name
 * @returns {string} Empty when the name has nothing to keep.
 */
export const slugifyProtocolName = (name) =>
  String(name ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, MAXIMUM_PROTOCOL_NAME_LENGTH)
    .replace(/_+$/, '')

/**
 * Names a new obs_data file after the model, as CA does, and after the protocol it holds when it has a name.
 *
 * @param {string} stem - The model's name, without an extension.
 * @param {string} [protocolName]
 * @returns {string}
 */
export function buildObsDataLocation(stem, protocolName) {
  const slug = slugifyProtocolName(protocolName)
  return slug ? `${stem || 'model'}_${slug}_obs_data.json` : `${stem || 'model'}_obs_data.json`
}

/**
 * Names the protocol an obs_data file holds after the file: without its folders, its "_obs_data.json" or ".json"
 * ending and a leading "<model>_", underscores read as spaces. A file named only after the model is named as the
 * model.
 *
 * @param {string} location
 * @param {string} [stem] - The model's name, without an extension.
 * @returns {string}
 */
export function nameObsDataFile(location, stem) {
  let name = baseName(location).replace(/\.json$/i, '').replace(/_?obs_data$/i, '')
  if (stem && name.length > stem.length + 1 && name.startsWith(`${stem}_`)) name = name.slice(stem.length + 1)
  return name.replace(/_+/g, ' ').trim() || 'Protocol'
}
