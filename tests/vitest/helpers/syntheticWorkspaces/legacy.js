/**
 * A synthetic workspace in the shape the MVP saved before versioning. Nodes keep portOptions and portLabels,
 * and the store holds whole CellML files as module collections, with values in availableParameters.
 */
import { component, decay, gain, legacyUnits, model } from './builders.js'

export const version = 'legacy'

const DECAY_VARIABLES = [
  ['t', 'second'],
  ['x', 'metre'],
  ['k', 'per_second'],
]

/**
 * Builds a legacy module config.
 *
 * @param {string} moduleRef - `<vessel_type>:<BC_type>`.
 * @param {string} file
 * @param {string} componentName
 * @param {Array<[string, string]>} variables - Name and units.
 * @param {Object} [ports] - Its entrance_ports, exit_ports and general_ports.
 * @returns {Object}
 */
const config = (moduleRef, file, componentName, variables, ports = {}) => {
  const [vessel_type, BC_type] = moduleRef.split(':')
  return {
    vessel_type,
    BC_type,
    module_format: 'cellml',
    module_file: file,
    module_type: componentName,
    entrance_ports: [],
    exit_ports: [],
    general_ports: [],
    ...ports,
    variables_and_units: variables.map(([name, units]) => [name, units, 'access', 'variable']),
  }
}

/**
 * Builds a legacy module collection: a CellML file and its modules' configs.
 *
 * @param {string} filename
 * @param {Array<{name: string, xml: string, variables?: Array, moduleRefs: Array<string>, ports?: Object}>} modules
 * @returns {Object}
 */
const collection = (filename, modules) => ({
  filename,
  modules: modules.map(({ name, variables = DECAY_VARIABLES, moduleRefs, ports }) => ({
    name,
    componentName: name,
    sourceFile: filename,
    portOptions: variables.map(([variable, units]) => ({ name: variable, units })),
    variables: variables.map(([variable, units]) => ({ name: variable, units })),
    ports: [],
    configs: moduleRefs.map((moduleRef) => config(moduleRef, filename, name, variables, ports)),
  })),
  model: model(filename.replace('.cellml', ''), modules.map(({ xml }) => xml)),
})

/**
 * Builds a legacy node.
 *
 * @param {string} id
 * @param {string} name
 * @param {string} sourceFile
 * @param {string} componentName
 * @param {Object} [data] - Its configIndex, portOptions, portLabels, ports (connection sites) and variables.
 * @returns {Object}
 */
const legacyNode = (id, name, sourceFile, componentName, data = {}) => ({
  id,
  type: 'moduleNode',
  initialized: false,
  position: { x: 0, y: 0 },
  data: {
    name,
    label: `${componentName} — ${sourceFile}`,
    componentName,
    sourceFile,
    configIndex: 0,
    portOptions: DECAY_VARIABLES.map(([variable, units]) => ({ name: variable, units })),
    portLabels: [],
    ports: [],
    variables: [],
    ...data,
  },
  style: { opacity: 1 },
})

/** A legacy port label, as nodes and couplings keep it. */
const portLabel = (portType, label, option) => ({ portType, label, option, multiport: 'None' })

/** A legacy edge between two connection sites; couplings are left out when the file has none. */
const legacyEdge = (source, sourceUid, target, targetUid, couplings) => ({
  id: `e_${source}_${target}`,
  type: 'smoothstep',
  source,
  target,
  sourceHandle: `port_${sourceUid}`,
  targetHandle: `port_${targetUid}`,
  data: couplings ? { couplings } : {},
  label: '',
  markerEnd: 'arrowclosed',
  style: { strokeWidth: 5 },
  sourceX: 0,
  sourceY: 0,
  targetX: 0,
  targetY: 0,
})

/**
 * Builds the workspace around the cases.
 *
 * @returns {Object}
 */
export const base = () => ({
  flow: { nodes: [], edges: [], position: [0, 0], zoom: 1, viewport: { x: 0, y: 0, zoom: 1 } },
  store: {
    availableModules: [],
    availableParameters: [],
    availableUnits: [legacyUnits()],
    availableVariableNameIdMap: [],
    globalConstants: [],
    lastExportName: '',
    lastSaveName: 'synthetic',
  },
})

const VALVE_LABEL = portLabel('general_ports', 'x_port', ['x'])

export const cases = {
  /**
   * A copied node keeps its original's port uids, so uids are only unique within a node. Nodes `original`,
   * `copy` and `other`; edges original -> other and other -> copy, coupled on x_port.
   */
  sharedPortUids: () => {
    const sites = [
      { uid: 'shared-in', side: 'left', type: 'target', name: 'in' },
      { uid: 'shared-out', side: 'right', type: 'source', name: 'out' },
    ]
    const node = (name) => legacyNode(name, name, 'valve_modules.cellml', 'valve', { ports: sites, portLabels: [VALVE_LABEL] })
    const coupled = [{ sourcePortLabel: VALVE_LABEL, targetPortLabel: VALVE_LABEL }]
    return {
      flow: {
        nodes: [node('original'), node('copy'), node('other')],
        edges: [
          legacyEdge('original', 'shared-out', 'other', 'shared-in', coupled),
          legacyEdge('other', 'shared-out', 'copy', 'shared-in', coupled),
        ],
      },
      store: {
        availableModules: [
          collection('valve_modules.cellml', [
            {
              name: 'valve',
              xml: decay('valve'),
              moduleRefs: ['valve:simple'],
              ports: { general_ports: [{ port_type: 'x_port', variables: ['x'] }] },
            },
          ]),
        ],
      },
    }
  },

  /**
   * User modules made from the template all keep the template's `new_module:phlynx`. Nodes `GLUT2_1` and
   * `NKA_1`, from User_Modules.cellml's GLUT2 and NKA.
   */
  templateUserModules: () => ({
    flow: {
      nodes: [
        legacyNode('GLUT2_1', 'GLUT2_1', 'User_Modules.cellml', 'GLUT2'),
        legacyNode('NKA_1', 'NKA_1', 'User_Modules.cellml', 'NKA'),
      ],
      edges: [],
    },
    store: {
      availableModules: [
        collection('template_modules.cellml', [{ name: 'new_module', xml: decay('new_module'), moduleRefs: ['new_module:phlynx'] }]),
        collection('User_Modules.cellml', [
          { name: 'GLUT2', xml: decay('GLUT2'), moduleRefs: ['new_module:phlynx'] },
          { name: 'NKA', xml: decay('NKA'), moduleRefs: ['new_module:phlynx'] },
        ]),
      ],
    },
  }),

  /**
   * A user copy of a library module keeps the library's moduleRef. Node `vessel_user` is the copy, and
   * `vessel_library` the library module's second config, `artery:vp`.
   */
  userCopyOfLibraryModule: () => ({
    flow: {
      nodes: [
        legacyNode('vessel_user', 'vessel_user', 'user_vessels.cellml', 'vessel'),
        legacyNode('vessel_library', 'vessel_library', 'vessel_modules.cellml', 'vessel', { configIndex: 1 }),
      ],
      edges: [],
    },
    store: {
      availableModules: [
        collection('vessel_modules.cellml', [{ name: 'vessel', xml: decay('vessel'), moduleRefs: ['artery:pp', 'artery:vp'] }]),
        collection('user_vessels.cellml', [{ name: 'vessel', xml: decay('vessel'), moduleRefs: ['artery:pp'] }]),
      ],
    },
  }),

  /**
   * Node `pump`'s `R` is a global constant valued in availableParameters, and `T`, set in the app, is only in
   * the store's globalConstants.
   */
  globalConstants: () => {
    const variables = [
      ['in', 'mM'],
      ['out', 'mM'],
      ['R', 'dimensionless'],
      ['T', 'dimensionless'],
    ]
    const xml = component(
      'pump',
      variables,
      `    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>out</ci><apply><times/><ci>R</ci><ci>T</ci><ci>in</ci></apply></apply>
    </math>`
    )
    return {
      flow: {
        nodes: [
          legacyNode('pump', 'pump', 'pump_modules.cellml', 'pump', {
            portOptions: variables.map(([name, units]) => ({ name, units })),
            variables: [
              { name: 'R', units: 'dimensionless', type: 'global_constant' },
              { name: 'T', units: 'dimensionless', type: 'global_constant' },
            ],
          }),
        ],
        edges: [],
      },
      store: {
        availableModules: [collection('pump_modules.cellml', [{ name: 'pump', xml, variables, moduleRefs: ['pump:simple'] }])],
        availableParameters: [
          ['R||dimensionless||8.314||known', { variable_name: 'R', units: 'dimensionless', value: '8.314', data_reference: 'known' }],
        ],
        globalConstants: [['T', { value: '310', units: 'dimensionless' }]],
      },
    }
  },

  /**
   * Node `channel`'s values and data references are in availableParameters, keyed `<variable>_<node>`: `g` has
   * a value and reference, and `in`, a computed variable, a reference only.
   */
  dataReferences: () => {
    const variables = [
      ['in', 'mM'],
      ['out', 'mM'],
      ['g', 'dimensionless'],
    ]
    const parameter = (variable, entry) => [`${variable}_channel`, { variable_name: `${variable}_channel`, units: 'mM', ...entry }]
    return {
      flow: {
        nodes: [
          legacyNode('channel', 'channel', 'channel_modules.cellml', 'channel', {
            portOptions: variables.map(([name, units]) => ({ name, units })),
          }),
        ],
        edges: [],
      },
      store: {
        availableModules: [
          collection('channel_modules.cellml', [{ name: 'channel', xml: gain('channel', 'g'), variables, moduleRefs: ['channel:simple'] }]),
        ],
        availableParameters: [
          parameter('g', { units: 'dimensionless', value: '2', data_reference: 'Smith2001' }),
          parameter('in', { value: '', data_reference: 'Jones1999' }),
        ],
      },
    }
  },

  /**
   * Edges saved without couplings, which the workspace resolves from the nodes' ports on load. `Environment`
   * gives Na_o and Cl_o their values; `INaK` and `Ito2` each take one, and `reversal_potentials` both.
   */
  edgesWithoutCouplings: () => {
    const file = 'cell_modules.cellml'
    const naLabel = portLabel('general_ports', 'Na_o__Environment', ['Na_o'])
    const clLabel = portLabel('general_ports', 'Cl_o__Environment', ['Cl_o'])
    const ions = { Na_o: [['Na_o', 'mM'], naLabel], Cl_o: [['Cl_o', 'mM'], clLabel] }

    // A component taking its ions from Environment, computing a current from them with a gain g = 1.
    const consumer = (name, ionNames) => {
      const variables = [['I', 'mM'], ['g', 'dimensionless', '1'], ...ionNames.map((ion) => ions[ion][0])]
      const ionTerms = ionNames.map((ion) => `<ci>${ion}</ci>`).join('')
      const sum = `<apply><times/><ci>g</ci>${ionNames.length > 1 ? `<apply><plus/>${ionTerms}</apply>` : ionTerms}</apply>`
      return {
        name,
        variables,
        xml: component(
          name,
          variables,
          `    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>I</ci>${sum}</apply>
    </math>`
        ),
        labels: ionNames.map((ion) => ions[ion][1]),
      }
    }
    const environmentVariables = [
      ['Na_o', 'mM', '140'],
      ['Cl_o', 'mM', '100'],
    ]
    const environment = {
      name: 'Environment',
      variables: environmentVariables,
      xml: component('Environment', environmentVariables),
      labels: [naLabel, clLabel],
    }
    const modules = [environment, consumer('INaK', ['Na_o']), consumer('Ito2', ['Cl_o']), consumer('reversal_potentials', ['Na_o', 'Cl_o'])]

    const site = (name, side, type) => ({ uid: `${name}-${side}`, side, type, name })
    const nodes = modules.map(({ name, variables, labels }) =>
      legacyNode(name, name, file, name, {
        portOptions: variables.map(([variable, units]) => ({ name: variable, units })),
        portLabels: labels,
        ports: name === 'Environment' ? [site(name, 'left', 'target')] : [site(name, 'right', 'source')],
      })
    )
    return {
      flow: {
        nodes,
        edges: modules.slice(1).map(({ name }) => legacyEdge(name, `${name}-right`, 'Environment', 'Environment-left')),
      },
      store: {
        availableModules: [
          collection(
            file,
            modules.map(({ name, xml, variables, labels }) => ({
              name,
              xml,
              variables,
              moduleRefs: [`${name}:cell`],
              ports: { general_ports: labels.map(({ label, option }) => ({ port_type: label, variables: option })) },
            }))
          ),
        ],
      },
    }
  },

  /** Node `colour_coded` has the MVP's colour category, `domainType: 'membrane'`. */
  domainType: () => {
    const node = legacyNode('colour_coded', 'colour_coded', 'coloured_modules.cellml', 'coloured')
    node.data.domainType = 'membrane'
    return {
      flow: { nodes: [node], edges: [] },
      store: {
        availableModules: [collection('coloured_modules.cellml', [{ name: 'coloured', xml: decay('coloured'), moduleRefs: ['coloured:simple'] }])],
      },
    }
  },
}
