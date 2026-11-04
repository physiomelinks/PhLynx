import { describe, expect, it } from 'vitest'
import { SPECIES_ALIASES, parseSpeciesTerm, searchSpecies, speciesToken } from '../../../../src/services/annotations/species.js'

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

  it('offers inorganic phosphate as Pi ahead of hydrogenphosphate', () => {
    const curies = searchSpecies('phosphate').map((item) => item.curie)
    expect(curies.indexOf('CHEBI:24838')).toBeLessThan(curies.indexOf('CHEBI:43474'))
    expect(searchSpecies('pi')[0]).toEqual({ curie: 'CHEBI:24838', label: 'Pi', source: 'table' })
    expect(searchSpecies('hydrogenphosphate').map((item) => item.curie)).toEqual(['CHEBI:43474'])
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

  it('gives every pinned species a unique ChEBI CURIE', () => {
    const curies = SPECIES_ALIASES.map((entry) => entry.curie)
    expect(new Set(curies).size).toBe(curies.length)
    for (const curie of curies) expect(parseSpeciesTerm(curie)).toBe(curie)
  })

  it('gives inorganic phosphate and hydrogenphosphate distinct tokens', () => {
    expect(speciesToken('CHEBI:24838')).toBe('Pi')
    expect(speciesToken('http://purl.obolibrary.org/obo/CHEBI_43474')).toBe('HPO4')
    const tokens = SPECIES_ALIASES.map((entry) => speciesToken(entry.curie))
    expect(new Set(tokens).size).toBe(tokens.length)
  })
})
