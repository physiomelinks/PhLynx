import { describe, expect, it } from 'vitest'
import { SPECIES_ALIASES, parseSpeciesTerm, searchSpecies } from '../../../../src/services/annotations/species.js'
import { displayLabel } from '../../../../src/services/annotations/labels.js'

describe('parseSpeciesTerm', () => {
  it.each([
    ['CHEBI:29101', 'CHEBI:29101'],
    ['chebi_29101', 'CHEBI:29101'],
    [' http://purl.obolibrary.org/obo/CHEBI_29101 ', 'CHEBI:29101'],
    ['http://identifiers.org/CHEBI:29101', 'CHEBI:29101'],
    ['GO:0005737', null],
    ['sodium', null],
    ['', null],
  ])('reads %j as %j', (text, curie) => {
    expect(parseSpeciesTerm(text)).toBe(curie)
  })
})

describe('searchSpecies', () => {
  it('matches labels, aliases and CURIEs, ignoring case', () => {
    expect(searchSpecies('sodium')[0].curie).toBe('CHEBI:29101')
    expect(searchSpecies('GLC').map((item) => item.curie)).toEqual(['CHEBI:17634'])
    expect(searchSpecies('29103')[0].curie).toBe('CHEBI:29103')
  })

  it('puts a pasted term first, then workspace terms, without repeats', () => {
    const results = searchSpecies('', { workspaceTerms: ['CHEBI:29103', 'CHEBI:99999'], labelOf: (curie) => `label ${curie}` })
    expect(results.slice(0, 2)).toEqual([
      { curie: 'CHEBI:29103', label: 'K⁺', source: 'workspace' },
      { curie: 'CHEBI:99999', label: 'label CHEBI:99999', source: 'workspace' },
    ])
    expect(results.filter((item) => item.curie === 'CHEBI:29103')).toHaveLength(1)
    expect(searchSpecies('CHEBI:29103', { workspaceTerms: ['CHEBI:29103'] })[0].source).toBe('pasted')
  })

  it('gives every pinned species a unique ChEBI CURIE and a label', () => {
    const curies = SPECIES_ALIASES.map((entry) => entry.curie)
    expect(new Set(curies).size).toBe(curies.length)
    for (const curie of curies) expect(parseSpeciesTerm(curie)).toBe(curie)
    expect(displayLabel('CHEBI:29108')).toBe('Ca²⁺')
  })
})
