/**
 * Built-in templates written as pieces (schema 4), to check the pieces' topology against how the templates relate
 * their sites today. Old paths map to new ones as: a cell's inside -> its compartment, '<cell>.membrane' -> its
 * membrane piece, a facet -> '<membrane>.<span>', a fold facet -> a fold piece, a process zone -> a zone piece, a
 * junction or link -> a tube, a compartment or microdomain -> a compartment. Sides a cell had no facet on are spans
 * with no site.
 */

/** Spans with no site, for the sides of a cell that had no facet. */
const bare = (...sides) =>
  Object.fromEntries(sides.map((side) => [side, [{ id: side, label: `Membrane (${side})`, site: false }]]))

export const CARDIOMYOCYTE = [
  { id: 'myocyte', kind: 'compartment', label: 'Cardiomyocyte' },
  {
    id: 'myocyte-membrane',
    kind: 'membrane',
    label: 'Sarcolemma',
    encloses: ['myocyte'],
    sides: {
      top: [{ id: 'sarcolemma', label: 'Sarcolemma' }],
      ...bare('right', 'bottom', 'left'),
    },
  },
  {
    id: 't-tubule',
    kind: 'fold',
    label: 'T-tubule',
    membrane: 'myocyte-membrane',
    side: 'top',
  },
  {
    id: 'myofilaments',
    kind: 'zone',
    label: 'Myofilaments',
    compartment: 'myocyte',
  },
  {
    id: 'mitochondria',
    kind: 'zone',
    label: 'Mitochondria',
    compartment: 'myocyte',
  },
  {
    id: 'sr',
    kind: 'compartment',
    label: 'Sarcoplasmic reticulum',
    parent: 'myocyte',
  },
  {
    id: 'sr-membrane',
    kind: 'membrane',
    label: 'SR membrane',
    parent: 'myocyte',
    encloses: ['sr'],
    sides: {
      right: [{ id: 'junctional', label: 'Junctional SR' }],
      bottom: [{ id: 'network', label: 'Network SR' }],
      ...bare('top', 'left'),
    },
  },
  {
    id: 'extracellular',
    kind: 'compartment',
    label: 'Extracellular space',
    docks: [{ on: 'myocyte-membrane', side: 'top', face: 'outside' }],
  },
  {
    id: 'cleft',
    kind: 'compartment',
    label: 'Dyadic cleft',
    parent: 'myocyte',
    docks: [
      { on: 't-tubule', face: 'inside' },
      { on: 'sr-membrane', side: 'right', face: 'outside' },
    ],
  },
]

const ALL_SIDES = ['top', 'right', 'bottom', 'left']

export const ROD = [
  {
    id: 'outer-segment',
    kind: 'compartment',
    label: 'Outer segment',
    term: 'GO:0001750',
    tone: 'violet',
    docks: [
      { on: 'rod-membrane', side: 'top', face: 'inside', to: 0.5 },
      { on: 'rod-membrane', side: 'bottom', face: 'inside', to: 0.5 },
      { on: 'rod-membrane', side: 'left', face: 'inside' },
    ],
  },
  {
    id: 'inner-segment',
    kind: 'compartment',
    label: 'Inner segment',
    term: 'GO:0001917',
    tone: 'teal',
    docks: [
      { on: 'rod-membrane', side: 'top', face: 'inside', from: 0.5 },
      { on: 'rod-membrane', side: 'bottom', face: 'inside', from: 0.5 },
      { on: 'rod-membrane', side: 'right', face: 'inside' },
    ],
  },
  {
    id: 'rod-membrane',
    kind: 'membrane',
    label: 'Plasma membrane',
    encloses: ['outer-segment', 'inner-segment'],
    skin: { ref: 'rod-photoreceptor' },
    sides: {
      top: [
        { id: 'os-upper', label: 'Outer segment membrane', to: 0.5 },
        { id: 'is-upper', label: 'Inner segment membrane' },
      ],
      bottom: [
        { id: 'os-lower', label: 'Outer segment membrane', to: 0.5 },
        { id: 'is-lower', label: 'Inner segment membrane' },
      ],
      left: [{ id: 'os-tip', label: 'Outer segment tip' }],
      right: [{ id: 'terminal', label: 'Synaptic end' }],
    },
  },
  {
    id: 'cilium',
    kind: 'tube',
    label: 'Connecting cilium',
    ends: ['outer-segment', 'inner-segment'],
    flux: 'junction',
  },
  {
    id: 'extracellular',
    kind: 'compartment',
    label: 'Extracellular space',
    docks: ALL_SIDES.map((side) => ({
      on: 'rod-membrane',
      side,
      face: 'outside',
    })),
  },
]

export const CHEMICAL_SYNAPSE = [
  { id: 'pre', kind: 'compartment', label: 'Presynaptic terminal' },
  {
    id: 'pre-membrane',
    kind: 'membrane',
    label: 'Presynaptic membrane',
    encloses: ['pre'],
    sides: {
      top: [{ id: 'perisynaptic', label: 'Perisynaptic membrane' }],
      bottom: [{ id: 'active-zone', label: 'Active zone' }],
      ...bare('left', 'right'),
    },
  },
  {
    id: 'vesicle-cycle',
    kind: 'zone',
    label: 'Vesicle cycle',
    compartment: 'pre',
  },
  { id: 'post', kind: 'compartment', label: 'Postsynaptic spine' },
  {
    id: 'post-membrane',
    kind: 'membrane',
    label: 'Postsynaptic membrane',
    encloses: ['post'],
    sides: {
      top: [{ id: 'psd', label: 'Postsynaptic density' }],
      ...bare('right', 'bottom', 'left'),
    },
  },
  {
    id: 'ca-signalling',
    kind: 'zone',
    label: 'Ca²⁺ signalling',
    compartment: 'post',
  },
  {
    id: 'cleft',
    kind: 'compartment',
    label: 'Synaptic cleft',
    docks: [
      { on: 'pre-membrane', side: 'bottom', face: 'outside' },
      { on: 'post-membrane', side: 'top', face: 'outside' },
    ],
  },
  {
    id: 'ecs',
    kind: 'compartment',
    label: 'Extracellular space',
    docks: [{ on: 'pre-membrane', side: 'top', face: 'outside' }],
  },
]

/** An epithelial cell's membrane, its sides annotated as the epithelial facets. */
const epithelialMembrane = (cell) => ({
  id: `${cell}-membrane`,
  kind: 'membrane',
  label: 'Plasma membrane',
  encloses: [cell],
  sides: {
    top: [
      {
        id: 'apical',
        label: 'Apical membrane',
        annotation: { facet: 'apical' },
      },
    ],
    bottom: [
      {
        id: 'basolateral',
        label: 'Basolateral membrane',
        annotation: { facet: 'basolateral' },
      },
    ],
    left: [
      {
        id: 'lateral-left',
        label: 'Lateral membrane (left)',
        annotation: { facet: 'lateral', at: 'left' },
        group: 'lateral',
      },
    ],
    right: [
      {
        id: 'lateral-right',
        label: 'Lateral membrane (right)',
        annotation: { facet: 'lateral', at: 'right' },
        group: 'lateral',
      },
    ],
  },
})

export const TWO_CELL_EPITHELIUM = [
  { id: 'a', kind: 'compartment', label: 'Cell A' },
  epithelialMembrane('a'),
  { id: 'b', kind: 'compartment', label: 'Cell B' },
  epithelialMembrane('b'),
  {
    id: 'apical-fluid',
    kind: 'compartment',
    label: 'Apical fluid',
    docks: [
      { on: 'a-membrane', side: 'top', face: 'outside' },
      { on: 'b-membrane', side: 'top', face: 'outside' },
    ],
  },
  {
    id: 'basolateral-fluid',
    kind: 'compartment',
    label: 'Basolateral fluid',
    docks: [
      { on: 'a-membrane', side: 'bottom', face: 'outside' },
      { on: 'b-membrane', side: 'bottom', face: 'outside' },
    ],
  },
  {
    id: 'paracellular',
    kind: 'compartment',
    label: 'Paracellular space',
    docks: [
      { on: 'a-membrane', side: 'right', face: 'outside' },
      { on: 'b-membrane', side: 'left', face: 'outside' },
    ],
  },
]
