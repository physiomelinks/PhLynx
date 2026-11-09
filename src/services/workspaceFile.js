/**
 * Builds and reads the saved workspace file. buildWorkspaceFile is the one definition of what a
 * save writes, so any change to its shape needs a new format version and a migration step in
 * workspaceMigrator.js.
 */
import { PHLYNX_PROJECT_IDENTIFIER, PHLYNX_PROJECT_VERSION } from '../utils/constants'
import { readFileAsText } from '../utils/misc'
import { notify } from '../utils/notify'

/**
 * Builds the workspace file from the flow and the saved stores.
 *
 * @param {Object} sources
 * @param {Object} sources.flow - Vue Flow `toObject()` output.
 * @param {Object} sources.library - libraryStore.
 * @param {Object} sources.simulation - simulationSettingsStore.
 * @param {Object} sources.inspectionModules - inspectionModuleStore.
 * @param {Object} sources.omex - omexStore.
 * @param {Object} sources.parameters - defaultParametersStore.
 * @param {Object} [sources.bioTemplates] - bioTemplateStore.
 * @param {Object} [sources.bioGlyphs] - glyphLibraryStore.
 * @returns {Object} The workspace, at PHLYNX_PROJECT_VERSION.
 */
export function buildWorkspaceFile({ flow, library, simulation, inspectionModules, omex, parameters, bioTemplates, bioGlyphs }) {
  // Older builds ignore the key, and nodes bound to a template's sites fall back to their role.
  const templateState = bioTemplates?.getState() ?? null
  // Likewise the user's own cartoons the nodes are drawn as: a copy of each, so the workspace looks the same
  // elsewhere.
  const glyphState = bioGlyphs?.getState((flow?.nodes ?? []).map((node) => node.data?.bioView?.glyph)) ?? null
  return {
    id: PHLYNX_PROJECT_IDENTIFIER,
    version: PHLYNX_PROJECT_VERSION,
    flow,
    store: library.getState(),
    simulation: simulation.getState(),
    inspectionModules: inspectionModules.getState(),
    workspace: omex.getState(),
    parameters: parameters.getState(),
    ...(templateState ? { bioTemplates: templateState } : {}),
    ...(glyphState ? { bioGlyphs: glyphState } : {}),
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
    notify.error({ title: 'Failed to read workflow', message: error.message })
    return false
  }
  try {
    await apply(state)
  } catch (error) {
    notify.error({ title: 'Failed to load workflow', message: error.message })
    return false
  }
  return true
}
