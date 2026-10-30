/**
 * Live UniProt lookups for a transporter's accession: reviewed (Swiss-Prot) entries only. UniProt can be slow, so
 * a typed accession always works without it.
 */

import { fetchJson } from './ols.js'
import { getCachedSearch, rememberTerms, setCachedSearch } from './termCache.js'

export const UNIPROT_SEARCH_URL = 'https://rest.uniprot.org/uniprotkb/search'

/**
 * Builds a UniProtKB search URL for reviewed entries.
 *
 * @param {string} query
 * @returns {string}
 */
export function buildUniprotSearchUrl(query) {
  const params = new URLSearchParams({
    query: `(${query}) AND reviewed:true`,
    fields: 'accession,protein_name,gene_names,organism_name',
    format: 'json',
    size: '10',
  })
  return `${UNIPROT_SEARCH_URL}?${params}`
}

/**
 * Reads one UniProtKB result as a protein.
 *
 * @param {Object} result
 * @returns {{ curie: string, accession: string, label: string, gene: string, organism: string }|null}
 */
export function readUniprotEntry(result) {
  const accession = result?.primaryAccession
  if (typeof accession !== 'string') return null
  const description = result.proteinDescription ?? {}
  const label =
    description.recommendedName?.fullName?.value ?? description.submissionNames?.[0]?.fullName?.value ?? accession
  return {
    curie: `uniprot:${accession}`,
    accession,
    label,
    gene: result.genes?.[0]?.geneName?.value ?? '',
    organism: result.organism?.scientificName ?? '',
  }
}

/**
 * Searches reviewed UniProtKB entries for typed text, from the cache when fresh.
 *
 * @param {string} query
 * @param {{ signal?: AbortSignal, fetch?: typeof fetch }} [options]
 * @returns {Promise<Array<{ curie: string, accession: string, label: string, gene: string, organism: string }>>}
 */
export async function searchUniprot(query, { signal, fetch } = {}) {
  const text = String(query ?? '').trim()
  if (!text) return []
  const url = buildUniprotSearchUrl(text)
  const cached = getCachedSearch(url)
  if (cached) return cached
  const body = await fetchJson(url, { signal, fetch })
  const entries = (body?.results ?? []).map(readUniprotEntry).filter(Boolean)
  setCachedSearch(url, entries)
  rememberTerms(entries)
  return entries
}
