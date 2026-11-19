import { describe, expect, it } from 'vitest'

import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'
import { CARDIOMYOCYTE, CHEMICAL_SYNAPSE, ROD, TWO_CELL_EPITHELIUM } from '../../../fixtures/pieces.js'

/** The validated pieces' topology; fails the test on any error. */
function topology(raw) {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return topologyOf(pieces)
}

/** Each site's role and neighbours, as 'path relation' strings, sorted: the shape siteNeighbours was checked in. */
const table = (raw) => {
  const t = topology(raw)
  return Object.fromEntries(
    t.sites.map(({ path, role }) => [
      path,
      [
        role,
        ...t
          .neighbours(path)
          .map((n) => `${n.path} ${n.relation}`)
          .sort(),
      ],
    ]),
  )
}

// Each table is the built-in template's siteNeighbours today, with its paths mapped as fixtures/pieces.js says.
describe('neighbours, as template sites relate today', () => {
  it('joins a cardiomyocyte’s fold to the cleft inside it and the SR’s sides to the cleft and cytosol', () => {
    expect(table(CARDIOMYOCYTE)).toEqual({
      myocyte: [
        'cytosol',
        'mitochondria process',
        'myocyte-membrane membrane',
        'myocyte-membrane.sarcolemma protein',
        'myofilaments process',
        'sr-membrane.network protein',
        't-tubule embedded',
      ],
      'myocyte-membrane': ['membrane', 'myocyte inside', 'myocyte-membrane.sarcolemma protein', 't-tubule protein'],
      'myocyte-membrane.sarcolemma': [
        'membraneProtein',
        'extracellular outside',
        'myocyte inside',
        'myocyte-membrane membrane',
      ],
      't-tubule': [
        'membraneProtein',
        'cleft inside',
        'extracellular outside',
        'myocyte membrane',
        'myocyte-membrane membrane',
      ],
      myofilaments: ['cytosolic', 'myocyte inside'],
      mitochondria: ['cytosolic', 'myocyte inside'],
      sr: ['cytosol', 'sr-membrane membrane', 'sr-membrane.junctional protein', 'sr-membrane.network protein'],
      'sr-membrane': ['membrane', 'sr inside', 'sr-membrane.junctional protein', 'sr-membrane.network protein'],
      'sr-membrane.junctional': ['membraneProtein', 'cleft outside', 'sr inside', 'sr-membrane membrane'],
      'sr-membrane.network': ['membraneProtein', 'myocyte outside', 'sr inside', 'sr-membrane membrane'],
      extracellular: ['region', 'myocyte-membrane.sarcolemma protein', 't-tubule protein'],
      cleft: ['region', 'sr-membrane.junctional protein', 't-tubule protein'],
    })
  })

  it('joins a rod’s two segments by its cilium, each meeting its own stretches of membrane', () => {
    expect(table(ROD)).toEqual({
      'outer-segment': [
        'region',
        'cilium downstream',
        'rod-membrane.os-lower protein',
        'rod-membrane.os-tip protein',
        'rod-membrane.os-upper protein',
      ],
      'inner-segment': [
        'region',
        'cilium upstream',
        'rod-membrane.is-lower protein',
        'rod-membrane.is-upper protein',
        'rod-membrane.terminal protein',
      ],
      // With no bulk, the membrane meets neither segment as a whole.
      'rod-membrane': [
        'membrane',
        'rod-membrane.is-lower protein',
        'rod-membrane.is-upper protein',
        'rod-membrane.os-lower protein',
        'rod-membrane.os-tip protein',
        'rod-membrane.os-upper protein',
        'rod-membrane.terminal protein',
      ],
      'rod-membrane.os-upper': [
        'membraneProtein',
        'extracellular outside',
        'outer-segment inside',
        'rod-membrane membrane',
      ],
      'rod-membrane.is-upper': [
        'membraneProtein',
        'extracellular outside',
        'inner-segment inside',
        'rod-membrane membrane',
      ],
      'rod-membrane.terminal': [
        'membraneProtein',
        'extracellular outside',
        'inner-segment inside',
        'rod-membrane membrane',
      ],
      'rod-membrane.os-lower': [
        'membraneProtein',
        'extracellular outside',
        'outer-segment inside',
        'rod-membrane membrane',
      ],
      'rod-membrane.is-lower': [
        'membraneProtein',
        'extracellular outside',
        'inner-segment inside',
        'rod-membrane membrane',
      ],
      'rod-membrane.os-tip': [
        'membraneProtein',
        'extracellular outside',
        'outer-segment inside',
        'rod-membrane membrane',
      ],
      cilium: ['cytosolic', 'inner-segment downstream', 'outer-segment upstream'],
      extracellular: [
        'region',
        'rod-membrane.is-lower protein',
        'rod-membrane.is-upper protein',
        'rod-membrane.os-lower protein',
        'rod-membrane.os-tip protein',
        'rod-membrane.os-upper protein',
        'rod-membrane.terminal protein',
      ],
    })
  })

  it('puts a synaptic cleft outside both the active zone and the postsynaptic density', () => {
    expect(table(CHEMICAL_SYNAPSE)).toEqual({
      pre: [
        'cytosol',
        'pre-membrane membrane',
        'pre-membrane.active-zone protein',
        'pre-membrane.perisynaptic protein',
        'vesicle-cycle process',
      ],
      'pre-membrane': [
        'membrane',
        'pre inside',
        'pre-membrane.active-zone protein',
        'pre-membrane.perisynaptic protein',
      ],
      'pre-membrane.perisynaptic': ['membraneProtein', 'ecs outside', 'pre inside', 'pre-membrane membrane'],
      'pre-membrane.active-zone': ['membraneProtein', 'cleft outside', 'pre inside', 'pre-membrane membrane'],
      'vesicle-cycle': ['cytosolic', 'pre inside'],
      post: ['cytosol', 'ca-signalling process', 'post-membrane membrane', 'post-membrane.psd protein'],
      'post-membrane': ['membrane', 'post inside', 'post-membrane.psd protein'],
      'post-membrane.psd': ['membraneProtein', 'cleft outside', 'post inside', 'post-membrane membrane'],
      'ca-signalling': ['cytosolic', 'post inside'],
      cleft: ['region', 'post-membrane.psd protein', 'pre-membrane.active-zone protein'],
      ecs: ['region', 'pre-membrane.perisynaptic protein'],
    })
  })

  it('shares the apical, basolateral and paracellular fluids between two epithelial cells', () => {
    const t = table(TWO_CELL_EPITHELIUM)
    expect(t['a-membrane.lateral-left']).toEqual(['membraneProtein', 'a inside', 'a-membrane membrane'])
    expect(t['a-membrane.lateral-right']).toEqual([
      'membraneProtein',
      'a inside',
      'a-membrane membrane',
      'paracellular outside',
    ])
    expect(t['b-membrane.lateral-left']).toEqual([
      'membraneProtein',
      'b inside',
      'b-membrane membrane',
      'paracellular outside',
    ])
    expect(t['apical-fluid']).toEqual(['region', 'a-membrane.apical protein', 'b-membrane.apical protein'])
    expect(t['basolateral-fluid']).toEqual([
      'region',
      'a-membrane.basolateral protein',
      'b-membrane.basolateral protein',
    ])
    expect(t.paracellular).toEqual(['region', 'a-membrane.lateral-right protein', 'b-membrane.lateral-left protein'])
    expect(t.a).toEqual([
      'cytosol',
      'a-membrane membrane',
      'a-membrane.apical protein',
      'a-membrane.basolateral protein',
      'a-membrane.lateral-left protein',
      'a-membrane.lateral-right protein',
    ])
  })
})

describe('neighbour context', () => {
  it('names the membrane a protein meets its spaces across, and each kind of piece', () => {
    const near = topology(CARDIOMYOCYTE).neighbours('sr-membrane.network')
    expect(near).toContainEqual({
      path: 'myocyte',
      relation: 'outside',
      context: { kind: 'compartment', membrane: 'sr-membrane' },
    })
    expect(near).toContainEqual({
      path: 'sr-membrane',
      relation: 'membrane',
      context: { kind: 'membrane', membrane: 'sr-membrane' },
    })
    expect(topology(CARDIOMYOCYTE).neighbours('cleft')).toContainEqual({
      path: 't-tubule',
      relation: 'protein',
      context: { kind: 'fold', membrane: 'myocyte-membrane' },
    })
  })

  it('gives a tube’s flux, and which end each compartment is', () => {
    const t = topology(ROD)
    expect(t.neighbours('cilium')).toEqual([
      {
        path: 'outer-segment',
        relation: 'upstream',
        context: { kind: 'compartment', flux: 'junction', end: 0 },
      },
      {
        path: 'inner-segment',
        relation: 'downstream',
        context: { kind: 'compartment', flux: 'junction', end: 1 },
      },
    ])
    expect(t.neighbours('inner-segment')).toContainEqual({
      path: 'cilium',
      relation: 'upstream',
      context: { kind: 'tube', flux: 'junction', end: 1 },
    })
  })

  it('leaves out sites switched off', () => {
    const t = topology(CARDIOMYOCYTE)
    expect(t.sites.map((site) => site.path)).not.toContain('myocyte-membrane.left')
    expect(t.neighbours('myocyte-membrane.left')).toEqual([])
  })
})

describe('relative sides', () => {
  it('puts an organelle’s outside in the compartment it stands in, unless a compartment is docked there', () => {
    const t = topology(CARDIOMYOCYTE)
    expect(t.insideOf('sr-membrane.network')).toBe('sr')
    expect(t.outsideOf('sr-membrane.network')).toEqual(['myocyte'])
    expect(t.outsideOf('sr-membrane.junctional')).toEqual(['cleft'])
  })

  it('finds what a stretch of membrane meets from its middle', () => {
    const t = topology(ROD)
    expect(t.insideOf('rod-membrane.os-upper')).toBe('outer-segment')
    expect(t.insideOf('rod-membrane.is-upper')).toBe('inner-segment')
    expect(t.outsideOf('rod-membrane.terminal')).toEqual(['extracellular'])
    expect(t.bulkOf('rod-membrane')).toBeNull()
  })

  it('gives a fold the lumen outside the side it dips in from, or the compartment docked into it', () => {
    expect(topology(CARDIOMYOCYTE).foldLumen('t-tubule')).toEqual(['extracellular'])
    const withLumen = [
      ...CARDIOMYOCYTE,
      {
        id: 'tt-lumen',
        kind: 'compartment',
        label: 'T-tubule lumen',
        docks: [{ on: 't-tubule', face: 'outside' }],
      },
    ]
    const t = topology(withLumen)
    expect(t.foldLumen('t-tubule')).toEqual(['tt-lumen'])
    // The rest of the top side still meets the extracellular space.
    expect(t.outsideOf('myocyte-membrane.sarcolemma')).toEqual(['extracellular'])
  })

  it('gives a stretch of membrane with no compartment docked inside the membrane’s bulk', () => {
    const t = topology(CARDIOMYOCYTE)
    expect(t.bulkOf('myocyte-membrane')).toBe('myocyte')
    expect(t.insideOf('myocyte-membrane.sarcolemma')).toBe('myocyte')
    expect(t.withinOf('mitochondria')).toBe('myocyte')
    expect(t.enclosureOf('sr')).toBe('sr-membrane')
    expect(t.enclosureOf('cleft')).toBeNull()
  })

  it('counts the membranes round a site', () => {
    const t = topology(CARDIOMYOCYTE)
    expect(t.depthOf('extracellular')).toBe(0)
    expect(t.depthOf('myocyte-membrane')).toBe(0)
    expect(t.depthOf('myocyte')).toBe(1)
    expect(t.depthOf('cleft')).toBe(1)
    expect(t.depthOf('sr-membrane.network')).toBe(1)
    expect(t.depthOf('sr')).toBe(2)
    expect(t.depthOf('mitochondria')).toBe(1)
    expect(t.depthOf('nothing')).toBeNull()
  })

  it('tells what a nested organelle’s membranes meet, any number deep', () => {
    // A mitochondrion: the outer membrane encloses the intermembrane space, in which the inner membrane encloses the matrix.
    const t = topology([
      { id: 'cytosol', kind: 'compartment', label: 'Cytosol' },
      {
        id: 'plasma',
        kind: 'membrane',
        label: 'Plasma membrane',
        encloses: ['cytosol'],
      },
      {
        id: 'ims',
        kind: 'compartment',
        label: 'Intermembrane space',
        parent: 'cytosol',
      },
      {
        id: 'outer',
        kind: 'membrane',
        label: 'Outer membrane',
        parent: 'cytosol',
        encloses: ['ims'],
      },
      { id: 'matrix', kind: 'compartment', label: 'Matrix', parent: 'ims' },
      {
        id: 'inner',
        kind: 'membrane',
        label: 'Inner membrane',
        parent: 'ims',
        encloses: ['matrix'],
      },
    ])
    expect(t.insideOf('inner.top')).toBe('matrix')
    expect(t.outsideOf('inner.top')).toEqual(['ims'])
    expect(t.insideOf('outer.left')).toBe('ims')
    expect(t.outsideOf('outer.left')).toEqual(['cytosol'])
    expect(t.depthOf('matrix')).toBe(3)
    expect(t.isWithin('matrix', 'plasma')).toBe(false)
    expect(t.isWithin('ims', 'outer')).toBe(true)
  })
})

describe('tubeGroupOf', () => {
  const pieces = [
    { id: 'a', kind: 'compartment', label: 'A' },
    { id: 'b', kind: 'compartment', label: 'B' },
    { id: 'c', kind: 'compartment', label: 'C' },
    { id: 'd', kind: 'compartment', label: 'D' },
    { id: 'e', kind: 'compartment', label: 'E', parent: 'd' },
    { id: 'f', kind: 'compartment', label: 'F' },
    { id: 'f-membrane', kind: 'membrane', label: 'Membrane', encloses: ['f'] },
    { id: 'ab', kind: 'tube', label: 'A to B', ends: ['a', 'b'] },
    { id: 'cb', kind: 'tube', label: 'C to B', ends: ['c', 'b'] },
    { id: 'ce', kind: 'tube', label: 'C to E', ends: ['c', 'e'] },
    { id: 'cf', kind: 'tube', label: 'C to F', ends: ['c', 'f'] },
  ]

  it('takes every compartment joined by tubes that stands in the same place and is enclosed by no membrane', () => {
    const t = topology(pieces)
    // E stands in D, and F is enclosed already.
    expect(t.tubeGroupOf('a')).toEqual(['a', 'b', 'c'])
    expect(t.tubeGroupOf('c')).toEqual(['a', 'b', 'c'])
    expect(t.tubeGroupOf('d')).toEqual(['d'])
  })

  it('takes nothing round a compartment enclosed already, or what is not a compartment', () => {
    const t = topology(pieces)
    expect(t.tubeGroupOf('f')).toEqual([])
    expect(t.tubeGroupOf('ab')).toEqual([])
  })
})
