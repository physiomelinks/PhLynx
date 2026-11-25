/**
 * Lays out the pieces of the physiology view (schema 4): one pure pass, the same every time, from the pieces alone.
 *
 * 1. Sizes, from the inside out: a membrane is as big as its frame says, at least, and grows for the proteins on its
 *    spans and for what stands in its bulk; a compartment standing freely grows for what stands in it.
 * 2. Places, from the outside in: each piece from its parent's corner, by its frame, or in a row where it has none.
 *    What a membrane encloses undocked (its bulk) fills it; a docked compartment is drawn from its docks.
 * 3. Tubes, between their ends: a right-angle path, or a joint where the two ends touch.
 *
 * The places are in the vocabulary the view already draws (see bioFlowNodes): a membrane is a 'cell', a compartment
 * that isn't a bulk a 'region', a tube a 'link'; a process zone is a 'zone', an image an 'image'. Each is keyed by
 * pieceKey(id) and says
 * which piece it is (`piece`) and which site it offers (`site`, a pieceSiteRef, or null).
 */

import { cellHint, CARD, GAP, processZone, REGION_HEIGHT, SIDE_REGION_WIDTH, SURROUND_DEPTH, TUBE } from '../layout.js'
import {
  CELL_RADIUS,
  FOLD,
  SYMBOL_HEIGHT,
  SYMBOL_WIDTH,
  MEMBRANE_BAND_HALF,
  MIN_CELL,
  fitCellRect,
  foldDepthFor,
  foldPocket,
  facetSlots,
  foldPoint,
  proteinPlacement,
} from '../geometry.js'
import { LABEL_GAP } from '../metrics.js'
import { byName, inSlotOrder } from '../slotOrder.js'
import { parseSiteRef } from '../siteRefs.js'
import { withFolds } from '../shape.js'
import { contextOfPiece } from '../skinContext.js'
import { resolveSkin } from '../skinRegistry.js'
import { INNER_INSET, LIMITS, ROOM_INSIDE, isDefaultZoneLabel, isWithinPiece } from './constants.js'
import { dragModeOf } from './moves.js'
import { spanPath, topologyOf } from './topology.js'
import { nameFits, nameInUpperCorner, proteinReach } from '../speciesLayout.js'

/** The key a piece's place has in the view's layout. */
export const pieceKey = (id) => `pc:${id}`

/** The instance a site of the pieces is named under, as a template instance's sites are. */
export const PIECES_INSTANCE = 'pieces'

/** A site of the pieces, as a node's bioView names it. */
export const pieceSiteRef = (path) => `${PIECES_INSTANCE}/${path}`

/** The smallest an organelle's membrane is drawn. */
const ORGANELLE_MIN = Object.freeze({ width: 200, height: 140 })
/**
 * The smallest a membrane with a frame is drawn: room for its rounded corners and its band, no more. A membrane
 * dropped on a compartment is framed as the compartment was, so it takes that size, and grows only for what it
 * holds, not to the size a cell with no frame is drawn at.
 */
const FRAMED_MIN = Object.freeze({ width: 3 * CELL_RADIUS, height: 3 * CELL_RADIUS })
/** How big a compartment standing freely is drawn unless its frame says. */
const FREE_COMPARTMENT = Object.freeze({ width: 320, height: REGION_HEIGHT })
/** Room by what stands in a row inside a compartment with no frame of its own, and between two in the row. */
const ROOM = SYMBOL_HEIGHT / 2 + 36
/** How far a compartment docked inside a membrane reaches unless it says (it starts INNER_INSET in). */
const INNER_DEPTH = 84
/**
 * How far clear of a fold's walls and end what stands in its cell keeps: the membrane's band and the proteins on the
 * walls, which stand half out into the cell.
 */
const FOLD_CLEARANCE = SYMBOL_WIDTH / 2 + MEMBRANE_BAND_HALF
/** How many times a cell is laid out again to fit what stands in it round its folds, which move as it grows. */
const FIT_PASSES = 8
/** How far in from its container's corner a piece moved clear of a fold is kept. */
const FOLD_INSET = 8
/** How far round a fold a compartment docked to its walls reaches. */
const FOLD_REACH = 46
/** How far a band out from one side of a membrane runs on past its ends. */
const BAND_OVERRUN = GAP
/** The room a tube leaves for its module, and a joint between two compartments that touch. */
const TUBE_ZONE = Object.freeze({ width: CARD.width + 16, height: CARD.height + 16 })
/** The least height a process zone is drawn: a row of symbols with their names, as one spanning its cell is. */
const ZONE_HEIGHT = processZone({ x: 0, y: 0, width: 0 }, 0).height
/**
 * How far a process zone keeps from the edge of its compartment (past a membrane's band and the proteins on it) and
 * from anything else standing in it, the same on every side.
 */
const ZONE_MARGIN = 16
/** How rounded a process zone's corners are drawn (see BioZone). */
const ZONE_CORNER = 8
/**
 * How far in from a membrane's middle a process zone keeps on a side with no proteins: its margin past the band, and
 * far enough that its rounded corner keeps its margin from the band round the cell's rounded corner too.
 */
const MEMBRANE_ZONE_INSET = Math.ceil(
  Math.max(
    MEMBRANE_BAND_HALF + ZONE_MARGIN,
    CELL_RADIUS - ZONE_CORNER - (CELL_RADIUS - MEMBRANE_BAND_HALF - ZONE_MARGIN - ZONE_CORNER) / Math.SQRT2,
  ),
)
/** How far a compartment is grown at a time to find room for its name. */
const NAME_GROWTH = 8
/** The most room a compartment's name takes below what stands in it: its inset, its height, and its hint's. */
const NAME_ROOM = 96
/** A piece with a frame is resized from its bottom-right corner. */
const FRAME_RESIZE = Object.freeze({ mode: 'frame', position: 'bottom-right' })
/** An image is resized by its frame too, keeping its picture's shape. */
const IMAGE_RESIZE = Object.freeze({ ...FRAME_RESIZE, keepAspect: true })
const OPPOSITE = Object.freeze({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' })

/** How far above a tube's room its bend grip sits. */
const GRIP_RISE = 10

/** How rounded a compartment standing freely is drawn (see BioRegion). */
const REGION_RADIUS = 12

/** How close two compartments' edges are to count as touching, for a tube between them. */
const TOUCHING = 8

const isHorizontal = (side) => side === 'top' || side === 'bottom'
const bottomOf = (rect) => rect.y + rect.height
const rightOf = (rect) => rect.x + rect.width
const middleOf = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

/** The box round some rects. */
function boxOf(rects) {
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  return {
    x: left,
    y: top,
    width: Math.max(...rects.map(rightOf)) - left,
    height: Math.max(...rects.map(bottomOf)) - top,
  }
}

/** A rect grown by `by` on every side (shrunk, when negative). */
const grownBy = (rect, by) => ({
  x: rect.x - by,
  y: rect.y - by,
  width: Math.max(0, rect.width + 2 * by),
  height: Math.max(0, rect.height + 2 * by),
})

/** Where two rects overlap; an empty rect at the nearer edge where they don't. */
function overlapOf(a, b) {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(0, Math.min(rightOf(a), rightOf(b)) - x),
    height: Math.max(0, Math.min(bottomOf(a), bottomOf(b)) - y),
  }
}

/** A box from two corners, in either order. */
const between = (a, b) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
})

/**
 * Gives the widest stretch of a band across a cell that no fold cuts into: a process zone runs along the wider side
 * of a fold it would cross, where it is, rather than moving.
 *
 * @param {Object} band - The zone, as it would span its cell.
 * @param {Array<{box: Object}>} folds - What each fold keeps clear (see foldsIn).
 * @returns {Object} The band itself where no fold reaches it.
 */
export function widestClear(band, folds) {
  let stretches = [[band.x, rightOf(band)]]
  for (const { box } of folds) {
    if (box.y >= bottomOf(band) || bottomOf(box) <= band.y) continue
    stretches = stretches
      .flatMap(([from, to]) => [
        [from, Math.min(to, box.x)],
        [Math.max(from, rightOf(box)), to],
      ])
      .filter(([from, to]) => to > from)
  }
  if (stretches.length === 1 && stretches[0][0] === band.x && stretches[0][1] === rightOf(band)) return band
  const [from, to] = stretches.reduce(
    (best, each) => (each[1] - each[0] > best[1] - best[0] ? each : best),
    [band.x, band.x],
  )
  return { ...band, x: from, width: to - from }
}

/**
 * Moves a rect standing in a cell clear of the cell's folds, the least way it can: along the fold's side to either
 * of its walls while it stays in the cell, or in past its end. A fold up from the bottom or in from the right has
 * its end where the cell does, so the rect may instead stay and the cell grow until the fold is past it.
 *
 * @param {Object} rect - From the cell's corner.
 * @param {Array<{edge: string, box: Object}>} folds - What each fold keeps clear (see foldsIn).
 * @param {{width: number, height: number}} size - The cell as it is laid out now.
 * @param {{x: number, y: number}} [least] - How far left and up it may go: a piece in a row stays in its place in it.
 * @returns {{rect: Object, need: {width: number, height: number}}} need: how big the cell must be for it.
 */
export function clearOfFolds(rect, folds, size, least = { x: FOLD_INSET, y: FOLD_INSET }) {
  const need = { width: 0, height: 0 }
  let placed = rect
  // Moving clear of one fold can put it on another, so go round them again.
  for (let round = 0; round <= folds.length; round++) {
    const fold = folds.find(({ box }) => overlap(placed, box))
    if (!fold) break
    const { edge, box } = fold
    const across = edge === 'top' || edge === 'bottom'
    const [at, length, limit] = across ? ['x', 'width', size.width] : ['y', 'height', size.height]
    const [inward, depth] = across ? ['y', 'height'] : ['x', 'width']
    const start = across ? box.x : box.y
    const end = across ? rightOf(box) : bottomOf(box)
    const moves = [
      // Along the side, to before its near wall or past its far one, inside the cell.
      { [at]: start - placed[length] },
      { [at]: end },
    ].filter((move) => move[at] >= least[at] && move[at] + placed[length] <= limit - FOLD_INSET)
    if (edge === 'top' || edge === 'left') moves.push({ [inward]: across ? bottomOf(box) : rightOf(box) })
    else {
      const before = (across ? box.y : box.x) - placed[depth]
      if (before >= least[inward]) moves.push({ [inward]: before })
    }
    const cost = (move) => Math.hypot((move.x ?? placed.x) - placed.x, (move.y ?? placed.y) - placed.y)
    // Staying, the cell grows on that side by as far as the fold reaches past it.
    const grow = edge === 'bottom' ? bottomOf(placed) - box.y : edge === 'right' ? rightOf(placed) - box.x : Infinity
    const best = moves.reduce((cheapest, move) => (cost(move) < cost(cheapest) ? move : cheapest), moves[0])
    if (!best || cost(best) > grow) break
    placed = { ...placed, ...best }
  }
  // Level with a fold up from the bottom or in from the right, it needs the cell to reach past it by as far as the
  // fold reaches in: however big the cell is now, so the cell doesn't shrink back on to it once grown clear.
  for (const { edge, box } of folds) {
    if (edge === 'bottom' && placed.x < rightOf(box) && box.x < rightOf(placed)) {
      need.height = Math.max(need.height, bottomOf(placed) + size.height - box.y)
    }
    if (edge === 'right' && placed.y < bottomOf(box) && box.y < bottomOf(placed)) {
      need.width = Math.max(need.width, rightOf(placed) + size.width - box.x)
    }
  }
  return { rect: placed, need }
}

/**
 * The stretch of a membrane's side from `from` to `to` (0 to 1), as a line, pushed `out` from the side (in, when
 * negative).
 */
function sideLine(rect, side, from, to, out = 0) {
  if (isHorizontal(side)) {
    const y = side === 'top' ? rect.y - out : bottomOf(rect) + out
    return [
      { x: rect.x + from * rect.width, y },
      { x: rect.x + to * rect.width, y },
    ]
  }
  const x = side === 'left' ? rect.x - out : rightOf(rect) + out
  return [
    { x, y: rect.y + from * rect.height },
    { x, y: rect.y + to * rect.height },
  ]
}

/**
 * A right-angle path for a tube between two compartments, from the edge of the first to the edge of the second:
 * straight where they face each other, else one bend; or through the bends it is given, square at each.
 *
 * @param {{x: number, y: number, width: number, height: number}} a - The upstream end's rect.
 * @param {{x: number, y: number, width: number, height: number}} b - The downstream end's.
 * @param {Array<{x: number, y: number}>} [bends] - Corners the user put, in absolute coordinates.
 * @returns {Array<{x: number, y: number}>} At least two points.
 */
export function routeTube(a, b, bends = []) {
  if (bends.length) {
    const start = edgeToward(a, bends[0])
    const end = edgeToward(b, bends.at(-1))
    return squared([start, ...bends, end])
  }
  const overlap = (lowA, highA, lowB, highB) => [Math.max(lowA, lowB), Math.min(highA, highB)]
  const [left, right] = overlap(a.x, rightOf(a), b.x, rightOf(b))
  if (left < right) {
    // One above the other: straight down (or up) through the middle of the stretch they share.
    const x = (left + right) / 2
    return a.y < b.y
      ? [
          { x, y: bottomOf(a) },
          { x, y: b.y },
        ]
      : [
          { x, y: a.y },
          { x, y: bottomOf(b) },
        ]
  }
  const [top, bottom] = overlap(a.y, bottomOf(a), b.y, bottomOf(b))
  if (top < bottom) {
    const y = (top + bottom) / 2
    return a.x < b.x
      ? [
          { x: rightOf(a), y },
          { x: b.x, y },
        ]
      : [
          { x: a.x, y },
          { x: rightOf(b), y },
        ]
  }
  // Neither: out of the first's side towards the second, then turning once into the second's top or bottom. The bend
  // lies level with the first and in line with the second, so inside neither.
  const ca = middleOf(a)
  const cb = middleOf(b)
  return [
    { x: cb.x > ca.x ? rightOf(a) : a.x, y: ca.y },
    { x: cb.x, y: ca.y },
    { x: cb.x, y: ca.y < cb.y ? b.y : bottomOf(b) },
  ]
}

/** The point on a rect's edge a path to `toward` leaves from: square to the edge where it can be. */
function edgeToward(rect, toward) {
  if (toward.x >= rect.x && toward.x <= rightOf(rect))
    return { x: toward.x, y: toward.y < rect.y ? rect.y : bottomOf(rect) }
  if (toward.y >= rect.y && toward.y <= bottomOf(rect))
    return { x: toward.x < rect.x ? rect.x : rightOf(rect), y: toward.y }
  const centre = middleOf(rect)
  return { x: toward.x < centre.x ? rect.x : rightOf(rect), y: centre.y }
}

/** A path made square: a corner put in wherever two points in a row are on neither the same line across nor down. */
function squared(points) {
  const out = [points[0]]
  for (const point of points.slice(1)) {
    const last = out.at(-1)
    if (last.x !== point.x && last.y !== point.y) out.push({ x: point.x, y: last.y })
    out.push(point)
  }
  return out
}

/** The middle of a path's longest stretch, where its module's room goes. */
function pathMiddle(points) {
  let best = { length: -1, point: points[0] }
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]]
    const length = Math.hypot(q.x - p.x, q.y - p.y)
    if (length > best.length) best = { length, point: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } }
  }
  return best.point
}

/**
 * Which way a path runs at `centre`, along its stretch nearest it (the longer of two as near, as at a bend): down
 * or across, and backwards (up or to the left) or not. A conduit's vessel is drawn along it, flowing its way.
 */
export function runAt(points, centre) {
  let best = null
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]]
    const dx = q.x - p.x
    const dy = q.y - p.y
    const length = Math.hypot(dx, dy)
    const t = length ? Math.max(0, Math.min(1, ((centre.x - p.x) * dx + (centre.y - p.y) * dy) / length ** 2)) : 0
    const distance = Math.hypot(centre.x - (p.x + t * dx), centre.y - (p.y + t * dy))
    const nearer = !best || distance < best.distance - 0.5
    const asNearButLonger = best && Math.abs(distance - best.distance) <= 0.5 && length > best.length
    if (nearer || asNearButLonger) best = { distance, length, dx, dy }
  }
  if (!best) return { vertical: false, reverse: false }
  const vertical = Math.abs(best.dy) > Math.abs(best.dx)
  return { vertical, reverse: vertical ? best.dy < 0 : best.dx < 0 }
}

/** Whether two rects overlap. */
const overlap = (r, q) => r.x < q.x + q.width && q.x < r.x + r.width && r.y < q.y + q.height && q.y < r.y + r.height

/**
 * A tube's room for its module, moved beside its way where the way is too short to hold it clear of the two
 * compartments it joins, as a link's is: square to the way's longest stretch, the nearer side first.
 */
function clearOfEnds(zone, points, ends) {
  if (!ends.some((end) => overlap(zone, end))) return zone
  let longest = [points[0], points[1]]
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]]
    if (Math.hypot(q.x - p.x, q.y - p.y) > Math.hypot(longest[1].x - longest[0].x, longest[1].y - longest[0].y))
      longest = [p, q]
  }
  const isAcross = longest[0].y === longest[1].y
  for (let shift = 8; shift <= 800; shift += 8) {
    for (const sign of [-1, 1]) {
      const moved = isAcross ? { ...zone, y: zone.y + sign * shift } : { ...zone, x: zone.x + sign * shift }
      if (!ends.some((end) => overlap(moved, end))) return moved
    }
  }
  return zone
}

const zoneAt = (centre, size = TUBE_ZONE) => ({ x: centre.x - size.width / 2, y: centre.y - size.height / 2, ...size })

/** Half a bridge's width, between the middles of its two walls. */
const BRIDGE_HALF = 28

/**
 * The open channel a bridge makes between two cells that face each other across a gap, side by side or one above the
 * other, clear of their rounded corners: straight across the gap, from one membrane's middle to the other's.
 *
 * @param {{x: number, y: number, width: number, height: number}} a - One cell's outline.
 * @param {{x: number, y: number, width: number, height: number}} b - The other's.
 * @returns {{from: {x: number, y: number}, to: {x: number, y: number}, half: number, vertical: boolean}|null} null
 *   when they overlap, or don't face each other along enough of their sides.
 */
function bridgeChannel(a, b) {
  const room = 2 * (BRIDGE_HALF + MEMBRANE_BAND_HALF + CELL_RADIUS)
  const across = (low, high) => (high - low >= room ? (low + high) / 2 : null)
  const [left, right] = a.x <= b.x ? [a, b] : [b, a]
  const y = across(Math.max(a.y, b.y), Math.min(bottomOf(a), bottomOf(b)))
  if (right.x > rightOf(left) && y !== null) {
    return { from: { x: rightOf(left), y }, to: { x: right.x, y }, half: BRIDGE_HALF, vertical: false }
  }
  const [upper, lower] = a.y <= b.y ? [a, b] : [b, a]
  const x = across(Math.max(a.x, b.x), Math.min(rightOf(a), rightOf(b)))
  if (lower.y > bottomOf(upper) && x !== null) {
    return { from: { x, y: bottomOf(upper) }, to: { x, y: lower.y }, half: BRIDGE_HALF, vertical: true }
  }
  return null
}

/** The box a bridge's channel takes: its walls, and on into each cell over its membrane. */
function channelBox({ from, to, half, vertical }) {
  const reach = half + MEMBRANE_BAND_HALF
  return vertical
    ? {
        x: from.x - reach,
        y: from.y - MEMBRANE_BAND_HALF,
        width: 2 * reach,
        height: to.y - from.y + 2 * MEMBRANE_BAND_HALF,
      }
    : {
        x: from.x - MEMBRANE_BAND_HALF,
        y: from.y - reach,
        width: to.x - from.x + 2 * MEMBRANE_BAND_HALF,
        height: 2 * reach,
      }
}

/**
 * Where two rects touch, if they do, and how big a joint there is drawn: on the stretch of edge they share where both
 * run straight, past their rounded corners, as long along it as that stretch allows (no shorter than `least`, nor
 * longer than `size`), as near the middle of what they share as it may; or, with one inside the other, at the middle
 * of the inner one's right side, as big as `size`.
 *
 * @param {Object} a
 * @param {Object} b
 * @param {{radii?: [number, number], size?: {width: number, height: number}, least?: number}} [options] - How rounded
 *   each one's corners are; the joint's size, its height along a side they share side by side, its width along one
 *   they share one above the other; and the least it is drawn along it.
 * @returns {{x: number, y: number, size: {width: number, height: number}}|null} Its middle, and size.
 */
function contact(a, b, { radii = [0, 0], size = { width: 0, height: 0 }, least = 0 } = {}) {
  const near = (p, q) => Math.abs(p - q) <= TOUCHING
  const [ra, rb] = radii
  /** Where along the shared stretch the joint's middle goes, and how long it is, at most `length`. */
  const along = (lowA, highA, lowB, highB, length) => {
    const middle = (Math.max(lowA, lowB) + Math.min(highA, highB)) / 2
    const [from, to] = [Math.max(lowA + ra, lowB + rb), Math.min(highA - ra, highB - rb)]
    const long = Math.max(least, Math.min(length, to - from))
    if (to - from < long) return { at: to > from ? (from + to) / 2 : middle, long }
    return { at: Math.min(to - long / 2, Math.max(from + long / 2, middle)), long }
  }
  // One inside the other: where the inner one's right side meets the outer's inside.
  const holds = (outer, inner) =>
    inner.x >= outer.x && inner.y >= outer.y && rightOf(inner) <= rightOf(outer) && bottomOf(inner) <= bottomOf(outer)
  const inner = holds(a, b) ? b : holds(b, a) ? a : null
  if (inner) return { x: rightOf(inner), y: inner.y + inner.height / 2, size }
  const overlapX = a.x < rightOf(b) && b.x < rightOf(a)
  const overlapY = a.y < bottomOf(b) && b.y < bottomOf(a)
  const sideBySide = (x) => {
    const { at, long } = along(a.y, bottomOf(a), b.y, bottomOf(b), size.height)
    return { x, y: at, size: { width: size.width, height: long } }
  }
  const oneAbove = (y) => {
    const { at, long } = along(a.x, rightOf(a), b.x, rightOf(b), size.width)
    return { x: at, y, size: { width: long, height: size.height } }
  }
  if (overlapY && near(rightOf(a), b.x)) return sideBySide((rightOf(a) + b.x) / 2)
  if (overlapY && near(rightOf(b), a.x)) return sideBySide((rightOf(b) + a.x) / 2)
  if (overlapX && near(bottomOf(a), b.y)) return oneAbove((bottomOf(a) + b.y) / 2)
  if (overlapX && near(bottomOf(b), a.y)) return oneAbove((bottomOf(b) + a.y) / 2)
  return null
}

/**
 * Whether two compartments touch, as the layout sees it: where a gap junction between them can be drawn whole.
 *
 * @param {Object} [a] - The one's rect.
 * @param {Object} [b] - The other's.
 * @returns {boolean}
 */
export function compartmentsTouch(a, b) {
  return !!a && !!b && !!contact(a, b)
}

/** How far down a process zone its row starts: below its name, in its top-left corner, as a compartment's contents are. */
const ZONE_ROW_TOP = 18

/** Whether two rects overlap, not just touch. */
const overlapping = (a, b) => a.x < rightOf(b) && b.x < rightOf(a) && a.y < bottomOf(b) && b.y < bottomOf(a)

/**
 * Pushes what stands by its frame in a container out of the way of a piece drawn bigger than its frame, as a cell
 * grows for what is on it, or pushed itself: right or down, whichever way it lay from the other's frame, the lesser
 * where both, keeping the gap it had from it. On, from what is pushed, to what it then covers. Pieces that overlap
 * at their frames are left as they are, as they were put so.
 *
 * @param {Array<Object>} framed - The pieces standing by their frames in one container.
 * @param {Map<string, Object>} rel - Where each is, from the container's corner, as big as it is drawn: updated.
 */
function makeRoom(framed, rel) {
  const frameOf = (piece) => ({ ...rel.get(piece.id), width: piece.frame.width, height: piece.frame.height })
  const frames = new Map(framed.map((piece) => [piece.id, frameOf(piece)]))
  const isGrown = (piece) => {
    const rect = rel.get(piece.id)
    return rect.width > piece.frame.width || rect.height > piece.frame.height
  }
  const moved = new Set()
  for (let pass = 0; pass < framed.length; pass++) {
    let changed = false
    for (const a of framed) {
      if (!isGrown(a) && !moved.has(a.id)) continue
      const [ra, fa] = [rel.get(a.id), frames.get(a.id)]
      for (const b of framed) {
        const [rb, fb] = [rel.get(b.id), frames.get(b.id)]
        if (b === a || !overlapping(ra, rb) || overlapping(fa, fb)) continue
        const right = fb.x >= rightOf(fa) ? rightOf(ra) + (fb.x - rightOf(fa)) - rb.x : Infinity
        const down = fb.y >= bottomOf(fa) ? bottomOf(ra) + (fb.y - bottomOf(fa)) - rb.y : Infinity
        if (right === Infinity && down === Infinity) continue
        rel.set(b.id, right <= down ? { ...rb, x: rb.x + right } : { ...rb, y: rb.y + down })
        moved.add(b.id)
        changed = true
      }
    }
    if (!changed) break
  }
}

/** Room along a process zone's row for a symbol with its name under it, a spare place's as a short name's. */
const zoneRoom = (width) => Math.max(SYMBOL_WIDTH, width) + LABEL_GAP

/** How long a process zone's row is, for the names of its processes and a spare place past them. */
const zoneLength = (widths) => [...widths, 0].reduce((sum, width) => sum + zoneRoom(width), 0)

/**
 * Where the symbols in a process zone's row go, with a spare place past them: their top-lefts, in from the zone's
 * corner, each centred in the room its name takes under it.
 *
 * @param {{x: number, y: number}} zone
 * @param {Array<number>} widths - How wide each process's name is drawn (see widthOf).
 * @returns {Array<{x: number, y: number}>}
 */
function zoneSlots(zone, widths) {
  let x = zone.x + CELL_RADIUS / 2
  return [...widths, 0].map((width) => {
    const room = zoneRoom(width)
    const slot = { x: x + (room - SYMBOL_WIDTH) / 2, y: zone.y + ZONE_ROW_TOP }
    x += room
    return slot
  })
}

/**
 * Finds the nodes bound to the pieces' sites through their bioView.site ('pieces/<path>'). A site the pieces don't
 * offer leaves its node unbound; of several nodes on a one-module site, the first by name holds it and the rest are
 * unbound.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes
 * @returns {{occupants: Map<string, string[]>, bound: Map<string, string>}} occupants: site path -> the ids on it, in
 *   slot order; bound: node id -> the site ref it holds.
 */
export function boundToPieces(pieces, nodes) {
  const occupants = new Map()
  const bound = new Map()
  if (!pieces.length || !nodes.length) return { occupants, bound }
  const offered = new Map(topologyOf(pieces).sites.map((site) => [site.path, site]))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const id of nodes.map((node) => node.id).sort(byName(byId))) {
    const parsed = parseSiteRef(byId.get(id).data?.bioView?.site)
    const site = parsed?.instance === PIECES_INSTANCE && offered.get(parsed.path)
    if (!site) continue
    const ids = occupants.get(site.path) ?? []
    if (site.kind === 'single' && ids.length) continue
    occupants.set(site.path, [...ids, id])
  }
  for (const [path, ids] of occupants) {
    occupants.set(path, inSlotOrder(ids, byId))
    for (const id of ids) bound.set(id, pieceSiteRef(path))
  }
  return { occupants, bound }
}

/**
 * The role of each node bound to a site of the pieces: its site's role (see topologyOf). A node on no site the pieces
 * offer has none.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes
 * @returns {Map<string, string>} Node id -> its site's role.
 */
export function siteRolesOf(pieces, nodes) {
  const { bound } = boundToPieces(pieces, nodes)
  if (!bound.size) return new Map()
  const roleAt = new Map(topologyOf(pieces).sites.map((site) => [pieceSiteRef(site.path), site.role]))
  return new Map([...bound].map(([id, ref]) => [id, roleAt.get(ref)]))
}

/**
 * Lays the pieces out.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated (see validatePieces).
 * @param {Object} [options]
 * @param {Array<{id: string, data?: Object}>} [options.nodes] - The diagram's nodes: those bound to a site of the
 *   pieces are drawn on it (see boundToPieces).
 * @param {(id: string) => number} [options.widthOf] - How wide a node's name is drawn under its symbol.
 * @returns {{places: Map<string, Object>, rects: Map<string, Object>, sites: Array<Object>}} places: by pieceKey, or
 *   by the node on a piece that takes one module, and the nodes bound to sites (a protein, a process card, a tube's
 *   module, a membrane's); rects: piece id -> where it is drawn (a bulk has its membrane's); sites: every site, as
 *   layoutPhysiology gives a template's, for the drop prompts.
 */
export function layoutPieces(pieces, { nodes = [], widthOf = () => 0 } = {}) {
  const topology = topologyOf(pieces)
  const { occupants } = boundToPieces(pieces, nodes)
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  const ofKind = (kind) => pieces.filter((piece) => piece.kind === kind)
  const membranes = ofKind('membrane')
  const bulks = new Map(membranes.map((membrane) => [topology.bulkOf(membrane.id), membrane.id]))
  bulks.delete(null)
  const isDocked = (compartment) => !!compartment.docks?.length
  const isEnclosed = (compartment) => !!topology.enclosureOf(compartment.id)
  /** A compartment that stands by its own frame: neither docked nor filling a membrane. */
  const isFree = (piece) => piece.kind === 'compartment' && !isDocked(piece) && !isEnclosed(piece)
  const sitePath = (piece) => (piece.site === false ? null : pieceSiteRef(piece.id))
  /** The line skin a membrane is drawn with (see resolveSkin): a lipid bilayer unless chosen otherwise. */
  const membraneSkinOf = (membrane) =>
    resolveSkin(contextOfPiece(topology, membrane.id), membrane.skin)?.id ?? 'bilayer'
  /** The area skin a compartment or image is drawn with (see resolveSkin), as a piece's skin is kept; null for none. */
  const areaSkinOf = (compartment) => {
    const skin = compartment && resolveSkin(contextOfPiece(topology, compartment.id), compartment.skin)
    if (skin?.renderer !== 'area') return null
    return compartment.skin?.ref === skin.id ? compartment.skin : { ref: skin.id }
  }

  // What stands in each compartment, or on the canvas (''), by its own frame or in a row: membranes, free
  // compartments and process zones. Images stand apart, on the canvas by their frames (see below).
  const standing = new Map()
  const stand = (parent, piece) => standing.set(parent ?? '', [...(standing.get(parent ?? '') ?? []), piece])
  for (const piece of pieces) {
    if (piece.kind === 'membrane' || isFree(piece)) stand(piece.parent, piece)
    if (isWithinPiece(piece)) stand(piece.compartment, piece)
  }

  // Each membrane's shape: its spans along its sides and its folds, as the view's geometry reads a cell's.
  const shapeOf = new Map()
  for (const membrane of membranes) {
    const folds = ofKind('fold').filter((fold) => fold.membrane === membrane.id)
    const facets = [
      ...topology.spansOf(membrane.id).map(({ id, label, side, from, to, group, annotation }) =>
        Object.freeze({
          id,
          label,
          edge: side,
          from,
          to,
          ...(group && { group }),
          ...(annotation && { annotation }),
        }),
      ),
      ...folds.map(({ id, label, side, at, depth }) =>
        Object.freeze({ id, label, fold: side, at, ...(depth && { depth }) }),
      ),
    ]
    let shape = Object.freeze({ facets: Object.freeze(facets), processes: Object.freeze([]) })
    // A fold is as deep as its proteins need, at least.
    shape = withFolds(shape, (facet) => ({
      depth: Math.max(facet.depth ?? FOLD.depth, foldDepthFor((occupants.get(facet.id) ?? []).length)),
    }))
    shapeOf.set(membrane.id, shape)
  }
  /** Proteins per facet of a membrane's shape, and their names' widths. */
  const facetPath = (membraneId, facet) => (facet.fold ? facet.id : spanPath(membraneId, facet.id))
  const countsOf = (membraneId) =>
    Object.fromEntries(
      shapeOf
        .get(membraneId)
        .facets.map((facet) => [facet.id, (occupants.get(facetPath(membraneId, facet)) ?? []).length]),
    )
  const widthsOf = (membraneId) =>
    Object.fromEntries(
      shapeOf
        .get(membraneId)
        .facets.map((facet) => [facet.id, (occupants.get(facetPath(membraneId, facet)) ?? []).map(widthOf)]),
    )

  /** How far the proteins on each side of a membrane reach into its cell, from its middle; none on a side, 0. */
  const proteinReachOf = (membraneId) => {
    const reach = { top: 0, right: 0, bottom: 0, left: 0 }
    for (const span of topology.spansOf(membraneId)) {
      for (const id of occupants.get(spanPath(membraneId, span.id)) ?? []) {
        reach[span.side] = Math.max(reach[span.side], proteinReach(span.side, widthOf(id)))
      }
    }
    return reach
  }
  /**
   * How far in from a compartment's edge a process zone keeps, on each side: ZONE_MARGIN past its border; in a
   * membrane, past its band and round its corners, or past the proteins on that side and their names.
   */
  const zoneMargins = (containerId) => {
    const membraneId = bulks.get(containerId)
    const reach = membraneId && proteinReachOf(membraneId)
    const margin = (side) => (reach ? Math.max(MEMBRANE_ZONE_INSET, reach[side] + ZONE_MARGIN) : ZONE_MARGIN)
    return { top: margin('top'), right: margin('right'), bottom: margin('bottom'), left: margin('left') }
  }
  /**
   * How far down a compartment its name reaches where it is drawn in its upper-left corner, past the proteins along
   * its top, for rows of zones to start below; 0 where it isn't drawn there: a cell with no module has its name
   * centred, with its hint, below what stands in it.
   */
  const nameBottomOf = (containerId, width) => {
    const membraneId = bulks.get(containerId)
    const empty = !occupants.get(containerId)?.length
    if (membraneId && empty) return 0
    const top = membraneId ? proteinReachOf(membraneId).top : 0
    const proteins = top ? [{ x: 0, y: 0, width, height: top }] : []
    const rect = { x: 0, y: 0, width, height: LIMITS.size.max }
    const name = byId.get(containerId)?.label ?? ''
    const spot = nameInUpperCorner(membraneId ? 'cell' : 'region', rect, name, proteins, empty)
    return spot ? bottomOf(spot) : 0
  }
  /**
   * How tall a compartment must be for its name to find a clear corner (see nameFits), at least as tall as it is: it
   * grows from its bottom until the name fits there, where what stands in it leaves no room. It grows no further than
   * puts its lower-left corner past all that stands in it: where the name still doesn't fit, what is in the way is
   * along its sides, which growing doesn't clear, and the name is drawn over it as nameInCorners falls back to.
   */
  const heightForName = (containerId, kind, size) => {
    const name = byId.get(containerId)?.label ?? ''
    const membraneId = bulks.get(containerId)
    const reach = membraneId ? proteinReachOf(membraneId) : { top: 0, right: 0, bottom: 0, left: 0 }
    const empty = !occupants.get(containerId)?.length
    const inside = [...(arrangements.get(containerId)?.values() ?? [])]
    const lowest = Math.max(0, ...inside.map(bottomOf))
    const limit = Math.min(LIMITS.size.max, Math.max(size.height, lowest + reach.bottom + NAME_ROOM))
    // The proteins along its top and bottom with their names, which a name in a corner keeps clear of. Those down its
    // sides stand at points along them, which the name finds its way between.
    const fits = (height) => {
      const proteins = [
        { x: 0, y: 0, width: size.width, height: reach.top },
        { x: 0, y: height - reach.bottom, width: size.width, height: reach.bottom },
      ].filter((strip) => strip.height > 0)
      return nameFits(kind, { x: 0, y: 0, width: size.width, height }, name, [...inside, ...proteins], empty)
    }
    let height = size.height
    while (height < limit && !fits(height)) height += NAME_GROWTH
    return fits(height) ? height : size.height
  }

  // ── 1. Sizes, from the inside out ─────────────────────────────────────
  const sizes = new Map()
  /** Where what stands in a compartment goes, from its corner, and how far it reaches. */
  const arrangements = new Map()

  /**
   * What each fold of a membrane keeps clear of what stands in its cell, its walls and end and the proteins on them,
   * from the cell's corner, as big as `size`.
   */
  const foldsIn = (membraneId, size) => {
    const rect = { x: 0, y: 0, width: size.width, height: size.height }
    return shapeOf
      .get(membraneId)
      .facets.filter((facet) => facet.fold)
      .map((facet) => {
        const { edge, at, half, depth } = foldPocket(rect, facet)
        const reach = half + FOLD_CLEARANCE
        return {
          edge,
          box: between(foldPoint(rect, edge, at - reach, 0), foldPoint(rect, edge, at + reach, depth + FOLD_CLEARANCE)),
        }
      })
  }

  /**
   * Lays out what stands in a container whose inside is `width` wide (and `height` high, as it is laid out now),
   * from its corner. In a cell, all of it is kept clear of the cell's folds.
   */
  function arrange(containerId, width, height = 0) {
    const rel = new Map()
    const list = standing.get(containerId ?? '') ?? []
    const zones = list.filter((piece) => piece.kind === 'zone')
    const others = list.filter((piece) => piece.kind !== 'zone')
    others.forEach(measure)
    const membraneId = containerId && bulks.get(containerId)
    const folds = membraneId ? foldsIn(membraneId, { width, height }) : []
    const margins = containerId ? zoneMargins(containerId) : { top: 0, right: 0, bottom: 0, left: 0 }
    // Rows of zones start below its name, where that is in its upper-left corner, so a zone dropped in leaves the
    // name where it was; a zone moved there by the user moves the name instead.
    const rowsTop = containerId ? Math.max(margins.top, nameBottomOf(containerId, width) + ZONE_MARGIN) : margins.top
    /** The band a zone without a frame is laid out in, in its row from the top, as wide as the container allows. */
    const zoneRow = (wide, index) => ({
      x: margins.left,
      y: rowsTop + index * (ZONE_HEIGHT + ZONE_MARGIN),
      width: wide - margins.left - margins.right,
      height: ZONE_HEIGHT,
    })
    // How big the container must be for what is moved clear of its folds, past what they reach.
    const need = { width: 0, height: 0 }
    const clear = (rect, least) => {
      if (!folds.length) return rect
      const cleared = clearOfFolds(rect, folds, { width, height }, least)
      need.width = Math.max(need.width, cleared.need.width)
      need.height = Math.max(need.height, cleared.need.height)
      return cleared.rect
    }
    /** How long a zone's row of cards is, with a spare place past them. */
    const cardsOf = (zone) => CELL_RADIUS / 2 + zoneLength((occupants.get(zone.id) ?? []).map(widthOf))
    // What stands by its frame first: a zone as big as its frame says, at least as big as its cards need, as a
    // compartment is for what stands in it; then the rest, each sized for what it holds. Any grown bigger than its
    // frame pushes the others out of its way.
    const framed = list.filter((piece) => piece.frame)
    // A zone is kept its margin in from the container's top and left; past its right and bottom, the container grows.
    for (const zone of framed.filter((piece) => piece.kind === 'zone')) {
      const { width: wide, height: high } = zone.frame
      const [x, y] = [Math.max(zone.frame.x, margins.left), Math.max(zone.frame.y, margins.top)]
      rel.set(zone.id, clear({ x, y, width: Math.max(wide, cardsOf(zone)), height: Math.max(high, ZONE_HEIGHT) }))
    }
    // The rest keep the same room from each side of what they stand in: in from its top and left, as it grows to
    // leave past its right and bottom.
    const low = containerId ? ROOM_INSIDE : -Infinity
    for (const piece of framed.filter((piece) => piece.kind !== 'zone')) {
      const [x, y] = [Math.max(piece.frame.x, low), Math.max(piece.frame.y, low)]
      rel.set(piece.id, clear({ x, y, ...sizes.get(piece.id) }, { x: low, y: low }))
    }
    makeRoom(framed, rel)
    const framedZones = framed.filter((piece) => piece.kind === 'zone').map((zone) => rel.get(zone.id))
    // Process zones without a frame in rows from the top, their margin in from its sides, as wide as it is, passing
    // over a row anything with a frame stands in or comes within a margin of, so a zone dropped in is drawn in a
    // spare place touching nothing, for the user to move where they want it.
    let row = 0
    const placed = framed.map((piece) => rel.get(piece.id))
    const isTaken = (band) =>
      placed.some((rect) =>
        overlapping(
          {
            x: rect.x - ZONE_MARGIN,
            y: rect.y - ZONE_MARGIN,
            width: rect.width + 2 * ZONE_MARGIN,
            height: rect.height + 2 * ZONE_MARGIN,
          },
          band,
        ),
      )
    // What the zones need of its width: those that span it, room for their cards and a spare place past them, not
    // the width they take from it, which would grow it again and again; those with frames, their reach. Either keeps
    // the same margin past it, so a zone given a frame where it was drawn leaves the container as it was.
    let zonesNeed = Math.max(0, ...framedZones.map((rect) => rightOf(rect) + margins.right))
    for (const zone of zones) {
      if (!zone.frame) {
        // Rows go down, so one is past every zone with a frame in the end.
        let area = zoneRow(width, row++)
        while (isTaken(area)) area = zoneRow(width, row++)
        const cards = cardsOf(zone)
        zonesNeed = Math.max(zonesNeed, area.x + cards + margins.right)
        // A fold it would cross leaves it the wider side, and the cell grows until its cards fit there. The folds
        // move as it does, so step out from the width it needs with none by what is still short, to find the least
        // width they fit at whatever width it is laid out at now.
        if (folds.length) {
          let wide = zonesNeed
          for (let short = 1; short > 0 && wide < LIMITS.size.max; wide += Math.max(1, Math.ceil(short))) {
            const band = zoneRow(wide, row - 1)
            short = cards - widestClear(band, foldsIn(membraneId, { width: wide, height })).width
            if (short <= 0) break
          }
          zonesNeed = Math.max(zonesNeed, wide)
        }
        const along = widestClear(area, folds)
        rel.set(zone.id, along !== area ? along : { ...area, width: Math.max(area.width, cards) })
      }
    }
    const zoneBottoms = zones.map((zone) => bottomOf(rel.get(zone.id)))
    const below = containerId ? Math.max(SYMBOL_HEIGHT + 40, ...zoneBottoms) + ROOM : 0
    // The rest without a frame in a row below the zones; on the canvas, side by side from its corner.
    let x = containerId ? CELL_RADIUS + ROOM : 0
    for (const piece of others.filter((piece) => !piece.frame)) {
      const size = sizes.get(piece.id)
      const placed = clear({ x, y: below, ...size }, { x, y: below })
      rel.set(piece.id, placed)
      x = Math.max(x + size.width, placed.y === below ? rightOf(placed) : 0) + (containerId ? 2 * ROOM : 2 * GAP)
    }
    // What else stands in it keeps more room past it, for the names of the proteins on it.
    const fixed = others.map((piece) => rel.get(piece.id))
    const reach = boxOf([...fixed, { x: 0, y: 0, width: 0, height: 0 }])
    arrangements.set(containerId ?? '', rel)
    return {
      width: fixed.length ? reach.x + reach.width : 0,
      zonesNeed,
      height: fixed.length ? reach.y + reach.height : 0,
      // The zones keep their margin past them at the bottom too.
      zonesHeight: zones.length ? Math.max(...zoneBottoms) + margins.bottom : 0,
      need,
    }
  }

  function measure(piece) {
    if (sizes.has(piece.id)) return sizes.get(piece.id)
    if (piece.kind === 'membrane') {
      const least = piece.frame ? FRAMED_MIN : piece.parent ? ORGANELLE_MIN : MIN_CELL
      const base = piece.frame ? { width: piece.frame.width, height: piece.frame.height } : { ...least }
      let size = fitCellRect(
        { x: 0, y: 0, ...base },
        countsOf(piece.id),
        shapeOf.get(piece.id),
        widthsOf(piece.id),
        least,
      )
      const bulk = topology.bulkOf(piece.id)
      if (bulk) {
        // Grown for what stands in it; and again while that moves round its folds, which move as it grows. Its size is
        // found afresh each time, as a fold that reached what stands in a cell not yet as big as it will be may not.
        // Where it comes back to a size it was, what stands in it goes one way round a fold at one size and the
        // other at the next: it takes the biggest of those.
        const least = size
        const tried = [size]
        for (let pass = 0; pass < FIT_PASSES; pass++) {
          const inside = arrange(bulk, size.width, size.height)
          const grown = {
            width: Math.max(
              least.width,
              inside.width ? inside.width + ROOM_INSIDE : 0,
              inside.zonesNeed,
              inside.need.width,
            ),
            height: Math.max(
              least.height,
              inside.height ? inside.height + ROOM_INSIDE : 0,
              inside.zonesHeight,
              inside.need.height,
            ),
          }
          if (grown.width === size.width && grown.height === size.height) break
          const back = tried.findIndex((each) => each.width === grown.width && each.height === grown.height)
          if (back >= 0) {
            const cycle = tried.slice(back)
            size = {
              width: Math.max(...cycle.map((each) => each.width)),
              height: Math.max(...cycle.map((each) => each.height)),
            }
            break
          }
          tried.push(grown)
          size = grown
        }
        // Taller where its name finds no clear corner, then the zones span the cell as it finally is.
        if (standing.has(bulk)) size = { ...size, height: heightForName(bulk, 'cell', size) }
        arrange(bulk, size.width, size.height)
      } else if (bulk) arrange(bulk, size.width, size.height)
      sizes.set(piece.id, { width: size.width, height: size.height })
      return sizes.get(piece.id)
    }
    // A compartment standing freely.
    const base = piece.frame
      ? { width: piece.frame.width, height: piece.frame.height }
      : piece.style === 'vessel'
        ? { ...TUBE }
        : { ...FREE_COMPARTMENT }
    const inside = standing.has(piece.id)
      ? arrange(piece.id, base.width)
      : { width: 0, zonesNeed: 0, height: 0, zonesHeight: 0 }
    const size = {
      width: Math.max(base.width, inside.width ? inside.width + ROOM_INSIDE : 0, inside.zonesNeed),
      height: Math.max(base.height, inside.height ? inside.height + ROOM_INSIDE : 0, inside.zonesHeight),
    }
    if (standing.has(piece.id)) {
      arrange(piece.id, size.width)
      // Taller where its name finds no clear corner.
      size.height = heightForName(piece.id, 'region', size)
    }
    sizes.set(piece.id, size)
    return size
  }
  arrange(null, 0)

  // ── 2. Places, from the outside in ────────────────────────────────────
  const rects = new Map()
  /** Places what stands in a container, from its corner. */
  function placeIn(containerId, corner) {
    for (const [id, rel] of arrangements.get(containerId ?? '') ?? []) {
      const rect = { ...rel, x: corner.x + rel.x, y: corner.y + rel.y }
      rects.set(id, rect)
      const piece = byId.get(id)
      if (piece.kind === 'membrane') {
        const bulk = topology.bulkOf(id)
        if (bulk) {
          rects.set(bulk, rect)
          placeIn(bulk, rect)
        }
      } else if (piece.kind === 'compartment') placeIn(id, rect)
    }
  }
  placeIn(null, { x: 0, y: 0 })
  // Images on the canvas, each where its frame says: under what overlaps it, neither pushing nor pushed.
  for (const image of ofKind('image')) rects.set(image.id, { ...image.frame })

  /** Where a fold is in its membrane, and the rect of its lumen. */
  const pocketOf = (fold) => {
    const rect = rects.get(fold.membrane)
    const facet = shapeOf.get(fold.membrane).facets.find((each) => each.id === fold.id)
    return rect && facet ? { rect, pocket: foldPocket(rect, facet) } : null
  }
  /** Turns two corners in a fold's own terms (along its side, in from it) into a rect. */
  const foldBox = (rect, edge, [alongA, inA], [alongB, inB]) =>
    between(foldPoint(rect, edge, alongA, inA), foldPoint(rect, edge, alongB, inB))

  // Docked compartments, drawn from their docks: inside ones in from the stretches they are docked to, outside ones
  // out from them.
  const cutouts = new Map()
  /** By compartment id: the inside of the membrane it is docked within, as a rounded rect in its own coordinates. */
  const clips = new Map()
  /**
   * The membrane a compartment is docked inside of on every dock, as a dock on each of several of its sides is.
   *
   * @returns {Object|null} Its rect; null for one docked outside, to a fold, or to more than one membrane.
   */
  function membraneWithin(compartment) {
    const [first] = compartment.docks
    const isWithin = compartment.docks.every(
      (dock) => dock.face === 'inside' && dock.on === first.on && byId.get(dock.on)?.kind === 'membrane',
    )
    return isWithin ? (rects.get(first.on) ?? null) : null
  }
  /**
   * The gap between the wall of a fold a compartment is docked into and the side of a membrane it is docked out from,
   * where the two face each other across it: from the side to the wall, over the stretch both reach.
   *
   * @returns {Object|null} Null for any other compartment, or where the two don't face each other.
   */
  function foldGap(compartment) {
    if (compartment.docks.length !== 2) return null
    const onFold = compartment.docks.find((dock) => byId.get(dock.on)?.kind === 'fold' && dock.face === 'inside')
    const onSide = compartment.docks.find((dock) => dock.side && dock.face === 'outside')
    const found = onFold && pocketOf(byId.get(onFold.on))
    const other = onSide && rects.get(onSide.on)
    if (!found || !other) return null
    const { rect, pocket } = found
    // The fold's walls, from its mouth to its end, in the view's coordinates.
    const mouth = foldPoint(rect, pocket.edge, pocket.at, 0)
    const end = foldPoint(rect, pocket.edge, pocket.at, pocket.depth - pocket.half)
    const [p, q] = sideLine(other, onSide.side, onSide.from, onSide.to)
    if (isHorizontal(pocket.edge) && !isHorizontal(onSide.side)) {
      // A fold down from the top or up from the bottom, beside an organelle's left or right side.
      const wall = mouth.x + (onSide.side === 'right' ? -pocket.half : pocket.half)
      const top = Math.max(Math.min(mouth.y, end.y), Math.min(p.y, q.y) + CELL_RADIUS / 2)
      const bottom = Math.min(Math.max(mouth.y, end.y), Math.max(p.y, q.y) - CELL_RADIUS / 2)
      const isFacing = onSide.side === 'right' ? wall > p.x : wall < p.x
      return isFacing && bottom > top
        ? between(
            { x: p.x - (onSide.side === 'right' ? CELL_RADIUS / 2 : -CELL_RADIUS / 2), y: top },
            { x: wall, y: bottom },
          )
        : null
    }
    if (!isHorizontal(pocket.edge) && isHorizontal(onSide.side)) {
      const wall = mouth.y + (onSide.side === 'bottom' ? -pocket.half : pocket.half)
      const left = Math.max(Math.min(mouth.x, end.x), Math.min(p.x, q.x) + CELL_RADIUS / 2)
      const right = Math.min(Math.max(mouth.x, end.x), Math.max(p.x, q.x) - CELL_RADIUS / 2)
      const isFacing = onSide.side === 'bottom' ? wall > p.y : wall < p.y
      return isFacing && right > left
        ? between(
            { x: left, y: p.y - (onSide.side === 'bottom' ? CELL_RADIUS / 2 : -CELL_RADIUS / 2) },
            { x: right, y: wall },
          )
        : null
    }
    return null
  }

  /**
   * The gap between two membrane sides a compartment is docked to that face each other across it, as a cleft between
   * two organelles, or between an organelle and its cell's membrane, is: from one side to the other, over the stretch
   * both reach.
   *
   * @returns {Object|null} Null for any other compartment, or where the two don't face each other.
   */
  function sideGap(compartment) {
    if (compartment.docks.length !== 2) return null
    const [a, b] = compartment.docks
    if (!a.side || !b.side || isHorizontal(a.side) !== isHorizontal(b.side)) return null
    const across = isHorizontal(a.side)
    const ends = []
    for (const dock of [a, b]) {
      const rect = byId.get(dock.on)?.kind === 'membrane' && rects.get(dock.on)
      if (!rect) return null
      const outside = dock.face === 'outside'
      // Outside, in under the rounded corners; inside, in from the membrane as one docked there alone is.
      const [p, q] = sideLine(rect, dock.side, dock.from, dock.to, outside ? -CELL_RADIUS / 2 : -INNER_INSET)
      const trim = outside ? CELL_RADIUS / 2 : 0
      const outward = dock.side === 'bottom' || dock.side === 'right' ? 1 : -1
      ends.push({
        at: across ? p.y : p.x,
        low: Math.min(across ? p.x : p.y, across ? q.x : q.y) + trim,
        high: Math.max(across ? p.x : p.y, across ? q.x : q.y) - trim,
        // Which way the compartment lies from it.
        toward: outside ? outward : -outward,
      })
    }
    const [one, two] = ends
    const low = Math.max(one.low, two.low)
    const high = Math.min(one.high, two.high)
    const isFacing = one.toward === -two.toward && (two.at - one.at) * one.toward > 0
    if (!isFacing || high <= low) return null
    return across
      ? between({ x: low, y: one.at }, { x: high, y: two.at })
      : between({ x: one.at, y: low }, { x: two.at, y: high })
  }

  /** Places a docked compartment, once what it is docked to has a place; false while it hasn't. */
  function placeDocked(compartment) {
    const parts = []
    const face = compartment.docks[0].face
    const sides = new Set(compartment.docks.map((dock) => dock.side).filter(Boolean))
    for (const dock of compartment.docks) {
      const target = byId.get(dock.on)
      if (target.kind === 'fold') {
        const found = pocketOf(target)
        if (!found) continue
        const { rect, pocket } = found
        const { edge, at, half, depth } = pocket
        if (dock.face === 'outside') {
          // Its lumen: the fold itself.
          parts.push(foldBox(rect, edge, [at - half, -INNER_INSET], [at + half, depth]))
        } else {
          const reach = compartment.depth ?? FOLD_REACH
          const box = foldBox(
            rect,
            edge,
            [at - half - INNER_INSET - reach, INNER_INSET],
            [at + half + INNER_INSET + reach, depth + reach],
          )
          parts.push(box)
          // Round a fold alone, it leaves the fold itself clear: the membrane is drawn under it.
          if (compartment.docks.length === 1) {
            const hole = foldBox(
              rect,
              edge,
              [at - half - INNER_INSET, -half],
              [at + half + INNER_INSET, depth + INNER_INSET],
            )
            cutouts.set(compartment.id, { ...hole, radius: half + INNER_INSET })
          }
        }
        continue
      }
      const rect = rects.get(target.id)
      if (!rect) continue
      if (dock.face === 'inside') {
        const depth = compartment.depth ?? INNER_DEPTH
        const [p, q] = sideLine(rect, dock.side, dock.from, dock.to, -INNER_INSET)
        const [r] = sideLine(rect, dock.side, dock.from, dock.from, -INNER_INSET - depth)
        parts.push(between(p, { x: isHorizontal(dock.side) ? q.x : r.x, y: isHorizontal(dock.side) ? r.y : q.y }))
        continue
      }
      // Outside: out by its depth, and in under the membrane's rounded corners, which are drawn over it.
      const depth =
        compartment.depth ??
        (sides.size > 2 ? SURROUND_DEPTH : isHorizontal(dock.side) ? REGION_HEIGHT : SIDE_REGION_WIDTH)
      const [p, q] = sideLine(rect, dock.side, dock.from, dock.to, -CELL_RADIUS)
      const [r] = sideLine(rect, dock.side, dock.from, dock.from, depth)
      parts.push(between(p, { x: isHorizontal(dock.side) ? q.x : r.x, y: isHorizontal(dock.side) ? r.y : q.y }))
    }
    if (parts.length < compartment.docks.length) return false
    // Between a fold's wall and the side of an organelle facing it, as a dyadic cleft is, or two membrane sides that
    // face each other: just the gap between them.
    let rect = foldGap(compartment) ?? sideGap(compartment) ?? boxOf(parts)
    // A band out along whole top or bottom sides runs on past their ends, as a fluid over cells does.
    const isBand =
      face === 'outside' &&
      sides.size === 1 &&
      isHorizontal([...sides][0]) &&
      compartment.docks.every((dock) => dock.side && dock.from === 0 && dock.to === 1)
    if (isBand) rect = { ...rect, x: rect.x - BAND_OVERRUN, width: rect.width + 2 * BAND_OVERRUN }
    // Within a membrane: kept INNER_INSET in from all of it, as each dock's stretch runs on to the membrane at its
    // ends, and rounded where it reaches the membrane's corners as the membrane is.
    const membrane = membraneWithin(compartment)
    if (membrane) {
      const inside = grownBy(membrane, -INNER_INSET)
      rect = overlapOf(rect, inside)
      clips.set(compartment.id, {
        x: inside.x - rect.x,
        y: inside.y - rect.y,
        width: inside.width,
        height: inside.height,
        radius: CELL_RADIUS - INNER_INSET,
      })
    }
    rects.set(compartment.id, rect)
    if (cutouts.has(compartment.id)) {
      const hole = cutouts.get(compartment.id)
      cutouts.set(compartment.id, { ...hole, x: hole.x - rect.x, y: hole.y - rect.y })
    }
    // What stands in it, from its corner.
    if (standing.has(compartment.id)) {
      arrange(compartment.id, rect.width)
      placeIn(compartment.id, rect)
    }
    return true
  }
  // One docked to a membrane that stands in another docked compartment waits for that one to be placed.
  let pending = ofKind('compartment').filter(isDocked)
  for (let pass = 0; pending.length && pass < 4; pass++)
    pending = pending.filter((compartment) => !placeDocked(compartment))

  // ── The places ────────────────────────────────────────────────────────
  /** How a piece is dragged (see dragModeOf) and resized, as its place says for the view. */
  const handling = (id, resize) => {
    const drag = dragModeOf(pieces, id)
    return { ...(drag && { drag }), ...(resize && { resize }) }
  }
  /**
   * The middle of the far edge of a compartment docked along one side, where its reach grip is: dragged across the
   * side, it sets how far the compartment reaches; dropped on another membrane's side or a fold, it docks it there
   * too (see resolveExtraDock).
   */
  const farEdge = (compartment) => {
    const [dock] = compartment.docks
    const rect = rects.get(compartment.id)
    if (compartment.docks.length !== 1 || !dock.side || !rect) return null
    const edge = dock.face === 'outside' ? dock.side : OPPOSITE[dock.side]
    const { x, y } = middleOf(rect)
    if (edge === 'top') return { x, y: rect.y }
    if (edge === 'bottom') return { x, y: bottomOf(rect) }
    if (edge === 'left') return { x: rect.x, y }
    return { x: rightOf(rect), y }
  }
  // A piece that takes one module is drawn as that module's node once one is on it, as a template's piece is; a
  // membrane as its cell, keyed by what is on its bulk.
  const occupantOf = (path) => occupants.get(path)?.[0] ?? null
  const cellKeyOf = (membraneId) => occupantOf(topology.bulkOf(membraneId)) ?? pieceKey(membraneId)
  /** The key of the place a compartment is drawn by: its membrane's cell for a bulk, else its own. */
  const keyOfCompartment = (id) => (bulks.has(id) ? cellKeyOf(bulks.get(id)) : (occupantOf(id) ?? pieceKey(id)))
  const own = { instance: PIECES_INSTANCE }
  const places = new Map()
  const sites = []
  /** The zones within a compartment, which what is placed in it (its name, its hint) keeps clear of. */
  const zonesIn = (compartmentId) =>
    (standing.get(compartmentId) ?? []).filter(isWithinPiece).map((piece) => ({ rect: rects.get(piece.id) }))
  /** A site, as dropSites reads it, grouped with the rest of the piece it is drawn by. */
  const nameOfNode = new Map(nodes.map((node) => [node.id, node.data?.name]))
  const offer = (path, role, kind, label, group, extra) => {
    const ref = pieceSiteRef(path)
    const members = occupants.get(path) ?? []
    sites.push({
      ref,
      instance: PIECES_INSTANCE,
      path,
      role,
      kind,
      // A compartment, membrane or tube is its module, and goes by its name.
      label: (kind === 'single' && members[0] && nameOfNode.get(members[0])) || label,
      group,
      occupant: kind === 'single' ? (members[0] ?? null) : null,
      ...(kind === 'slots' && { occupants: members }),
      ...extra,
    })
  }

  for (const membrane of membranes) {
    const rect = rects.get(membrane.id)
    if (!rect) continue
    const bulkId = topology.bulkOf(membrane.id)
    const bulk = bulkId && byId.get(bulkId)
    const shape = shapeOf.get(membrane.id)
    const key = cellKeyOf(membrane.id)
    // Each fold in the membrane's own coordinates, in the colour of what fills it.
    const folds = ofKind('fold')
      .filter((fold) => fold.membrane === membrane.id)
      .map((fold) => {
        const facet = shape.facets.find((each) => each.id === fold.id)
        const lumen = topology.foldLumen(fold.id).map((id) => byId.get(id))[0]
        return { facetId: fold.id, label: fold.label, ...foldPocket(rect, facet), tone: lumen?.tone ?? null }
      })
    const within = (standing.get(bulkId) ?? [])
      .filter((piece) => !isWithinPiece(piece))
      .map((piece) => ({ rect: rects.get(piece.id) }))
    const membraneNode = membrane.site === false ? null : occupantOf(membrane.id)
    places.set(key, {
      kind: 'cell',
      ...own,
      ...handling(membrane.id, FRAME_RESIZE),
      piece: membrane.id,
      path: membrane.id,
      bulk: bulkId ?? null,
      rect,
      shape,
      membrane: membraneNode,
      membraneSite: sitePath(membrane),
      site: bulk ? sitePath(bulk) : null,
      empty: !(bulkId && occupantOf(bulkId)),
      label: bulk?.label ?? membrane.label,
      tone: null,
      ...(membrane.parent && { parent: keyOfCompartment(membrane.parent) }),
      membraneSkin: membraneSkinOf(membrane),
      // Its inside's skin: a cell with no bulk, its inside all docked compartments, has none of its own.
      ...(areaSkinOf(bulk) && { skin: areaSkinOf(bulk) }),
      hintAt: membrane.parent
        ? { x: rect.width / 2, y: rect.height / 2 + 10 }
        : cellHint(rect, [...zonesIn(bulkId), ...within]),
      // A span along part of its side is named out from its own middle.
      facetLabels: topology
        .spansOf(membrane.id)
        .filter((span) => span.site !== false)
        .map((span) => {
          if (span.from === 0 && span.to === 1) return { facetId: span.id, label: span.label, edge: span.side }
          const middle = proteinPlacement(rect, span.id, 0, 1, shape)
          return {
            facetId: span.id,
            label: span.label,
            edge: middle.outward,
            at: { x: middle.x - rect.x, y: middle.y - rect.y },
          }
        }),
      ...(folds.length && { folds }),
      zones: zonesIn(bulkId),
    })
    if (bulk && bulk.site !== false) offer(bulkId, 'cytosol', 'single', bulk.label, key, { key, rect })
    // Its band is its module's node; a membrane is never without one but for the moment it is made.
    if (membraneNode) places.set(membraneNode, { kind: 'membrane', cell: key, ...own, site: pieceSiteRef(membrane.id) })
    if (membrane.site !== false) offer(membrane.id, 'membrane', 'single', membrane.label, key, { key, rect })

    // The proteins on each span and fold, in slot order, and the slots a drop can take.
    for (const facet of shape.facets) {
      const path = facetPath(membrane.id, facet)
      const span = facet.fold ? null : topology.span(path)
      if ((span ?? byId.get(facet.id)).site === false) continue
      const members = occupants.get(path) ?? []
      const widths = members.map(widthOf)
      const name = facet.annotation?.facet ?? facet.id
      members.forEach((id, order) => {
        const placement = proteinPlacement(rect, facet.id, order, members.length, shape, widths)
        places.set(id, {
          kind: 'protein',
          cell: key,
          facet: name,
          part: facet.id,
          order,
          ...placement,
          ...own,
          site: pieceSiteRef(path),
        })
      })
      const slots = facetSlots(rect, facet.id, members.length, shape, { widths })
      offer(path, 'membraneProtein', 'slots', facet.label, key, {
        cell: key,
        facet: facet.id,
        slots,
        widths,
        cellRect: rect,
        shape,
      })
    }
  }

  for (const compartment of ofKind('compartment')) {
    if (bulks.has(compartment.id)) continue
    const rect = rects.get(compartment.id)
    if (!rect) continue
    const inner = isDocked(compartment) && compartment.docks[0].face === 'inside'
    const host = inner && byId.get(compartment.docks[0].on)
    const hostMembrane = host && (host.kind === 'fold' ? host.membrane : host.id)
    const key = keyOfCompartment(compartment.id)
    places.set(key, {
      kind: 'region',
      ...own,
      ...handling(compartment.id, isDocked(compartment) ? null : FRAME_RESIZE),
      piece: compartment.id,
      path: compartment.id,
      side: null,
      adjacent: null,
      rect,
      site: sitePath(compartment),
      empty: !occupantOf(compartment.id),
      tone: compartment.tone,
      form: inner ? 'inner' : isDocked(compartment) ? 'band' : 'free',
      // What it is drawn within: the cell it is docked inside, else the compartment it stands in.
      ...(inner
        ? { parent: cellKeyOf(hostMembrane) }
        : compartment.parent && { parent: keyOfCompartment(compartment.parent) }),
      // Named along the side it lies against; one round a membrane, or on more than two sides, in its own corner.
      ...(isDocked(compartment) &&
        new Set(compartment.docks.map((dock) => dock.side)).size <= 2 && {
          edge: compartment.docks.find((dock) => dock.side)?.side ?? 'top',
        }),
      ...(cutouts.has(compartment.id) && { cutout: cutouts.get(compartment.id) }),
      ...(clips.has(compartment.id) && { clip: clips.get(compartment.id) }),
      ...(areaSkinOf(compartment) && { skin: areaSkinOf(compartment) }),
      ...(compartment.style === 'vessel' && { shape: 'tube' }),
      label: compartment.label,
    })
    // One within a membrane is told from the cell round it by being the smaller (see nearestSite).
    if (compartment.site !== false) {
      offer(compartment.id, 'region', 'single', compartment.label, key, { key, rect, ...(inner && { inner: true }) })
    }
  }

  for (const zone of ofKind('zone')) {
    const rect = rects.get(zone.id)
    if (!rect) continue
    const host = keyOfCompartment(zone.compartment)
    const members = occupants.get(zone.id) ?? []
    places.set(pieceKey(zone.id), {
      kind: 'zone',
      ...own,
      ...handling(zone.id, FRAME_RESIZE),
      piece: zone.id,
      path: zone.id,
      compartment: zone.compartment,
      cell: host,
      rect,
      site: sitePath(zone),
      empty: !members.length,
      // Named by someone, so its name says what its processes share, not just what it is.
      named: !isDefaultZoneLabel(zone.label),
      label: zone.label,
    })
    // Its processes in a row along its top, each drawn as its symbol with its name under it, as a protein is.
    const row = zoneSlots(rect, members.map(widthOf))
    members.forEach((id, order) => {
      places.set(id, {
        kind: 'cytosolic',
        symbol: true,
        cell: host,
        order,
        ...row[order],
        ...own,
        site: pieceSiteRef(zone.id),
      })
    })
    if (zone.site === false) continue
    const slots = row.map((slot, order) => ({ ...slot, spare: order === members.length }))
    offer(zone.id, 'cytosolic', 'slots', zone.label, host, { cell: host, process: zone.id, symbol: true, slots, rect })
  }

  // Images: a picture each, drawn by its frame on the canvas, offering no site.
  for (const image of ofKind('image')) {
    const rect = rects.get(image.id)
    if (!rect) continue
    places.set(pieceKey(image.id), {
      kind: 'image',
      ...own,
      ...handling(image.id, IMAGE_RESIZE),
      piece: image.id,
      path: image.id,
      rect,
      site: null,
      image: image.image ?? null,
      opacity: image.opacity ?? 1,
      ...(areaSkinOf(image) && { skin: areaSkinOf(image) }),
      label: image.label,
    })
  }

  // ── 3. Tubes ──────────────────────────────────────────────────────────
  for (const tube of ofKind('tube')) {
    const [a, b] = tube.ends.map((id) => rects.get(id))
    if (!a || !b) continue
    // A joint stays on the straight of both sides it is on, clear of their rounded corners: a cell's, its membrane's.
    const radii = tube.ends.map((id) => (bulks.has(id) ? CELL_RADIUS : REGION_RADIUS))
    const touch = contact(a, b, { radii, size: TUBE_ZONE, least: 2 * BRIDGE_HALF })
    const key = pieceKey(tube.id)
    const node = occupantOf(tube.id)
    const base = {
      kind: 'link',
      ...own,
      piece: tube.id,
      path: tube.id,
      site: sitePath(tube),
      empty: !node,
      flow: tube.flux,
      label: tube.label,
      // The skin its joint is drawn with, where it has one (see BioJointSymbol).
      jointSkin: resolveSkin(contextOfPiece(topology, tube.id), tube.skin)?.id ?? null,
    }
    let zone
    let joint = null
    // A gap junction needs its two membranes to meet: apart, it is drawn broken, its connexons with nothing to dock to.
    let broken = false
    // A flow between compartments apart runs along a conduit: which way its way runs at its room.
    let conduit = null
    // A bridge between two cells apart is an open channel across the gap between their membranes.
    const cells = [...new Set(tube.ends.map((id) => topology.enclosureOf(id)))]
    const channel =
      tube.flux === 'bridge' &&
      !touch &&
      cells.length === 2 &&
      cells.every((id) => id && rects.get(id)) &&
      bridgeChannel(rects.get(cells[0]), rects.get(cells[1]))
    if (channel) {
      const { from, to, vertical } = channel
      const length = vertical ? to.y - from.y : to.x - from.x
      // Its module is drawn on it, reaching a little into each cell at most, as the lumen does.
      const reach = length + 2 * MEMBRANE_BAND_HALF
      const size = {
        width: Math.max(2 * MEMBRANE_BAND_HALF, Math.min(TUBE_ZONE.width, reach)),
        height: TUBE_ZONE.height,
      }
      zone = zoneAt(
        { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        vertical ? { width: size.height, height: size.width } : size,
      )
      joint = tube.flux
      const rect = boxOf([zone, channelBox(channel)])
      places.set(key, { ...base, rect, joint, tone: byId.get(tube.ends[0]).tone, zone, channel })
    } else if (touch) {
      zone = zoneAt(touch, touch.size)
      joint = tube.flux
      places.set(key, { ...base, rect: zone, joint, tone: byId.get(tube.ends[0]).tone, zone })
    } else {
      const points = routeTube(a, b, tube.bends ?? [])
      // Bent by the user, its room is at its bend; else midway along its way, clear of its ends.
      const centre = tube.bends?.length === 1 ? tube.bends[0] : pathMiddle(points)
      // A flow runs along a conduit, drawn as a stretch of vessel along its way (see BioJointSymbol): its room turned
      // to run down a way that runs down.
      conduit = tube.flux === 'flow' ? runAt(points, centre) : null
      const size = conduit?.vertical ? { width: TUBE_ZONE.height, height: TUBE_ZONE.width } : TUBE_ZONE
      zone = tube.bends?.length === 1 ? zoneAt(centre, size) : clearOfEnds(zoneAt(centre, size), points, [a, b])
      const rect = boxOf([zone, ...points.map((point) => ({ ...point, width: 0, height: 0 }))])
      broken = tube.flux === 'junction'
      places.set(key, {
        ...base,
        rect,
        points,
        zone,
        ...(broken && { broken: true }),
        ...(conduit && { conduit, tone: byId.get(tube.ends[0]).tone }),
      })
      // Grips: one at each end, to join it to another compartment, and one above its room, to bend it.
      const grip = (what, at, extra = {}) =>
        places.set(`grip:${what}:${tube.id}`, { kind: 'grip', grip: what, piece: tube.id, ...own, ...at, ...extra })
      grip('start', points[0], { end: 0 })
      grip('end', points.at(-1), { end: 1 })
      grip('bend', { x: zone.x + zone.width / 2, y: zone.y - GRIP_RISE }, { below: zone.height / 2 + GRIP_RISE })
    }
    // The module on it is drawn as a card in the room it leaves, or as its joint (broken, a junction apart), or as
    // the stretch of vessel a conduit is.
    if (node) {
      places.set(node, {
        kind: 'card',
        ...(joint && { joint }),
        ...(broken && { joint: tube.flux, broken: true }),
        ...(conduit && { joint: 'conduit', conduit }),
        jointSkin: base.jointSkin,
        x: zone.x + (zone.width - CARD.width) / 2,
        y: zone.y + (zone.height - CARD.height) / 2,
        ...own,
        site: pieceSiteRef(tube.id),
        link: key,
      })
    }
    if (tube.site !== false) {
      offer(tube.id, 'cytosolic', 'single', tube.label, key, {
        key,
        rect: zone,
        inner: true,
        ...(joint && { joint: true }),
      })
    }
  }

  // A grip at each fold's far end, to move it along its side and change its depth.
  for (const fold of ofKind('fold')) {
    const rect = rects.get(fold.membrane)
    const facet = rect && shapeOf.get(fold.membrane).facets.find((each) => each.id === fold.id)
    if (!facet) continue
    const pocket = foldPocket(rect, facet)
    const end = foldPoint(rect, pocket.edge, pocket.at, pocket.depth)
    places.set(`grip:fold:${fold.id}`, { kind: 'grip', grip: 'fold', piece: fold.id, ...own, ...end })
  }

  // A grip on the far edge of each compartment docked along one side, to set its reach or dock it somewhere else too.
  for (const compartment of ofKind('compartment').filter(isDocked)) {
    const edge = !bulks.has(compartment.id) && farEdge(compartment)
    if (edge)
      places.set(`grip:reach:${compartment.id}`, {
        kind: 'grip',
        grip: 'reach',
        piece: compartment.id,
        ...own,
        ...edge,
      })
  }

  return { places, rects, sites }
}
