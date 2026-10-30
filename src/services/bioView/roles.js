/**
 * What each instance is in the physiological view, worked out from its annotations unless the user has said.
 *
 * A node's data.bioView holds the user's choices and its place in that view, all optional:
 * - role, glyph, facet, cell: overrides of what is worked out here; a facet of null takes a protein out of
 *   its membrane;
 * - at: 'left' or 'right', which side of the cell a lateral protein is on;
 * - adjacent: [{ cell, facet, at? }], what a region lies against, e.g. one cell's lateral side for a
 *   paracellular space;
 * - order: its slot along its facet, for a membrane protein;
 * - site: '<instanceId>/<sitePath>', the template site it is bound to; one whose instance is gone leaves it
 *   unbound, falling back to its role;
 * - position, rect: where it is drawn, when not worked out from its cell.
 */

import { FACETS } from '../annotations/apicoord.js'
import { GO } from '../annotations/iris.js'
import { facingLyph } from '../annotations/match.js'
import { glyphFor } from './glyphs.js'

/**
 * What an instance can be:
 * - membraneProtein: sits in a cell's membrane, on a facet;
 * - membrane: a cell's membrane itself;
 * - cytosol: a cell's inside;
 * - cytosolic: a process inside a cell, such as glycolysis;
 * - region: a space outside cells, such as a lumen or a vessel;
 * - none: nothing physiological is known, drawn as a card.
 */
export const ROLES = ['membraneProtein', 'membrane', 'cytosol', 'cytosolic', 'region', 'none']

/** Roles that belong to a cell. */
const CELL_ROLES = new Set(['membraneProtein', 'membrane', 'cytosolic'])

/** The two sides of a cell's lateral facet. */
const SIDES = ['left', 'right']

/**
 * Keeps the entries of a region's adjacency that name a cell and a facet of it (and a side, for lateral).
 *
 * @param {*} adjacent - data.bioView.adjacent.
 * @returns {Array<{cell: string, facet: string, at?: string}>|null} null when none are usable.
 */
function validAdjacency(adjacent) {
  if (!Array.isArray(adjacent)) return null
  const valid = adjacent
    .filter((entry) => typeof entry?.cell === 'string' && FACETS.includes(entry.facet))
    .map(({ cell, facet, at }) => (facet === 'lateral' ? { cell, facet, at: SIDES.includes(at) ? at : 'left' } : { cell, facet }))
  return valid.length ? valid : null
}

/**
 * Finds the node bound to an ApiCoord.
 *
 * @param {string|null|undefined} coordIri
 * @param {Array<{ id: string, data?: Object }>} nodes
 * @returns {string|null} The node id.
 */
export function cellNodeIdFor(coordIri, nodes) {
  if (!coordIri) return null
  return nodes.find((node) => node.data?.apiCoord?.coordIri === coordIri)?.id ?? null
}

/**
 * Gives the GO cellular components a sidecar puts its variables in, leaving out ones only on the
 * component itself.
 *
 * @param {Object|null} sidecar - From parseSidecar.
 * @returns {Set<string>}
 */
export function goLocationsOf(sidecar) {
  const locations = new Set()
  for (const { location } of sidecar?.variables ?? []) {
    if (!location || location === 'self') continue
    locations.add(location.startsWith('self+') ? location.slice('self+'.length) : location)
  }
  return locations
}

/**
 * Works out a role from an ApiCoord.
 *
 * @param {Object} coord
 * @param {Object} apiCoords - From the annotation store's getApiCoords.
 * @param {Array<Object>} nodes
 * @returns {Object|null}
 */
function fromApiCoord(coord, apiCoords, nodes) {
  switch (coord.kind) {
    case 'deployment':
      return { role: 'membraneProtein', facet: coord.facets?.[0] ?? null, cell: cellNodeIdFor(coord.within, nodes) }
    case 'facet-layer':
      return { role: 'membrane', cell: cellNodeIdFor(coord.within, nodes) }
    case 'cell':
      return { role: 'cytosol' }
    case 'layer':
      return { role: 'region', side: coord.layerIndex === 0 ? 'apical' : null }
    case 'lyph':
      return { role: 'region', side: facingLyph(apiCoords.instances ?? [])?.coordIri === coord.iri ? 'basolateral' : null }
    default:
      return null
  }
}

/**
 * Works out a role from a module's sidecar: its component kind, else where its variables are.
 *
 * @param {Object} sidecar
 * @returns {Object|null}
 */
function fromSidecar(sidecar) {
  switch (sidecar.component?.kind) {
    case 'transporter':
      return { role: 'membraneProtein' }
    case 'membrane':
      return { role: 'membrane' }
    case 'compartment':
      return { role: 'region' }
  }
  const locations = goLocationsOf(sidecar)
  if (locations.has(GO.cytoplasm) && locations.has(GO.extracellularRegion)) return { role: 'membraneProtein' }
  if (locations.size === 1 && locations.has(GO.cytoplasm)) return { role: 'cytosolic' }
  return null
}

/**
 * Works out what an instance is in the physiological view. The user's bioView choices win, then its
 * ApiCoord, then its module's sidecar.
 *
 * @param {Object} data - The node's data.
 * @param {Object} [context]
 * @param {Object|null} [context.apiCoords] - From the annotation store's getApiCoords.
 * @param {Object|null} [context.sidecar] - The parsed sidecar of the node's math.
 * @param {Array<Object>} [context.nodes] - The flow's nodes, to find cells by ApiCoord.
 * @returns {{ role: string, facet: string|null, at: string|null, annotatedFacet: string|null, cell: string|null,
 *   side: string|null, adjacent: Array<Object>|null, glyph: string|null, source: 'override'|'apiCoord'|'sidecar'|'none',
 *   site?: string }}
 *   annotatedFacet is the facet the annotations give, whatever the user chose, and null for a node bound to a
 *   template site, which the template places; side is the facet a region faces according to the annotations,
 *   and adjacent what the user said it lies against; site, only there when set, the template site it is bound to.
 */
export function resolveBioRole(data, { apiCoords = null, sidecar = null, nodes = [] } = {}) {
  const coord = data?.apiCoord?.coordIri ? apiCoords?.coords?.get(data.apiCoord.coordIri) : null
  const fromCoord = coord ? fromApiCoord(coord, apiCoords, nodes) : null
  const fromModule = !fromCoord && sidecar ? fromSidecar(sidecar) : null
  const worked = fromCoord ?? fromModule
  const source = fromCoord ? 'apiCoord' : fromModule ? 'sidecar' : 'none'
  const override = data?.bioView ?? {}

  const role = ROLES.includes(override.role) ? override.role : (worked?.role ?? 'none')
  // A facet of null, as opposed to none at all, takes the protein out of its membrane.
  const unplaced = override.facet === null
  const facet = role !== 'membraneProtein' || unplaced ? null : FACETS.includes(override.facet) ? override.facet : (worked?.facet ?? null)
  const cell = CELL_ROLES.has(role) ? (override.cell ?? worked?.cell ?? null) : null
  const site = typeof override.site === 'string' && override.site ? override.site : null
  return {
    role,
    facet,
    at: facet === 'lateral' && SIDES.includes(override.at) ? override.at : null,
    annotatedFacet: role === 'membraneProtein' && !site ? (worked?.facet ?? null) : null,
    cell,
    side: role === 'region' ? (worked?.side ?? null) : null,
    adjacent: role === 'region' ? validAdjacency(override.adjacent) : null,
    glyph: role === 'membraneProtein' ? glyphFor(sidecar?.component?.isVersionOf, override.glyph) : null,
    source: ROLES.includes(override.role) ? 'override' : source,
    ...(site && { site }),
  }
}
