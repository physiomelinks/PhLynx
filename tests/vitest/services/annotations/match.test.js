import { beforeAll, describe, expect, it } from 'vitest'
import { CHEBI, GO, OPB } from '../../../../src/services/annotations/iris.js'
import {
  compatible,
  groupMatches,
  instanceQuantities,
  isCompleteAnnotation,
  matchCouplings,
  pairQuantities,
  pairing,
  quantitiesFor,
  roleOf,
} from '../../../../src/services/annotations/match.js'
import { sameLocation } from '../../../../src/services/annotations/locate.js'
import { placementsOf } from '../../../../src/services/bioView/placement.js'
import { TOY_MODULES, loadToy } from './toyModel.js'
import { TOY_PLACEMENTS, TOY_TEMPLATES, TOY_TEMPLATE_INSTANCE } from './toyNodes.js'

/** A located quantity, as matching sees one. */
function quantity({ instance, property = OPB.concentration, species = [CHEBI.sodium], location = 'self', ...rest }) {
  return {
    instance,
    variable: `${instance}_x`,
    property,
    species,
    location,
    role: roleOf({ property, location }),
    locations: [{ key: 'k', path: [instance] }],
    ...rest,
  }
}

describe('roleOf', () => {
  it('derives the four roles from the location and whether the property is a flow', () => {
    expect(roleOf({ property: OPB.concentration, location: 'self' })).toBe('owner')
    expect(roleOf({ property: OPB.molarFlowRate, location: `self+${GO.plasmaMembrane}` })).toBe('aggregator')
    expect(roleOf({ property: OPB.concentration, location: GO.cytoplasm })).toBe('reader')
    expect(roleOf({ property: OPB.molarFlowRate, location: GO.extracellularRegion })).toBe('contributor')
  })
})

describe('isCompleteAnnotation', () => {
  it('needs a property and a location, and a species for a property of one', () => {
    expect(isCompleteAnnotation({ property: OPB.concentration, species: [CHEBI.sodium], location: 'self' })).toBe(true)
    expect(isCompleteAnnotation({ property: OPB.concentration, species: [], location: 'self' })).toBe(false)
    expect(isCompleteAnnotation({ property: OPB.fluidVolume, location: 'self' })).toBe(true)
    expect(isCompleteAnnotation({ property: OPB.fluidVolume, location: null })).toBe(false)
    expect(isCompleteAnnotation({ property: null, location: 'self' })).toBe(false)
  })
})

describe('pairing', () => {
  const owner = quantity({ instance: 'pool' })
  const reader = quantity({ instance: 'porter', location: GO.cytoplasm })

  it('links an owner and a reader of the same quantity at the same place, the owner outer', () => {
    expect(pairing(reader, owner)).toMatchObject({ outer: owner, inner: reader, kind: 'link', key: 'k' })
    expect(compatible(owner, reader)).toBe(true)
  })

  it('sums a contributor into an aggregator', () => {
    const aggregator = quantity({ instance: 'pool', property: OPB.molarFlowRate })
    const contributor = quantity({ instance: 'porter', property: OPB.molarFlowRate, location: GO.cytoplasm })
    expect(pairing(aggregator, contributor)).toMatchObject({ outer: aggregator, inner: contributor, kind: 'sum' })
  })

  it('pairs nothing across properties, species or within one instance', () => {
    expect(pairing(owner, quantity({ instance: 'porter', property: OPB.amount, location: GO.cytoplasm }))).toBeNull()
    expect(pairing(owner, quantity({ instance: 'porter', species: [CHEBI.potassium], location: GO.cytoplasm }))).toBeNull()
    expect(pairing(owner, quantity({ instance: 'pool', location: GO.cytoplasm }))).toBeNull()
    expect(pairing(owner, quantity({ instance: 'other' }))).toBeNull()
  })

  it('needs the inner facets to lie within the outer facets when the outer lists some', () => {
    const at = (facets) => [{ key: 'k', path: [], facets }]
    const outer = { ...owner, locations: at(['apical', 'basolateral']) }
    expect(compatible(outer, { ...reader, locations: at(['apical']) })).toBe(true)
    expect(compatible({ ...owner, locations: at(['apical']) }, { ...reader, locations: at(['basolateral']) })).toBe(false)
    expect(compatible(owner, { ...reader, locations: at(['basolateral']) })).toBe(true)
  })
})

describe('sameLocation', () => {
  it('needs equal keys and neither side unresolved', () => {
    expect(sameLocation({ key: 'a' }, { key: 'a' })).toBe(true)
    expect(sameLocation({ key: 'a' }, { key: 'b' })).toBe(false)
    expect(sameLocation({ key: 'a', unresolved: true }, { key: 'a' })).toBe(false)
    expect(sameLocation(null, { key: 'a' })).toBe(false)
  })
})

const HELD = new Set(['outside', 'vessel'])
const tuples = (matches) =>
  matches
    .flatMap((m) => m.couplings.map((c) => `${m.sourceName}.${c.source.variable} -> ${m.targetName}.${c.target.variable}`))
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

describe('matching the toy model placed on an epithelial cell', () => {
  let toy, instances, byName

  /** The toy instances, each at its TOY_PLACEMENTS site, or at another of the template's sites. */
  const placed = (sites = TOY_PLACEMENTS, modules = TOY_MODULES) => {
    const names = Object.keys(sites)
    const nodes = names.map((name) => ({ id: name, data: { name, bioView: { site: `${TOY_TEMPLATE_INSTANCE}/${sites[name]}` } } }))
    const places = placementsOf(nodes, TOY_TEMPLATES)
    return names.map((name) => ({ name, places: places.get(name), sidecar: toy.sidecars.get(modules[name]) }))
  }

  beforeAll(async () => {
    toy = await loadToy()
    instances = placed()
    byName = new Map(instances.map((instance) => [instance.name, instance]))
  })

  const quantity = (name, variable) =>
    quantitiesFor(byName.get(name), byName.get(name).sidecar).find((entry) => entry.variable === variable)

  it('locates one quantity per annotated variable', () => {
    const porter = quantitiesFor(byName.get('porter_in'), byName.get('porter_in').sidecar)
    expect(porter.map((entry) => entry.variable).sort()).toEqual(['area', 'c_A_i', 'c_A_o', 'j_A', 'u', 'v_A_i', 'v_A_o'])
    const lacking = { ...byName.get('porter_in'), variables: ['area', 'c_A_i'] }
    expect(quantitiesFor(lacking, lacking.sidecar).map((entry) => entry.variable).sort()).toEqual(['area', 'c_A_i'])
    expect(quantity('porter_in', 'v_A_i')).toMatchObject({
      instance: 'porter_in',
      property: 'OPB:00592',
      species: ['CHEBI:29101'],
      location: 'GO:0005737',
      role: 'contributor',
      mathRef: 'porter.cellml:porter',
      locations: [{ key: 'site:bt-toy/cell', label: 'Epithelial cell' }],
    })
  })

  it('pairs complementary roles at one place', () => {
    expect(compatible(quantity('outside', 'c_A'), quantity('porter_in', 'c_A_o'))).toBe(true)
    expect(pairing(quantity('cell', 'v_A'), quantity('porter_in', 'v_A_i'))).toMatchObject({
      kind: 'sum',
      outer: { instance: 'cell', variable: 'v_A' },
    })
    expect(compatible(quantity('wall', 'u'), quantity('porter_out', 'u'))).toBe(true)
    // The cytoplasm is not the apical fluid.
    expect(compatible(quantity('outside', 'c_A'), quantity('porter_in', 'c_A_i'))).toBe(false)
    // An owner's facets must cover the reader's.
    const narrow = {
      ...quantity('wall', 'u'),
      locations: quantity('wall', 'u').locations.map((location) => ({ ...location, facets: ['apical'] })),
    }
    expect(compatible(narrow, quantity('porter_out', 'u'))).toBe(false)
    expect(compatible(narrow, quantity('porter_in', 'u'))).toBe(true)
  })

  it('matches every toy edge, oriented by place rank', () => {
    const { matches, conflicts, unresolved } = matchCouplings(instances, { heldConstant: HELD })
    expect(conflicts).toEqual([])
    expect(tuples(matches)).toEqual(TOY_COUPLINGS)
    expect(matches.map((m) => m.key)).toEqual([
      'outside->porter_in',
      'porter_in->cell',
      'porter_in->wall',
      'cell->porter_out',
      'wall->porter_out',
      'porter_out->vessel',
    ])
    // The apical and basolateral fluids have no plasma membrane to place their area on.
    expect(unresolved).toEqual([
      { instance: 'outside', variable: 'area', location: 'self+GO:0005886' },
      { instance: 'vessel', variable: 'area', location: 'self+GO:0005886' },
    ])
  })

  it('adds the outer fluxes when nothing is held constant', () => {
    const extra = tuples(matchCouplings(instances).matches).filter((tuple) => !TOY_COUPLINGS.includes(tuple))
    expect(extra).toEqual(['outside.v_A -> porter_in.v_A_o', 'porter_out.v_A_o -> vessel.v_A'])
  })

  it('reports owner conflicts and ambiguous readers', () => {
    const twin = { ...byName.get('cell'), name: 'cell_twin' }
    const { matches, conflicts } = matchCouplings([...instances, twin], { heldConstant: HELD })
    expect(conflicts.map((c) => [c.a.instance, c.b.instance, c.a.variable].join(' '))).toEqual(
      expect.arrayContaining(['cell cell_twin c_A', 'cell cell_twin volume', 'cell cell_twin v_A', 'cell cell_twin area'])
    )
    const reader = matches.find((m) => m.key === 'porter_in->cell').couplings.find((c) => c.source.variable === 'c_A_i')
    expect(reader.ambiguous).toBe(true)
    expect(matches.find((m) => m.key === 'outside->porter_in').couplings[0].ambiguous).toBeUndefined()
  })

  it('keeps membranes on disjoint facets apart and flags overlapping ones', () => {
    const split = (wallFacets) => {
      const onFacets = (instance, facets) => ({
        ...instance,
        places: instance.places.map((place) => (place.kind === 'membrane' ? { ...place, facets } : place)),
      })
      const wall = onFacets(byName.get('wall'), wallFacets)
      const wallBas = onFacets({ ...byName.get('wall'), name: 'wall_bas' }, ['basolateral'])
      return matchCouplings([...instances.filter((i) => i.name !== 'wall'), wall, wallBas], { heldConstant: HELD })
    }

    const disjoint = split(['apical'])
    expect(disjoint.conflicts).toEqual([])
    expect(tuples(disjoint.matches).filter((tuple) => tuple.includes('.u '))).toEqual([
      'porter_in.u -> wall.u',
      'wall_bas.u -> porter_out.u',
    ])

    const overlapping = split(['apical', 'basolateral'])
    expect(overlapping.conflicts.map((c) => `${c.a.instance} ${c.b.instance} ${c.a.variable}`).sort()).toEqual([
      'wall wall_bas i_tot',
      'wall wall_bas u',
    ])
    const ambiguous = overlapping.matches
      .flatMap((m) => m.couplings)
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

  it('ignores instances without places or a sidecar', () => {
    const loose = [
      { name: 'loose', places: [], sidecar: toy.sidecars.get('pool') },
      { name: 'bare', places: byName.get('cell').places, sidecar: null },
    ]
    expect(tuples(matchCouplings([...instances, ...loose], { heldConstant: HELD }).matches)).toEqual(TOY_COUPLINGS)
  })

  it('pairs a changed instance against the rest as a full pairing does', () => {
    const quantities = instances.flatMap((instance) => instanceQuantities(instance, {}, HELD.has(instance.name)))
    const full = pairQuantities(quantities)
    const others = pairQuantities(quantities.filter((q) => q.instance !== 'wall'))
    const wall = pairQuantities(quantities, { involving: new Set(['wall']) })
    expect(wall.pairs.every((pair) => pair.outer.instance === 'wall' || pair.inner.instance === 'wall')).toBe(true)
    expect(wall.pairs.length + others.pairs.length).toBe(full.pairs.length)
    const grouped = groupMatches([...others.pairs, ...wall.pairs], byName)
    expect(tuples(grouped)).toEqual(tuples(matchCouplings(instances, { heldConstant: HELD }).matches))
  })
})
