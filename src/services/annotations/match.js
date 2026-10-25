/**
 * Matching annotated quantities across instances: derives each quantity's role, pairs compatible quantities and
 * groups the pairs into suggested edges.
 *
 * Roles are derived, never authored: a self-located quantity is an owner, or an aggregator (Sum) when it is a
 * flow; a relatively located one is a reader, or a contributor when it is a flow. Owner↔reader is a plain link,
 * aggregator↔contributor a Sum term (always ×1).
 */

import { isFlowProperty } from './iris.js'
import { locate, lyphKey, sameLocation, shortName } from './locate.js'

const OUTER_ROLES = { reader: 'owner', contributor: 'aggregator' }
const CONFIDENCE_ORDER = { high: 1, low: 0 }

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
 * The located quantities of one instance: one per annotated variable with a property and a location.
 *
 * @param {{ name: string, coord: object }} instance
 * @param {object} sidecar - From parseSidecar.
 * @param {{ coords: Map<string, object>, scopes: Map<string, object> }} [context]
 * @returns {Array<{ instance: string, variable: string, subject: string, property: string, species: string[],
 *   location: string, role: string, mathRef: string, locations: Array<object> }>}
 */
export function quantitiesFor(instance, sidecar, context = {}) {
  if (!instance || !sidecar) return []
  return sidecar.variables
    .filter((entry) => entry.property && entry.location)
    .map((entry) => ({
      instance: instance.name,
      variable: entry.variable,
      subject: entry.subject,
      property: entry.property,
      species: [...new Set(entry.species)].sort(),
      location: entry.location,
      role: roleOf(entry),
      mathRef: sidecar.mathRef,
      locations: locate(instance.coord, entry.location, context),
    }))
}

/**
 * Resolves what a basolateral facet faces: the one lyph instance with api:coalescedWith, at low confidence.
 * Without exactly one such lyph the location stays unresolved.
 *
 * @param {Array<object>} quantities - From quantitiesFor; not changed.
 * @param {Array<{ name: string, label?: string, coord: object }>} instances - label names the lyph in the reason.
 * @returns {Array<object>} The quantities with their locations resolved where possible.
 */
export function resolveFacing(quantities, instances) {
  const lyphs = instances.filter((instance) => instance.coord?.kind === 'lyph' && instance.coord.coalescedWith?.length)
  if (lyphs.length !== 1) return quantities
  const [lyph] = lyphs
  const why =
    `Assumed: ${lyph.label ?? lyph.name} is the only lyph with api:coalescedWith, so the basolateral facet is taken to face it. ` +
    'ApiCoord v0.2 has no adjacency predicate for this.'
  return quantities.map((quantity) => {
    if (!quantity.locations.some((location) => location.unresolved)) return quantity
    return {
      ...quantity,
      locations: quantity.locations.map((location) =>
        location.unresolved
          ? {
              key: lyphKey(lyph.coord),
              confidence: 'low',
              path: [...location.path, `${shortName(lyph.coord.iri)} (coalesced lyph)`],
              why,
            }
          : location
      ),
    }
  })
}

const sameSpecies = (a, b) => a.length === b.length && a.every((term, index) => term === b[index])

/**
 * How two quantities couple, if they do.
 *
 * @param {object} qa - A located quantity.
 * @param {object} qb - Another.
 * @returns {{ outer: object, inner: object, kind: 'link'|'sum', confidence: 'high'|'low', key: string,
 *   outerPath: string[], innerPath: string[], why?: string }|null} outer is the owner or aggregator.
 */
export function pairing(qa, qb) {
  if (!qa || !qb || qa.instance === qb.instance) return null
  if (qa.property !== qb.property || !sameSpecies(qa.species, qb.species)) return null
  let outer, inner
  if (OUTER_ROLES[qa.role] === qb.role) [outer, inner] = [qb, qa]
  else if (OUTER_ROLES[qb.role] === qa.role) [outer, inner] = [qa, qb]
  else return null

  let best = null
  for (const outerLocation of outer.locations) {
    for (const innerLocation of inner.locations) {
      if (!sameLocation(outerLocation, innerLocation)) continue
      const confidence = outerLocation.confidence === 'low' || innerLocation.confidence === 'low' ? 'low' : 'high'
      if (best && CONFIDENCE_ORDER[best.confidence] >= CONFIDENCE_ORDER[confidence]) continue
      const why = outerLocation.why ?? innerLocation.why
      best = {
        outer,
        inner,
        kind: outer.role === 'aggregator' ? 'sum' : 'link',
        confidence,
        key: outerLocation.key,
        outerPath: outerLocation.path,
        innerPath: innerLocation.path,
        ...(confidence === 'low' && why ? { why } : {}),
      }
    }
  }
  return best
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

/**
 * Orders instances for edge direction: outside layer 0, apical deployment 1, cell and facet-layer 2,
 * basolateral deployment 3, lyph 4.
 *
 * @param {object} coord
 * @returns {number}
 */
export function rankOf(coord) {
  switch (coord?.kind) {
    case 'layer':
      return 0
    case 'deployment':
      return coord.facets?.includes('apical') ? 1 : 3
    case 'cell':
    case 'facet-layer':
      return 2
    case 'lyph':
      return 4
    default:
      return 5
  }
}

const withoutLocations = ({ locations, ...quantity }) => quantity

// Whether two self-located places overlap: the same key and, on a plasma membrane, a shared facet.
function overlaps(a, b) {
  if (a.unresolved || b.unresolved || a.key !== b.key) return false
  if (!a.key.startsWith('pm:')) return true
  return (a.facets ?? []).some((facet) => (b.facets ?? []).includes(facet))
}

/**
 * Key of a suggested edge, and of one of its couplings.
 *
 * @param {string} sourceName
 * @param {string} targetName
 * @param {[string, string]} [variables] - Source and target variable, for a coupling key.
 * @returns {string}
 */
export function suggestionKey(sourceName, targetName, variables) {
  const edge = `${sourceName}->${targetName}`
  return variables ? `${edge}:${variables[0]}->${variables[1]}` : edge
}

function existingCouplingKeys(existingEdges) {
  const keys = new Set()
  for (const edge of existingEdges ?? []) {
    for (const { sourcePort, targetPort } of edge.data?.couplings ?? edge.couplings ?? []) {
      for (const sourceVariable of sourcePort?.variables ?? []) {
        for (const targetVariable of targetPort?.variables ?? []) {
          keys.add(`${edge.source}\0${sourceVariable}\0${edge.target}\0${targetVariable}`)
          keys.add(`${edge.target}\0${targetVariable}\0${edge.source}\0${sourceVariable}`)
        }
      }
    }
  }
  return keys
}

/**
 * Suggests couplings between located instances.
 *
 * @param {Array<{ name: string, coord: object, sidecar: object }>} instances
 * @param {{ coords?: Map, scopes?: Map, heldConstant?: Set<string>, existingEdges?: Array, dismissed?: Set<string> }}
 *   [options] - heldConstant names instances whose aggregators are dropped; existingEdges ({source, target} by
 *   instance name, couplings as sourcePort/targetPort variables) and dismissed (edge or coupling keys) are left out.
 * @returns {{ suggestions: Array<{ key: string, sourceName: string, targetName: string, couplings: Array<object>,
 *   confidence: 'high'|'low', why?: string }>, conflicts: Array<object>, unresolved: Array<object> }}
 */
export function suggestCouplings(instances, options = {}) {
  const { heldConstant = new Set(), existingEdges = [], dismissed = new Set() } = options
  const context = { coords: options.coords, scopes: options.scopes }
  const located = instances.filter((instance) => instance?.coord && instance.sidecar)
  const byName = new Map(located.map((instance) => [instance.name, instance]))

  let quantities = located.flatMap((instance) =>
    quantitiesFor(instance, instance.sidecar, context).filter(
      (quantity) => !(heldConstant.has(instance.name) && quantity.role === 'aggregator')
    )
  )
  quantities = resolveFacing(quantities, located)

  const unresolved = quantities
    .filter((quantity) => !quantity.locations.some((location) => !location.unresolved))
    .map(({ instance, variable, location }) => ({ instance, variable, location }))

  const pairs = []
  const conflicts = []
  for (let i = 0; i < quantities.length; i++) {
    for (let j = i + 1; j < quantities.length; j++) {
      const [qa, qb] = [quantities[i], quantities[j]]
      const pair = pairing(qa, qb)
      if (pair) {
        pairs.push(pair)
        continue
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
  }

  // A reader or contributor with more than one counterpart is ambiguous.
  const counts = new Map()
  for (const pair of pairs) {
    const id = `${pair.inner.instance}\0${pair.inner.variable}`
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const existing = existingCouplingKeys(existingEdges)
  const groups = new Map()
  for (const pair of pairs) {
    const [a, b] = [pair.outer, pair.inner]
    const rankA = rankOf(byName.get(a.instance).coord)
    const rankB = rankOf(byName.get(b.instance).coord)
    const aFirst = rankA !== rankB ? rankA < rankB : a.instance < b.instance
    const [source, target] = aFirst ? [a, b] : [b, a]
    if (existing.has(`${source.instance}\0${source.variable}\0${target.instance}\0${target.variable}`)) continue
    const edgeKey = suggestionKey(source.instance, target.instance)
    const couplingKey = suggestionKey(source.instance, target.instance, [source.variable, target.variable])
    if (dismissed.has(edgeKey) || dismissed.has(couplingKey)) continue

    if (!groups.has(edgeKey)) {
      groups.set(edgeKey, { key: edgeKey, sourceName: source.instance, targetName: target.instance, couplings: [] })
    }
    groups.get(edgeKey).couplings.push({
      key: couplingKey,
      source: withoutLocations(source),
      target: withoutLocations(target),
      kind: pair.kind,
      confidence: pair.confidence,
      place: {
        key: pair.key,
        sourcePath: aFirst ? pair.outerPath : pair.innerPath,
        targetPath: aFirst ? pair.innerPath : pair.outerPath,
      },
      ...(pair.why ? { why: pair.why } : {}),
      ...(counts.get(`${b.instance}\0${b.variable}`) > 1 ? { ambiguous: true } : {}),
    })
  }

  const suggestions = [...groups.values()].map((group) => {
    group.couplings.sort((x, y) => x.key.localeCompare(y.key))
    const low = group.couplings.filter((coupling) => coupling.confidence === 'low')
    const whys = [...new Set(low.map((coupling) => coupling.why).filter(Boolean))]
    return {
      ...group,
      confidence: low.length ? 'low' : 'high',
      ...(whys.length ? { why: whys.join(' ') } : {}),
    }
  })
  suggestions.sort(
    (x, y) =>
      rankOf(byName.get(x.sourceName).coord) - rankOf(byName.get(y.sourceName).coord) || x.key.localeCompare(y.key)
  )

  return { suggestions, conflicts, unresolved }
}
