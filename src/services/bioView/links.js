/**
 * The links a module dropped on a template site makes with the modules on the sites next to it, and the port
 * couplings each link gives its edge. A link is typed:
 * - 'across': through a membrane, outside → protein → inside;
 * - 'flow': along a conduit, upstream → downstream (no built-in template lays one out yet);
 * - 'exchange': between neighbours with no direction, such as a protein and its membrane.
 * Directed links couple the first module's exit or general ports to the second's entrance or general ports;
 * exchange links couple general ports only. A single-connection port never joins two links.
 */

import { heldPorts, resolvePortCouplings } from '../../utils/edges.js'
import { isAnnotatedPort } from '../../utils/portIdentity.js'

/** The kinds of link. */
export const LINK_KINDS = Object.freeze(['flow', 'across', 'exchange'])

/** The port types each end of a link may couple through. */
const DIRECTED = { from: new Set(['exit_ports', 'general_ports']), to: new Set(['entrance_ports', 'general_ports']) }
const ENDS = {
  flow: DIRECTED,
  across: DIRECTED,
  exchange: { from: new Set(['general_ports']), to: new Set(['general_ports']) },
}

/**
 * Which way a neighbour's link runs, by the dropped site's role and how the neighbour lies to it (see
 * siteNeighbours): 'in' when it runs neighbour → dropped, 'out' when dropped → neighbour.
 */
const DIRECTIONS = {
  membraneProtein: { outside: ['across', 'in'], inside: ['across', 'out'] },
  // The cell is inside each protein of its membrane, a compartment outside those against it.
  cytosol: { protein: ['across', 'in'] },
  region: { protein: ['across', 'out'] },
}
/** Conduit relations, the same whatever the dropped site is. */
const FLOWS = { upstream: ['flow', 'in'], downstream: ['flow', 'out'] }

/**
 * Turns a dropped site's relationships into typed links.
 *
 * @param {string} id - The dropped node.
 * @param {string} role - Its site's role, e.g. 'membraneProtein', 'cytosol' or 'region'.
 * @param {Array<{id: string, relation: string}>} neighbours - The nodes on the sites next to it, each with how its
 *   site lies to the dropped one (see siteNeighbours and neighbourNodes).
 * @returns {Array<{from: string, to: string, kind: 'flow'|'across'|'exchange'}>} One per neighbour, in order.
 */
export function siteLinks(id, role, neighbours) {
  return neighbours.map(({ id: other, relation }) => {
    const [kind, way] = FLOWS[relation] ?? DIRECTIONS[role]?.[relation] ?? ['exchange', 'out']
    return way === 'in' ? { from: other, to: id, kind } : { from: id, to: other, kind }
  })
}

/**
 * The port couplings a link gives an edge from its `from` node to its `to` node: label matches (see
 * resolvePortCouplings) between the ends the kind allows, past any single-connection port another edge already
 * couples.
 *
 * @param {{id: string, ports?: Array<Object>}} from
 * @param {{id: string, ports?: Array<Object>}} to
 * @param {'flow'|'across'|'exchange'} kind
 * @param {Array<Object>} [edges] - The workspace's edges, before this one.
 * @returns {Array<{sourcePort: Object, targetPort: Object}>}
 */
export function linkCouplings(from, to, kind, edges = []) {
  const ends = ENDS[kind] ?? ENDS.exchange
  // The Nth edge out of the source and into the target, as in out_modules / inp_modules.
  const sourceIndex = edges.filter((e) => e.source === from.id).length
  const targetIndex = edges.filter((e) => e.target === to.id).length
  // The edge this link makes is not among them yet, so every edge given is another's.
  const self = `${from.id}--${to.id}`
  const held = new Set([
    ...heldPorts(from.id, from.ports ?? [], edges, self),
    ...heldPorts(to.id, to.ports ?? [], edges, self),
  ])
  return resolvePortCouplings(from.ports ?? [], to.ports ?? [], sourceIndex, targetIndex, { held }).filter(
    (coupling) => ends.from.has(coupling.sourcePort.portType) && ends.to.has(coupling.targetPort.portType)
  )
}

/**
 * Whether placement made an edge, so a move that takes one end away from the other may remove it. The edges a
 * drop makes carry their link's kind in data.placement; an edge drawn or edited by hand has data.placement false.
 * An edge with neither comes from a workspace saved before edges were marked: it counts as placement-made when
 * every coupling it has is annotation-driven (or it has none) and it keeps no manual couplings aside, since a drop
 * between annotated modules couples only through annotated ports while hand-made couplings go through manual ones.
 *
 * @param {{data?: Object}} edge
 * @returns {boolean}
 */
export function isPlacementEdge(edge) {
  const { placement, couplings = [], manualCouplings } = edge?.data ?? {}
  if (placement !== undefined) return !!placement
  if (manualCouplings?.length) return false
  return couplings.every(({ sourcePort, targetPort }) => isAnnotatedPort(sourcePort) && isAnnotatedPort(targetPort))
}

/**
 * The edges a node's move leaves behind: those between it and the nodes it lay next to before and no longer does.
 * Those placement made go (see isPlacementEdge); those drawn or edited by hand stay, apart, so the user can be
 * told.
 *
 * @param {string} id - The moved node.
 * @param {Iterable<string>} before - Its neighbours where it was.
 * @param {Iterable<string>} after - Its neighbours where it is now.
 * @param {Array<{source: string, target: string, data?: Object}>} edges - The workspace's edges.
 * @returns {{remove: Array<Object>, keep: Array<Object>}}
 */
export function staleLinks(id, before, after, edges) {
  const kept = new Set(after)
  const former = new Set([...before].filter((other) => other !== id && !kept.has(other)))
  const stale = edges.filter(
    ({ source, target }) => (source === id && former.has(target)) || (target === id && former.has(source))
  )
  return { remove: stale.filter(isPlacementEdge), keep: stale.filter((edge) => !isPlacementEdge(edge)) }
}

/**
 * Whether a module or node has ports to couple through.
 *
 * @param {Object} [holder] - A node's data or a library module, with its `ports`.
 * @returns {boolean}
 */
export const hasPorts = (holder) => !!holder?.ports?.length

/** What a drop on each kind of area makes; a compartment is said by its own label. */
const AREA_WORDS = { cell: 'intracellular space', membrane: 'membrane', process: 'new process' }

/**
 * Names a drop target for the label that follows the pointer, with what the drop makes there: the cell's inside
 * or its membrane, a new protein or process, or one put before the protein or process in a slot.
 *
 * @param {Object} site - A drop target, from dropSites.
 * @param {(id: string) => string} [nameOf] - A node's name.
 * @returns {string}
 */
export function siteLabel(site, nameOf = (id) => id) {
  if (site.type === 'area') return AREA_WORDS[site.area] ? `${site.label} (${AREA_WORDS[site.area]})` : site.label
  const what = site.role === 'cytosolic' ? 'process' : 'protein'
  return site.occupant ? `${site.label} (${what}, before ${nameOf(site.occupant)})` : `${site.label} (new ${what})`
}

/**
 * The label a drop on a template site shows: the site, the neighbours it couples to, and, when the dropped module
 * or a neighbour has no ports, that those edges are placed but not coupled.
 *
 * @param {string} siteLabel
 * @param {{name: string, hasPorts: boolean}} dropped
 * @param {Array<{label: string, name: string, hasPorts: boolean}>} neighbours - The nodes on the sites next to it.
 * @returns {string}
 */
export function dropLabel(siteLabel, dropped, neighbours) {
  if (!neighbours.length) return siteLabel
  const coupled = dropped.hasPorts ? neighbours.filter((n) => n.hasPorts) : []
  const portless = dropped.hasPorts
    ? [...new Set(neighbours.filter((n) => !n.hasPorts).map((n) => n.name))]
    : [dropped.name]
  const parts = [siteLabel]
  if (coupled.length) parts.push(`connects to ${coupled.map((n) => `${n.label} (${n.name})`).join(', ')}`)
  if (portless.length) {
    parts.push(`Placed — not coupled (${portless.join(', ')} ${portless.length > 1 ? 'have' : 'has'} no ports)`)
  }
  return parts.join(' · ')
}
