/**
 * Reads and writes CUFLynx/circulatory_autogen's params_for_id.csv, which carries the ranges its
 * sensitivity/identification sliders use, as PhLynx's own parameter scan selections (parameterSliders.js).
 * `vessel_name` is `global` for a global constant, else an instance name; `param_type` is always `const`,
 * since only constants and global constants are slidable.
 */
import Papa from 'papaparse'

import { createSliderDefinition, isSlidableRow } from './parameterSliders'

export const PARAMS_FOR_ID_FORMAT = 'text/csv'
export const PARAMS_FOR_ID_COLUMNS = ['vessel_name', 'param_name', 'param_type', 'min', 'max', 'name_for_plotting']
const GLOBAL_VESSEL_NAME = 'global'
const PARAM_TYPE = 'const'

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
 * Whether an archive entry's filename looks like a params_for_id file.
 *
 * @param {string} location
 * @returns {boolean}
 */
export const looksLikeParamsForIdLocation = (location) => /params_for_id/i.test(location.split('/').at(-1))

/**
 * Finds the params_for_id file among an archive's extra files.
 *
 * @param {Array<{location: string, format: string, payload: *}>} extras
 * @returns {{index: number, entry: Object}|null}
 */
export function findParamsForIdExtra(extras) {
  const index = (extras ?? []).findIndex((entry) => looksLikeParamsForIdLocation(entry.location))
  return index === -1 ? null : { index, entry: extras[index] }
}

/**
 * Parses a params_for_id file's contents into rows, trimming the whitespace CUFLynx pads its columns with.
 *
 * @param {ArrayBuffer|ArrayBufferView|string} payload
 * @returns {Array<Object>}
 * @throws {Error} When a required column is missing.
 */
export function parseParamsForId(payload) {
  const { data, meta } = Papa.parse(readText(payload), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => (typeof value === 'string' ? value.trim() : value),
  })
  const missing = PARAMS_FOR_ID_COLUMNS.filter((column) => !(meta.fields ?? []).includes(column))
  if (missing.length) throw new Error(`Invalid params_for_id file. Missing columns: ${missing.join(', ')}.`)
  return data.filter((row) => row.vessel_name && row.param_name)
}

/**
 * Resolves params_for_id rows against the workspace's nodes, building a slider definition for each row that
 * names a slidable variable, and carrying over the file's range and display label.
 *
 * @param {Array<Object>} rows - From parseParamsForId.
 * @param {Array<Object>} nodes - Workspace nodes.
 * @param {Function} getGlobalConstant - libraryStore.getGlobalConstant.
 * @returns {{selections: Array<Object>, warnings: Array<string>}}
 */
export function resolveParamsForIdRows(rows, nodes, getGlobalConstant) {
  const selections = []
  const warnings = []
  for (const row of rows) {
    const isGlobal = row.vessel_name.toLowerCase() === GLOBAL_VESSEL_NAME
    const node = isGlobal
      ? (nodes ?? []).find((candidate) => (candidate.data?.variables ?? []).some((v) => v.name === row.param_name && v.type === 'global_constant'))
      : (nodes ?? []).find((candidate) => candidate.data?.name === row.vessel_name)
    const variable = node?.data?.variables?.find((candidate) => candidate.name === row.param_name)

    if (!node || !variable) {
      warnings.push(`${row.vessel_name}/${row.param_name}: not found in this workspace.`)
      continue
    }
    if (!isSlidableRow(variable)) {
      warnings.push(`${row.vessel_name}/${row.param_name}: not a constant, so it can't have a slider.`)
      continue
    }

    const definition = createSliderDefinition(node, variable, getGlobalConstant)
    const min = Number(row.min)
    const max = Number(row.max)
    selections.push({
      ...definition,
      min: Number.isFinite(min) ? min : definition.min,
      max: Number.isFinite(max) ? max : definition.max,
      label: row.name_for_plotting || null,
    })
  }
  return { selections, warnings }
}

/**
 * Builds params_for_id rows from parameter scan selections, the inverse of resolveParamsForIdRows.
 *
 * @param {Array<Object>} selections - parameterScanConfig.selections.
 * @returns {Array<Object>}
 */
export function paramsForIdRowsFromSelections(selections) {
  return (selections ?? []).map((selection) => ({
    vessel_name: selection.type === 'global_constant' ? GLOBAL_VESSEL_NAME : selection.nodeName,
    param_name: selection.parameterName,
    param_type: PARAM_TYPE,
    min: selection.min,
    max: selection.max,
    name_for_plotting: selection.label || '',
  }))
}

/**
 * Writes params_for_id rows as a file's contents.
 *
 * @param {Array<Object>} rows
 * @returns {string}
 */
export function serialiseParamsForId(rows) {
  return Papa.unparse(rows, { columns: PARAMS_FOR_ID_COLUMNS })
}

/**
 * Names a new params_for_id file after the model, as CA does.
 *
 * @param {string} stem - The model's name, without an extension.
 * @returns {string}
 */
export const buildParamsForIdLocation = (stem) => (stem ? `${stem}_params_for_id.csv` : 'params_for_id.csv')

/**
 * Decides what an OMEX export's params_for_id file should hold: a fresh CSV from the current sliders, at
 * an existing extra's own filename if there is one, or null to pass an untouched extra through verbatim
 * (an unrelated file, or one from a workspace that hasn't touched its sliders).
 *
 * @param {Array<Object>} selections - parameterScanConfig.selections.
 * @param {Array<{location: string, format: string}>} preservedExtras - The archive's other extra files.
 * @returns {{location: string, csv: string}|null}
 */
export function resolveParamsForIdExport(selections, preservedExtras) {
  if (!selections?.length) return null
  const existing = findParamsForIdExtra(preservedExtras)
  const location = existing?.entry.location ?? buildParamsForIdLocation()
  return { location, csv: serialiseParamsForId(paramsForIdRowsFromSelections(selections)) }
}
