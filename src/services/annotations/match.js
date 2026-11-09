/**
 * Matching annotated quantities: a quantity's derived role, and whether two quantities pair.
 *
 * Roles are derived, never authored: a self-located quantity is an owner, or an aggregator (Sum) when it is a
 * flow; a relatively located one is a reader, or a contributor when it is a flow. Owner↔reader is a plain link,
 * aggregator↔contributor a Sum term (always ×1).
 */

import { isFlowProperty, takesSpecies } from './iris.js'
import { sameLocation } from './locate.js'

const OUTER_ROLES = { reader: 'owner', contributor: 'aggregator' }

/**
 * The derived role of a sidecar variable entry.
 *
 * @param {{ property: string, location: string }} entry
 * @returns {'owner'|'aggregator'|'reader'|'contributor'}
 */
export function roleOf({ property, location }) {
  const self = location === 'self' || location?.startsWith('self+')
  const flow = isFlowProperty(property)
  if (self) return flow ? 'aggregator' : 'owner'
  return flow ? 'contributor' : 'reader'
}

/**
 * Whether an entry says enough to be a port: a property, a location and, for a property of a species, a species.
 *
 * @param {{ property?: string|null, species?: string[], location?: string|null }} entry
 * @returns {boolean}
 */
export function isCompleteAnnotation({ property, species, location }) {
  return !!(property && location && (!takesSpecies(property) || species?.length))
}

const sameSpecies = (a, b) => a.length === b.length && a.every((term, index) => term === b[index])

/**
 * How two quantities couple, if they do.
 *
 * @param {object} qa - A located quantity.
 * @param {object} qb - Another.
 * @returns {{ outer: object, inner: object, kind: 'link'|'sum', key: string, outerPath: string[],
 *   innerPath: string[] }|null} outer is the owner or aggregator; the first place they share.
 */
export function pairing(qa, qb) {
  if (!qa || !qb || qa.instance === qb.instance) return null
  if (qa.property !== qb.property || !sameSpecies(qa.species, qb.species)) return null
  let outer, inner
  if (OUTER_ROLES[qa.role] === qb.role) [outer, inner] = [qb, qa]
  else if (OUTER_ROLES[qb.role] === qa.role) [outer, inner] = [qa, qb]
  else return null

  for (const outerLocation of outer.locations) {
    const innerLocation = inner.locations.find((location) => sameLocation(outerLocation, location))
    if (!innerLocation) continue
    return {
      outer,
      inner,
      kind: outer.role === 'aggregator' ? 'sum' : 'link',
      key: outerLocation.key,
      outerPath: outerLocation.path,
      innerPath: innerLocation.path,
    }
  }
  return null
}

/**
 * The single compatibility predicate: same property, same species, compatible locations, complementary roles.
 *
 * @param {object} qa - A located quantity.
 * @param {object} qb - Another.
 * @returns {boolean}
 */
export function compatible(qa, qb) {
  return pairing(qa, qb) !== null
}
