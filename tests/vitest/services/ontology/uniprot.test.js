import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryStorage } from '../../helpers/memoryStorage.js'
import { LookupUnavailableError } from '../../../../src/services/ontology/ols.js'
import { getCachedTerm, resetTermCache } from '../../../../src/services/ontology/termCache.js'
import { buildUniprotSearchUrl, readUniprotEntry, searchUniprot } from '../../../../src/services/ontology/uniprot.js'

const SGLT1 = {
  primaryAccession: 'P13866',
  proteinDescription: { recommendedName: { fullName: { value: 'Sodium/glucose cotransporter 1' } } },
  genes: [{ geneName: { value: 'SLC5A1' } }],
  organism: { scientificName: 'Homo sapiens' },
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
  resetTermCache()
})
afterEach(() => vi.unstubAllGlobals())

describe('uniprot', () => {
  it('searches reviewed entries only', () => {
    const url = new URL(buildUniprotSearchUrl('SLC5A1'))
    expect(url.origin + url.pathname).toBe('https://rest.uniprot.org/uniprotkb/search')
    expect(url.searchParams.get('query')).toBe('(SLC5A1) AND reviewed:true')
    expect(url.searchParams.get('format')).toBe('json')
  })

  it('reads an entry, falling back to a submitted name', () => {
    expect(readUniprotEntry(SGLT1)).toEqual({
      curie: 'uniprot:P13866',
      accession: 'P13866',
      label: 'Sodium/glucose cotransporter 1',
      gene: 'SLC5A1',
      organism: 'Homo sapiens',
    })
    expect(readUniprotEntry({ primaryAccession: 'Q1', proteinDescription: { submissionNames: [{ fullName: { value: 'S' } }] } }).label).toBe('S')
    expect(readUniprotEntry({})).toBeNull()
  })

  it('returns entries and remembers their labels', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [SGLT1] }) }))
    expect((await searchUniprot('sglt1', { fetch })).map((entry) => entry.accession)).toEqual(['P13866'])
    expect(getCachedTerm('uniprot:P13866')?.label).toBe('Sodium/glucose cotransporter 1')
  })

  it('reports a failing service as unavailable', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    await expect(searchUniprot('sglt1', { fetch })).rejects.toBeInstanceOf(LookupUnavailableError)
  })
})
