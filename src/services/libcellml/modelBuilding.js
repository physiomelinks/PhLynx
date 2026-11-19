/**
 * Builds models in the libCellML worker (see libcellmlClient.js), so a big workspace doesn't freeze the page: the
 * nodes, edges and the library parts they use cross as plain data, and the build runs there as on the main thread.
 */
import { runLibCellML } from './libcellmlClient'
import { snapshotLibrary, toPlain } from './librarySnapshot'

/**
 * Copies a build's inputs as plain data, and asks for the Maps the caller wants filled.
 *
 * @returns {Array} The operation's arguments.
 */
function buildArgs(nodes, edges, library, inspectionModules, options) {
  const { exportedIds, instanceSources, ...rest } = options
  return [
    toPlain(nodes),
    toPlain(edges),
    snapshotLibrary(library, nodes),
    toPlain(inspectionModules),
    { ...toPlain(rest), exportedIds: !!exportedIds, instanceSources: !!instanceSources },
  ]
}

/** Fills a caller's Map with what the build filled, if the caller passed one. */
function fill(target, filled) {
  if (!target || !filled) return
  for (const [key, value] of filled) target.set(key, value)
}

/**
 * Builds the flattened model off the main thread.
 *
 * @param {Array} nodes - As for generateFlattenedModel.
 * @param {Array} edges
 * @param {Object} library - The library store, or a facade with its methods.
 * @param {Array} [inspectionModules]
 * @param {Object} [options] - As for generateFlattenedModel; `exportedIds` and `instanceSources` are filled once
 *   the build finishes.
 * @returns {Promise<string>} The flattened CellML; rejects as generateFlattenedModel throws.
 */
export async function generateFlattenedModelInBackground(nodes, edges, library, inspectionModules = [], options = {}) {
  const result = await runLibCellML('flattenModel', ...buildArgs(nodes, edges, library, inspectionModules, options))
  fill(options.exportedIds, result.exportedIds)
  fill(options.instanceSources, result.instanceSources)
  return result.text
}

/**
 * Builds the modular CellML off the main thread.
 *
 * @param {Array} nodes - As for buildModularModel.
 * @param {Array} edges
 * @param {Object} library - The library store, or a facade with its methods.
 * @param {Array} [inspectionModules]
 * @param {Object} [options] - As for buildModularModel; `exportedIds` is filled once the build finishes.
 * @returns {Promise<Object>} What buildModularModel returns; rejects as it throws.
 */
export async function buildModularModelInBackground(nodes, edges, library, inspectionModules = [], options = {}) {
  const { exportedIds, ...modular } = await runLibCellML(
    'buildModularModel',
    ...buildArgs(nodes, edges, library, inspectionModules, { ...options, instanceSources: null })
  )
  fill(options.exportedIds, exportedIds)
  return modular
}
