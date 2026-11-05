/**
 * Places of annotated quantities: resolving a side-car location against the places a node sits at in the
 * physiology view (see services/bioView/placement.js), and the shared test of whether two resolved places are
 * the same.
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

/**
 * Resolves a side-car location against a node's places: 'self' and 'self+GO:plasma membrane' to the node's own
 * compartment and membrane, and GO cytoplasm, plasma membrane and extracellular region to the places next to it.
 *
 * @param {Array<{ key: string, label?: string, as?: string[], facets?: string[] }>} places - From the location
 *   source; `as` lists the locations that resolve to each.
 * @param {string} location - 'self', 'self+GO:…' or a GO cellular component.
 * @returns {Array<{ key: string, label?: string, facets?: string[], path: string[] }>} Empty when nothing there
 *   answers the location.
 */
export function locateAll(places, location) {
  if (!location) return []
  return (places ?? [])
    .filter((place) => place.as?.includes(location))
    .map((place) => ({
      key: place.key,
      ...(place.label ? { label: place.label } : {}),
      ...(place.facets ? { facets: [...place.facets] } : {}),
      path: [place.label ?? place.key],
    }))
}
