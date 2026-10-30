/**
 * Locating quantities: combines a sidecar location ('self', 'self+GO:…' or a GO term relative to the instance)
 * with the instance's ApiCoord into place keys that two instances can share.
 *
 * Keys: 'layer:S:i' (layer i of scope S), 'cyto:C' and 'pm:C' (cytoplasm and plasma membrane of cell C,
 * C = S + '/' + api:cell), 'lyph:<origin>', and the unresolved 'extra-basolateral:C'.
 */

import { FACETS } from './apicoord.js'
import { GO } from './iris.js'

const SELF = 'self'
const SELF_PLASMA_MEMBRANE = `self+${GO.plasmaMembrane}`

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
 * The scope key: the scope's sorted canonical api:anatomy terms, else its IRI.
 *
 * @param {string|null} scopeIri
 * @param {Map<string, object>} scopes - From parseApiCoords.
 * @returns {string|null}
 */
export function scopeKey(scopeIri, scopes) {
  if (!scopeIri) return null
  const anatomy = scopes?.get(scopeIri)?.anatomy ?? []
  return anatomy.length ? [...anatomy].sort().join(',') : scopeIri
}

/**
 * The cell key and path of a cell coordinate.
 *
 * @returns {{ key: string, scope: string, path: string[] }|null}
 */
function cellOf(cell, scopes) {
  if (!cell || cell.kind !== 'cell') return null
  const scope = scopeKey(cell.scope, scopes)
  if (!scope || !cell.cell) return null
  return { key: `${scope}/${cell.cell}`, scope, path: [shortName(cell.iri), shortName(cell.scope)] }
}

/**
 * The key of a lyph coordinate itself.
 *
 * @param {object} coord - A lyph coordinate.
 * @returns {string}
 */
export function lyphKey(coord) {
  return `lyph:${coord.origin?.[0] ?? coord.template ?? coord.iri}`
}

/**
 * Resolves a sidecar location on an instance's coordinate.
 *
 * @param {object} coord - The instance's coordinate (from parseApiCoords).
 * @param {string} location - 'self', 'self+GO:…' or a GO cellular component.
 * @param {{ coords: Map<string, object>, scopes: Map<string, object> }} context
 * @returns {Array<{ key: string, facets?: string[], confidence: 'high'|'low', path: string[], unresolved?: boolean }>}
 *   Empty when the location has no meaning on this kind of coordinate.
 */
export function locate(coord, location, { coords = new Map(), scopes = new Map() } = {}) {
  if (!coord || !location) return []
  const here = shortName(coord.iri)
  const high = (key, path, facets) => ({ key, ...(facets ? { facets } : {}), confidence: 'high', path })

  switch (coord.kind) {
    case 'layer': {
      if (location !== SELF) return []
      const scope = scopeKey(coord.scope, scopes)
      if (!scope || coord.layerIndex === null) return []
      return [high(`layer:${scope}:${coord.layerIndex}`, [here, shortName(coord.scope)])]
    }
    case 'cell': {
      const cell = cellOf(coord, scopes)
      if (!cell) return []
      // The compartment placed on a cell is its cytoplasm; its plasma membrane spans every facet.
      if (location === SELF) return [high(`cyto:${cell.key}`, cell.path)]
      if (location === SELF_PLASMA_MEMBRANE) return [high(`pm:${cell.key}`, cell.path, [...FACETS])]
      return []
    }
    case 'lyph':
      return location === SELF ? [high(lyphKey(coord), [here])] : []
    case 'facet-layer': {
      const cell = cellOf(coords.get(coord.within), scopes)
      if (!cell) return []
      const path = [here, ...cell.path]
      if (location === SELF && (coord.layerIndex === 1 || coord.material === GO.plasmaMembrane)) {
        return [high(`pm:${cell.key}`, path, [...coord.facets])]
      }
      if (location === GO.cytoplasm) return [high(`cyto:${cell.key}`, path)]
      return []
    }
    case 'deployment': {
      const cell = cellOf(coords.get(coord.within), scopes)
      if (!cell) return []
      const path = [here, ...cell.path]
      if (location === GO.cytoplasm) return [high(`cyto:${cell.key}`, path)]
      if (location === GO.plasmaMembrane) return [high(`pm:${cell.key}`, path, [...coord.facets])]
      if (location === GO.extracellularRegion) return coord.facets.flatMap((facet) => facing(facet, cell, path))
      return []
    }
    default:
      return []
  }
}

// What a deployment's facet faces, outside the cell.
function facing(facet, cell, path) {
  if (facet === 'apical') {
    return [
      {
        key: `layer:${cell.scope}:0`,
        confidence: 'high',
        path: [...path, 'apical facet faces layer 0 of the host'],
      },
    ]
  }
  if (facet === 'basolateral') {
    return [
      {
        key: `extra-basolateral:${cell.key}`,
        confidence: 'low',
        unresolved: true,
        path: [...path, 'no ApiCoord predicate says what the basolateral facet faces'],
      },
    ]
  }
  return []
}

/**
 * Whether two resolved locations name the same place. For plasma-membrane keys the relative side's facets
 * must lie within the self-located side's facets.
 *
 * @param {{ key: string, facets?: string[], unresolved?: boolean }} outer - Of the owner or aggregator.
 * @param {{ key: string, facets?: string[], unresolved?: boolean }} inner - Of the reader or contributor.
 * @returns {boolean}
 */
export function sameLocation(outer, inner) {
  if (!outer || !inner || outer.unresolved || inner.unresolved || outer.key !== inner.key) return false
  if (!outer.key.startsWith('pm:')) return true
  const allowed = new Set(outer.facets ?? [])
  return (inner.facets ?? []).every((facet) => allowed.has(facet))
}
