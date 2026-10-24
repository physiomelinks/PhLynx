import { beforeAll, describe, expect, it } from 'vitest'
import {
  compatible,
  pairing,
  quantitiesFor,
  rankOf,
  resolveFacing,
  roleOf,
  suggestCouplings,
  suggestionKey,
} from '../../../../src/services/annotations/match.js'
import { loadToy, readToy } from './toyModel.js'

const HELD = new Set(['outside', 'vessel'])
const tuples = (suggestions) =>
  suggestions
    .flatMap((s) =>
      s.couplings.map((c) => `${s.sourceName}.${c.source.variable} -> ${s.targetName}.${c.target.variable}`)
    )
    .sort()

// The toy couplings with the outside pool and the vessel held constant.
const TOY_COUPLINGS = [
  'cell.area -> porter_out.area',
  'cell.c_A -> porter_out.c_A_i',
  'cell.v_A -> porter_out.v_A_i',
  'outside.c_A -> porter_in.c_A_o',
  'porter_in.area -> cell.area',
  'porter_in.c_A_i -> cell.c_A',
  'porter_in.j_A -> wall.i_tot',
  'porter_in.u -> wall.u',
  'porter_in.v_A_i -> cell.v_A',
  'porter_out.c_A_o -> vessel.c_A',
  'wall.i_tot -> porter_out.j_A',
  'wall.u -> porter_out.u',
]

describe('roleOf', () => {
  it('derives roles from location and flow', () => {
    expect(roleOf({ property: 'OPB:00340', location: 'self' })).toBe('owner')
    expect(roleOf({ property: 'OPB:00295', location: 'self+GO:0005886' })).toBe('owner')
    expect(roleOf({ property: 'OPB:00592', location: 'self' })).toBe('aggregator')
    expect(roleOf({ property: 'OPB:00318', location: 'self' })).toBe('aggregator')
    expect(roleOf({ property: 'OPB:00340', location: 'GO:0005737' })).toBe('reader')
    expect(roleOf({ property: 'OPB:00592', location: 'GO:0005576' })).toBe('contributor')
  })
})

describe('matching the toy model', () => {
  let toy, context, byName

  beforeAll(async () => {
    toy = await loadToy()
    context = { coords: toy.coords, scopes: toy.scopes }
    byName = new Map(toy.instances.map((instance) => [instance.name, instance]))
  })

  const quantity = (name, variable) => {
    const instance = byName.get(name)
    return resolveFacing(quantitiesFor(instance, instance.sidecar, context), toy.instances).find(
      (entry) => entry.variable === variable
    )
  }

  it('locates one quantity per annotated variable', () => {
    const porter = quantitiesFor(byName.get('porter_in'), byName.get('porter_in').sidecar, context)
    expect(porter.map((entry) => entry.variable).sort()).toEqual([
      'area',
      'c_A_i',
      'c_A_o',
      'j_A',
      'u',
      'v_A_i',
      'v_A_o',
    ])
    expect(porter.find((entry) => entry.variable === 'v_A_i')).toMatchObject({
      instance: 'porter_in',
      property: 'OPB:00592',
      species: ['CHEBI:29101'],
      location: 'GO:0005737',
      role: 'contributor',
      mathRef: 'porter.cellml:porter',
    })
  })

  it('pairs complementary roles at one place', () => {
    expect(compatible(quantity('outside', 'c_A'), quantity('porter_in', 'c_A_o'))).toBe(true)
    expect(pairing(quantity('cell', 'v_A'), quantity('porter_in', 'v_A_i'))).toMatchObject({
      kind: 'sum',
      confidence: 'high',
      outer: { instance: 'cell', variable: 'v_A' },
    })
    expect(compatible(quantity('wall', 'u'), quantity('porter_out', 'u'))).toBe(true)
  })

  it('refuses mismatched property, species, place or roles', () => {
    // Reader with reader, contributor with contributor.
    expect(compatible(quantity('porter_in', 'c_A_i'), quantity('porter_out', 'c_A_i'))).toBe(false)
    expect(compatible(quantity('porter_in', 'v_A_i'), quantity('porter_out', 'v_A_i'))).toBe(false)
    // Same place, different property.
    expect(compatible(quantity('cell', 'c_A'), quantity('porter_in', 'v_A_i'))).toBe(false)
    // Same property, different place: the cytoplasm is not the outside layer.
    expect(compatible(quantity('outside', 'c_A'), quantity('porter_in', 'c_A_i'))).toBe(false)
    // Different species.
    const other = { ...quantity('porter_in', 'c_A_o'), species: ['CHEBI:29103'] }
    expect(compatible(quantity('outside', 'c_A'), other)).toBe(false)
    // An owner's facets must cover the reader's.
    const narrow = {
      ...quantity('wall', 'u'),
      locations: [{ key: quantity('wall', 'u').locations[0].key, facets: ['apical'], confidence: 'high', path: [] }],
    }
    expect(compatible(narrow, quantity('porter_out', 'u'))).toBe(false)
    expect(compatible(narrow, quantity('porter_in', 'u'))).toBe(true)
    // Never within one instance.
    expect(compatible(quantity('cell', 'c_A'), { ...quantity('porter_in', 'c_A_i'), instance: 'cell' })).toBe(false)
  })

  it('suggests every toy edge, oriented by rank', () => {
    const { suggestions, conflicts, unresolved } = suggestCouplings(toy.instances, { ...context, heldConstant: HELD })
    expect(conflicts).toEqual([])
    expect(tuples(suggestions)).toEqual(TOY_COUPLINGS)
    expect(suggestions.map((s) => s.key)).toEqual([
      'outside->porter_in',
      'porter_in->cell',
      'porter_in->wall',
      'cell->porter_out',
      'wall->porter_out',
      'porter_out->vessel',
    ])
    // The outside and the vessel have no plasma membrane to place their area on.
    expect(unresolved).toEqual([
      { instance: 'outside', variable: 'area', location: 'self+GO:0005886' },
      { instance: 'vessel', variable: 'area', location: 'self+GO:0005886' },
    ])
  })

  it('marks the coalesced-lyph fallback as low confidence with a reason', () => {
    const { suggestions } = suggestCouplings(toy.instances, { ...context, heldConstant: HELD })
    const vessel = suggestions.find((s) => s.targetName === 'vessel')
    expect(vessel.confidence).toBe('low')
    expect(vessel.why).toMatch(/vessel is the only lyph with api:coalescedWith/)
    expect(vessel.couplings[0].place.sourcePath).toContain('coord_vessel (coalesced lyph)')
    expect(suggestions.filter((s) => s.confidence === 'low')).toHaveLength(1)
  })

  it('leaves the basolateral side unresolved without exactly one coalesced lyph', async () => {
    const twoLyphs = await loadToy(
      `${readToy('toy-apicoords.ttl')}
model:vessel2 bqbiol:is local:coord_vessel2 .
local:coord_vessel2 a api:ApiCoord ; api:kind "lyph" ; api:origin <https://example.org/toy/ids/lyph-toy-vessel-2> ;
    api:coalescedWith <https://example.org/toy/ids/coalescence-toy> .
`
    )
    const instances = twoLyphs.instances.map((instance) =>
      instance.name === 'vessel2' ? { ...instance, sidecar: twoLyphs.sidecars.get('pool') } : instance
    )
    const { suggestions, unresolved } = suggestCouplings(instances, {
      coords: twoLyphs.coords,
      scopes: twoLyphs.scopes,
      heldConstant: new Set([...HELD, 'vessel2']),
    })
    expect(suggestions.some((s) => s.targetName.startsWith('vessel'))).toBe(false)
    expect(unresolved).toContainEqual({ instance: 'porter_out', variable: 'c_A_o', location: 'GO:0005576' })

    const noVessel = toy.instances.filter((instance) => instance.name !== 'vessel')
    expect(suggestCouplings(noVessel, context).unresolved).toContainEqual({
      instance: 'porter_out',
      variable: 'v_A_o',
      location: 'GO:0005576',
    })
  })

  it('adds the outer fluxes when nothing is held constant', () => {
    const { suggestions } = suggestCouplings(toy.instances, context)
    const extra = tuples(suggestions).filter((tuple) => !TOY_COUPLINGS.includes(tuple))
    expect(extra).toEqual(['outside.v_A -> porter_in.v_A_o', 'porter_out.v_A_o -> vessel.v_A'])
  })

  it('reports owner conflicts and ambiguous readers', () => {
    const cell = byName.get('cell')
    const twin = { ...cell, name: 'cell_twin' }
    const { suggestions, conflicts } = suggestCouplings([...toy.instances, twin], { ...context, heldConstant: HELD })
    expect(conflicts.map((c) => [c.a.instance, c.b.instance, c.a.variable].join(' '))).toEqual(
      expect.arrayContaining([
        'cell cell_twin c_A',
        'cell cell_twin volume',
        'cell cell_twin v_A',
        'cell cell_twin area',
      ])
    )
    const reader = suggestions
      .find((s) => s.key === 'porter_in->cell')
      .couplings.find((c) => c.source.variable === 'c_A_i')
    expect(reader.ambiguous).toBe(true)
    const outside = suggestions.find((s) => s.key === 'outside->porter_in').couplings[0]
    expect(outside.ambiguous).toBeUndefined()
  })

  it('keeps membranes on disjoint facets apart and flags overlapping ones', async () => {
    const split = (wallFacets) =>
      loadToy(
        `${readToy('toy-apicoords.ttl').replace('api:facet "basolateral" , "apical" , "lateral"', `api:facet ${wallFacets}`)}
model:wall_bas bqbiol:is local:coord_wall_bas .
local:coord_wall_bas a api:ApiCoord ; api:kind "facet-layer" ; api:within local:coord_cell ;
    api:facet "basolateral" ; api:layerIndex 1 ; api:material <http://purl.obolibrary.org/obo/GO_0005886> .
`
      ).then((model) => ({
        ...model,
        instances: model.instances.map((instance) =>
          instance.name === 'wall_bas' ? { ...instance, sidecar: model.sidecars.get('wall') } : instance
        ),
      }))
    const run = (model) =>
      suggestCouplings(model.instances, { coords: model.coords, scopes: model.scopes, heldConstant: HELD })

    const disjoint = run(await split('"apical"'))
    expect(disjoint.conflicts).toEqual([])
    const voltage = tuples(disjoint.suggestions).filter((tuple) => tuple.includes('.u '))
    expect(voltage).toEqual(['porter_in.u -> wall.u', 'wall_bas.u -> porter_out.u'])

    const overlapping = run(await split('"apical" , "basolateral"'))
    expect(overlapping.conflicts.map((c) => `${c.a.instance} ${c.b.instance} ${c.a.variable}`).sort()).toEqual([
      'wall wall_bas i_tot',
      'wall wall_bas u',
    ])
    const ambiguous = overlapping.suggestions
      .flatMap((s) => s.couplings)
      .filter((c) => c.ambiguous)
      .map((c) => c.key)
      .sort()
    expect(ambiguous).toEqual([
      'wall->porter_out:i_tot->j_A',
      'wall->porter_out:u->u',
      'wall_bas->porter_out:i_tot->j_A',
      'wall_bas->porter_out:u->u',
    ])
  })

  it('skips existing couplings and dismissed suggestions', () => {
    const existingEdges = [
      {
        source: 'cell',
        target: 'porter_in',
        data: { couplings: [{ sourcePort: { variables: ['c_A'] }, targetPort: { variables: ['c_A_i'] } }] },
      },
    ]
    const dismissed = new Set([
      suggestionKey('wall', 'porter_out'),
      suggestionKey('porter_in', 'cell', ['area', 'area']),
    ])
    const { suggestions } = suggestCouplings(toy.instances, {
      ...context,
      heldConstant: HELD,
      existingEdges,
      dismissed,
    })
    expect(suggestions.find((s) => s.key === 'wall->porter_out')).toBeUndefined()
    expect(suggestions.find((s) => s.key === 'porter_in->cell').couplings.map((c) => c.source.variable)).toEqual([
      'v_A_i',
    ])
  })

  it('ignores instances without a coordinate or sidecar', () => {
    const { suggestions } = suggestCouplings([...toy.instances, { name: 'loose', sidecar: toy.sidecars.get('pool') }], {
      ...context,
      heldConstant: HELD,
    })
    expect(tuples(suggestions)).toEqual(TOY_COUPLINGS)
  })

  it('ranks coordinates', () => {
    expect(rankOf(byName.get('outside').coord)).toBe(0)
    expect(rankOf(byName.get('porter_in').coord)).toBe(1)
    expect(rankOf(byName.get('cell').coord)).toBe(2)
    expect(rankOf(byName.get('wall').coord)).toBe(2)
    expect(rankOf(byName.get('porter_out').coord)).toBe(3)
    expect(rankOf(byName.get('vessel').coord)).toBe(4)
    expect(rankOf(undefined)).toBe(5)
  })
})
