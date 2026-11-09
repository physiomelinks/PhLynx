/**
 * A synthetic workspace at format 1.4.0. The workspace holds the default parameter sets imported for each math,
 * keyed `mathRef:paramRef`, and those waiting for a config to name them, each math's side-car of annotations, and
 * the ports and couplings those annotations give.
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
            source: { file: '', importedAt: '2026-11-09T00:00:00.000Z', kind: 'instance', nodeId: part.flow.nodes[0].id },
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
      [mathRef, '@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .\n<#x> bqbiol:is <https://identifiers.org/CHEBI:17234> .\n'],
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
    const coupled = { flow: { edges: [edge('pool_a', 'pool_b', [{ sourcePort: port('pool_a'), targetPort: port('pool_b') }])] } }
    return mergeParts(a, b, coupled)
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
}
