/**
 * Moving and resizing the pieces, as dragging them does: each takes the validated pieces and where each is drawn
 * (layoutPieces' rects) and gives a new raw list, which validatePieces then checks. Positions are in the view's
 * coordinates; frames are written from the corner of what a piece stands in.
 */

import { INNER_INSET, LIMITS } from './constants.js'
import { fluxBetween, isDefaultTubeName, tubeName } from './edits.js'
import { topologyOf } from './topology.js'

/** How short a span another's slide may leave it, as a share of its side. */
const LEAST_SPAN = 0.05
/** How far in from its parent's corner a child is kept. */
const INSET = 8

const copy = (pieces) => JSON.parse(JSON.stringify(pieces))
const round = (value) => Math.round(value)
const fraction = (value) => Math.round(value * 1000) / 1000
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const isAcross = (side) => side === 'top' || side === 'bottom'

/**
 * How a piece can be dragged: by its frame (a membrane, a compartment standing freely, a process zone), along its
 * side (a compartment docked along one stretch of a membrane's side), or not at all.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @returns {'frame'|'slide'|null}
 */
export function dragModeOf(pieces, id) {
  const piece = pieces.find((each) => each.id === id)
  if (!piece) return null
  if (piece.kind === 'membrane' || piece.kind === 'zone') return 'frame'
  if (piece.kind !== 'compartment') return null
  const topology = topologyOf(pieces)
  if (!piece.docks?.length) return topology.enclosureOf(id) ? null : 'frame'
  const [dock] = piece.docks
  const onFold = pieces.find((each) => each.id === dock.on)?.kind === 'fold'
  // Along one stretch of one side, with room to go: a full side has none.
  return piece.docks.length === 1 && !onFold && (dock.from > 0 || dock.to < 1) ? 'slide' : null
}

/** The rect a piece's frame is measured from: what it stands in, or the view's corner. */
function cornerOf(piece, rects) {
  const parent = piece.kind === 'zone' ? piece.compartment : piece.parent
  return (parent && rects.get(parent)) || { x: 0, y: 0 }
}

/**
 * A piece's frame, or where it is drawn now as one, from the corner of what it stands in. A frame is taken from where
 * the piece is drawn, which is elsewhere where it was moved clear of a fold, so a drag starts from what is seen.
 */
function frameOf(piece, rects) {
  const rect = rects.get(piece.id)
  const corner = cornerOf(piece, rects)
  const drawn = rect && { x: rect.x - corner.x, y: rect.y - corner.y }
  if (piece.frame) return { ...piece.frame, ...drawn }
  return rect ? { ...drawn, width: rect.width, height: rect.height } : null
}

/**
 * Gives the other zones in a zone's compartment that are laid out in rows a frame where they are drawn, so moving or
 * resizing the one leaves them where they are, for the user to place, rather than making way for it. A fold moving
 * still moves them clear of it, as it does any piece standing by its frame.
 */
function pinSiblingZones(raw, piece, rects) {
  if (piece.kind !== 'zone') return
  for (const other of raw) {
    if (other === piece || other.kind !== 'zone' || other.compartment !== piece.compartment || other.frame) continue
    const drawn = frameOf(other, rects)
    if (!drawn) continue
    other.frame = { x: round(drawn.x), y: round(drawn.y), width: round(drawn.width), height: round(drawn.height) }
  }
}

/** How near a piece standing in what `parent` names may come to its corner. */
const lowOf = (parent) => (parent ? INSET : LIMITS.at.min)

/**
 * Moves a piece with a frame by how far it was dragged. One standing in a compartment is kept from going out of its
 * top or left; past its right or bottom, the compartment grows to hold it. A cell takes the cells joined to it by gap
 * junctions with it, all as far, so their membranes stay together: a junction is never pulled apart by a drag.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @param {{x: number, y: number}} delta - How far, in the view's coordinates.
 * @param {Map<string, Object>} rects - From layoutPieces.
 * @returns {Array<Object>|null} Null where it can't move so.
 */
export function moveFrame(pieces, id, delta, rects) {
  const raw = copy(pieces)
  const piece = raw.find((each) => each.id === id)
  if (!piece || !frameOf(piece, rects)) return null
  const group = piece.kind === 'membrane' ? topologyOf(pieces).junctionGroupOf(id) : [id]
  const moving = group.map((each) => raw.find((other) => other.id === each))
  const starts = moving.map((each) => frameOf(each, rects))
  if (starts.some((start) => !start)) return null
  // The size drawn now: a membrane's frame is only its least. All go as far, as far as each may.
  const parent = piece.kind === 'zone' ? piece.compartment : piece.parent
  const low = lowOf(parent)
  const along = (axis) =>
    clamp(
      delta[axis],
      Math.max(...starts.map((start) => low - start[axis])),
      Math.min(...starts.map((start) => LIMITS.at.max - start[axis])),
    )
  const shift = { x: along('x'), y: along('y') }
  moving.forEach((each, index) => {
    const start = starts[index]
    each.frame = { ...start, x: round(start.x + shift.x), y: round(start.y + shift.y) }
  })
  pinSiblingZones(raw, piece, rects)
  return raw
}

/** Which side of a rect another lies on: the axis they overlap least along, the way its middle is. */
function sideOf(rect, other) {
  const apartX = Math.max(other.x - (rect.x + rect.width), rect.x - (other.x + other.width))
  const apartY = Math.max(other.y - (rect.y + rect.height), rect.y - (other.y + other.height))
  if (apartX >= apartY) return other.x + other.width / 2 >= rect.x + rect.width / 2 ? 'right' : 'left'
  return other.y + other.height / 2 >= rect.y + rect.height / 2 ? 'bottom' : 'top'
}

/**
 * Keeps the cells joined to a resized cell by gap junctions against it: each goes as far as the side of the cell it
 * lies against has, taking the cells joined on beyond it with it.
 *
 * @param {Array<Object>} raw - The pieces resized, changed in place.
 * @param {ReadonlyArray<Object>} pieces - Before the resize.
 * @param {string} id - The membrane resized.
 * @param {Map<string, Object>} before - Where each was drawn before the resize.
 * @param {Map<string, Object>|null} after - Where each is drawn after it.
 */
function keepJunctionsTouching(raw, pieces, id, before, after) {
  const topology = topologyOf(pieces)
  const was = before.get(id)
  const now = after?.get(id)
  if (!was || !now) return
  const edges = {
    left: { x: now.x - was.x, y: 0 },
    right: { x: now.x + now.width - (was.x + was.width), y: 0 },
    top: { x: 0, y: now.y - was.y },
    bottom: { x: 0, y: now.y + now.height - (was.y + was.height) },
  }
  // Each cell against it goes as its side does; those joined on beyond go as the one they are reached through.
  const shifts = new Map([[id, null]])
  const queue = []
  for (const other of topology.junctionNeighbours(id)) {
    const rect = before.get(other)
    if (!rect) continue
    shifts.set(other, edges[sideOf(was, rect)])
    queue.push(other)
  }
  while (queue.length) {
    const at = queue.shift()
    for (const other of topology.junctionNeighbours(at)) {
      if (shifts.has(other)) continue
      shifts.set(other, shifts.get(at))
      queue.push(other)
    }
  }
  for (const [other, shift] of shifts) {
    if (!shift || (!shift.x && !shift.y)) continue
    const piece = raw.find((each) => each.id === other)
    const start = frameOf(piece, before)
    if (!start) continue
    const low = lowOf(piece.parent)
    piece.frame = {
      ...start,
      x: round(clamp(start.x + shift.x, low, LIMITS.at.max)),
      y: round(clamp(start.y + shift.y, low, LIMITS.at.max)),
    }
  }
}

/**
 * Sets the rect a piece with a frame is drawn at, as a resize leaves it. A membrane's is its least size: it still
 * grows for what is on and in it. Given `rectsOf`, a cell resized moves the cells joined to it by gap junctions so
 * they stay against it, as far as the side each is against moves where it is then drawn.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @param {{x: number, y: number, width: number, height: number}} rect - In the view's coordinates.
 * @param {Map<string, Object>} rects
 * @param {Object} [options]
 * @param {(raw: Array<Object>) => Map<string, Object>|null} [options.rectsOf] - Where pieces are drawn, as
 *   layoutPieces' rects; null where they don't validate.
 * @returns {Array<Object>|null}
 */
export function resizeFrame(pieces, id, rect, rects, { rectsOf } = {}) {
  const raw = copy(pieces)
  const piece = raw.find((each) => each.id === id)
  if (!piece) return null
  const corner = cornerOf(piece, rects)
  const size = (value) => round(clamp(value, LIMITS.size.min, LIMITS.size.max))
  piece.frame = {
    x: round(rect.x - corner.x),
    y: round(rect.y - corner.y),
    width: size(rect.width),
    height: size(rect.height),
  }
  pinSiblingZones(raw, piece, rects)
  if (rectsOf && piece.kind === 'membrane' && topologyOf(pieces).junctionNeighbours(id).length) {
    keepJunctionsTouching(raw, pieces, id, rects, rectsOf(raw))
  }
  return raw
}

/**
 * Gives a membrane, compartment or zone back the size its contents need, dropping the larger size it was given.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @returns {Array<Object>|null} Null for a piece with no frame.
 */
export function fitToContents(pieces, id) {
  const raw = copy(pieces)
  const piece = raw.find((each) => each.id === id)
  if (!piece?.frame) return null
  piece.frame = { ...piece.frame, width: LIMITS.size.min, height: LIMITS.size.min }
  return raw
}

/**
 * Slides a compartment docked along one stretch of a membrane's side along it, by how far it was dragged that way,
 * up to the docks either side of it on the same face. Its span goes with it, the spans next to it giving way.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @param {{x: number, y: number}} delta
 * @param {Map<string, Object>} rects
 * @returns {Array<Object>|null}
 */
export function slideDock(pieces, id, delta, rects) {
  if (dragModeOf(pieces, id) !== 'slide') return null
  const raw = copy(pieces)
  const piece = raw.find((each) => each.id === id)
  const [dock] = piece.docks
  const from = dock.from ?? 0
  const to = dock.to ?? 1
  const membrane = raw.find((each) => each.id === dock.on)
  const rect = rects.get(membrane.id)
  if (!rect) return null
  const length = isAcross(dock.side) ? rect.width : rect.height
  let shift = (isAcross(dock.side) ? delta.x : delta.y) / length
  // Not past the docks either side of it, on the same face of the same side.
  const others = raw
    .filter((each) => each.id !== id)
    .flatMap((each) => each.docks ?? [])
    .filter((each) => each.on === dock.on && each.side === dock.side && each.face === dock.face)
  const before = Math.max(0, ...others.filter((each) => (each.to ?? 1) <= from).map((each) => each.to ?? 1))
  const after = Math.min(1, ...others.filter((each) => (each.from ?? 0) >= to).map((each) => each.from ?? 0))
  // Nor so far that a span next to its own is left too short.
  const spans = membrane.sides[dock.side]
  const own = spans.findIndex((span) => span.from === from && span.to === to)
  const room = (span) => (span ? span.to - span.from - LEAST_SPAN : Infinity)
  const back = Math.min(from - before, own >= 0 ? room(spans[own - 1]) : Infinity)
  const ahead = Math.min(after - to, own >= 0 ? room(spans[own + 1]) : Infinity)
  shift = clamp(shift, -Math.max(0, back), Math.max(0, ahead))
  const next = { from: fraction(from + shift), to: fraction(to + shift) }
  dock.from = next.from
  dock.to = next.to
  if (!dock.from) delete dock.from
  if (dock.to === 1) delete dock.to
  // Its span moves with it: the one before ends where it starts, and the one after starts where it ends.
  if (own >= 0) {
    if (spans[own - 1]) spans[own - 1].to = next.from
    spans[own].from = next.from
    spans[own].to = next.to
    if (spans[own + 1]) spans[own + 1].from = next.to
  }
  // Written as a template writes spans: each with its end, the last running to the end of the side.
  membrane.sides[dock.side] = spans.map(({ from: _, to: end, ...span }, index) =>
    index === spans.length - 1 ? span : { ...span, to: end },
  )
  return raw
}

/**
 * Sets how far a docked compartment reaches from its docks, as resizing it across its side does.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @param {number} depth
 * @returns {Array<Object>|null}
 */
export function setDepth(pieces, id, depth) {
  const raw = copy(pieces)
  const piece = raw.find((each) => each.id === id)
  if (!piece?.docks?.length) return null
  piece.depth = round(clamp(depth, LIMITS.depth.min, LIMITS.depth.max))
  return raw
}

/**
 * Sets how far a compartment docked along one side reaches, as its far edge's grip, dragged to a point, leaves it:
 * out from the side for one docked outside, in from it for one docked inside.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @param {{x: number, y: number}} point - Where the grip is.
 * @param {Map<string, Object>} rects
 * @returns {Array<Object>|null}
 */
export function reachTo(pieces, id, point, rects) {
  const piece = pieces.find((each) => each.id === id)
  const dock = piece?.docks?.length === 1 && piece.docks[0]
  const rect = dock?.side && rects.get(dock.on)
  if (!rect) return null
  const out = {
    top: rect.y - point.y,
    bottom: point.y - rect.y - rect.height,
    left: rect.x - point.x,
    right: point.x - rect.x - rect.width,
  }[dock.side]
  return setDepth(pieces, id, dock.face === 'outside' ? out : -out - INNER_INSET)
}

/**
 * Moves a fold to where its grip, at its far end, is dragged: along its side, and as deep in.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @param {{x: number, y: number}} point - Where the grip is.
 * @param {Map<string, Object>} rects
 * @returns {Array<Object>|null}
 */
export function moveFold(pieces, id, point, rects) {
  const raw = copy(pieces)
  const fold = raw.find((each) => each.id === id)
  const rect = fold && rects.get(fold.membrane)
  if (!rect) return null
  const across = isAcross(fold.side)
  fold.at = fraction(clamp(across ? (point.x - rect.x) / rect.width : (point.y - rect.y) / rect.height, 0.05, 0.95))
  const inward = {
    top: point.y - rect.y,
    bottom: rect.y + rect.height - point.y,
    left: point.x - rect.x,
    right: rect.x + rect.width - point.x,
  }[fold.side]
  // The grip is at the fold's far end, so the fold is as deep as the grip is in.
  fold.depth = round(clamp(inward, LIMITS.fold.min, LIMITS.fold.max))
  return raw
}

/**
 * Bends a tube through a point: its way runs square through it, its module's room there.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @param {{x: number, y: number}|null} point - Null to straighten it again.
 * @returns {Array<Object>|null}
 */
export function bendTube(pieces, id, point) {
  const raw = copy(pieces)
  const tube = raw.find((each) => each.id === id)
  if (tube?.kind !== 'tube') return null
  if (point) tube.bends = [{ x: round(point.x), y: round(point.y) }]
  else delete tube.bends
  return raw
}

/**
 * Joins one end of a tube to another compartment, carrying what a tube added between the two would: a gap junction
 * between two cells unless `flux` makes it a bridge, an open channel within one cell, else a flow. A diffusion is
 * kept, being no tube's by default. Its name follows what it carries, unless someone has named it.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @param {string} id
 * @param {0|1} end - Upstream (0) or downstream (1).
 * @param {string} compartment
 * @param {string} [flux] - What it carries, where the user chose; else worked out from what it joins.
 * @returns {Array<Object>|null} Null where it would join a compartment to itself.
 */
export function reattachTube(pieces, id, end, compartment, flux) {
  const raw = copy(pieces)
  const tube = raw.find((each) => each.id === id)
  if (tube?.kind !== 'tube' || tube.ends[1 - end] === compartment) return null
  tube.ends[end] = compartment
  delete tube.bends
  const was = tube.flux
  if (was !== 'diffusion') tube.flux = flux ?? fluxBetween(raw, tube.ends)
  if (tube.flux !== was && isDefaultTubeName(tube.label, was)) {
    tube.label = tubeName(
      raw.filter((each) => each.id !== id),
      tube.flux,
    )
  }
  return raw
}
