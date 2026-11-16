/**
 * Matching annotated quantities across instances: derives each quantity's role, locates it at its instance's
 * places, pairs compatible quantities and groups the pairs into matched edges.
 *
 * Roles are derived, never authored: a self-located quantity is an owner, or an aggregator (Sum) when it is a
 * flow; a relatively located one is a reader, or a contributor when it is a flow. Owner↔reader is a plain link,
 * aggregator↔contributor a Sum term (always ×1).
 */

import { rankPlace } from '../bioView/placement.js'
import { isFlowProperty, takesSpecies } from './iris.js'
import { locateAll, sameLocation } from './locate.js'

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

/**
 * The located quantities of one instance: one per completely annotated variable (see isCompleteAnnotation) and, when
 * the instance lists its math's variables, that the math has.
 *
 * @param {{ name: string, places?: Array<Object>, variables?: Iterable<string> }} instance - places, from the
 *   location source.
 * @param {object} sidecar - From parseSidecar.
 * @param {{ locate?: Function }} [context] - locate(places, location), the location source's; locateAll by default.
 * @returns {Array<{ instance: string, variable: string, subject: string, property: string, species: string[],
 *   location: string, role: string, mathRef: string, locations: Array<object> }>}
 */
export function quantitiesFor(instance, sidecar, context = {}) {
  if (!instance || !sidecar) return []
  const locate = context.locate ?? locateAll
  const known = instance.variables ? new Set(instance.variables) : null
  return sidecar.variables
    .filter((entry) => isCompleteAnnotation(entry) && (!known || known.has(entry.variable)))
    .map((entry) => ({
      instance: instance.name,
      variable: entry.variable,
      subject: entry.subject,
      property: entry.property,
      species: [...new Set(entry.species)].sort(),
      location: entry.location,
      role: roleOf(entry),
      mathRef: sidecar.mathRef,
      locations: locate(instance.places ?? [], entry.location),
    }))
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

const withoutLocations = ({ locations, ...quantity }) => quantity

// Whether two self-located places overlap: the same key and, when both list facets, a shared facet.
function overlaps(a, b) {
  if (a.unresolved || b.unresolved || a.key !== b.key) return false
  if (!a.facets?.length || !b.facets?.length) return true
  return a.facets.some((facet) => b.facets.includes(facet))
}

// Key of a matched edge, and of one of its couplings.
function matchKey(sourceName, targetName, variables) {
  const edge = `${sourceName}->${targetName}`
  return variables ? `${edge}:${variables[0]}->${variables[1]}` : edge
}

/**
 * Pairs located quantities: every compatible pair, and the owner or aggregator clashes where two instances claim
 * one place. With `involving`, only pairs with at least one quantity of those instances are tried, so a new or
 * changed instance is paired against the rest without repeating the others' pairs.
 *
 * @param {Array<object>} quantities - Located quantities.
 * @param {{ involving?: Set<string> }} [options] - Instance names.
 * @returns {{ pairs: Array<object>, conflicts: Array<object> }} pairs from pairing.
 */
export function pairQuantities(quantities, { involving } = {}) {
  const pairs = []
  const conflicts = []
  const visit = (qa, qb) => {
    const pair = pairing(qa, qb)
    if (pair) {
      pairs.push(pair)
      return
    }
    if (
      qa.instance !== qb.instance &&
      qa.role === qb.role &&
      (qa.role === 'owner' || qa.role === 'aggregator') &&
      qa.property === qb.property &&
      sameSpecies(qa.species, qb.species)
    ) {
      const shared = qa.locations.find((a) => qb.locations.some((b) => overlaps(a, b)))
      if (shared) conflicts.push({ key: shared.key, a: withoutLocations(qa), b: withoutLocations(qb) })
    }
  }
  const [changed, rest] = involving
    ? [quantities.filter((q) => involving.has(q.instance)), quantities.filter((q) => !involving.has(q.instance))]
    : [quantities, []]
  for (let i = 0; i < changed.length; i++) {
    for (let j = i + 1; j < changed.length; j++) visit(changed[i], changed[j])
    for (const other of rest) visit(changed[i], other)
  }
  return { pairs, conflicts }
}

/** An instance's rank for an edge's direction: its own place's (see rankPlace). */
const rankOfInstance = (instance) => rankPlace(instance?.places?.[0])

/**
 * Groups pairs into matched edges, one per pair of instances, directed by rank, lowest first.
 *
 * @param {Array<object>} pairs - From pairQuantities.
 * @param {Map<string, Object>} byName - The located instances by name.
 * @param {{ rankOf?: (instance: Object) => number }} [options] - An instance's rank; its own place's by default.
 * @returns {Array<{ key: string, sourceName: string, targetName: string, couplings: Array<object> }>} A coupling
 *   of a reader or contributor with more than one counterpart is marked ambiguous.
 */
export function groupMatches(pairs, byName, { rankOf = rankOfInstance } = {}) {
  const counts = new Map()
  for (const pair of pairs) {
    const id = `${pair.inner.instance}\0${pair.inner.variable}`
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const groups = new Map()
  for (const pair of pairs) {
    const [a, b] = [pair.outer, pair.inner]
    const rankA = rankOf(byName.get(a.instance))
    const rankB = rankOf(byName.get(b.instance))
    const aFirst = rankA !== rankB ? rankA < rankB : a.instance < b.instance
    const [source, target] = aFirst ? [a, b] : [b, a]
    const edgeKey = matchKey(source.instance, target.instance)

    if (!groups.has(edgeKey)) {
      groups.set(edgeKey, { key: edgeKey, sourceName: source.instance, targetName: target.instance, couplings: [] })
    }
    groups.get(edgeKey).couplings.push({
      key: matchKey(source.instance, target.instance, [source.variable, target.variable]),
      source: withoutLocations(source),
      target: withoutLocations(target),
      kind: pair.kind,
      place: {
        key: pair.key,
        sourcePath: aFirst ? pair.outerPath : pair.innerPath,
        targetPath: aFirst ? pair.innerPath : pair.outerPath,
      },
      ...(counts.get(`${b.instance}\0${b.variable}`) > 1 ? { ambiguous: true } : {}),
    })
  }

  const matches = [...groups.values()]
  for (const group of matches) group.couplings.sort((x, y) => x.key.localeCompare(y.key))
  matches.sort(
    (x, y) => rankOf(byName.get(x.sourceName)) - rankOf(byName.get(y.sourceName)) || x.key.localeCompare(y.key)
  )
  return matches
}

/**
 * The located quantities of an instance, less its aggregators when it is held constant.
 *
 * @param {{ name: string, places: Array<Object>, sidecar: object, variables?: Iterable<string> }} instance
 * @param {{ locate?: Function }} [context] - As for quantitiesFor.
 * @param {boolean} [isHeldConstant=false]
 * @returns {Array<object>} From quantitiesFor.
 */
export function instanceQuantities(instance, context, isHeldConstant = false) {
  return quantitiesFor(instance, instance.sidecar, context).filter(
    (quantity) => !(isHeldConstant && quantity.role === 'aggregator')
  )
}

/**
 * Matches couplings between placed instances.
 *
 * @param {Array<{ name: string, label?: string, places: Array<Object>, sidecar: object,
 *   variables?: Iterable<string> }>} instances - places from the location source; variables, the math's variable
 *   names, leaves out entries for others. Instances without places or a side-car are left out.
 * @param {Object} [options]
 * @param {Set<string>} [options.heldConstant] - Instances whose aggregators are dropped.
 * @param {Function} [options.locate] - The location source's locate; locateAll by default.
 * @param {(place: Object) => number} [options.rank] - The location source's rank; rankPlace by default.
 * @returns {{ matches: Array<{ key: string, sourceName: string, targetName: string, couplings: Array<object> }>,
 *   conflicts: Array<object>, unresolved: Array<object> }}
 */
export function matchCouplings(instances, { heldConstant = new Set(), locate, rank = rankPlace } = {}) {
  const context = { locate }
  const located = instances.filter((instance) => instance?.places?.length && instance.sidecar)
  const byName = new Map(located.map((instance) => [instance.name, instance]))
  const quantities = located.flatMap((instance) =>
    instanceQuantities(instance, context, heldConstant.has(instance.name))
  )
  const { pairs, conflicts } = pairQuantities(quantities)
  return {
    matches: groupMatches(pairs, byName, { rankOf: (instance) => rank(instance?.places?.[0]) }),
    conflicts,
    unresolved: unresolvedOf(quantities),
  }
}

/**
 * The quantities no location resolved for.
 *
 * @param {Array<object>} quantities - Located quantities.
 * @returns {Array<{ instance: string, variable: string, location: string }>}
 */
export function unresolvedOf(quantities) {
  return quantities
    .filter((quantity) => !quantity.locations.some((location) => !location.unresolved))
    .map(({ instance, variable, location }) => ({ instance, variable, location }))
}
