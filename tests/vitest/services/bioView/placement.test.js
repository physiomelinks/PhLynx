import { describe, expect, it } from 'vitest'
import { GO } from '../../../../src/services/annotations/iris.js'
import { locatePlace, placementsOf, preparePlacement, rankPlace } from '../../../../src/services/bioView/placement.js'
import { getBuiltInPieceTemplate } from '../../../../src/services/bioView/pieces/builtInTemplates.js'

const TEMPLATES = { pieces: getBuiltInPieceTemplate('epithelial-cell').pieces }
const onSite = (id, path) => ({ id, data: { name: id, bioView: { site: `pieces/${path}` } } })
const summary = (places) =>
  places.map(({ key, kind, as, facets }) => ({ key, kind, as, ...(facets ? { facets } : {}) }))

describe('placementsOf on the pieces', () => {
  it('places a membrane protein on its facet, between its cell and the fluid against that facet', () => {
    const places = placementsOf([onSite('p', 'plasma-membrane.apical')], TEMPLATES).get('p')
    expect(summary(places)).toEqual([
      { key: 'site:pieces/plasma-membrane.apical', kind: 'membraneProtein', as: [], facets: ['apical'] },
      { key: 'site:pieces/cell', kind: 'cytosol', as: [GO.cytoplasm] },
      { key: 'site:pieces/plasma-membrane', kind: 'membrane', as: [GO.plasmaMembrane], facets: ['apical'] },
      { key: 'site:pieces/apical-fluid', kind: 'region', as: [GO.extracellularRegion] },
    ])
    expect(places[3].label).toBe('Apical fluid (lumen)')
  })

  it('places a cell, its membrane, a process and a compartment', () => {
    const nodes = [
      onSite('c', 'cell'),
      onSite('m', 'plasma-membrane'),
      onSite('g', 'metabolism'),
      onSite('r', 'paracellular'),
    ]
    const places = placementsOf(nodes, TEMPLATES)
    // Clockwise from the top, as the membrane's sides go.
    const facets = ['apical', 'lateral-right', 'basolateral', 'lateral-left']
    expect(summary(places.get('c'))).toEqual([
      { key: 'site:pieces/cell', kind: 'cytosol', as: ['self'] },
      { key: 'site:pieces/plasma-membrane', kind: 'membrane', as: [`self+${GO.plasmaMembrane}`], facets },
    ])
    expect(summary(places.get('m'))).toEqual([
      { key: 'site:pieces/plasma-membrane', kind: 'membrane', as: ['self'], facets },
      { key: 'site:pieces/cell', kind: 'cytosol', as: [GO.cytoplasm] },
    ])
    expect(summary(places.get('g'))).toEqual([
      { key: 'site:pieces/metabolism', kind: 'cytosolic', as: [] },
      { key: 'site:pieces/cell', kind: 'cytosol', as: [GO.cytoplasm] },
    ])
    expect(places.get('r')).toEqual([
      {
        key: 'site:pieces/paracellular',
        label: 'Paracellular space',
        kind: 'region',
        as: ['self'],
        sides: ['lateral'],
      },
    ])
  })

  it('leaves a node on a dangling site to its role', () => {
    const gone = { id: 'x', data: { bioView: { site: 'gone/plasma-membrane.apical' } } }
    expect(placementsOf([gone, onSite('y', 'nowhere')], TEMPLATES)).toEqual(
      new Map([
        ['x', []],
        ['y', []],
      ]),
    )
  })
})

describe('placementsOf off the pieces', () => {
  it('leaves a node on no site unplaced, whatever role is stored', () => {
    const nodes = [
      { id: 'c', data: { name: 'Cell', bioView: { role: 'cytosol' } } },
      { id: 'card', data: { name: 'Card' } },
    ]
    expect(placementsOf(nodes)).toEqual(
      new Map([
        ['c', []],
        ['card', []],
      ]),
    )
    expect(locatePlace(onSite('t', 'cell'), preparePlacement([], TEMPLATES))[0].key).toBe('site:pieces/cell')
  })
})

describe('rankPlace', () => {
  it('orders places outside in, apical first', () => {
    expect(rankPlace({ kind: 'region', sides: ['apical'] })).toBe(0)
    expect(rankPlace({ kind: 'membraneProtein', sides: ['apical'] })).toBe(1)
    expect(rankPlace({ kind: 'cytosol' })).toBe(2)
    expect(rankPlace({ kind: 'membrane' })).toBe(2)
    expect(rankPlace({ kind: 'cytosolic' })).toBe(2)
    expect(rankPlace({ kind: 'membraneProtein', sides: ['basolateral'] })).toBe(3)
    expect(rankPlace({ kind: 'region', sides: ['basolateral'] })).toBe(4)
    expect(rankPlace(undefined)).toBe(5)
  })
})
