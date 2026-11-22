import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import { boundToPieces, layoutPieces, pieceKey } from '../../../../../src/services/bioView/pieces/layout.js'
import { layoutPhysiology } from '../../../../../src/services/bioView/layout.js'
import { dropSites, nearestSite } from '../../../../../src/services/bioView/drop.js'

const node = (id, site, extra = {}) => ({ id, data: { name: id, bioView: { site, ...extra } } })

const cardiomyocyte = getBuiltInPieceTemplate('cardiomyocyte').pieces
const rod = getBuiltInPieceTemplate('rod-photoreceptor').pieces

describe('boundToPieces', () => {
  it('finds the nodes on each site, in slot order, one only on a one-module site', () => {
    const nodes = [
      node('b-cytosol', 'pieces/myocyte'),
      node('a-cytosol', 'pieces/myocyte'),
      node('ncx', 'pieces/sarcolemma.surface', { order: 1 }),
      node('nka', 'pieces/sarcolemma.surface', { order: 0 }),
      node('lost', 'pieces/nowhere'),
      node('template', 'bt-1/cell'),
    ]
    const { occupants, bound } = boundToPieces(cardiomyocyte, nodes)
    // The first by name holds a one-module site.
    expect(occupants.get('myocyte')).toEqual(['a-cytosol'])
    expect(occupants.get('sarcolemma.surface')).toEqual(['nka', 'ncx'])
    expect([...bound.keys()].sort()).toEqual(['a-cytosol', 'ncx', 'nka'])
    expect(bound.get('nka')).toBe('pieces/sarcolemma.surface')
  })
})

describe('layoutPieces with modules on the pieces', () => {
  const nodes = [
    node('cytosol', 'pieces/myocyte', { role: 'cytosol' }),
    node('sarcolemma-module', 'pieces/sarcolemma', { role: 'membrane' }),
    node('nka', 'pieces/sarcolemma.surface', { role: 'membraneProtein', order: 0 }),
    node('ncx', 'pieces/sarcolemma.surface', { role: 'membraneProtein', order: 1 }),
    node('lcc', 'pieces/t-tubule', { role: 'membraneProtein' }),
    node('serca', 'pieces/sr-membrane.network', { role: 'membraneProtein' }),
    node('contraction', 'pieces/myofilaments', { role: 'cytosolic' }),
    node('ecs', 'pieces/extracellular', { role: 'region' }),
  ]
  const { places, sites } = layoutPieces(cardiomyocyte, { nodes })

  it('draws a cell as the module on its bulk, with its membrane module', () => {
    expect(places.has(pieceKey('sarcolemma'))).toBe(false)
    expect(places.get('cytosol')).toMatchObject({
      kind: 'cell',
      instance: 'pieces',
      piece: 'sarcolemma',
      membrane: 'sarcolemma-module',
      site: 'pieces/myocyte',
      empty: false,
    })
    expect(places.get('sarcolemma-module')).toEqual({
      kind: 'membrane',
      cell: 'cytosol',
      instance: 'pieces',
      site: 'pieces/sarcolemma',
    })
    // An organelle in it stands in the cell, now drawn as the module.
    expect(places.get(pieceKey('sr-membrane')).parent).toBe('cytosol')
  })

  it('puts proteins in their slots along their span, down a fold, or on an organelle', () => {
    const [nka, ncx] = ['nka', 'ncx'].map((id) => places.get(id))
    expect(nka).toMatchObject({
      kind: 'protein',
      cell: 'cytosol',
      part: 'surface',
      order: 0,
      site: 'pieces/sarcolemma.surface',
      instance: 'pieces',
    })
    expect(ncx.order).toBe(1)
    expect(ncx.x).toBeGreaterThan(nka.x)
    expect(places.get('lcc')).toMatchObject({ kind: 'protein', cell: 'cytosol', part: 't-tubule' })
    expect(places.get('serca')).toMatchObject({ kind: 'protein', cell: pieceKey('sr-membrane'), part: 'network' })
  })

  it('puts a process card in its zone, and a region as its module', () => {
    const zone = places.get(pieceKey('myofilaments'))
    expect(zone).toMatchObject({ kind: 'zone', cell: 'cytosol', empty: false })
    const card = places.get('contraction')
    expect(card).toMatchObject({ kind: 'cytosolic', cell: 'cytosol', order: 0, site: 'pieces/myofilaments' })
    expect(card.x).toBeGreaterThan(zone.rect.x)
    expect(places.get('ecs')).toMatchObject({ kind: 'region', piece: 'extracellular', empty: false })
    expect(places.has(pieceKey('extracellular'))).toBe(false)
  })

  it('offers every site to drop on, each with what is on it, grouped by the place drawing it', () => {
    const byPath = new Map(sites.map((site) => [site.path, site]))
    expect(byPath.get('myocyte')).toMatchObject({
      ref: 'pieces/myocyte',
      role: 'cytosol',
      kind: 'single',
      occupant: 'cytosol',
      key: 'cytosol',
      group: 'cytosol',
    })
    expect(byPath.get('sarcolemma')).toMatchObject({
      role: 'membrane',
      occupant: 'sarcolemma-module',
      group: 'cytosol',
    })
    expect(byPath.get('sarcolemma.surface')).toMatchObject({
      role: 'membraneProtein',
      kind: 'slots',
      occupants: ['nka', 'ncx'],
      cell: 'cytosol',
      facet: 'surface',
    })
    // A slot for each protein and a spare past them.
    expect(byPath.get('sarcolemma.surface').slots).toHaveLength(3)
    expect(byPath.get('myofilaments')).toMatchObject({
      role: 'cytosolic',
      kind: 'slots',
      process: 'myofilaments',
      occupants: ['contraction'],
    })
    expect(byPath.get('cleft')).toMatchObject({ role: 'region', kind: 'single', occupant: null, inner: true })
    expect(byPath.has('sarcolemma.left')).toBe(false)
  })

  it('takes a drop on the cell’s inside, its membrane, a span’s slot and an empty compartment', () => {
    const targets = dropSites(sites)
    const cell = places.get('cytosol').rect
    const at = (x, y) => nearestSite(targets, { x, y })
    expect(at(cell.x + cell.width * 0.5, cell.y + cell.height - 60)).toMatchObject({
      ref: 'pieces/myocyte',
      area: 'cell',
    })
    expect(at(cell.x + 2, cell.y + cell.height / 2)).toMatchObject({ ref: 'pieces/sarcolemma', area: 'membrane' })
    const nka = places.get('nka')
    expect(at(nka.x, nka.y)).toMatchObject({ ref: 'pieces/sarcolemma.surface', type: 'slot', order: 0 })
    const cleft = places.get(pieceKey('cleft')).rect
    expect(at(cleft.x + cleft.width / 2, cleft.y + cleft.height / 2)).toMatchObject({
      ref: 'pieces/cleft',
      area: 'compartment',
    })
  })
})

describe('a tube’s module', () => {
  it('is drawn in its joint, where the two ends touch', () => {
    const { places } = layoutPieces(rod, { nodes: [node('cng', 'pieces/cilium', { role: 'cytosolic' })] })
    const tube = places.get(pieceKey('cilium'))
    expect(tube).toMatchObject({ kind: 'link', joint: 'bridge', empty: false })
    expect(places.get('cng')).toMatchObject({
      kind: 'card',
      joint: 'bridge',
      link: pieceKey('cilium'),
      site: 'pieces/cilium',
    })
  })
})

describe('layoutPhysiology beside the pieces', () => {
  it('leaves out the nodes the pieces place, so none is drawn twice', () => {
    const nodes = [node('cytosol', 'pieces/myocyte', { role: 'cytosol' }), { id: 'loose', data: { name: 'loose' } }]
    const { places } = layoutPhysiology(nodes, new Map(), { placedElsewhere: new Set(['cytosol']) })
    expect(places.has('cytosol')).toBe(false)
    expect(places.get('loose')).toMatchObject({ kind: 'card' })
  })
})
