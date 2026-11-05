import { describe, expect, it } from 'vitest'
import { GO } from '../../../../src/services/annotations/iris.js'
import { locateAll, sameLocation, shortName } from '../../../../src/services/annotations/locate.js'

describe('locate', () => {
  it('names IRIs by their fragment or last path segment', () => {
    expect(shortName('https://example.org/model.cellml#cell.c_A')).toBe('cell.c_A')
    expect(shortName('https://example.org/terms/region-1')).toBe('region-1')
    expect(shortName(undefined)).toBe('undefined')
  })

  it('resolves a location to the places that answer it, with their labels and facets', () => {
    const places = [
      { key: 'site:t/cell.apical', label: 'Apical membrane', as: [] },
      { key: 'site:t/cell', label: 'Cell', as: [GO.cytoplasm] },
      { key: 'site:t/cell.membrane', label: 'Membrane', as: [GO.plasmaMembrane], facets: ['apical'] },
      { key: 'site:t/lumen', label: 'Lumen', as: [GO.extracellularRegion] },
    ]
    expect(locateAll(places, GO.cytoplasm)).toEqual([
      { key: 'site:t/cell', label: 'Cell', path: ['Cell'] },
    ])
    expect(locateAll(places, GO.plasmaMembrane)).toEqual([
      { key: 'site:t/cell.membrane', label: 'Membrane', facets: ['apical'], path: ['Membrane'] },
    ])
    expect(locateAll(places, GO.extracellularRegion).map((place) => place.key)).toEqual(['site:t/lumen'])
    expect(locateAll(places, 'self')).toEqual([])
    expect(locateAll(places, null)).toEqual([])
    expect(locateAll(undefined, 'self')).toEqual([])
  })

  it('needs a relative place’s facets to lie within a self-located one’s', () => {
    const all = { key: 'm', facets: ['apical', 'basolateral'] }
    const apical = { key: 'm', facets: ['apical'] }
    expect(sameLocation(all, apical)).toBe(true)
    expect(sameLocation(apical, all)).toBe(false)
    expect(sameLocation({ key: 'c' }, { key: 'c' })).toBe(true)
    expect(sameLocation({ key: 'c' }, { key: 'd' })).toBe(false)
  })
})
