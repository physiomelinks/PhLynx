import { beforeAll, describe, expect, it } from 'vitest'
import { locate, lyphKey, sameLocation, scopeKey, shortName } from '../../../../src/services/annotations/locate.js'
import { loadToy } from './toyModel.js'

const S = 'UBERON:0000025,UBERON:0000483'
const CELL = `${S}/CL:0000066`

describe('locate', () => {
  let coordOf, context

  beforeAll(async () => {
    const toy = await loadToy()
    context = { coords: toy.coords, scopes: toy.scopes }
    const byName = new Map(toy.instances.map((instance) => [instance.name, instance.coord]))
    coordOf = (name) => byName.get(name)
  })

  const keys = (name, location) => locate(coordOf(name), location, context).map((entry) => entry.key)

  it('keys a scope by its sorted anatomy terms', () => {
    const scope = coordOf('outside').scope
    expect(scopeKey(scope, context.scopes)).toBe(S)
    expect(scopeKey('https://example.org/unknown-scope', context.scopes)).toBe('https://example.org/unknown-scope')
    expect(scopeKey(null, context.scopes)).toBeNull()
  })

  it('places self on a layer, a cell, a lyph and a facet-layer', () => {
    expect(locate(coordOf('outside'), 'self', context)).toEqual([
      { key: `layer:${S}:0`, confidence: 'high', path: ['coord_outside', 'scope_tube'] },
    ])
    expect(keys('cell', 'self')).toEqual([`cyto:${CELL}`])
    expect(keys('vessel', 'self')).toEqual(['lyph:https://example.org/toy/ids/lyph-toy-vessel'])
    expect(locate(coordOf('wall'), 'self', context)).toEqual([
      {
        key: `pm:${CELL}`,
        facets: ['apical', 'lateral', 'basolateral'],
        confidence: 'high',
        path: ['coord_wall', 'coord_cell', 'scope_tube'],
      },
    ])
  })

  it("places a cell's own plasma membrane on every facet", () => {
    expect(locate(coordOf('cell'), 'self+GO:0005886', context)).toMatchObject([
      { key: `pm:${CELL}`, facets: ['apical', 'lateral', 'basolateral'], confidence: 'high' },
    ])
    expect(locate(coordOf('outside'), 'self+GO:0005886', context)).toEqual([])
    expect(locate(coordOf('vessel'), 'self+GO:0005886', context)).toEqual([])
  })

  it('places a deployment relative to its cell', () => {
    expect(keys('porter_in', 'GO:0005737')).toEqual([`cyto:${CELL}`])
    expect(locate(coordOf('porter_out'), 'GO:0005886', context)).toMatchObject([
      { key: `pm:${CELL}`, facets: ['basolateral'], confidence: 'high' },
    ])
    expect(keys('porter_in', 'self')).toEqual([])
    expect(keys('wall', 'GO:0005737')).toEqual([`cyto:${CELL}`])
  })

  it('faces an apical deployment onto layer 0 and leaves the basolateral side unresolved', () => {
    const [apical] = locate(coordOf('porter_in'), 'GO:0005576', context)
    expect(apical).toMatchObject({ key: `layer:${S}:0`, confidence: 'high' })
    expect(apical.path).toContain('apical facet faces layer 0 of the host')

    const [basolateral] = locate(coordOf('porter_out'), 'GO:0005576', context)
    expect(basolateral).toMatchObject({ key: `extra-basolateral:${CELL}`, unresolved: true, confidence: 'low' })

    const lateral = { ...coordOf('porter_in'), facets: ['lateral'] }
    expect(locate(lateral, 'GO:0005576', context)).toEqual([])
  })

  it('returns nothing without a coordinate or a known cell', () => {
    expect(locate(undefined, 'self', context)).toEqual([])
    expect(locate(coordOf('porter_in'), 'GO:0005737', { coords: new Map(), scopes: context.scopes })).toEqual([])
  })

  it('compares plasma-membrane facets as a subset', () => {
    const all = { key: 'pm:x', facets: ['apical', 'lateral', 'basolateral'] }
    const apical = { key: 'pm:x', facets: ['apical'] }
    expect(sameLocation(all, apical)).toBe(true)
    expect(sameLocation(apical, all)).toBe(false)
    expect(sameLocation({ key: 'cyto:x' }, { key: 'cyto:x' })).toBe(true)
    expect(sameLocation({ key: 'cyto:x' }, { key: 'cyto:y' })).toBe(false)
    expect(sameLocation({ key: 'e:x', unresolved: true }, { key: 'e:x', unresolved: true })).toBe(false)
  })

  it('names IRIs and lyphs', () => {
    expect(shortName('https://a.org/x/apicoords.rdf#coord_cell')).toBe('coord_cell')
    expect(shortName('https://a.org/x/lyph-1')).toBe('lyph-1')
    expect(lyphKey({ iri: 'urn:l', origin: [], template: 'urn:t' })).toBe('lyph:urn:t')
    expect(lyphKey({ iri: 'urn:l', origin: [] })).toBe('lyph:urn:l')
  })
})
