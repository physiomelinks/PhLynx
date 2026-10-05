/**
 * Builds the saved workspace file. This is the one definition of what a save writes, so any change
 * to its shape needs a new format version and a migration step in workspaceMigrator.js.
 */
import { PHLYNX_PROJECT_IDENTIFIER, PHLYNX_PROJECT_VERSION } from '../utils/constants'

/**
 * Builds the workspace file from the flow and the saved stores.
 *
 * @param {Object} sources
 * @param {Object} sources.flow - Vue Flow `toObject()` output.
 * @param {Object} sources.library - libraryStore.
 * @param {Object} sources.simulation - simulationSettingsStore.
 * @param {Object} sources.inspectionModules - inspectionModuleStore.
 * @param {Object} sources.omex - omexStore.
 * @returns {Object} The workspace, at PHLYNX_PROJECT_VERSION.
 */
export function buildWorkspaceFile({ flow, library, simulation, inspectionModules, omex }) {
  return {
    id: PHLYNX_PROJECT_IDENTIFIER,
    version: PHLYNX_PROJECT_VERSION,
    flow,
    store: library.getState(),
    simulation: simulation.getState(),
    inspectionModules: inspectionModules.getState(),
    workspace: omex.getState(),
  }
}
