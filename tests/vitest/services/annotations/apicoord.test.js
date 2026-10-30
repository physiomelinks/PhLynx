import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const toy = readFileSync(resolve(TOY, 'toy-apicoords.ttl'), 'utf8')
const BASE = 'https://phlynx.invalid/apicoords/'

const HEAD = `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix api: <https://apinatomy.org/uris/elements/> .
@prefix model: <./model.cellml#> .
@prefix local: <./apicoords.rdf#> .
`

describe('parseApiCoords', () => {
  it('reads every instance and normalises each kind', async () => {
    const { instances, coords, scopes, warnings } = await parseApiCoords(toy)
    expect(warnings).toEqual([])
    expect(instances.map((instance) => instance.name)).toEqual([
      'outside',
      'cell',
      'wall',
      'porter_in',
      'porter_out',
      'vessel',
    ])
    expect(instances[0]).toMatchObject({
      subject: `${BASE}model.cellml#outside`,
      coordIri: `${BASE}apicoords.rdf#coord_outside`,
    })
    expect(coords.size).toBe(6)

    const scopeIri = `${BASE}apicoords.rdf#scope_tube`
    expect(scopes.get(scopeIri)).toMatchObject({
      anatomy: ['UBERON:0000025', 'UBERON:0000483'],
      closure: 'part_of,is_a',
    })

    const coord = (name) => instances.find((instance) => instance.name === name).coord
    expect(coord('outside')).toMatchObject({ kind: 'layer', scope: scopeIri, layerIndex: 0 })
    expect(coord('outside').material).toBe('https://example.org/toy/ids/mat-toy-fluid')
    expect(coord('cell')).toMatchObject({
      kind: 'cell',
      scope: scopeIri,
      cell: 'CL:0000066',
      chainShape: 'bag-tube-bag',
    })
    expect(coord('wall')).toMatchObject({
      kind: 'facet-layer',
      within: `${BASE}apicoords.rdf#coord_cell`,
      facets: ['apical', 'lateral', 'basolateral'],
      layerIndex: 1,
      material: 'GO:0005886',
    })
    expect(coord('porter_in')).toMatchObject({
      kind: 'deployment',
      facets: ['apical'],
      protein: 'uniprot:Q0TOY1',
      label: 'porter',
      regions: ['extracellular', 'transmembrane', 'cytoplasmic'],
    })
    expect(coord('porter_out')).toMatchObject({ facets: ['basolateral'], protein: 'uniprot:Q0TOY1', label: null })
    expect(coord('vessel')).toMatchObject({
      kind: 'lyph',
      anatomy: ['UBERON:0001982'],
      conveys: 'UBERON:0000178',
      coalescedWith: ['https://example.org/toy/ids/coalescence-toy'],
      origin: ['https://example.org/toy/ids/lyph-toy-vessel'],
    })
  })

  it('accepts api:scope on a layer', async () => {
    const text = toy.replace(
      'api:within local:scope_tube ;\n    api:layerIndex 0',
      'api:scope local:scope_tube ;\n    api:layerIndex 0'
    )
    expect(text).not.toBe(toy)
    const { instances, warnings } = await parseApiCoords(text)
    expect(warnings).toEqual([])
    expect(instances[0].coord.scope).toBe(`${BASE}apicoords.rdf#scope_tube`)
  })

  it('collects malformed coordinates as warnings', async () => {
    const { instances, warnings } = await parseApiCoords(`${HEAD}
model:a bqbiol:is local:a .
local:a a api:ApiCoord ; api:kind "deployment" ; api:facet "inner" .
model:b bqbiol:is local:b .
local:b a api:ApiCoord ; api:kind "layer" ; api:layerIndex "x" .
model:c bqbiol:is local:c .
local:c a api:ApiCoord ; api:kind "wormhole" .
model:d bqbiol:is local:d .
local:d a api:ApiCoord ; api:kind "deployment" ; api:within local:b ; api:facet "apical" ; api:protein <http://identifiers.org/uniprot/P1> .
model:a bqbiol:is local:d .
model:e bqbiol:is <https://example.org/not-a-coord> .`)
    expect(instances.map((instance) => instance.name)).toEqual(['a', 'b', 'c', 'd', 'a'])
    const messages = warnings.map((warning) => `${warning.subject?.split('#')[1]}: ${warning.message}`)
    expect(messages).toEqual(
      expect.arrayContaining([
        'a: Unknown api:facet inner.',
        'a: A deployment needs api:within a cell coordinate.',
        'a: A deployment needs api:facet.',
        'a: A deployment needs api:protein.',
        'b: A layer needs one api:scope or api:within, found 0.',
        "b: api:layerIndex 'x' is not an integer.",
        "c: Unknown api:kind 'wormhole'.",
        'd: api:within https://phlynx.invalid/apicoords/apicoords.rdf#b is not a cell coordinate.',
        "a: The instance 'a' is placed twice.",
      ])
    )
  })

  it('warns on a syntax error or a file without instances', async () => {
    expect((await parseApiCoords('local:a a .')).warnings[0].message).toMatch(/Could not parse/)
    expect((await parseApiCoords(HEAD)).warnings[0].message).toMatch(/No instance/)
  })
})
