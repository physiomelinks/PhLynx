import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryStorage } from '../../helpers/memoryStorage.js'
import {
  LookupUnavailableError,
  REQUEST_TIMEOUT_MS,
  buildSearchUrl,
  buildTermUrl,
  createDebouncedSearch,
  fetchJson,
  lookupTerm,
  readOlsTerm,
  searchCellularComponents,
  searchChebi,
} from '../../../../src/services/ontology/ols.js'
import { getCachedTerm, resetTermCache } from '../../../../src/services/ontology/termCache.js'

/**
 * A fetch double answering every request with a JSON body.
 *
 * @param {any} body
 * @param {number} [status]
 */
function respondWith(body, status = 200) {
  return vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
}

/** A fetch double that never answers until its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
  )
}

const SODIUM_DOC = {
  iri: 'http://purl.obolibrary.org/obo/CHEBI_29101',
  label: 'sodium(1+)',
  obo_id: 'CHEBI:29101',
  synonym: ['Na+'],
  is_obsolete: false,
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
  resetTermCache()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('URLs', () => {
  it('searches only the defining ontology by label and synonym', () => {
    const url = new URL(buildSearchUrl('sodium ion', { ontology: 'chebi' }))
    expect(url.origin + url.pathname).toBe('https://www.ebi.ac.uk/ols4/api/select')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'sodium ion',
      ontology: 'chebi',
      rows: '10',
      isDefiningOntology: 'true',
      queryFields: 'label,synonym',
      fieldList: 'iri,label,obo_id,synonym,is_obsolete',
    })
  })

  it('limits a GO component search to cellular components', () => {
    const url = new URL(buildSearchUrl('cytoplasm', { ontology: 'go', isComponent: true }))
    expect(url.searchParams.get('allChildrenOf')).toBe('http://purl.obolibrary.org/obo/GO_0005575')
  })

  it('double-encodes the term IRI, and has no URL outside ChEBI and GO', () => {
    expect(buildTermUrl('chebi_29101')).toBe(
      'https://www.ebi.ac.uk/ols4/api/ontologies/chebi/terms/http%253A%252F%252Fpurl.obolibrary.org%252Fobo%252FCHEBI_29101'
    )
    expect(buildTermUrl('OPB:00340')).toBeNull()
  })
})

describe('readOlsTerm', () => {
  it('normalises the IRI to a canonical CURIE', () => {
    expect(readOlsTerm({ ...SODIUM_DOC, is_obsolete: 'true' })).toEqual({
      curie: 'CHEBI:29101',
      label: 'sodium(1+)',
      synonyms: ['Na+'],
      isObsolete: true,
    })
  })

  it('falls back to the OBO id, and skips docs without a known term', () => {
    expect(readOlsTerm({ iri: 'urn:x', obo_id: 'GO:0005737', label: ['cytoplasm'] })?.curie).toBe('GO:0005737')
    expect(readOlsTerm({ iri: 'urn:x', label: 'x' })).toBeNull()
  })
})

describe('searchChebi', () => {
  it('returns terms and caches the search and its labels', async () => {
    const fetch = respondWith({ response: { docs: [SODIUM_DOC, { label: 'junk' }] } })
    const terms = await searchChebi('sodium', { fetch })
    expect(terms.map((term) => term.curie)).toEqual(['CHEBI:29101'])
    expect(getCachedTerm('CHEBI:29101')).toEqual({ label: 'sodium(1+)', isObsolete: false })

    await searchChebi('sodium', { fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not search empty text', async () => {
    const fetch = respondWith({})
    expect(await searchCellularComponents('  ', { fetch })).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a failing service as unavailable', async () => {
    await expect(searchChebi('sodium', { fetch: respondWith({}, 503) })).rejects.toBeInstanceOf(LookupUnavailableError)
    await expect(
      searchChebi('potassium', {
        fetch: vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      })
    ).rejects.toBeInstanceOf(LookupUnavailableError)
  })

  it('reports offline without fetching', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fetch = respondWith({})
    await expect(searchChebi('sodium', { fetch })).rejects.toBeInstanceOf(LookupUnavailableError)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('fetchJson', () => {
  it('times out after eight seconds', async () => {
    vi.useFakeTimers()
    const result = fetchJson('https://x', { fetch: hangingFetch() })
    const assertion = expect(result).rejects.toThrow('Timed out')
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    await assertion
  })

  it('rethrows the caller’s abort as an AbortError', async () => {
    const controller = new AbortController()
    const result = fetchJson('https://x', { fetch: hangingFetch(), signal: controller.signal })
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('createDebouncedSearch', () => {
  it('runs only the latest query after the delay, and aborts the one in flight', async () => {
    vi.useFakeTimers()
    const signals = []
    const search = vi.fn((query, { signal }) => {
      signals.push(signal)
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        setTimeout(() => resolve([query]), 1000)
      })
    })
    const debounced = createDebouncedSearch(search, { delay: 300 })

    const first = debounced('so')
    const second = debounced('sod')
    await vi.advanceTimersByTimeAsync(300)
    expect(search).toHaveBeenCalledTimes(1)
    expect(await first).toBeNull()

    const third = debounced('sodium')
    expect(signals[0].aborted).toBe(true)
    expect(await second).toBeNull()
    await vi.advanceTimersByTimeAsync(1300)
    expect(await third).toEqual(['sodium'])
  })

  it('passes a failure on to the caller', async () => {
    vi.useFakeTimers()
    const debounced = createDebouncedSearch(async () => {
      throw new LookupUnavailableError('down')
    })
    const result = debounced('x')
    const assertion = expect(result).rejects.toBeInstanceOf(LookupUnavailableError)
    await vi.advanceTimersByTimeAsync(300)
    await assertion
  })
})

describe('lookupTerm', () => {
  it('looks up a term once, then answers from the cache', async () => {
    const fetch = respondWith({ ...SODIUM_DOC, is_obsolete: true })
    expect(await lookupTerm('http://purl.obolibrary.org/obo/CHEBI_29101', { fetch })).toEqual({
      curie: 'CHEBI:29101',
      label: 'sodium(1+)',
      isObsolete: true,
    })
    expect(fetch.mock.calls[0][0]).toBe(buildTermUrl('CHEBI:29101'))
    await lookupTerm('CHEBI:29101', { fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('has nothing for a term OLS does not know, but reports other failures', async () => {
    expect(await lookupTerm('CHEBI:99999999', { fetch: respondWith({}, 404) })).toBeNull()
    await expect(lookupTerm('CHEBI:99999999', { fetch: respondWith({}, 503) })).rejects.toBeInstanceOf(LookupUnavailableError)
  })

  it('has nothing for a term outside ChEBI and GO', async () => {
    const fetch = respondWith({})
    expect(await lookupTerm('OPB:00340', { fetch })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
