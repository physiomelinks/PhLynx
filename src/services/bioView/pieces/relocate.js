/**
 * Taking a piece already on the view out of where it is and putting it somewhere else: standing in another
 * compartment or on the view, or docked against a membrane's side. Each takes the validated pieces and where each is
 * drawn (layoutPieces' rects) and gives { pieces, id } (raw, for validatePieces) or { pieces: null, error }, as a
 * drop's apply does (see drops.js). Modules stay on the pieces they are on, which keep their ids.
 */

import { LIMITS, ROOM_INSIDE, containerIdOf, isWithinPiece } from './constants.js'
import { cutStretch, refluxTubes } from './edits.js'
import { writtenPieces } from './model.js'
import { topologyOf } from './topology.js'

/** How far in from its compartment's corner a process zone is kept, at least (see moves.js). */
const ZONE_INSET = 8
/** How far from what it is moved out of a piece is put. */
const OUT_GAP = 40

const copy = writtenPieces
const round = (value) => Math.round(value)
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const fail = (error) => ({ pieces: null, id: null, error })

/** What a piece stands in, as it is written: a zone's compartment, another's parent; null for the view. */
const containerOf = (piece) => containerIdOf(piece) ?? null

/**
 * What is lifted with a piece: a compartment or process zone itself, or a cell whole (its membrane, taken for a
 * compartment that fills one) with every cell joined to it by gap junctions, which are never pulled apart; and with
 * each, all that stands in it, is a fold of it, or is docked to it and to nothing left behind. A compartment docked
 * to something left behind as well stays against that. Tubes are not lifted: they keep their ends.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {string} id
 * @returns {{root: string, kind: 'compartment'|'cell'|'zone', label: string, tops: string[], ids: Set<string>}|
 *   {error: string}} root: the piece that is lifted (a cell's membrane); tops: it, and the cells joined to it; error:
 *   why it can't be lifted.
 */
export function liftedWith(pieces, id) {
  const topology = topologyOf(pieces)
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  let piece = byId.get(id)
  let label = piece?.label
  if (piece?.kind === 'compartment') {
    const enclosure = topology.enclosureOf(id)
    const bulk = enclosure && topology.bulkOf(enclosure)
    if (bulk === id) piece = byId.get(enclosure)
    else if (enclosure && !bulk) {
      const cell = byId.get(enclosure).label
      return { error: `${piece.label} is part of the inside of ${cell}, which has no other: it stays where it is.` }
    }
  } else if (piece?.kind === 'membrane') label = byId.get(topology.bulkOf(id))?.label ?? label
  if (piece?.kind === 'image') return { error: 'An image stays on the canvas: drag it to move it there.' }
  if (!['compartment', 'membrane', 'zone'].includes(piece?.kind)) {
    return { error: 'Only a compartment, a cell or a process zone can be moved somewhere else.' }
  }
  const tops = piece.kind === 'membrane' ? topology.junctionGroupOf(piece.id) : [piece.id]
  const ids = new Set(tops)
  for (const top of tops) for (const enclosed of byId.get(top).encloses ?? []) ids.add(enclosed)
  const goesWith = (each) =>
    ids.has(each.parent) ||
    (isWithinPiece(each) && ids.has(each.compartment)) ||
    (each.kind === 'fold' && ids.has(each.membrane)) ||
    (!!each.docks?.length && each.docks.every((dock) => ids.has(dock.on)))
  for (let grew = true; grew;) {
    grew = false
    for (const each of pieces) {
      if (each.kind === 'tube' || ids.has(each.id) || !goesWith(each)) continue
      ids.add(each.id)
      grew = true
    }
  }
  return { root: piece.id, kind: piece.kind === 'membrane' ? 'cell' : piece.kind, label, tops, ids }
}

/**
 * The compartment a piece would stand in were it let go of where it is: the one it stands in, or for a compartment
 * a membrane encloses beside its bulk, that bulk.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {string} id
 * @returns {string|null} Null for the view, or no such piece.
 */
export function standingIn(pieces, id) {
  const piece = pieces.find((each) => each.id === id)
  if (!piece) return null
  if (piece.kind === 'compartment') {
    const topology = topologyOf(pieces)
    const enclosure = topology.enclosureOf(id)
    const bulk = enclosure && topology.bulkOf(enclosure)
    if (bulk && bulk !== id) return bulk
  }
  return containerOf(piece)
}

/** Takes what is left behind off what was lifted: each compartment against both keeps its other docks. */
function leaveBehind(raw, ids) {
  for (const piece of raw) {
    if (ids.has(piece.id) || !piece.docks) continue
    piece.docks = piece.docks.filter((dock) => !ids.has(dock.on))
  }
}

/** Takes a compartment off every membrane: its docks, and its place among what one encloses. */
function letGo(raw, compartment) {
  delete compartment.docks
  delete compartment.depth
  for (const each of raw) {
    if (each.kind === 'membrane') each.encloses = each.encloses.filter((id) => id !== compartment.id)
  }
}

/**
 * Stands a piece in a compartment, or on the view, moved by `shift` from where it is drawn: a compartment loses its
 * docks and stands by a frame its size, a cell goes whole with the cells joined to it, a process zone goes to the
 * compartment (it has to have one). Standing where it stood already, it is only detached, or moved.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {string} id
 * @param {{parent?: string|null, shift?: {x: number, y: number}}} to - The compartment it goes in (null: the view),
 *   and how far it moves, in the view's coordinates.
 * @param {Map<string, Object>} rects - From layoutPieces.
 * @returns {{pieces: Array<Object>|null, id: string|null, error?: string}}
 */
export function standPiece(pieces, id, { parent = null, shift = { x: 0, y: 0 } } = {}, rects) {
  const lifted = liftedWith(pieces, id)
  if (lifted.error) return fail(lifted.error)
  if (parent && lifted.ids.has(parent)) return fail(`${lifted.label} can’t go inside itself.`)
  if (parent && pieces.find((piece) => piece.id === parent)?.kind !== 'compartment') {
    return fail('It can only stand in a compartment, or on the view.')
  }
  if (lifted.kind === 'zone' && !parent) return fail('A process zone goes in a compartment.')
  const corner = parent ? rects.get(parent) : { x: 0, y: 0 }
  if (!corner) return fail('That compartment has no place yet.')
  const raw = copy(pieces)
  const root = raw.find((piece) => piece.id === lifted.root)
  if (root.kind === 'compartment') letGo(raw, root)
  leaveBehind(raw, lifted.ids)
  const enclosed = new Set(raw.flatMap((piece) => (lifted.ids.has(piece.id) && piece.encloses) || []))
  // Those lifted that stand in nothing lifted go to the new place; the rest follow what they stand in.
  const tops = raw.filter(
    (piece) => lifted.ids.has(piece.id) && ['compartment', 'membrane', 'zone'].includes(piece.kind),
  )
  const framed = []
  for (const piece of tops) {
    if (lifted.ids.has(containerOf(piece))) continue
    if (isWithinPiece(piece)) piece.compartment = parent
    else if (parent) piece.parent = parent
    else delete piece.parent
    // Drawn by its own frame: a membrane, a zone, and a compartment neither docked nor enclosed.
    if (piece.kind === 'compartment' && (piece.docks?.length || enclosed.has(piece.id))) continue
    const rect = rects.get(piece.id)
    if (!rect) return fail(`${piece.label} has no place yet.`)
    const size = piece.frame ?? rect
    framed.push({
      piece,
      frame: { x: rect.x + shift.x - corner.x, y: rect.y + shift.y - corner.y, width: size.width, height: size.height },
    })
  }
  // Kept in from the top and left of what it stands in, all as far; that grows to hold it at its right and bottom.
  const low = !parent ? LIMITS.at.min : isWithinPiece({ kind: lifted.kind }) ? ZONE_INSET : ROOM_INSIDE
  const nudge = (axis) => Math.max(0, low - Math.min(...framed.map(({ frame }) => frame[axis])))
  const [dx, dy] = [nudge('x'), nudge('y')]
  for (const { piece, frame } of framed) {
    piece.frame = {
      x: round(clamp(frame.x + dx, LIMITS.at.min, LIMITS.at.max)),
      y: round(clamp(frame.y + dy, LIMITS.at.min, LIMITS.at.max)),
      width: round(clamp(frame.width, LIMITS.size.min, LIMITS.size.max)),
      height: round(clamp(frame.height, LIMITS.size.min, LIMITS.size.max)),
    }
  }
  refluxTubes(raw, lifted.ids)
  return { pieces: raw, id: lifted.root }
}

/**
 * Docks a compartment already on the view against a stretch of a membrane's side, in place of wherever it was: inside
 * (standing in the membrane's bulk, or among what it encloses where it has none) or outside (standing where the
 * membrane does). It reaches as far from the side as it was drawn across it, and what stands in it goes with it. The
 * stretch becomes a span of its own, as for a compartment dropped there (see dockCompartment).
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {string} id
 * @param {{on: string, side: string, face: 'inside'|'outside', from?: number, to?: number}} dock
 * @param {Map<string, Object>} rects - From layoutPieces.
 * @returns {{pieces: Array<Object>|null, id: string|null, error?: string}}
 */
export function dockPiece(pieces, id, { on, side, face, from = 0, to = 1 }, rects) {
  const lifted = liftedWith(pieces, id)
  if (lifted.error) return fail(lifted.error)
  if (lifted.kind !== 'compartment') {
    return fail('Only a compartment can be docked against a membrane; cells are joined by tubes.')
  }
  const validated = pieces.find((piece) => piece.id === on)
  if (validated?.kind !== 'membrane') return fail('It can only be docked to a membrane’s side.')
  if (lifted.ids.has(on)) return fail(`${lifted.label} can’t be docked to what is inside it.`)
  const bulk = topologyOf(pieces).bulkOf(on)
  const raw = copy(pieces)
  const root = raw.find((piece) => piece.id === id)
  const membrane = raw.find((piece) => piece.id === on)
  const rect = rects.get(id)
  letGo(raw, root)
  leaveBehind(raw, lifted.ids)
  delete root.frame
  if (rect) {
    const reach = side === 'top' || side === 'bottom' ? rect.height : rect.width
    root.depth = round(clamp(reach, LIMITS.depth.min, LIMITS.depth.max))
  }
  root.docks = [{ on, side, face, ...(from > 0 && { from }), ...(to < 1 && { to }) }]
  const parent = face === 'inside' ? (bulk ?? membrane.parent) : membrane.parent
  if (parent) root.parent = parent
  else delete root.parent
  if (face === 'inside' && !bulk) membrane.encloses.push(id)
  cutStretch(membrane, validated, side, from, to, id, root.label)
  refluxTubes(raw, lifted.ids)
  return { pieces: raw, id }
}

/**
 * Takes a docked compartment off every membrane it is against, leaving it standing where it is drawn.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {string} id
 * @param {Map<string, Object>} rects - From layoutPieces.
 * @returns {{pieces: Array<Object>|null, id: string|null, error?: string}}
 */
export function detachPiece(pieces, id, rects) {
  const piece = pieces.find((each) => each.id === id)
  if (piece?.kind !== 'compartment' || !piece.docks?.length) return fail('It is against no membrane.')
  return standPiece(pieces, id, { parent: standingIn(pieces, id) }, rects)
}

/**
 * What a piece can be moved out of: the compartment it stands in, with the piece it is drawn as (a cell's membrane,
 * for its inside).
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {string} id
 * @returns {{id: string, label: string, drawn: string, parent: string|null}|null} Null for one on the view, or one
 *   that can't be lifted.
 */
export function outOf(pieces, id) {
  const lifted = liftedWith(pieces, id)
  if (lifted.error || isWithinPiece({ kind: lifted.kind })) return null
  const within = pieces.find((piece) => piece.id === standingIn(pieces, lifted.root))
  if (!within) return null
  return {
    id: within.id,
    label: within.label,
    drawn: topologyOf(pieces).enclosureOf(within.id) ?? within.id,
    parent: within.parent ?? null,
  }
}

/**
 * Moves a compartment or cell out of the compartment it stands in, to stand beside it: to its right, level with its
 * top.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {string} id
 * @param {Map<string, Object>} rects - From layoutPieces.
 * @returns {{pieces: Array<Object>|null, id: string|null, error?: string}}
 */
export function moveOut(pieces, id, rects) {
  const lifted = liftedWith(pieces, id)
  if (lifted.error) return fail(lifted.error)
  const from = outOf(pieces, id)
  const [rect, beside] = [rects.get(lifted.root), from && rects.get(from.drawn)]
  if (!from || !rect || !beside) return fail('It stands in no compartment to move out of.')
  const shift = { x: beside.x + beside.width + OUT_GAP - rect.x, y: beside.y - rect.y }
  return standPiece(pieces, id, { parent: from.parent, shift }, rects)
}
