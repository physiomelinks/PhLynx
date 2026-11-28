/**
 * Where instances sit in the physiology view, as the places their annotated quantities resolve against: the site of
 * the pieces a node is bound to. A node on no piece has no places, so takes no part in coupling by location.
 *
 * A place is { key, label, kind, as, facets?, sides? }:
 * - key: 'site:pieces/<path>';
 * - kind: the role of the piece, e.g. 'cytosol' or 'region';
 * - as: the side-car locations that resolve to it from the node: 'self', 'self+GO:…' or a GO term;
 * - facets: the parts of a membrane it spans, which two places must share to meet;
 * - sides: the facet names a membrane protein sits on or a region lies against, which rankPlace reads.
 * A node's own place comes first.
 */

import { parseSiteRef } from './siteRefs.js'
import { PIECES_INSTANCE } from './pieces/layout.js'
import { piecePlaces } from './pieces/placement.js'

/**
 * The places of a node bound to a site of the pieces.
 *
 * @returns {Array<Object>|null} Null when the site is dangling: it is no site the pieces offer.
 */
function sitePlaces(ref, { pieces }) {
  const parsed = parseSiteRef(ref)
  if (parsed?.instance !== PIECES_INSTANCE || !pieces.length) return null
  return piecePlaces(pieces, parsed.path)
}

/**
 * Prepares what locatePlace reads.
 *
 * @param {Array<{id: string, data?: Object}>} nodes - The flow's nodes.
 * @param {Object} [options]
 * @param {ReadonlyArray<Object>} [options.pieces] - The pieces the view is built from (schema 4), validated.
 * @returns {Object}
 */
export function preparePlacement(nodes, { pieces = [] } = {}) {
  return { pieces }
}

/**
 * The places of one node (see the header).
 *
 * @param {{id: string, data?: Object}} node
 * @param {Object} prepared - From preparePlacement.
 * @returns {Array<Object>} Empty when the node is not on a site the pieces offer.
 */
export function locatePlace(node, prepared) {
  if (!node || !prepared) return []
  const ref = node.data?.bioView?.site
  return (ref && sitePlaces(ref, prepared)) || []
}

/**
 * The places of every node.
 *
 * @param {Array<{id: string, data?: Object}>} nodes
 * @param {Object} [options] - As for preparePlacement.
 * @returns {Map<string, Array<Object>>} Node id -> its places.
 */
export function placementsOf(nodes, options) {
  const prepared = preparePlacement(nodes, options)
  return new Map(nodes.map((node) => [node.id, locatePlace(node, prepared)]))
}

/**
 * Orders places for an edge's direction, outside in and apical first: a region against an apical facet 0, a
 * protein on one 1, a cell, its membrane or a process inside it 2, a protein on another facet 3, any other
 * region 4.
 *
 * @param {Object|undefined} place - A node's own place.
 * @returns {number} 5 for none.
 */
export function rankPlace(place) {
  const isApical = (place?.sides ?? []).includes('apical')
  switch (place?.kind) {
    case 'region':
      return isApical ? 0 : 4
    case 'membraneProtein':
      return isApical ? 1 : 3
    case 'cytosol':
    case 'membrane':
    case 'cytosolic':
      return 2
    default:
      return 5
  }
}
