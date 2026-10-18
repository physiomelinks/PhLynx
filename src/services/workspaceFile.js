/**
 * Builds and reads the saved workspace file. buildWorkspaceFile is the one definition of what a
 * save writes, so any change to its shape needs a new format version and a migration step in
 * workspaceMigrator.js. Since 1.3.0 the flow holds every scope's nodes (super-modules' children
 * included), their data.scope and data.localId, super instance and interface nodes and exposure edges,
 * and never `hidden`: which nodes the canvas shows is worked out on load.
 */
import { PHLYNX_PROJECT_IDENTIFIER, PHLYNX_PROJECT_VERSION } from '../utils/constants'
import { readFileAsText } from '../utils/misc'
import { notify } from '../utils/notify'

/**
 * Drops `hidden` from a flow's nodes and edges: it says what the canvas shows now, never what the
 * workspace is.
 *
 * @param {{nodes?: Array, edges?: Array}} flow - Vue Flow `toObject()` output, or a saved flow.
 * @returns {Object} The flow, with nodes and edges copied only where they had `hidden`.
 */
export function withoutHidden(flow) {
  const strip = (items) =>
    items?.map((item) => {
      if (!item || !('hidden' in item)) return item
      const { hidden: _hidden, ...rest } = item
      return rest
    })
  return { ...flow, ...(flow?.nodes && { nodes: strip(flow.nodes) }), ...(flow?.edges && { edges: strip(flow.edges) }) }
}

/**
 * Builds the workspace file from the flow and the saved stores.
 *
 * @param {Object} sources
 * @param {Object} sources.flow - Vue Flow `toObject()` output; saved without `hidden`.
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
    flow: withoutHidden(flow),
    store: library.getState(),
    simulation: simulation.getState(),
    inspectionModules: inspectionModules.getState(),
    workspace: omex.getState(),
  }
}

/**
 * Reads a workspace JSON file and hands the parsed workspace to `apply`. Read, parse and apply
 * failures each show an error notification.
 *
 * @param {File} file - The chosen workspace file.
 * @param {(state: Object) => (Promise|void)} apply - Restores the parsed workspace.
 * @returns {Promise<boolean>} Whether the workspace loaded.
 */
export async function loadWorkspaceFile(file, apply) {
  let state
  try {
    state = JSON.parse(await readFileAsText(file))
  } catch (error) {
    notify.error({ title: 'Failed to read workflow', items: [error.message] })
    return false
  }
  try {
    await apply(state)
  } catch (error) {
    notify.error({ title: 'Failed to load workflow', items: [error.message] })
    return false
  }
  return true
}
