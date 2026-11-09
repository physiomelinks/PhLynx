/**
 * Where annotated quantities are located comes from one location source at a time. The built-in source is
 * physiology placement (see services/bioView/placement.js); another may be registered in its place.
 *
 * A source has:
 * - prepare(nodes, { sidecarFor, data, workedRole }): what placeOf reads, once per coupling context; data is
 *   what read() gave, with the workspace's template instances and definitions;
 * - placeOf(node, prepared): the node's places, its own first, as locate and rank read them; none when unplaced;
 * - locate(places, location): a side-car location resolved against a node's places (see locateAll);
 * - rank(place): orders a node's own place for an edge's direction, lowest first;
 * - workedRole(node, { sidecar }): a physiology role the source works out (see resolveBioRole), or null;
 * - nodeKeys: the node data keys it reads, kept when a node is rebuilt from a snapshot and, but for bioView, left
 *   off a pasted copy;
 * - read() and ensure(), optional: the data it reads now, and a promise that loads it.
 */

import { locatePlace, preparePlacement, rankPlace } from '../bioView/placement.js'
import { locateAll } from './locate.js'

/** The built-in source: where nodes sit in the physiology view. */
export const PLACEMENT_SOURCE = Object.freeze({
  id: 'placement',
  prepare: (nodes, { sidecarFor, data, workedRole } = {}) => preparePlacement(nodes, { sidecarFor, ...data, workedRole }),
  placeOf: (node, prepared) => locatePlace(node, prepared),
  locate: locateAll,
  rank: rankPlace,
  workedRole: () => null,
  nodeKeys: Object.freeze(['bioView']),
})

let registered = null

/**
 * Makes a source the one in use. Members it leaves out are the built-in source's.
 *
 * @param {Object} source
 * @returns {() => void} Unregisters it, if it is still the one in use.
 */
export function registerLocationSource(source) {
  const entry = Object.freeze({ ...PLACEMENT_SOURCE, ...source })
  const previous = registered
  registered = entry
  return () => {
    if (registered === entry) registered = previous
  }
}

/**
 * @returns {Object} The location source in use.
 */
export function locationSource() {
  return registered ?? PLACEMENT_SOURCE
}
