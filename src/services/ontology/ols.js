/**
 * Live ChEBI and GO lookups through EBI's OLS4, which needs no key. Searches run only for what the user types,
 * debounced, abortable and with a timeout; their labels go to the term cache.
 */

import { canonicalCurie, expandCurie, splitCurie } from '../annotations/iris.js'
import { getCachedSearch, getCachedTerm, rememberTerms, setCachedSearch } from './termCache.js'

export const OLS_BASE_URL = 'https://www.ebi.ac.uk/ols4/api'
export const REQUEST_TIMEOUT_MS = 8000
export const SEARCH_DELAY_MS = 300

// GO's cellular_component root, to keep component searches to components.
const CELLULAR_COMPONENT_IRI = 'http://purl.obolibrary.org/obo/GO_0005575'

/** Thrown when a lookup cannot reach its service, so the caller can say it is offline. */
export class LookupUnavailableError extends Error {
  constructor(message, { cause, status } = {}) {
    super(message, { cause })
    this.name = 'LookupUnavailableError'
    this.status = status
  }
}

/**
 * Whether an error is an abort by the caller, not a failure.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAbortError(error) {
  return error?.name === 'AbortError'
}

/**
 * Fetches JSON, aborting after a timeout or when the caller's signal aborts.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeout]
 * @param {typeof fetch} [options.fetch]
 * @returns {Promise<any>} The parsed body.
 * @throws {DOMException} An AbortError when the caller aborts.
 * @throws {LookupUnavailableError} When offline, timed out, or the service fails.
 */
export async function fetchJson(url, { signal, timeout = REQUEST_TIMEOUT_MS, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (globalThis.navigator?.onLine === false) throw new LookupUnavailableError('Offline')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let isTimedOut = false
  const timer = setTimeout(() => {
    isTimedOut = true
    controller.abort()
  }, timeout)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new LookupUnavailableError(`HTTP ${response.status}`, { status: response.status })
    return await response.json()
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (error instanceof LookupUnavailableError) throw error
    throw new LookupUnavailableError(isTimedOut ? 'Timed out' : 'Request failed', { cause: error })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

/**
 * Wraps a search so only the latest call runs: earlier calls still waiting resolve to null, and an earlier
 * request in flight is aborted.
 *
 * @param {(query: string, options: { signal: AbortSignal }) => Promise<Array>} search
 * @param {Object} [options]
 * @param {number} [options.delay]
 * @returns {((query: string) => Promise<Array|null>) & { cancel: () => void }}
 */
export function createDebouncedSearch(search, { delay = SEARCH_DELAY_MS } = {}) {
  let timer = null
  let controller = null
  let settlePending = null

  const cancel = () => {
    clearTimeout(timer)
    controller?.abort()
    settlePending?.(null)
    timer = controller = settlePending = null
  }

  const debounced = (query) => {
    cancel()
    return new Promise((resolve, reject) => {
      settlePending = resolve
      timer = setTimeout(async () => {
        settlePending = null
        const current = (controller = new AbortController())
        try {
          resolve(await search(query, { signal: current.signal }))
        } catch (error) {
          if (isAbortError(error)) resolve(null)
          else reject(error)
        } finally {
          if (controller === current) controller = null
        }
      }, delay)
    })
  }
  debounced.cancel = cancel
  return debounced
}

/**
 * Builds an OLS4 search URL.
 *
 * @param {string} query
 * @param {Object} options
 * @param {'chebi'|'go'} options.ontology
 * @param {boolean} [options.isComponent] - Limits a GO search to cellular components.
 * @returns {string}
 */
export function buildSearchUrl(query, { ontology, isComponent = false }) {
  const params = new URLSearchParams({
    q: query,
    ontology,
    rows: '10',
    isDefiningOntology: 'true',
    queryFields: 'label,synonym',
    fieldList: 'iri,label,obo_id,synonym,is_obsolete',
  })
  if (isComponent) params.set('allChildrenOf', CELLULAR_COMPONENT_IRI)
  return `${OLS_BASE_URL}/select?${params}`
}

/**
 * Builds the OLS4 URL of one term; OLS wants its IRI encoded twice.
 *
 * @param {string} curie - e.g. 'CHEBI:29101', in any prefix case.
 * @returns {string|null} The URL, or null when the term is not in ChEBI or GO.
 */
export function buildTermUrl(curie) {
  const canonical = canonicalCurie(curie)
  const ontology = ontologyOf(canonical)
  if (!ontology) return null
  return `${OLS_BASE_URL}/ontologies/${ontology}/terms/${encodeURIComponent(encodeURIComponent(expandCurie(canonical)))}`
}

/**
 * The OLS ontology id of a canonical CURIE.
 *
 * @param {string} curie
 * @returns {'chebi'|'go'|null}
 */
function ontologyOf(curie) {
  const [prefix] = splitCurie(curie)
  return { CHEBI: 'chebi', GO: 'go' }[prefix] ?? null
}

/**
 * Reads one OLS document as a term, normalising its IRI or OBO id to a canonical CURIE.
 *
 * @param {Object} doc - An OLS search doc or term.
 * @returns {{ curie: string, label: string, synonyms: string[], isObsolete: boolean }|null}
 */
export function readOlsTerm(doc) {
  const label = Array.isArray(doc?.label) ? doc.label[0] : doc?.label
  const curie = [doc?.iri, doc?.obo_id].map((value) => (value ? canonicalCurie(value) : null)).find((value) => splitCurie(value)[0])
  if (!curie || typeof label !== 'string') return null
  const synonyms = doc.synonym ?? doc.synonyms ?? []
  return {
    curie,
    label,
    synonyms: (Array.isArray(synonyms) ? synonyms : [synonyms]).filter((value) => typeof value === 'string'),
    isObsolete: doc.is_obsolete === true || doc.is_obsolete === 'true',
  }
}

/**
 * Searches ChEBI or GO for typed text, from the cache when fresh.
 *
 * @param {string} query
 * @param {Object} options
 * @param {'chebi'|'go'} options.ontology
 * @param {boolean} [options.isComponent]
 * @param {AbortSignal} [options.signal]
 * @param {typeof fetch} [options.fetch]
 * @returns {Promise<Array<{ curie: string, label: string, synonyms: string[], isObsolete: boolean }>>}
 */
export async function searchOntology(query, { ontology, isComponent = false, signal, fetch } = {}) {
  const text = String(query ?? '').trim()
  if (!text) return []
  const url = buildSearchUrl(text, { ontology, isComponent })
  const cached = getCachedSearch(url)
  if (cached) return cached
  const body = await fetchJson(url, { signal, fetch })
  const terms = (body?.response?.docs ?? []).map(readOlsTerm).filter(Boolean)
  setCachedSearch(url, terms)
  rememberTerms(terms)
  return terms
}

/**
 * Searches ChEBI for species.
 *
 * @param {string} query
 * @param {{ signal?: AbortSignal, fetch?: typeof fetch }} [options]
 * @returns {Promise<Array<{ curie: string, label: string, synonyms: string[], isObsolete: boolean }>>}
 */
export function searchChebi(query, options = {}) {
  return searchOntology(query, { ...options, ontology: 'chebi' })
}

/**
 * Searches GO's cellular components.
 *
 * @param {string} query
 * @param {{ signal?: AbortSignal, fetch?: typeof fetch }} [options]
 * @returns {Promise<Array<{ curie: string, label: string, synonyms: string[], isObsolete: boolean }>>}
 */
export function searchCellularComponents(query, options = {}) {
  return searchOntology(query, { ...options, ontology: 'go', isComponent: true })
}

/**
 * Looks up one ChEBI or GO term's label, from the cache when known.
 *
 * @param {string} iriOrCurie
 * @param {{ signal?: AbortSignal, fetch?: typeof fetch }} [options]
 * @returns {Promise<{ curie: string, label: string, isObsolete: boolean }|null>} Null when OLS has no such term.
 */
export async function lookupTerm(iriOrCurie, { signal, fetch } = {}) {
  const curie = canonicalCurie(iriOrCurie)
  const cached = getCachedTerm(curie)
  if (cached) return { curie, ...cached }
  const url = buildTermUrl(curie)
  if (!url) return null
  let body
  try {
    body = await fetchJson(url, { signal, fetch })
  } catch (error) {
    if (error?.status === 404) return null
    throw error
  }
  const term = readOlsTerm(body)
  if (!term || term.curie !== curie) return null
  rememberTerms([term])
  return { curie, label: term.label, isObsolete: term.isObsolete }
}
