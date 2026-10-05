import { createPinia, setActivePinia } from 'pinia'

import { buildWorkspaceFile } from '../../../src/services/workspaceFile.js'
import { migrateWorkspace } from '../../../src/services/workspaceMigrator.js'
import { useInspectionModuleStore } from '../../../src/stores/inspectionModuleStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'

/**
 * Loads a workspace file into fresh stores and saves it again, as the app does on load then save.
 *
 * @param {Object} doc - A parsed workspace file, of any version.
 * @returns {Object} The file a save would write.
 */
export function loadAndSave(doc) {
  setActivePinia(createPinia())
  const library = useLibraryStore()
  const simulation = useSimulationSettingsStore()
  const inspectionModules = useInspectionModuleStore()
  const omex = useOmexStore()

  const migrated = migrateWorkspace(doc)
  library.loadState(migrated.store)
  simulation.loadState(migrated.simulation)
  inspectionModules.loadState(migrated.inspectionModules)
  omex.loadState(migrated.workspace)

  return JSON.parse(JSON.stringify(buildWorkspaceFile({ flow: migrated.flow, library, simulation, inspectionModules, omex })))
}
