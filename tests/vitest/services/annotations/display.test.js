import { describe, expect, it } from 'vitest'
import {
  annotationChips,
  fromAnnotationTitle,
  locationText,
  placeText,
  resolvedPlaces,
  subjectText,
  termDetail,
} from '../../../../src/services/annotations/display.js'

describe('annotation display', () => {
  it('makes species, property and location chips from the label provider', () => {
    const chips = annotationChips({ property: 'OPB:00340', species: ['CHEBI:29101'], location: 'GO:0005737' })
    expect(chips).toEqual([
      { kind: 'species', text: 'Na⁺', curie: 'CHEBI:29101' },
      { kind: 'property', text: 'concentration', curie: 'OPB:00340' },
      { kind: 'location', text: 'cytoplasm', curie: 'GO:0005737' },
    ])
  })

  it('falls back to the CURIE for a term without a label', () => {
    const [species] = annotationChips({
      property: 'OPB:00340',
      species: ['http://purl.obolibrary.org/obo/CHEBI_1'],
      location: 'self',
    })
    expect(species.text).toBe('CHEBI:1')
  })

  it('names self locations', () => {
    expect(locationText('self')).toBe('self')
    expect(locationText('self+GO:0005886')).toBe('plasma membrane (self)')
    expect(locationText(null)).toBe('unlocated')
    expect(locationText('self', 'this membrane')).toBe('this membrane')
    expect(locationText('self+GO:0005886', 'this compartment')).toBe('plasma membrane of this compartment')
    expect(annotationChips({ location: 'self' }, { selfName: 'this compartment' })).toEqual([
      { kind: 'location', text: 'this compartment' },
    ])
  })

  it('describes resolved places by their labels', () => {
    expect(placeText({ key: 'apical-fluid', label: 'apical fluid' })).toBe('apical fluid')
    expect(placeText({ key: 'cell-membrane', facets: ['apical'] })).toBe('cell-membrane (apical)')
    expect(placeText(null)).toBe('unresolved')
    expect(
      resolvedPlaces({
        locations: [{ key: 'lumen', label: 'lumen', path: ['epithelium', 'lumen'] }],
      })
    ).toEqual([{ text: 'lumen', path: 'epithelium → lumen', unresolved: false }])
    expect(resolvedPlaces(null)).toEqual([])
    const chips = annotationChips({ property: 'OPB:00340', location: null, absoluteLocation: { key: 'c', label: 'cytosol' } })
    expect(chips.at(-1)).toEqual({ kind: 'location', text: 'cytosol' })
  })

  it('lists a term with its label, CURIE and IRI', () => {
    expect(termDetail('GO:0005886')).toEqual({
      curie: 'GO:0005886',
      label: 'plasma membrane',
      iri: 'https://identifiers.org/go/GO:0005886',
    })
  })

  it('titles locked controls with the annotation’s role and mode', () => {
    expect(fromAnnotationTitle({ multiportType: 'Sum', annotation: { role: 'aggregator' } })).toBe(
      'From annotation: aggregator, multiport, summed'
    )
    expect(fromAnnotationTitle({})).toBe('From annotation')
  })

  it('writes sidecar subjects relative to their module file', () => {
    expect(subjectText('https://phlynx.invalid/modules/m.cellml#m.v')).toBe('./m.cellml#m.v')
    expect(subjectText('http://example.org/x#y')).toBe('http://example.org/x#y')
  })
})
