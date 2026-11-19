/**
 * Reads imported CellML in the libCellML worker (see libcellmlClient.js), so a big file doesn't freeze the page. Each
 * runs the utils/cellml function of the same name there.
 */
import { runLibCellML } from './libcellmlClient'

/**
 * Splits a CellML file into its components and units, as processCellMLData does.
 *
 * @param {string} cellml
 * @param {{ hoist?: boolean }} [options] - hoist: move encapsulated components to the top level first.
 * @returns {Promise<Object>} What processCellMLData returns.
 */
export const processCellMLDataInBackground = (cellml, { hoist = false } = {}) =>
  runLibCellML('processCellMLData', cellml, { hoist })

/**
 * Moves encapsulated components to the top level, as hoistEncapsulatedComponents does.
 *
 * @param {string} cellml
 * @returns {Promise<{cellml: string, hoisted: string[], ignoredContainment: boolean, hoistFailed: boolean}>}
 */
export const hoistEncapsulatedComponentsInBackground = (cellml) => runLibCellML('hoistEncapsulatedComponents', cellml)

/**
 * Checks whether text parses as CellML without errors, as isCellML does.
 *
 * @param {string} content
 * @returns {Promise<boolean>}
 */
export const isCellMLInBackground = (content) => runLibCellML('isCellML', content)

/**
 * Splits a model into one-component models, as extractComponentsFromCellmlString does.
 *
 * @param {string} cellml
 * @returns {Promise<{xml: Array|null, errors: string[]}>}
 */
export const extractComponentsFromCellmlStringInBackground = (cellml) =>
  runLibCellML('extractComponentsFromCellmlString', cellml)

/**
 * Flattens a model of units imports, as flattenImportedUnits (services/import/cellmlImports.js) does.
 *
 * @param {string} modelXml
 * @param {Map<string, string>} files - The imported files' text, by root-relative path.
 * @returns {Promise<{ cellml: string } | { error: string }>}
 */
export const flattenImportedUnitsInBackground = (modelXml, files) => runLibCellML('flattenImportedUnits', modelXml, files)

/**
 * Gets a live conversion's component as a module's math, as liveComponentMath (services/celldl/liveMath.js) does.
 *
 * @param {string} cellml
 * @param {string} [componentName]
 * @returns {Promise<string|null>}
 */
export const liveComponentMathInBackground = (cellml, componentName) => runLibCellML('liveComponentMath', cellml, componentName)
