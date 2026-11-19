/**
 * Prepares a simulation's flattened model in the libCellML worker (see libcellmlClient.js): adding a protocol's
 * drivers and clock, and mapping the run's results back to the nodes.
 */
import { runLibCellML } from './libcellmlClient'
import { toPlain } from './librarySnapshot'

/**
 * Maps each variable row of the nodes to the name its values are reported under, as buildVariableMapping does. Only
 * the reported names cross to the worker, not the values.
 *
 * @param {Object} options
 * @param {string} options.cellml - The flattened model that was run.
 * @param {Array<Object>} options.nodes - The scope's nodes.
 * @param {{voi: {name: string}, variables: Map<string, Object>}} options.results - The engine's results.
 * @returns {Promise<Map<string, string>>}
 */
export function buildVariableMappingInBackground({ cellml, nodes, results }) {
  const rows = nodes.map(({ id, data }) => ({
    id,
    data: { name: data.name, variables: (data.variables ?? []).map(({ name }) => ({ name })) },
  }))
  return runLibCellML('buildVariableMapping', cellml, toPlain(rows), [results.voi.name, ...results.variables.keys()])
}

/**
 * Adds a protocol's drivers to a flattened model, as addProtocolDrivers does.
 *
 * @param {Object} options
 * @param {string} options.cellml
 * @param {Array<Object>} options.drivers - From planDrivers.
 * @returns {Promise<{cellml: string, errors: string[]}>}
 */
export const addProtocolDriversInBackground = ({ cellml, drivers }) => runLibCellML('addProtocolDrivers', cellml, toPlain(drivers))

/**
 * Adds a protocol's clock to a flattened model, as addProtocolClock does.
 *
 * @param {Object} options
 * @param {string} options.cellml
 * @returns {Promise<{cellml: string, errors: string[]}>}
 */
export const addProtocolClockInBackground = ({ cellml }) => runLibCellML('addProtocolClock', cellml)
