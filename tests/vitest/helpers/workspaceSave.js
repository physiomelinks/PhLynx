import { createPinia, setActivePinia } from 'pinia'

import { buildWorkspaceFile } from '../../../src/services/workspaceFile.js'
import { migrateWorkspace } from '../../../src/services/workspaceMigrator.js'
import { useDefaultParametersStore } from '../../../src/stores/defaultParametersStore.js'
import { useSkinLibraryStore } from '../../../src/stores/skinLibraryStore.js'
import { useBioPiecesStore } from '../../../src/stores/bioPiecesStore.js'
import { useInspectionModuleStore } from '../../../src/stores/inspectionModuleStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useNodeThemeStore } from '../../../src/stores/nodeThemeStore.js'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'
import { useWorkspaceAppearanceStore } from '../../../src/stores/workspaceAppearanceStore.js'

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
  const parameters = useDefaultParametersStore()
  const bioPieces = useBioPiecesStore()
  const bioSkins = useSkinLibraryStore()
  const nodeTheme = useNodeThemeStore()
  const appearance = useWorkspaceAppearanceStore()

  const migrated = migrateWorkspace(doc)
  library.loadState(migrated.store)
  simulation.loadState(migrated.simulation)
  inspectionModules.loadState(migrated.inspectionModules)
  omex.loadState(migrated.workspace)
  parameters.loadState(migrated.parameters)
  bioPieces.loadState(migrated.bioPieces)
  bioSkins.loadState(migrated.bioSkins)
  nodeTheme.loadState(migrated.nodeTheme)
  appearance.loadState(migrated.appearance)

  const sources = { library, simulation, inspectionModules, omex, parameters, bioPieces, bioSkins, nodeTheme, appearance }
  const file = buildWorkspaceFile({ flow: migrated.flow, ...sources })
  return JSON.parse(JSON.stringify(file))
}
