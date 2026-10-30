import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryStorage } from '../../helpers/memoryStorage.js'
import { displayLabel } from '../../../../src/services/annotations/labels.js'
import {
  LABEL_TTL_MS,
  MAX_LABELS,
  SEARCH_TTL_MS,
  TERM_LABELS_KEY,
  createCachedLabelSource,
  ensureCachedLabelSource,
  getCachedSearch,
  getCachedTerm,
  isObsoleteTerm,
  labelRevision,
  rememberTerms,
  resetTermCache,
  setCachedSearch,
} from '../../../../src/services/ontology/termCache.js'

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
  resetTermCache()
})
afterEach(() => vi.unstubAllGlobals())

describe('search cache', () => {
  it('returns a search while fresh and forgets it after ten minutes', () => {
    setCachedSearch('q', [1], 0)
    expect(getCachedSearch('q', SEARCH_TTL_MS)).toEqual([1])
    expect(getCachedSearch('q', SEARCH_TTL_MS + 1)).toBeUndefined()
  })
})

describe('term labels', () => {
  it('stores labels by CURIE in localStorage and reads them back', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)
    rememberTerms([{ curie: 'CHEBI:1', label: 'one', isObsolete: true }], 100)
    expect(JSON.parse(storage.store.get(TERM_LABELS_KEY))['CHEBI:1']).toMatchObject({ label: 'one', isObsolete: true })

    resetTermCache()
    expect(getCachedTerm('http://purl.obolibrary.org/obo/CHEBI_1', 200)).toEqual({ label: 'one', isObsolete: true })
  })

  it('drops labels older than thirty days', () => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    rememberTerms([{ curie: 'CHEBI:1', label: 'one' }], 0)
    expect(getCachedTerm('CHEBI:1', LABEL_TTL_MS + 1)).toBeUndefined()
  })

  it('keeps only the newest labels past the cap', () => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    const terms = Array.from({ length: MAX_LABELS + 5 }, (_, i) => ({ curie: `CHEBI:${i}`, label: `t${i}` }))
    rememberTerms(terms)
    expect(getCachedTerm('CHEBI:0')).toBeUndefined()
    expect(getCachedTerm(`CHEBI:${MAX_LABELS + 4}`)).toMatchObject({ label: `t${MAX_LABELS + 4}` })
  })

  it('works in memory when localStorage throws on every access', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => rememberTerms([{ curie: 'GO:1', label: 'thing' }])).not.toThrow()
    expect(getCachedTerm('GO:1')).toMatchObject({ label: 'thing' })
  })

  it('ignores a corrupt store', () => {
    const storage = createMemoryStorage()
    storage.store.set(TERM_LABELS_KEY, '{not json')
    vi.stubGlobal('localStorage', storage)
    expect(getCachedTerm('CHEBI:1')).toBeUndefined()
  })

  it('bumps the label revision only when a label changes, and reports obsolete terms', () => {
    const before = labelRevision.value
    rememberTerms([{ curie: 'CHEBI:2', label: 'two', isObsolete: true }])
    rememberTerms([{ curie: 'CHEBI:2', label: 'two', isObsolete: true }])
    expect(labelRevision.value).toBe(before + 1)
    expect(isObsoleteTerm('CHEBI:2')).toBe(true)
  })
})

describe('cached label source', () => {
  it('labels terms the tables lack, after the built-in tables', () => {
    ensureCachedLabelSource()
    ensureCachedLabelSource()
    rememberTerms([
      { curie: 'CHEBI:29101', label: 'sodium(1+)' },
      { curie: 'CHEBI:9999999', label: 'remote species' },
    ])
    expect(displayLabel('CHEBI:29101')).toBe('Na⁺')
    expect(displayLabel('CHEBI:9999999')).toBe('remote species')
    expect(createCachedLabelSource().labelFor('CHEBI:9999999')).toBe('remote species')
  })
})
