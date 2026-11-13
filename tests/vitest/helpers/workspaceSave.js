import { createPinia, setActivePinia } from 'pinia'

import { buildWorkspaceFile } from '../../../src/services/workspaceFile.js'
import { migrateWorkspace } from '../../../src/services/workspaceMigrator.js'
import { useDefaultParametersStore } from '../../../src/stores/defaultParametersStore.js'
import { useGlyphLibraryStore } from '../../../src/stores/glyphLibraryStore.js'
import { useBioTemplateStore } from '../../../src/stores/bioTemplateStore.js'
import { useInspectionModuleStore } from '../../../src/stores/inspectionModuleStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useNodeThemeStore } from '../../../src/stores/nodeThemeStore.js'
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
  const parameters = useDefaultParametersStore()
  const bioTemplates = useBioTemplateStore()
  const bioGlyphs = useGlyphLibraryStore()
  const nodeTheme = useNodeThemeStore()

  const migrated = migrateWorkspace(doc)
  library.loadState(migrated.store)
  simulation.loadState(migrated.simulation)
  inspectionModules.loadState(migrated.inspectionModules)
  omex.loadState(migrated.workspace)
  parameters.loadState(migrated.parameters)
  bioTemplates.loadState(migrated.bioTemplates)
  bioGlyphs.loadState(migrated.bioGlyphs)
  nodeTheme.loadState(migrated.nodeTheme)

  const sources = { library, simulation, inspectionModules, omex, parameters, bioTemplates, bioGlyphs, nodeTheme }
  const file = buildWorkspaceFile({ flow: migrated.flow, ...sources })
  return JSON.parse(JSON.stringify(file))
}
