/**
 * The operations the libCellML worker runs (workers/libcellmlWorker.js), by name. Each takes the libCellML instance
 * then its arguments, which must be plain data, as must its result: they cross to and from the worker by
 * postMessage. The client (libcellmlClient.js) runs the same functions on the main thread when it can't use the worker.
 */
import { checkModel } from '../math/checkModel'
import { prepareSavedMath } from '../math/variableIds'
import { buildModularModel } from '../export/modularCellml'
import { flattenImportedUnits } from '../import/cellmlImports'
import { liveComponentMath } from '../celldl/liveMath'
import { buildVariableMapping } from '../simulation/variableMapping'
import { addProtocolClock, addProtocolDrivers } from '../simulation/protocolDriverModel'
import {
  areModelsEquivalent,
  combineComponentModels,
  extractComponentsFromCellmlString,
  extractVoiAndParametersFromModel,
  generateFlattenedModel,
  getModelComponentNames,
  hoistEncapsulatedComponents,
  isCellML,
  loadParametersFromCellML,
  processCellMLData,
} from '../../utils/cellml'
import { libraryFromSnapshot } from './librarySnapshot'

/**
 * Makes the Maps a build fills for its caller: the ones asked for, by name.
 *
 * @param {{ exportedIds?: boolean, instanceSources?: boolean }} wanted
 * @returns {{ exportedIds: Map|null, instanceSources: Map|null }}
 */
const filledMaps = ({ exportedIds, instanceSources }) => ({
  exportedIds: exportedIds ? new Map() : null,
  instanceSources: instanceSources ? new Map() : null,
})

/**
 * Runs generateFlattenedModel on a library snapshot.
 *
 * @param {Object} libcellml - Unused: utils/cellml has its own, bound with initLibCellML.
 * @param {Array} nodes
 * @param {Array} edges
 * @param {Object} snapshot - From snapshotLibrary.
 * @param {Array} inspectionModules
 * @param {Object} [options] - As for generateFlattenedModel, but `exportedIds` and `instanceSources` say whether to
 *   fill them.
 * @returns {Promise<{ text: string, exportedIds: Map|null, instanceSources: Map|null }>}
 */
async function flattenModel(libcellml, nodes, edges, snapshot, inspectionModules, options = {}) {
  const filled = filledMaps(options)
  const blob = generateFlattenedModel(nodes, edges, libraryFromSnapshot(snapshot), inspectionModules, { ...options, ...filled })
  return { text: await blob.text(), ...filled }
}

/**
 * Runs buildModularModel on a library snapshot.
 *
 * @param {Object} libcellml - Unused, as for flattenModel.
 * @param {Array} nodes
 * @param {Array} edges
 * @param {Object} snapshot - From snapshotLibrary.
 * @param {Array} inspectionModules
 * @param {Object} [options] - As for buildModularModel, but `exportedIds` says whether to fill it.
 * @returns {Promise<Object>} What buildModularModel returns, with `exportedIds`.
 */
async function buildModular(libcellml, nodes, edges, snapshot, inspectionModules, options = {}) {
  const { exportedIds } = filledMaps(options)
  const modular = await buildModularModel(nodes, edges, libraryFromSnapshot(snapshot), inspectionModules, { ...options, exportedIds })
  return { ...modular, exportedIds }
}

/**
 * Runs processCellMLData, hoisting encapsulated components first when asked.
 *
 * @param {Object} libcellml - Unused, as for flattenModel.
 * @param {string} cellml
 * @param {{ hoist?: boolean }} [options]
 * @returns {Object} What processCellMLData returns.
 */
function processCellml(libcellml, cellml, { hoist = false } = {}) {
  return processCellMLData(hoist ? hoistEncapsulatedComponents(cellml).cellml : cellml)
}

/**
 * Runs buildVariableMapping on the names a run reported, rather than its values.
 *
 * @param {Object} libcellml
 * @param {string} cellml
 * @param {Array<Object>} nodes - With `id`, and `data` with `name` and `variables`.
 * @param {string[]} reportedNames - The VoI's name, then every variable's.
 * @returns {Map<string, string>}
 */
function mapVariables(libcellml, cellml, nodes, [voiName, ...variableNames]) {
  const results = { voi: { name: voiName }, variables: new Map(variableNames.map((name) => [name, null])) }
  return buildVariableMapping({ libcellml, cellml, nodes, results })
}

// Operations on utils/cellml and the services below use the instance initLibCellML bound, so drop the argument.
export const operations = {
  checkModel,
  flattenModel,
  buildModularModel: buildModular,
  processCellMLData: processCellml,
  hoistEncapsulatedComponents: (libcellml, cellml) => hoistEncapsulatedComponents(cellml),
  isCellML: (libcellml, content) => isCellML(content),
  extractComponentsFromCellmlString: (libcellml, cellml) => extractComponentsFromCellmlString(cellml),
  flattenImportedUnits: (libcellml, modelXml, files) => flattenImportedUnits(modelXml, files),
  liveComponentMath: (libcellml, cellml, componentName) => liveComponentMath(cellml, componentName),
  areModelsEquivalent: (libcellml, a, b) => areModelsEquivalent(a, b),
  combineComponentModels: (libcellml, ...args) => combineComponentModels(...args),
  getModelComponentNames: (libcellml, model) => getModelComponentNames(model),
  extractVoiAndParametersFromModel: (libcellml, model, parameterInfo) => extractVoiAndParametersFromModel(model, parameterInfo),
  loadParametersFromCellML: (libcellml, model) => loadParametersFromCellML(model),
  prepareSavedMath: (libcellml, options) => prepareSavedMath(options),
  buildVariableMapping: mapVariables,
  addProtocolDrivers: (libcellml, cellml, drivers) => addProtocolDrivers({ libcellml, cellml, drivers }),
  addProtocolClock: (libcellml, cellml) => addProtocolClock({ libcellml, cellml }),
}

/**
 * Runs an operation.
 *
 * @param {Object} libcellml - The libCellML instance.
 * @param {string} op - An operation's name.
 * @param {Array} args - Its arguments, after libcellml.
 * @returns {*} What the operation returns.
 * @throws {Error} When no operation has that name, or the operation throws.
 */
export function runOperation(libcellml, op, args = []) {
  if (!Object.hasOwn(operations, op)) throw new Error(`Unknown libCellML operation: ${op}`)
  return operations[op](libcellml, ...args)
}
