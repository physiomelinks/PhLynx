/**
 * Caches for online ontology lookups: recent searches in memory, and the labels of resolved terms in
 * localStorage so chips read well offline. Only CURIEs are ever saved in sidecars.
 */

import { ref } from 'vue'

import { canonicalCurie } from '../annotations/iris.js'
import { addLabelSource } from '../annotations/labels.js'

export const TERM_LABELS_KEY = 'phlynx-term-labels'
export const SEARCH_TTL_MS = 10 * 60 * 1000
export const LABEL_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_SEARCHES = 100
export const MAX_LABELS = 500

/** Bumped whenever a label is learned, so anything showing labels re-renders. */
export const labelRevision = ref(0)

const searches = new Map()
let labels = null

/**
 * Returns a cached search's results while they are fresh.
 *
 * @param {string} key - The search, e.g. its URL.
 * @param {number} [now]
 * @returns {Array|undefined}
 */
export function getCachedSearch(key, now = Date.now()) {
  const hit = searches.get(key)
  if (!hit) return undefined
  if (now - hit.at > SEARCH_TTL_MS) {
    searches.delete(key)
    return undefined
  }
  return hit.results
}

/**
 * Caches a search's results, dropping the oldest search past the cap.
 *
 * @param {string} key
 * @param {Array} results
 * @param {number} [now]
 */
export function setCachedSearch(key, results, now = Date.now()) {
  searches.delete(key)
  searches.set(key, { results, at: now })
  if (searches.size > MAX_SEARCHES) searches.delete(searches.keys().next().value)
}

/**
 * Reads the stored labels once, dropping expired ones; an unreadable store reads as empty.
 *
 * @param {number} now
 * @returns {Map<string, { label: string, isObsolete: boolean, at: number }>}
 */
function ensureLabels(now) {
  if (labels) return labels
  labels = new Map()
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(TERM_LABELS_KEY) ?? '{}')
    for (const [curie, entry] of Object.entries(stored ?? {})) {
      if (typeof entry?.label === 'string' && now - entry.at <= LABEL_TTL_MS) {
        labels.set(curie, { label: entry.label, isObsolete: !!entry.isObsolete, at: entry.at })
      }
    }
  } catch {
    // Storage blocked or corrupt: labels stay in memory only.
  }
  return labels
}

/** Writes the labels back to localStorage, ignoring a full or blocked store. */
function saveLabels() {
  try {
    globalThis.localStorage?.setItem(TERM_LABELS_KEY, JSON.stringify(Object.fromEntries(labels)))
  } catch {
    // Storage blocked or full: labels stay in memory only.
  }
}

/**
 * Returns a resolved term's cached label and whether it is obsolete.
 *
 * @param {string} iriOrCurie
 * @param {number} [now]
 * @returns {{ label: string, isObsolete: boolean }|undefined}
 */
export function getCachedTerm(iriOrCurie, now = Date.now()) {
  const entry = ensureLabels(now).get(canonicalCurie(iriOrCurie))
  if (!entry || now - entry.at > LABEL_TTL_MS) return undefined
  return { label: entry.label, isObsolete: entry.isObsolete }
}

/**
 * Whether a cached term is obsolete in its ontology.
 *
 * @param {string} iriOrCurie
 * @returns {boolean}
 */
export function isObsoleteTerm(iriOrCurie) {
  return !!getCachedTerm(iriOrCurie)?.isObsolete
}

/**
 * Remembers resolved terms' labels, keeping the newest MAX_LABELS.
 *
 * @param {Array<{ curie: string, label: string, isObsolete?: boolean }>} terms
 * @param {number} [now]
 */
export function rememberTerms(terms, now = Date.now()) {
  const stored = ensureLabels(now)
  let isChanged = false
  for (const { curie, label, isObsolete = false } of terms) {
    if (!curie || !label) continue
    const previous = stored.get(curie)
    if (previous?.label !== label || previous?.isObsolete !== isObsolete) isChanged = true
    stored.delete(curie)
    stored.set(curie, { label, isObsolete, at: now })
  }
  while (stored.size > MAX_LABELS) stored.delete(stored.keys().next().value)
  saveLabels()
  if (isChanged) labelRevision.value++
}

/**
 * A label source over the cached labels; reading it tracks labelRevision, so computed labels refresh.
 *
 * @returns {{ labelFor: (curie: string) => string|undefined }}
 */
export function createCachedLabelSource() {
  return {
    labelFor(curie) {
      void labelRevision.value
      return getCachedTerm(curie)?.label
    },
  }
}

let isRegistered = false

/** Adds the cached labels to the default label provider, after the built-in tables; safe to call again. */
export function ensureCachedLabelSource() {
  if (isRegistered) return
  isRegistered = true
  addLabelSource(createCachedLabelSource(), { isFallback: true })
}

/** Forgets every cached search and label in memory, for tests. */
export function resetTermCache() {
  searches.clear()
  labels = null
}
