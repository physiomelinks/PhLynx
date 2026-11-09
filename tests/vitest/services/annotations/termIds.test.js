import { describe, expect, it, vi } from 'vitest'

import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import {
  entryTerms,
  findUnknownTerms,
  sidecarTerms,
  termIdProblem,
  termIdProblems,
} from '../../../../src/services/annotations/termIds.js'
import { readToy } from './toyModel.js'

describe('termIdProblem', () => {
  it('passes ids that fit their ontology', () => {
    for (const curie of ['OPB:00340', 'GO:0006096', 'CHEBI:29101', 'SBO:0000290', 'uniprot:P13866', 'ILX:0101431']) {
      expect(termIdProblem(curie)).toBeNull()
    }
  })

  it('says which ids do not fit, with one that does', () => {
    expect(termIdProblem('OPB:0006096')).toBe('OPB:0006096 doesn’t fit OPB’s ids, such as OPB:00340')
    expect(termIdProblem('GO:5737')).toMatch(/such as GO:0005737$/)
    expect(termIdProblem('CHEBI:x29101')).toMatch(/^CHEBI:x29101 doesn’t fit/)
    expect(termIdProblem('uniprot:p13866')).toMatch(/such as uniprot:P13866$/)
  })

  it('leaves terms of other ontologies, and places that are not terms, alone', () => {
    expect(termIdProblem('http://example.org/thing')).toBeNull()
    expect(termIdProblem('_:b0')).toBeNull()
    expect(termIdProblem(null)).toBeNull()
  })
})

describe('entryTerms', () => {
  it('lists the property, species and places, not the module itself', () => {
    const entry = { property: 'OPB:00592', species: ['CHEBI:29101'], location: 'self+GO:0005737', from: 'GO:0005576' }
    expect(entryTerms(entry)).toEqual(['OPB:00592', 'CHEBI:29101', 'GO:0005737', 'GO:0005576'])
    expect(entryTerms({ property: 'OPB:00154', species: [], location: 'self' })).toEqual(['OPB:00154'])
    expect(entryTerms(null)).toEqual([])
  })
})

describe('sidecarTerms', () => {
  it('lists every term a toy side-car cites, all of them well formed', async () => {
    for (const name of ['pool', 'wall', 'porter']) {
      const sidecar = await parseSidecar(readToy(`${name}.ttl`), {
        mathRef: `${name}.cellml:${name}`,
        cellml: readToy(`${name}.cellml`),
      })
      const terms = sidecarTerms(sidecar)
      expect(terms.length).toBeGreaterThan(0)
      expect(termIdProblems(terms)).toEqual([])
    }
  })

  it('names the module or variable that cites a malformed id', async () => {
    const text = readToy('porter.ttl')
      .replace('OPB_00592>', 'OPB_0006096>')
      .replace('<http://identifiers.org/GO:0005412>', '<http://identifiers.org/GO:5412>')
    const sidecar = await parseSidecar(text, { mathRef: 'porter.cellml:porter', cellml: readToy('porter.cellml') })
    expect(termIdProblems(sidecarTerms(sidecar)).map(({ where, curie }) => [where, curie])).toEqual([
      ['porter', 'GO:5412'],
      ['v_A_i', 'OPB:0006096'],
    ])
  })
})

describe('findUnknownTerms', () => {
  const terms = [
    { where: 'x', curie: 'CHEBI:99999999' },
    { where: 'y', curie: 'CHEBI:99999999' },
    { where: 'x', curie: 'GO:0099999' },
    { where: 'x', curie: 'CHEBI:29101' },
    { where: 'x', curie: 'OPB:00340' },
    { where: 'x', curie: 'GO:123' },
  ]

  it('looks up each well-formed ChEBI or GO term without a known label once, and lists those OLS lacks', async () => {
    const lookup = vi.fn(async (curie) => (curie === 'GO:0099999' ? { label: 'a component' } : null))
    const unknown = await findUnknownTerms(terms, lookup)
    expect(lookup.mock.calls.map(([curie]) => curie)).toEqual(['CHEBI:99999999', 'GO:0099999'])
    expect(unknown).toEqual([
      { where: 'x', curie: 'CHEBI:99999999', problem: 'OLS has no term CHEBI:99999999' },
      { where: 'y', curie: 'CHEBI:99999999', problem: 'OLS has no term CHEBI:99999999' },
    ])
  })

  it('counts a term as known when the lookup fails, as offline', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await findUnknownTerms(terms, lookup)).toEqual([])
  })
})
