import { describe, expect, it } from 'vitest'
import { CHEBI, GO, OPB } from '../../../../src/services/annotations/iris.js'
import { compatible, isCompleteAnnotation, pairing, roleOf } from '../../../../src/services/annotations/match.js'
import { sameLocation } from '../../../../src/services/annotations/locate.js'

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
