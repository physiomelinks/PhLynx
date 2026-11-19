/**
 * A synthetic workspace at format 1.4.0. The workspace holds the default parameter sets imported for each math,
 * keyed `mathRef:paramRef`, and those waiting for a config to name them, each math's side-car of annotations, and
 * the ports and couplings those annotations give, and the physiological view: each node's place in it and the
 * pieces it is built from and their skins, the edges a drop there made, which a later move may take away, and a
 * copy of each of the user's own cartoons the nodes are drawn as. An edge whose ends are placed there keeps its
 * manual couplings aside while their annotations couple it, and a compartment keeps the order its species were
 * dragged into in species mode. Nodes are coloured from the workspace's node theme, which it keeps a copy of
 * unless it is built in.
 * Written out literally rather than built with the app's helpers, so a change to those shows as a format change.
 */
import { base as base1_3_0 } from './v1-3-0.js'
import { edge, mergeParts } from './builders.js'
import { separatedDecayNode } from './v1-1-0.js'

export const version = '1.4.0'

/**
 * Builds the workspace around the cases.
 *
 * @returns {Object}
 */
export const base = () => {
  const doc = base1_3_0()
  doc.version = version
  doc.parameters = { sets: [], unlinked: [] }
  const { tolerance, ...settings } = doc.simulation.simulationSettings
  doc.simulation.simulationSettings = { ...settings, relativeTolerance: tolerance, absoluteTolerance: tolerance }
  return doc
}

const SOURCE = { file: 'decay_parameters.json', importedAt: '2026-11-08T00:00:00.000Z' }

export const cases = {
  /**
   * Node `decay_set`'s math has the set `decay`: k = 0.25 with its source noted, x_init still to be filled, and the
   * global F.
   */
  linkedSet: () => {
    const part = separatedDecayNode('decay_set')
    const [mathRef] = part.store.availableMath[0]
    part.parameters = {
      sets: [
        [
          `${mathRef}:decay`,
          {
            ref: 'decay',
            source: SOURCE,
            globals: [['F', { value: '96485.0', units: 'C_per_mol', data_reference: 'CODATA', extra: {} }]],
            values: [
              ['k', { value: '0.25', units: 'per_second', data_reference: 'Smith2001', extra: { sourced: 'yes' } }],
              ['x_init', { value: null, units: 'metre', data_reference: '', extra: {} }],
            ],
          },
        ],
      ],
    }
    return part
  },

  /** Node `decay_own`, dropped with Parameters "None", made the set `decay_own` of its own values. */
  instanceSet: () => {
    const part = separatedDecayNode('decay_own')
    const [mathRef] = part.store.availableMath[0]
    part.flow.nodes[0].data.parameterisation = 'decay_own'
    part.parameters = {
      sets: [
        [
          `${mathRef}:decay_own`,
          {
            ref: 'decay_own',
            source: {
              file: '',
              importedAt: '2026-11-09T00:00:00.000Z',
              kind: 'instance',
              nodeId: part.flow.nodes[0].id,
            },
            globals: [],
            values: [['k', { value: '0.5', units: 'per_second', data_reference: '', extra: {} }]],
          },
        ],
      ],
    }
    return part
  },

  /** Node `decay_notes`'s math has a side-car annotating its variable `x` by id. */
  moduleAnnotations: () => {
    const part = separatedDecayNode('decay_notes')
    const [mathRef] = part.store.availableMath[0]
    part.store.moduleAnnotations = [
      [
        mathRef,
        '@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .\n<#x> bqbiol:is <https://identifiers.org/CHEBI:17234> .\n',
      ],
    ]
    return part
  },

  /**
   * Nodes `pool_a` and `pool_b` have a port their side-car's annotation of x gives, coupled through it, and
   * `pool_b`'s summed flows are held at 0.
   */
  annotatedPorts: () => {
    const [a, b] = ['pool_a', 'pool_b'].map(separatedDecayNode)
    const port = (name) => ({
      portType: 'general_ports',
      label: '',
      variables: ['x'],
      multiportType: 'Sum',
      annotation: {
        subject: `decay_modules.cellml#${name}.x`,
        contribution: 0,
        variable: 'x',
        property: 'OPB:00340',
        species: ['CHEBI:29101'],
        location: 'GO:0005737',
        role: 'reader',
        source: { kind: 'sidecar', mathRef: `decay_modules.cellml:${name}` },
      },
    })
    a.flow.nodes[0].data.ports = [port('pool_a')]
    b.flow.nodes[0].data.ports = [port('pool_b')]
    b.flow.nodes[0].data.annotationOverlay = { heldConstant: true }
    const coupled = {
      flow: { edges: [edge('pool_a', 'pool_b', [{ sourcePort: port('pool_a'), targetPort: port('pool_b') }])] },
    }
    return mergeParts(a, b, coupled)
  },

  /**
   * Node `pump` sits on the apical stretch of an epithelial cell's membrane, built from pieces, drawn as a pump; node
   * `lumen` is a region against that membrane, placed by hand. The cell's membrane is drawn with a skin of the
   * workspace's own.
   */
  physiologyView: () => {
    const pump = separatedDecayNode('pump')
    const lumen = separatedDecayNode('lumen')
    pump.flow.nodes[0].data.bioView = {
      role: 'membraneProtein',
      glyph: 'pump',
      order: 0,
      site: 'pieces/membrane.apical',
    }
    lumen.flow.nodes[0].data.bioView = {
      role: 'region',
      at: 'left',
      adjacent: [{ cell: 'cell', facet: 'lateral', at: 'left' }],
      position: { x: 40, y: 60 },
      rect: { x: 40, y: 60, width: 200, height: 80 },
    }
    const pieces = [
      { id: 'cell', kind: 'compartment', label: 'Epithelial cell' },
      {
        id: 'membrane',
        kind: 'membrane',
        label: 'Plasma membrane',
        encloses: ['cell'],
        frame: { x: 0, y: 0, width: 360, height: 300 },
        skin: { ref: 'villus', mode: 'cover', opacity: 0.5 },
        sides: {
          top: [
            { id: 'apical', label: 'Apical membrane', to: 0.5, annotation: { facet: 'apical' } },
            { id: 'apical-2', label: 'Apical membrane (right)', group: 'apical', site: false },
          ],
          left: [
            { id: 'lateral-left', label: 'Lateral membrane (left)', annotation: { facet: 'lateral', at: 'left' } },
          ],
        },
      },
      {
        id: 'metabolism',
        kind: 'zone',
        label: 'Metabolism',
        compartment: 'cell',
        frame: { x: 20, y: 40, width: 200, height: 80 },
      },
      {
        id: 'apical-fluid',
        kind: 'compartment',
        label: 'Apical fluid (lumen)',
        tone: 'sky',
        term: 'GO:0005576',
        depth: 80,
        docks: [{ on: 'membrane', side: 'top', face: 'outside', from: 0, to: 0.5 }],
      },
      {
        id: 'tubule',
        kind: 'compartment',
        label: 'Tubule',
        style: 'vessel',
        frame: { x: 500, y: 0, width: 200, height: 100 },
      },
      {
        id: 'flow',
        kind: 'tube',
        label: 'Flow',
        ends: ['tubule', 'apical-fluid'],
        flux: 'flow',
        bends: [{ x: 450, y: 50 }],
      },
      { id: 'fold', kind: 'fold', label: 'Fold', membrane: 'membrane', side: 'left', at: 0.75, depth: 120 },
    ]
    const skins = {
      villus: {
        name: 'Villus',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      },
    }
    return mergeParts(pump, lumen, { bioPieces: { pieces, skins } })
  },

  /** Node `cytosol` was dropped next to `carrier` in the physiological view, which joined them across its membrane. */
  placementEdge: () => {
    const [carrier, cytosol] = ['carrier', 'cytosol'].map(separatedDecayNode)
    const placed = edge('carrier', 'cytosol', [])
    placed.data.placement = { from: 'carrier', to: 'cytosol', kind: 'across' }
    return mergeParts(carrier, cytosol, { flow: { edges: [placed] } })
  },

  /** Node `cup_carrier` is drawn as the user's own cartoon `local:cup`, which the workspace keeps a copy of. */
  userGlyph: () => {
    const part = separatedDecayNode('cup_carrier')
    part.flow.nodes[0].data.bioView = { role: 'membraneProtein', glyph: 'local:cup' }
    part.bioGlyphs = {
      glyphs: {
        'local:cup': {
          id: 'local:cup',
          name: 'Cup',
          sbo: 'SBO:0000284',
          goFunctions: ['GO:0099999'],
          viewBox: '0 0 64 48',
          elements: [{ type: 'path', d: 'M 8 3 L 32 20 L 56 3 L 56 45 L 8 45 Z', fill: 'body', stroke: 'outline' }],
          palette: { light: { body: '#3366cc' } },
        },
      },
    }
    return part
  },

  /** Node `heart_pump` has the category `pump`, coloured by the user's own theme `local:organs`, kept with it. */
  nodeTheme: () => {
    const part = separatedDecayNode('heart_pump')
    part.flow.nodes[0].data.domainType = 'pump'
    part.nodeTheme = {
      id: 'local:organs',
      theme: {
        schemaVersion: 1,
        id: 'local:organs',
        name: 'Organs',
        description: 'Colours by organ.',
        author: 'PhLynx tests',
        license: 'CC0-1.0',
        derivedFrom: 'plain',
        categories: [{ key: 'pump', label: 'Pump', color: '#ffe2ec', dark: '#4d2633' }],
      },
    }
    return part
  },

  /** The edge from `left_pool` to `right_pool` keeps its coupling through the label `q` aside. */
  setAsideCouplings: () => {
    const [left, right] = ['left_pool', 'right_pool'].map(separatedDecayNode)
    const port = { portType: 'general_ports', label: 'q', variables: ['x'], multiportType: 'None' }
    const placed = edge('left_pool', 'right_pool', [])
    placed.data.manualCouplings = [{ sourcePort: port, targetPort: port }]
    return mergeParts(left, right, { flow: { edges: [placed] } })
  },

  /** Node `cytosol_pool` lists glucose before sodium in species mode, as the user dragged them. */
  speciesOrder: () => {
    const part = separatedDecayNode('cytosol_pool')
    part.flow.nodes[0].data.bioView = { role: 'cytosol', speciesOrder: ['CHEBI:4167', 'CHEBI:29101'] }
    return part
  },

  /** The set `glut5` waits for a config to name it. */
  unlinkedSet: () => ({
    parameters: {
      unlinked: [
        [
          'glut5',
          {
            ref: 'glut5',
            source: { ...SOURCE, file: 'glut5_parameters.json' },
            globals: [],
            values: [['Km', { value: '1e-3', units: 'mM', data_reference: '', extra: {} }]],
          },
        ],
      ],
    },
  }),

  /** CVODE runs with a relative tolerance of 1e-6 and an absolute tolerance of 1e-10, set apart. */
  absoluteTolerance: () => ({
    simulation: { simulationSettings: { solver: 'CVODE', relativeTolerance: 1e-6, absoluteTolerance: 1e-10 } },
  }),
}
