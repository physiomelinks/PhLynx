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
 * that isn't a bulk a 'region', a tube a 'link'; a process zone is a 'zone'. Each is keyed by pieceKey(id) and says
 * which piece it is (`piece`) and which site it offers (`site`, a pieceSiteRef, or null).
 */

import { cellHint, CARD, GAP, processZone, REGION_HEIGHT, SIDE_REGION_WIDTH, SURROUND_DEPTH, TUBE } from '../layout.js'
import {
  CELL_RADIUS,
  FOLD,
  GLYPH_HEIGHT,
  MIN_CELL,
  fitCellRect,
  foldDepthFor,
  foldPocket,
  facetSlots,
  foldPoint,
  proteinPlacement,
} from '../geometry.js'
import { byName, inSlotOrder } from '../scaffold.js'
import { parseSiteRef } from '../templates.js'
import { withFolds, withOutline } from '../shape.js'
import { pathOf } from '../shapeGeometry.js'
import { dragModeOf } from './moves.js'
import { spanPath, topologyOf } from './topology.js'

/** The key a piece's place has in the view's layout. */
export const pieceKey = (id) => `pc:${id}`

/** The instance a site of the pieces is named under, as a template instance's sites are. */
export const PIECES_INSTANCE = 'pieces'

/** A site of the pieces, as a node's bioView names it. */
export const pieceSiteRef = (path) => `${PIECES_INSTANCE}/${path}`

/** The smallest an organelle's membrane is drawn. */
const ORGANELLE_MIN = Object.freeze({ width: 200, height: 140 })
/** How big a compartment standing freely is drawn unless its frame says. */
const FREE_COMPARTMENT = Object.freeze({ width: 320, height: REGION_HEIGHT })
/** Room round what stands inside a compartment, for its proteins' names, and between two in a row. */
const ROOM = GLYPH_HEIGHT / 2 + 36
/** Room below what stands in a cell, for its name and hint. */
const HINT_ROOM = 100
/** How far in from a membrane a compartment docked inside it starts, and how far it reaches unless it says. */
const INNER_INSET = 10
const INNER_DEPTH = 84
/** How far round a fold a compartment docked to its walls reaches. */
const FOLD_REACH = 46
/** How far a band out from one side of a membrane runs on past its ends. */
const BAND_OVERRUN = GAP
/** The room a tube leaves for its module, and a joint between two compartments that touch. */
const TUBE_ZONE = Object.freeze({ width: CARD.width + 16, height: CARD.height + 16 })
/** A piece with a frame is resized from its bottom-right corner. */
const FRAME_RESIZE = Object.freeze({ mode: 'frame', position: 'bottom-right' })
const OPPOSITE = Object.freeze({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' })

/** How far above a tube's room its bend grip sits. */
const GRIP_RISE = 10

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

/** A box from two corners, in either order. */
const between = (a, b) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
})

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

/**
 * Where two rects touch, if they do: the middle of the stretch of edge they share; or, with one inside the other, the
 * middle of the inner one's right side.
 */
function contact(a, b) {
  const near = (p, q) => Math.abs(p - q) <= TOUCHING
  const shared = (lowA, highA, lowB, highB) => (Math.max(lowA, lowB) + Math.min(highA, highB)) / 2
  // One inside the other: where the inner one's right side meets the outer's inside.
  const holds = (outer, inner) =>
    inner.x >= outer.x && inner.y >= outer.y && rightOf(inner) <= rightOf(outer) && bottomOf(inner) <= bottomOf(outer)
  const inner = holds(a, b) ? b : holds(b, a) ? a : null
  if (inner) return { x: rightOf(inner), y: inner.y + inner.height / 2 }
  const overlapX = a.x < rightOf(b) && b.x < rightOf(a)
  const overlapY = a.y < bottomOf(b) && b.y < bottomOf(a)
  if (overlapY && near(rightOf(a), b.x))
    return { x: (rightOf(a) + b.x) / 2, y: shared(a.y, bottomOf(a), b.y, bottomOf(b)) }
  if (overlapY && near(rightOf(b), a.x))
    return { x: (rightOf(b) + a.x) / 2, y: shared(a.y, bottomOf(a), b.y, bottomOf(b)) }
  if (overlapX && near(bottomOf(a), b.y))
    return { x: shared(a.x, rightOf(a), b.x, rightOf(b)), y: (bottomOf(a) + b.y) / 2 }
  if (overlapX && near(bottomOf(b), a.y))
    return { x: shared(a.x, rightOf(a), b.x, rightOf(b)), y: (bottomOf(b) + a.y) / 2 }
  return null
}

/** Where the card at a place in a process zone's row goes: in from the zone's corner. */
const zoneSlot = (zone, order) => ({ x: zone.x + CELL_RADIUS / 2 + order * (CARD.width + 16), y: zone.y + 8 })

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
 * Lays the pieces out.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated (see validatePieces).
 * @param {Object} [options]
 * @param {Map<string, Object>} [options.shapes] - Skin id -> the geometry it gives (see the template store's shapes).
 * @param {Array<{id: string, data?: Object}>} [options.nodes] - The diagram's nodes: those bound to a site of the
 *   pieces are drawn on it (see boundToPieces).
 * @param {(id: string) => number} [options.widthOf] - How wide a node's name is drawn under its cartoon.
 * @returns {{places: Map<string, Object>, rects: Map<string, Object>, sites: Array<Object>}} places: by pieceKey, or
 *   by the node on a piece that takes one module, and the nodes bound to sites (a protein, a process card, a tube's
 *   module, a membrane's); rects: piece id -> where it is drawn (a bulk has its membrane's); sites: every site, as
 *   layoutPhysiology gives a template's, for the drop prompts.
 */
export function layoutPieces(pieces, { shapes = new Map(), nodes = [], widthOf = () => 0 } = {}) {
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

  // What stands in each compartment, or on the canvas (''), by its own frame or in a row: membranes, free
  // compartments and process zones.
  const standing = new Map()
  const stand = (parent, piece) => standing.set(parent ?? '', [...(standing.get(parent ?? '') ?? []), piece])
  for (const piece of pieces) {
    if (piece.kind === 'membrane' || isFree(piece)) stand(piece.parent, piece)
    if (piece.kind === 'zone') stand(piece.compartment, piece)
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
    const drawn = membrane.skin && shapes.get(membrane.skin.ref)
    shapeOf.set(membrane.id, drawn ? withOutline(shape, drawn) : shape)
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

  // ── 1. Sizes, from the inside out ─────────────────────────────────────
  const sizes = new Map()
  /** Where what stands in a compartment goes, from its corner, and how far it reaches. */
  const arrangements = new Map()

  /** Lays out what stands in a container whose inside is `width` wide, from its corner. */
  function arrange(containerId, width) {
    const rel = new Map()
    const list = standing.get(containerId ?? '') ?? []
    const zones = list.filter((piece) => piece.kind === 'zone')
    const others = list.filter((piece) => piece.kind !== 'zone')
    others.forEach(measure)
    // Process zones without a frame in rows from the top, below the proteins on its top side, as wide as it is.
    let row = 0
    // What the zones that span the container need of its width: room for their cards and a spare place past them,
    // not the width they take from it, which would grow it again and again.
    let zonesNeed = 0
    for (const zone of zones) {
      if (zone.frame) rel.set(zone.id, { ...zone.frame })
      else {
        const area = processZone({ x: 0, y: 0, width }, row++)
        const cards = CELL_RADIUS / 2 + ((occupants.get(zone.id) ?? []).length + 1) * (CARD.width + 16)
        zonesNeed = Math.max(zonesNeed, area.x + cards + CELL_RADIUS / 2)
        rel.set(zone.id, { ...area, width: Math.max(area.width, cards) })
      }
    }
    const spanning = new Set(zones.filter((zone) => !zone.frame).map((zone) => zone.id))
    const below = containerId ? Math.max(GLYPH_HEIGHT + 40, ...[...rel.values()].map(bottomOf)) + ROOM : 0
    // The rest by their frames, or in a row below the zones; on the canvas, side by side from its corner.
    let x = containerId ? CELL_RADIUS + ROOM : 0
    for (const piece of others) {
      const size = sizes.get(piece.id)
      if (piece.frame) rel.set(piece.id, { x: piece.frame.x, y: piece.frame.y, ...size })
      else {
        rel.set(piece.id, { x, y: below, ...size })
        x += size.width + (containerId ? 2 * ROOM : 2 * GAP)
      }
    }
    const fixed = [...rel].filter(([id]) => !spanning.has(id)).map(([, rect]) => rect)
    const reach = boxOf([...fixed, { x: 0, y: 0, width: 0, height: 0 }])
    const tall = boxOf([...rel.values(), { x: 0, y: 0, width: 0, height: 0 }])
    arrangements.set(containerId ?? '', rel)
    return {
      width: fixed.length ? reach.x + reach.width : 0,
      zonesNeed,
      height: tall.y + tall.height,
      zones: zones.length,
    }
  }

  function measure(piece) {
    if (sizes.has(piece.id)) return sizes.get(piece.id)
    if (piece.kind === 'membrane') {
      const least = piece.parent ? ORGANELLE_MIN : MIN_CELL
      const skin = piece.skin && shapes.get(piece.skin.ref)
      const base = piece.frame ? { width: piece.frame.width, height: piece.frame.height } : { ...least }
      let size = skin
        ? { width: skin.width, height: skin.height }
        : fitCellRect({ x: 0, y: 0, ...base }, countsOf(piece.id), shapeOf.get(piece.id), widthsOf(piece.id), least)
      const bulk = topology.bulkOf(piece.id)
      if (bulk && !skin) {
        const inside = arrange(bulk, size.width)
        size = {
          width: Math.max(size.width, inside.width ? inside.width + CELL_RADIUS + ROOM : 0, inside.zonesNeed),
          height: Math.max(size.height, inside.height + (inside.zones || standing.has(bulk) ? HINT_ROOM : 0)),
        }
        // The zones span the cell as it finally is.
        arrange(bulk, size.width)
      } else if (bulk) arrange(bulk, size.width)
      sizes.set(piece.id, { width: size.width, height: size.height })
      return sizes.get(piece.id)
    }
    // A compartment standing freely.
    const base = piece.frame
      ? { width: piece.frame.width, height: piece.frame.height }
      : piece.style === 'vessel'
        ? { ...TUBE }
        : { ...FREE_COMPARTMENT }
    const inside = standing.has(piece.id) ? arrange(piece.id, base.width) : { width: 0, zonesNeed: 0, height: 0 }
    const size = {
      width: Math.max(base.width, inside.width ? inside.width + ROOM : 0, inside.zonesNeed),
      height: Math.max(base.height, inside.height + ROOM),
    }
    if (standing.has(piece.id)) arrange(piece.id, size.width)
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
  const clips = new Map()
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
        // A skin may draw the area itself.
        const area = target.skin && shapes.get(target.skin.ref)?.regions?.[compartment.id]
        if (area) {
          parts.push({
            x: rect.x + area.bounds.x,
            y: rect.y + area.bounds.y,
            width: area.bounds.width,
            height: area.bounds.height,
          })
          clips.set(
            compartment.id,
            area.points.map((point) => ({ x: point.x - area.bounds.x, y: point.y - area.bounds.y })),
          )
          continue
        }
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
    // Between a fold's wall and the side of an organelle facing it, as a dyadic cleft is: just the gap between them.
    let rect = foldGap(compartment) ?? boxOf(parts)
    // A band out along whole top or bottom sides runs on past their ends, as a fluid over cells does.
    const isBand =
      face === 'outside' &&
      sides.size === 1 &&
      isHorizontal([...sides][0]) &&
      compartment.docks.every((dock) => dock.side && dock.from === 0 && dock.to === 1)
    if (isBand) rect = { ...rect, x: rect.x - BAND_OVERRUN, width: rect.width + 2 * BAND_OVERRUN }
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
  /** A compartment docked along one side is resized across it, from its far edge: its depth. */
  const depthResize = (compartment) => {
    const [dock] = compartment.docks
    if (compartment.docks.length !== 1 || !dock.side) return null
    return {
      mode: 'depth',
      side: dock.side,
      face: dock.face,
      position: dock.face === 'outside' ? dock.side : OPPOSITE[dock.side],
    }
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
  const zonesIn = (compartmentId) =>
    (standing.get(compartmentId) ?? [])
      .filter((piece) => piece.kind === 'zone')
      .map((zone) => ({ rect: rects.get(zone.id) }))
  /** A site, as dropSites reads it, grouped with the rest of the piece it is drawn by. */
  const offer = (path, role, kind, label, group, extra) => {
    const ref = pieceSiteRef(path)
    const members = occupants.get(path) ?? []
    sites.push({
      ref,
      instance: PIECES_INSTANCE,
      path,
      role,
      kind,
      label,
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
    const drawn = membrane.skin && shapes.get(membrane.skin.ref)
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
      .filter((piece) => piece.kind !== 'zone')
      .map((piece) => ({ rect: rects.get(piece.id) }))
    const anchor = drawn?.anchors?.name
    const membraneNode = membrane.site === false ? null : occupantOf(membrane.id)
    places.set(key, {
      kind: 'cell',
      ...own,
      ...handling(membrane.id, drawn ? null : FRAME_RESIZE),
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
      ...(bulk?.skin || membrane.skin ? { skin: membrane.skin ?? bulk.skin } : {}),
      ...(drawn && { outline: pathOf(drawn.outline) }),
      hintAt: anchor
        ? { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 }
        : membrane.parent
          ? { x: rect.width / 2, y: rect.height / 2 + 10 }
          : cellHint(rect, [...zonesIn(bulkId), ...within]),
      // A span along part of its side, or along a stretch a skin draws, is named out from its own middle.
      facetLabels: topology
        .spansOf(membrane.id)
        .filter((span) => span.site !== false)
        .map((span) => {
          const facet = shape.facets.find((each) => each.id === span.id)
          if (!facet.path && span.from === 0 && span.to === 1)
            return { facetId: span.id, label: span.label, edge: span.side }
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
    if (membraneNode) {
      places.set(membraneNode, { kind: 'membrane', cell: key, ...own, site: pieceSiteRef(membrane.id) })
    }
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
      ...handling(compartment.id, isDocked(compartment) ? depthResize(compartment) : FRAME_RESIZE),
      piece: compartment.id,
      path: compartment.id,
      side: null,
      adjacent: null,
      rect,
      site: sitePath(compartment),
      empty: !occupantOf(compartment.id),
      tone: compartment.tone,
      form: inner ? 'inner' : isDocked(compartment) ? 'band' : 'free',
      ...(inner && { parent: cellKeyOf(hostMembrane) }),
      // Named along the side it lies against; one round a membrane, or on more than two sides, in its own corner.
      ...(isDocked(compartment) &&
        new Set(compartment.docks.map((dock) => dock.side)).size <= 2 && {
          edge: compartment.docks.find((dock) => dock.side)?.side ?? 'top',
        }),
      ...(cutouts.has(compartment.id) && { cutout: cutouts.get(compartment.id) }),
      ...(clips.has(compartment.id) && { clip: clips.get(compartment.id) }),
      ...(compartment.skin && { skin: compartment.skin }),
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
      label: zone.label,
    })
    // Its processes in a row along its top, as a template's process area's are.
    members.forEach((id, order) => {
      places.set(id, {
        kind: 'cytosolic',
        cell: host,
        order,
        ...zoneSlot(rect, order),
        ...own,
        site: pieceSiteRef(zone.id),
      })
    })
    if (zone.site === false) continue
    const slots = Array.from({ length: members.length + 1 }, (_, order) => ({
      ...zoneSlot(rect, order),
      spare: order === members.length,
    }))
    offer(zone.id, 'cytosolic', 'slots', zone.label, host, { cell: host, process: zone.id, slots, rect })
  }

  // ── 3. Tubes ──────────────────────────────────────────────────────────
  for (const tube of ofKind('tube')) {
    const [a, b] = tube.ends.map((id) => rects.get(id))
    if (!a || !b) continue
    const touch = contact(a, b)
    // A skin may anchor it, as the rod's cilium.
    const host = [tube.ends[0], tube.ends[1]].map((id) => byId.get(topology.enclosureOf(id))).find(Boolean)
    const anchor = host?.skin && shapes.get(host.skin.ref)?.anchors?.[tube.id]
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
    }
    let zone
    let joint = null
    if (touch || anchor) {
      const hostRect = host && rects.get(host.id)
      zone = anchor
        ? zoneAt({ x: hostRect.x + anchor.x + anchor.width / 2, y: hostRect.y + anchor.y + anchor.height / 2 })
        : zoneAt(touch)
      joint = tube.flux
      places.set(key, { ...base, rect: zone, joint, tone: byId.get(tube.ends[0]).tone, zone })
    } else {
      const points = routeTube(a, b, tube.bends ?? [])
      // Bent by the user, its room is at its bend; else midway along its way, clear of its ends.
      zone = tube.bends?.length === 1 ? zoneAt(tube.bends[0]) : clearOfEnds(zoneAt(pathMiddle(points)), points, [a, b])
      const rect = boxOf([zone, ...points.map((point) => ({ ...point, width: 0, height: 0 }))])
      places.set(key, { ...base, rect, points, zone })
      // Grips: one at each end, to join it to another compartment, and one above its room, to bend it.
      const grip = (what, at, extra = {}) =>
        places.set(`grip:${what}:${tube.id}`, { kind: 'grip', grip: what, piece: tube.id, ...own, ...at, ...extra })
      grip('start', points[0], { end: 0 })
      grip('end', points.at(-1), { end: 1 })
      grip('bend', { x: zone.x + zone.width / 2, y: zone.y - GRIP_RISE }, { below: zone.height / 2 + GRIP_RISE })
    }
    // The module on it is drawn as a card in the room it leaves, or as its joint.
    if (node) {
      places.set(node, {
        kind: 'card',
        ...(joint && { joint }),
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

  return { places, rects, sites }
}
