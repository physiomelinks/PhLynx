/**
 * Places of annotated quantities: the shared test of whether two resolved places are the same.
 */

/**
 * Fragment of an IRI, for readable paths.
 *
 * @param {string} iri
 * @returns {string}
 */
export function shortName(iri) {
  if (typeof iri !== 'string') return String(iri)
  const hash = iri.lastIndexOf('#')
  if (hash >= 0) return iri.slice(hash + 1)
  return iri.slice(iri.lastIndexOf('/') + 1)
}

/**
 * Whether two resolved locations name the same place: the keys are equal and, when the self-located side lists
 * facets, the relative side's facets lie within them.
 *
 * @param {{ key: string, facets?: string[], unresolved?: boolean }} outer - Of the owner or aggregator.
 * @param {{ key: string, facets?: string[], unresolved?: boolean }} inner - Of the reader or contributor.
 * @returns {boolean}
 */
export function sameLocation(outer, inner) {
  if (!outer || !inner || outer.unresolved || inner.unresolved || outer.key !== inner.key) return false
  if (!outer.facets?.length) return true
  const allowed = new Set(outer.facets)
  return (inner.facets ?? []).every((facet) => allowed.has(facet))
}
