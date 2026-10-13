/**
 * A small workspace in the shape the MVP saved before versioning, for testing its migration.
 *
 * It holds the cases that collide on a legacy `vessel_type:BC_type`: user modules made from the
 * template all keep `new_module:phlynx`, and a user copy of a library module keeps the library's ref.
 */

const cellml = (name, components) => `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="${name}">
${components
  .map(
    (component) => `  <component name="${component}">
    <variable name="x" units="dimensionless" initial_value="1" interface="public"/>
  </component>`
  )
  .join('\n')}
</model>`

const config = (moduleRef, file, component) => {
  const [vessel_type, BC_type] = moduleRef.split(':')
  return {
    vessel_type,
    BC_type,
    module_format: 'cellml',
    module_file: file,
    module_type: component,
    entrance_ports: [],
    exit_ports: [],
    general_ports: [],
    variables_and_units: [['x', 'dimensionless', 'access', 'variable']],
  }
}

const legacyModule = (file, component, moduleRefs) => ({
  name: component,
  componentName: component,
  sourceFile: file,
  portOptions: [{ name: 'x', units: 'dimensionless' }],
  variables: [{ name: 'x', units: 'dimensionless' }],
  ports: [],
  configs: moduleRefs.map((moduleRef) => config(moduleRef, file, component)),
})

const collection = (filename, modules) => ({
  filename,
  modules: modules.map(([component, moduleRefs]) => legacyModule(filename, component, moduleRefs)),
  model: cellml(filename.replace('.cellml', ''), modules.map(([component]) => component)),
})

const legacyNode = (id, name, sourceFile, componentName, configIndex = 0) => ({
  id,
  type: 'moduleNode',
  position: { x: 0, y: 0 },
  data: {
    name,
    label: `${componentName} — ${sourceFile}`,
    componentName,
    sourceFile,
    configIndex,
    portOptions: [{ name: 'x', units: 'dimensionless' }],
    portLabels: [],
    ports: [],
    variables: [],
  },
})

/**
 * Builds the legacy workspace.
 *
 * @returns {Object} A parsed legacy workspace file.
 */
export function legacyWorkspace() {
  return {
    flow: {
      nodes: [
        legacyNode('dndnode_0', 'GLUT2_1', 'User_Modules.cellml', 'GLUT2'),
        legacyNode('dndnode_1', 'NKA_1', 'User_Modules.cellml', 'NKA'),
        legacyNode('dndnode_2', 'vessel_user', 'User_Modules.cellml', 'vessel'),
        legacyNode('dndnode_3', 'vessel_library', 'vessel_modules.cellml', 'vessel', 1),
      ],
      edges: [],
      position: [0, 0],
      zoom: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    store: {
      availableModules: [
        collection('template_modules.cellml', [['new_module', ['new_module:phlynx']]]),
        collection('vessel_modules.cellml', [['vessel', ['artery:pp', 'artery:vp']]]),
        collection('User_Modules.cellml', [
          ['GLUT2', ['new_module:phlynx']],
          ['NKA', ['new_module:phlynx']],
          ['vessel', ['artery:pp']],
        ]),
      ],
      availableParameters: [],
      availableUnits: [],
      availableVariableNameIdMap: [],
      globalConstants: [],
      lastExportName: '',
      lastSaveName: 'legacy',
    },
  }
}
