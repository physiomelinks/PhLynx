import { describe, expect, it } from 'vitest'
import { GO } from '../../../../src/services/annotations/iris.js'
import { locatePlace, placementsOf, preparePlacement, rankPlace } from '../../../../src/services/bioView/placement.js'
import { getBuiltInTemplate } from '../../../../src/services/bioView/builtInTemplates.js'

const TEMPLATES = {
  instances: [{ id: 'bt-1', template: 'epithelial-cell', at: { x: 0, y: 0 } }],
  definitions: new Map([['epithelial-cell', getBuiltInTemplate('epithelial-cell')]]),
}
const onSite = (id, path) => ({ id, data: { name: id, bioView: { site: `bt-1/${path}` } } })
const summary = (places) => places.map(({ key, kind, as, facets }) => ({ key, kind, as, ...(facets ? { facets } : {}) }))

describe('placementsOf on a template', () => {
  it('places a membrane protein on its facet, between its cell and the fluid against that facet', () => {
    const places = placementsOf([onSite('p', 'cell.apical')], TEMPLATES).get('p')
    expect(summary(places)).toEqual([
      { key: 'site:bt-1/cell.apical', kind: 'membraneProtein', as: [], facets: ['apical'] },
      { key: 'site:bt-1/cell', kind: 'cytosol', as: [GO.cytoplasm] },
      { key: 'site:bt-1/cell.membrane', kind: 'membrane', as: [GO.plasmaMembrane], facets: ['apical'] },
      { key: 'site:bt-1/apical-fluid', kind: 'region', as: [GO.extracellularRegion] },
    ])
    expect(places[3].label).toBe('Apical fluid (lumen)')
  })

  it('places a cell, its membrane, a process and a compartment', () => {
    const nodes = [onSite('c', 'cell'), onSite('m', 'cell.membrane'), onSite('g', 'cell.metabolism'), onSite('r', 'paracellular')]
    const places = placementsOf(nodes, TEMPLATES)
    const facets = ['apical', 'basolateral', 'lateral-left', 'lateral-right']
    expect(summary(places.get('c'))).toEqual([
      { key: 'site:bt-1/cell', kind: 'cytosol', as: ['self'] },
      { key: 'site:bt-1/cell.membrane', kind: 'membrane', as: [`self+${GO.plasmaMembrane}`], facets },
    ])
    expect(summary(places.get('m'))).toEqual([
      { key: 'site:bt-1/cell.membrane', kind: 'membrane', as: ['self'], facets },
      { key: 'site:bt-1/cell', kind: 'cytosol', as: [GO.cytoplasm] },
    ])
    expect(summary(places.get('g'))).toEqual([
      { key: 'site:bt-1/cell.metabolism', kind: 'cytosolic', as: [] },
      { key: 'site:bt-1/cell', kind: 'cytosol', as: [GO.cytoplasm] },
    ])
    expect(places.get('r')).toEqual([
      { key: 'site:bt-1/paracellular', label: 'Paracellular space', kind: 'region', as: ['self'], sides: ['lateral'] },
    ])
  })

  it('leaves a node on a dangling site to its role', () => {
    const gone = { id: 'x', data: { bioView: { site: 'bt-gone/cell.apical' } } }
    expect(placementsOf([gone, onSite('y', 'nowhere')], TEMPLATES)).toEqual(
      new Map([
        ['x', []],
        ['y', []],
      ])
    )
  })
})

describe('placementsOf without a template', () => {
  const nodes = [
    { id: 'c', data: { name: 'Cell', bioView: { role: 'cytosol' } } },
    { id: 'm', data: { name: 'Membrane', bioView: { role: 'membrane', cell: 'c' } } },
    { id: 'p', data: { name: 'Pump', bioView: { role: 'membraneProtein', facet: 'basolateral', cell: 'c' } } },
    { id: 'r', data: { name: 'Blood', bioView: { role: 'region', adjacent: [{ cell: 'c', facet: 'basolateral' }] } } },
    { id: 'loose', data: { name: 'Loose', bioView: { role: 'region' } } },
    { id: 'card', data: { name: 'Card' } },
  ]

  it('places nodes by the cell, facet and adjacency their bioView gives', () => {
    const places = placementsOf(nodes)
    expect(summary(places.get('p'))).toEqual([
      { key: 'node:p', kind: 'membraneProtein', as: [], facets: ['basolateral'] },
      { key: 'node:c', kind: 'cytosol', as: [GO.cytoplasm] },
      { key: 'node:c.membrane', kind: 'membrane', as: [GO.plasmaMembrane], facets: ['basolateral'] },
      { key: 'node:r', kind: 'region', as: [GO.extracellularRegion] },
    ])
    expect(places.get('p')[1].label).toBe('Cell')
    expect(summary(places.get('m')).map((place) => place.key)).toEqual(['node:c.membrane', 'node:c'])
    expect(places.get('r')).toEqual([{ key: 'node:r', label: 'Blood', kind: 'region', as: ['self'], sides: ['basolateral'] }])
  })

  it('leaves a region against nothing, and a node with no role, unplaced', () => {
    const places = placementsOf(nodes)
    expect(places.get('loose')).toEqual([])
    expect(places.get('card')).toEqual([])
  })

  it('places a node outside the prepared ones by its own data', () => {
    const prepared = preparePlacement(nodes)
    const copy = { id: 'p2', data: { bioView: { role: 'membraneProtein', facet: 'basolateral', cell: 'c' } } }
    expect(locatePlace(copy, prepared)[1].key).toBe('node:c')
    expect(locatePlace(onSite('t', 'cell'), preparePlacement([], TEMPLATES))[0].key).toBe('site:bt-1/cell')
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

describe('placementsOf on a template’s nested pieces', () => {
  const CARDIOMYOCYTE = {
    instances: [{ id: 'bt-1', template: 'cardiomyocyte', at: { x: 0, y: 0 } }],
    definitions: new Map([['cardiomyocyte', getBuiltInTemplate('cardiomyocyte')]]),
  }
  const placesOf = (path) => summary(placementsOf([onSite('p', path)], CARDIOMYOCYTE).get('p')).slice(1)
  const key = (path) => `site:bt-1/${path}`

  it('has a fold’s protein between the outside of the side it dips in from and the microdomain against it', () => {
    expect(placesOf('myocyte.t-tubule')).toEqual([
      { key: key('cleft'), kind: 'region', as: [GO.cytoplasm] },
      { key: key('myocyte.membrane'), kind: 'membrane', as: [GO.plasmaMembrane], facets: ['t-tubule'] },
      { key: key('extracellular'), kind: 'region', as: [GO.extracellularRegion] },
    ])
  })

  it('has an organelle’s protein between its lumen and the cell’s inside, or the microdomain against it', () => {
    expect(placesOf('sr.network')).toEqual([
      { key: key('sr'), kind: 'cytosol', as: [GO.cytoplasm] },
      { key: key('sr.membrane'), kind: 'membrane', as: [GO.plasmaMembrane], facets: ['network'] },
      { key: key('myocyte'), kind: 'cytosol', as: [GO.extracellularRegion] },
    ])
    expect(placesOf('sr.junctional').at(-1)).toEqual({ key: key('cleft'), kind: 'region', as: [GO.extracellularRegion] })
  })

  it('leaves a protein along a side as it was', () => {
    expect(placesOf('myocyte.sarcolemma')).toEqual([
      { key: key('myocyte'), kind: 'cytosol', as: [GO.cytoplasm] },
      { key: key('myocyte.membrane'), kind: 'membrane', as: [GO.plasmaMembrane], facets: ['sarcolemma'] },
      { key: key('extracellular'), kind: 'region', as: [GO.extracellularRegion] },
    ])
  })
})

describe('placementsOf on a junction', () => {
  const rod = {
    schemaVersion: 2,
    id: 'rod',
    name: 'Rod',
    cells: [
      {
        id: 'rod',
        label: 'Rod',
        facets: [
          { id: 'os', label: 'OS membrane', edge: 'top' },
          { id: 'is', label: 'IS membrane', edge: 'bottom' },
        ],
        processes: [{ id: 'cilium', label: 'Cilium', between: ['outer', 'inner'] }],
      },
    ],
    compartments: [
      { id: 'outer', label: 'Outer segment', in: 'rod', against: ['rod.os'], term: 'GO:0001750' },
      { id: 'inner', label: 'Inner segment', in: 'rod', against: ['rod.is'] },
    ],
  }
  it('has the junction between its two spaces, each by its own term where it has one', async () => {
    const { validateTemplate } = await import('../../../../src/services/bioView/templates.js')
    const options = { instances: [{ id: 'bt-1', template: 'rod', at: { x: 0, y: 0 } }], definitions: new Map([['rod', validateTemplate(rod).template]]) }
    expect(summary(placementsOf([onSite('j', 'rod.cilium')], options).get('j')).slice(1)).toEqual([
      { key: 'site:bt-1/outer', kind: 'region', as: ['GO:0001750'] },
      { key: 'site:bt-1/inner', kind: 'region', as: [GO.cytoplasm] },
    ])
    // A protein on the outer segment's membrane finds it as cytoplasm, and by its term.
    expect(summary(placementsOf([onSite('p', 'rod.os')], options).get('p'))[1]).toEqual({ key: 'site:bt-1/outer', kind: 'region', as: [GO.cytoplasm, 'GO:0001750'] })
  })
})
