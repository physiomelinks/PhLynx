/**
 * A compartment, membrane or tube is its module: each offers one one-module site, and is never without a module on
 * it. The two live in separate stores (the pieces, and the diagram's nodes bound to their sites), so the pairing is
 * kept where either is edited: an edit to the pieces is given a module for each such piece it leaves without one, and
 * deleting such a module deletes its piece. Slots (a membrane's spans, folds and process zones) hold a row of modules,
 * which may be empty.
 */

import { SIZES } from './drops.js'
import { addCompartment } from './edits.js'
import { boundToPieces, layoutPieces, pieceSiteRef } from './layout.js'
import { topologyOf } from './topology.js'
import { GAP } from '../layout.js'

/**
 * Whether a site is one a piece is the module on: a compartment's, a membrane's own or a tube's, which take one
 * module each.
 *
 * @param {{kind: 'single'|'slots'}|null|undefined} site - From topologyOf().sites, or a drop target.
 * @returns {boolean}
 */
export const isPieceModule = (site) => site?.kind === 'single'

/**
 * The sites of compartments, membranes and tubes that have no module on them, which each need one.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes - The diagram's nodes.
 * @returns {Array<{path: string, role: string, label: string, piece: string}>} In the pieces' order.
 */
export function owedSites(pieces, nodes) {
  if (!pieces.length) return []
  const { occupants } = boundToPieces(pieces, nodes)
  return topologyOf(pieces)
    .sites.filter((site) => isPieceModule(site) && !occupants.get(site.path)?.length)
    .map(({ path, role, label, piece }) => ({ path, role, label, piece }))
}

/**
 * The paths of the sites of compartments, membranes and tubes that have no module on them (see owedSites).
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes
 * @returns {string[]}
 */
export const modulesOwed = (pieces, nodes) => owedSites(pieces, nodes).map((site) => site.path)

/**
 * The compartments, membranes and tubes whose module is among the nodes going, which go with it.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes - The diagram's nodes, those going among them.
 * @param {Iterable<string>} removedIds - The node ids going.
 * @returns {string[]} Piece ids, in the pieces' order.
 */
export function piecesOrphanedBy(pieces, nodes, removedIds) {
  const going = new Set(removedIds)
  if (!pieces.length || !going.size) return []
  const { occupants } = boundToPieces(pieces, nodes)
  const orphaned = topologyOf(pieces)
    .sites.filter((site) => isPieceModule(site) && (occupants.get(site.path) ?? []).some((id) => going.has(id)))
    .map((site) => site.piece)
  return [...new Set(orphaned)]
}

/**
 * A piece's name, as it is shown: a compartment's, membrane's or tube's is its module's, the one name the two have;
 * any other piece's is its label.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes
 * @param {string} id - A piece's.
 * @returns {string} The id, for a piece there is not.
 */
export function pieceNameOf(pieces, nodes, id) {
  const [module] = modulesOf(pieces, nodes, [id])
  const name = module && nodes.find((node) => node.id === module)?.data?.name
  return name || pieces.find((piece) => piece.id === id)?.label || id
}

/**
 * The modules that are some compartments, membranes and tubes: those on their one-module sites. A question about what
 * a deletion takes names the piece, so these go unnamed.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes
 * @param {Iterable<string>} pieceIds
 * @returns {Set<string>} Node ids.
 */
export function modulesOf(pieces, nodes, pieceIds) {
  const ids = new Set(pieceIds)
  if (!pieces.length || !ids.size) return new Set()
  const { occupants } = boundToPieces(pieces, nodes)
  return new Set(
    topologyOf(pieces)
      .sites.filter((site) => isPieceModule(site) && ids.has(site.piece))
      .flatMap((site) => occupants.get(site.path) ?? []),
  )
}

/**
 * The nodes whose annotations make them a compartment's module but which are on no piece: there is never a
 * compartment's module that is not a compartment, so each is given one of its own (see compartmentsFor). A module
 * already on a piece keeps it, whatever its annotations say.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes
 * @param {(node: Object) => string|null} kindOf - What a node's annotations say its component is ('compartment',
 *   'membrane', 'transporter'), else null.
 * @returns {string[]} Node ids, in the nodes' order.
 */
export function piecesOwed(pieces, nodes, kindOf) {
  const { bound } = boundToPieces(pieces, nodes)
  return nodes.filter((node) => !bound.has(node.id) && kindOf(node) === 'compartment').map((node) => node.id)
}

/**
 * Adds a compartment standing freely for each of some nodes, to be its module: where the node's card was put, else in
 * a row right of the pieces, as cards are laid out.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes - Those to give one, each named for its compartment.
 * @returns {{pieces: Array<Object>, sites: Map<string, string>}} pieces: raw, for validatePieces; sites: node id ->
 *   the site ref of its compartment.
 */
export function compartmentsFor(pieces, nodes) {
  const rects = [...(pieces.length ? layoutPieces(pieces).rects.values() : [])]
  const size = SIZES.compartment
  let x = rects.length ? Math.max(...rects.map((rect) => rect.x + rect.width)) + GAP * 2 : 0
  const y = rects.length ? Math.min(...rects.map((rect) => rect.y)) : 0
  let raw = pieces
  const sites = new Map()
  for (const node of nodes) {
    const stored = node.data?.bioView?.position
    const at = Number.isFinite(stored?.x) && Number.isFinite(stored?.y) ? stored : { x, y }
    if (at !== stored) x += size.width + GAP
    const label = typeof node.data?.name === 'string' && node.data.name ? node.data.name : undefined
    const added = addCompartment(raw, { frame: { ...at, ...size }, label })
    raw = added.pieces
    sites.set(node.id, pieceSiteRef(added.id))
  }
  return { pieces: [...raw], sites }
}
