/**
 * The operations the libCellML worker runs (workers/libcellmlWorker.js), by name. Each takes the libCellML instance
 * then its arguments, which must be plain data, as must its result: they cross to and from the worker by
 * postMessage. The client (libcellmlClient.js) runs the same functions on the main thread when it can't use the worker.
 */
import { checkModel } from '../math/checkModel'
import { buildModularModel } from '../export/modularCellml'
import { generateFlattenedModel } from '../../utils/cellml'
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

export const operations = {
  checkModel,
  flattenModel,
  buildModularModel: buildModular,
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
