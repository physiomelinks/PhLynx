/**
 * Asks libCellML about models in its worker (see libcellmlClient.js), so the page doesn't wait on it. Each runs the
 * function of the same name there, on strings and plain data.
 */
import { runLibCellML } from './libcellmlClient'
import { toPlain } from './librarySnapshot'

/**
 * Checks whether two CellML models are the same, as areModelsEquivalent does.
 *
 * @param {string} modelA
 * @param {string} modelB
 * @returns {Promise<boolean>}
 */
export const areModelsEquivalentInBackground = (modelA, modelB) => runLibCellML('areModelsEquivalent', modelA, modelB)

/**
 * Puts one-component models into one model, as combineComponentModels does.
 *
 * @param {string} modelName
 * @param {string[]} componentModels
 * @param {Array<string|undefined>} [names]
 * @returns {Promise<string>}
 */
export const combineComponentModelsInBackground = (modelName, componentModels, names = []) =>
  runLibCellML('combineComponentModels', modelName, toPlain(componentModels), toPlain(names))

/**
 * Names a model's top-level components, as getModelComponentNames does.
 *
 * @param {string} model
 * @returns {Promise<string[]>}
 */
export const getModelComponentNamesInBackground = (model) => runLibCellML('getModelComponentNames', model)

/**
 * Finds a flattened model's VoI and the parameters a scan selects, as extractVoiAndParametersFromModel does.
 *
 * @param {string} model
 * @param {Object} parameterInfo - With `selections`.
 * @returns {Promise<{voi: Object|null, mappedParameters: Object}>}
 */
export const extractVoiAndParametersFromModelInBackground = (model, parameterInfo) =>
  runLibCellML('extractVoiAndParametersFromModel', model, toPlain(parameterInfo))

/**
 * Reads a model's parameter components, as loadParametersFromCellML does.
 *
 * @param {string} model
 * @returns {Promise<{parameters: Object, globalParameters: Array}>}
 */
export const loadParametersFromCellMLInBackground = (model) => runLibCellML('loadParametersFromCellML', model)

/**
 * Works out the math a save writes, as prepareSavedMath (services/math/variableIds.js) does.
 *
 * @param {Object} options - As for prepareSavedMath.
 * @returns {Promise<{math: string|null, idsChanged: boolean, ids: Map<string, string>}>}
 */
export const prepareSavedMathInBackground = (options) => runLibCellML('prepareSavedMath', toPlain(options))
