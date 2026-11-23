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
 * @param {Object} [sources.bioPieces] - bioPiecesStore.
 * @param {Object} [sources.bioSkins] - skinLibraryStore.
 * @param {Object} [sources.nodeTheme] - nodeThemeStore.
 * @returns {Object} The workspace, at PHLYNX_PROJECT_VERSION.
 */
export function buildWorkspaceFile({
  flow,
  library,
  simulation,
  inspectionModules,
  omex,
  parameters,
  bioPieces,
  bioSkins,
  nodeTheme,
}) {
  // The pieces the physiology view is built from; older builds ignore the key, and nodes bound to the pieces' sites
  // fall back to their role there.
  const piecesState = bioPieces?.getState() ?? null
  // Likewise the user's own skins the nodes and pieces are drawn with: a copy of each, so the workspace looks the same
  // elsewhere.
  const used = [
    ...(flow?.nodes ?? []).map((node) => node.data?.bioView?.skin),
    ...(piecesState?.pieces ?? []).map((piece) => piece.skin?.ref),
  ]
  const skinState = bioSkins?.getState(used) ?? null
  // And the node colour theme: its id, with a copy unless it is built in, so categories keep their colours.
  const themeState = nodeTheme?.getState() ?? null
  return {
    id: PHLYNX_PROJECT_IDENTIFIER,
    version: PHLYNX_PROJECT_VERSION,
    flow,
    store: library.getState(),
    simulation: simulation.getState(),
    inspectionModules: inspectionModules.getState(),
    workspace: omex.getState(),
    parameters: parameters.getState(),
    ...(piecesState ? { bioPieces: piecesState } : {}),
    ...(skinState ? { bioSkins: skinState } : {}),
    ...(themeState ? { nodeTheme: themeState } : {}),
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
