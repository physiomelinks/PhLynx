/**
 * Geometry of the physiological view. A cell is a rounded rectangle whose outline is its membrane, and its
 * shape (shape.js) puts each facet of the membrane along one edge. The default shape is the epithelial cell:
 * the top edge is the apical facet, the bottom edge the basolateral facet, and the left and right edges are
 * the lateral facet's two sides. Membrane proteins sit in slots along a facet, centred on the outline. A drop
 * prompt sits on each protein, and one spare past the last is somewhere to drop the next.
 */

import { Position } from '@vue-flow/core'

import { CELL_RADIUS, FACET_INSET, GLYPH_WIDTH, LABEL_GAP, MIN_CELL, SLOT_PITCH, proteinLabelWidth } from './metrics.js'
import { EPITHELIAL_SHAPE, annotationOfFacet, facetById, facetOfAnnotation } from './shape.js'
import { isInside, lengthOf, pointAlong } from './shapeGeometry.js'

export { CELL_RADIUS, FACET_INSET, GLYPH_HEIGHT, GLYPH_WIDTH, MIN_CELL, SLOT_PITCH, proteinLabelWidth } from './metrics.js'

/**
 * Where each edge of a cell points, which way a protein on it is turned, and the axis its slots run along.
 */
export const EDGES = Object.freeze({
  top: Object.freeze({ outward: Position.Top, rotation: 0, axis: 'x' }),
  bottom: Object.freeze({ outward: Position.Bottom, rotation: 180, axis: 'x' }),
  left: Object.freeze({ outward: Position.Left, rotation: -90, axis: 'y' }),
  right: Object.freeze({ outward: Position.Right, rotation: 90, axis: 'y' }),
})

/** The narrowest a protein's name is drawn: a spare slot's, which has none, counts as that too. */
const NARROWEST = proteinLabelWidth()

/**
 * The distance between two neighbouring slots along a top or bottom edge: SLOT_PITCH, or more, so their names,
 * centred under them, keep LABEL_GAP apart.
 *
 * @param {number} [a] - One name's width (see proteinLabelWidth).
 * @param {number} [b] - The other's.
 * @returns {number}
 */
export function pitchBetween(a = NARROWEST, b = NARROWEST) {
  return Math.max(SLOT_PITCH, (a + b) / 2 + LABEL_GAP)
}

/**
 * The distance from each slot to the next in a row.
 *
 * @param {number} count - Slots in the row.
 * @param {number[]} [widths] - Each slot's name width, in order: none along a side edge, where names don't meet.
 * @returns {number[]} count - 1 of them.
 */
function rowPitches(count, widths) {
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) =>
    widths ? pitchBetween(widths[i], widths[i + 1]) : SLOT_PITCH
  )
}

/**
 * Spreads slot centres along a line, centred on its middle.
 *
 * @param {number} start
 * @param {number} end
 * @param {number} count
 * @param {number[]} [widths] - As for rowPitches.
 * @returns {number[]}
 */
function spread(start, end, count, widths) {
  const pitches = rowPitches(count, widths)
  let at = (start + end) / 2 - pitches.reduce((total, pitch) => total + pitch, 0) / 2
  return Array.from({ length: count }, (_, i) => (i ? (at += pitches[i - 1]) : at))
}

/**
 * The parts of an epithelial cell's membrane that hold their own row of slots: the lateral facet has one
 * down each side. Each is a facet of EPITHELIAL_SHAPE.
 */
export const FACET_PARTS = Object.freeze(EPITHELIAL_SHAPE.facets.map((facet) => facet.id))

/**
 * Gives the part of the membrane a facet and side name. A lateral protein with no side goes on the first
 * lateral part.
 *
 * @param {'apical'|'basolateral'|'lateral'} facet
 * @param {'left'|'right'} [at] - Which side, for lateral.
 * @param {Object} [shape=EPITHELIAL_SHAPE]
 * @returns {string} One of the shape's facet ids.
 */
export function partOf(facet, at, shape = EPITHELIAL_SHAPE) {
  return (
    facetOfAnnotation(shape, { facet, at }) ??
    shape.facets.find(({ annotation }) => annotation?.facet === facet)?.id ??
    facet
  )
}

/**
 * Gives the facet and side a part of the membrane is.
 *
 * @param {string} part - One of the shape's facet ids.
 * @param {Object} [shape=EPITHELIAL_SHAPE]
 * @returns {{facet: string, at: 'left'|'right'|undefined}}
 */
export function facetOfPart(part, shape = EPITHELIAL_SHAPE) {
  const annotation = annotationOfFacet(shape, part)
  return { facet: annotation?.facet ?? part, at: annotation?.at }
}

/**
 * @param {Object} shape
 * @param {string} part - A facet id.
 * @returns {Object} The EDGES entry of that facet's edge.
 */
function edgeOf(shape, part) {
  const name = facetById(shape, part)?.edge
  if (!EDGES[name]) throw new Error(`The cell has no facet "${part}".`)
  return { name, ...EDGES[name] }
}

/**
 * A fold's measures: how wide its lumen is between the outlines of its two walls; how deep it is unless its
 * template or its proteins ask for more; how far it stands in from the corner at the far end of its side; how far
 * down its walls the first protein sits; and how far the proteins along its side keep from its mouth.
 */
export const FOLD = Object.freeze({ width: 76, depth: 160, margin: 24, lead: 30, clearance: 44 })

/** The side a protein on each wall of a fold faces as one on that side of a cell does: out, into the fold's lumen. */
const FOLD_WALLS = Object.freeze({
  top: { low: 'right', high: 'left' },
  bottom: { low: 'right', high: 'left' },
  left: { low: 'bottom', high: 'top' },
  right: { low: 'bottom', high: 'top' },
})

/**
 * How deep a fold must be for its proteins: a row down each wall, or down the one facing an organelle, and a
 * spare slot.
 *
 * @param {number} count - Proteins on it.
 * @param {{lead?: number, facing?: boolean}} [fold] - As withFolds draws it.
 * @returns {number}
 */
export function foldDepthFor(count, { lead = FOLD.lead, facing = false } = {}) {
  const rows = facing ? count + 1 : Math.ceil((count + 1) / 2)
  return lead + GLYPH_WIDTH / 2 + (rows - 1) * SLOT_PITCH + GLYPH_WIDTH / 2 + FOLD.width / 2 + 8
}

/**
 * Gives where a fold is in its cell: how far along its side its middle is (from the side's left or top end), half
 * its lumen's width, and its depth in from the side. It comes in near the far end of its side, clear of the side's
 * own proteins, which are centred on what is left.
 *
 * @param {{width: number, height: number}} rect - The cell.
 * @param {{fold: string, depth?: number, lead?: number, facing?: boolean}} facet - The fold, from the cell's shape.
 * @returns {{edge: string, at: number, half: number, depth: number}}
 */
export function foldPocket(rect, facet) {
  const half = FOLD.width / 2
  const along = EDGES[facet.fold].axis === 'x' ? rect.width : rect.height
  const across = EDGES[facet.fold].axis === 'x' ? rect.height : rect.width
  const depth = Math.min(facet.depth ?? FOLD.depth, Math.max(FOLD.width, across - CELL_RADIUS))
  // Where its piece puts it along the side (`at`, 0 to 1), kept clear of the corners; else near the far end.
  const end = along - CELL_RADIUS - FOLD.margin - half
  const at = Number.isFinite(facet.at) ? Math.min(end, Math.max(CELL_RADIUS + FOLD.margin + half, facet.at * along)) : end
  return { edge: facet.fold, at, half, depth }
}

/**
 * Turns a place in a fold's own terms, how far along its side and how far in from it, into the cell's.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect - The cell.
 * @param {string} edge - The side the fold dips in from.
 * @param {number} along
 * @param {number} inward
 * @returns {{x: number, y: number}}
 */
export function foldPoint(rect, edge, along, inward) {
  if (edge === 'top') return { x: rect.x + along, y: rect.y + inward }
  if (edge === 'bottom') return { x: rect.x + along, y: rect.y + rect.height - inward }
  if (edge === 'left') return { x: rect.x + inward, y: rect.y + along }
  return { x: rect.x + rect.width - inward, y: rect.y + along }
}

/**
 * Gives the centres of a fold's slots: down its two walls in turn, the wall nearer its side's start first.
 *
 * @param {Object} rect - The cell.
 * @param {Object} facet - The fold.
 * @param {number} count
 * @returns {Array<{x: number, y: number, faces: string}>} faces: the side of a cell a protein there is drawn as on.
 */
function foldSlotPositions(rect, facet, count) {
  const pocket = foldPocket(rect, facet)
  const lead = facet.lead ?? FOLD.lead
  return Array.from({ length: count }, (_, order) => {
    // Down the wall facing an organelle alone, where a microdomain lies between the two.
    const wall = !facet.facing && order % 2 ? 'high' : 'low'
    const along = pocket.at + (wall === 'low' ? -pocket.half : pocket.half)
    const inward = lead + GLYPH_WIDTH / 2 + (facet.facing ? order : Math.floor(order / 2)) * SLOT_PITCH
    return { ...foldPoint(rect, pocket.edge, along, inward), faces: FOLD_WALLS[pocket.edge][wall] }
  })
}

/**
 * Gives the centres of the slots along a stretch of membrane a skin draws: spaced along it about its middle, each
 * facing out of the cell the nearest way a protein is drawn, up, down, left or right.
 *
 * @param {Object} rect - The cell.
 * @param {{path: Array<{x: number, y: number}>}} facet - With the stretch, in the cell's own coordinates.
 * @param {number} count
 * @param {{outline?: Array<Object>}} shape - With the cell's outline, which says which way is out.
 * @returns {Array<{x: number, y: number, faces: string}>}
 */
function pathSlotPositions(rect, facet, count, shape) {
  const total = lengthOf(facet.path)
  // Closer together where the stretch is short, down to a glyph's width.
  const pitch = count > 1 ? Math.max(GLYPH_WIDTH, Math.min(SLOT_PITCH, total / count)) : 0
  const first = total / 2 - ((count - 1) * pitch) / 2
  return Array.from({ length: count }, (_, order) => {
    const at = pointAlong(facet.path, Math.min(total, Math.max(0, first + order * pitch)))
    const heading = (at.angle * Math.PI) / 180
    // One of the two ways across the membrane leads out of the outline.
    let normal = { x: Math.sin(heading), y: -Math.cos(heading) }
    if (shape.outline && isInside(shape.outline, { x: at.x + normal.x * 14, y: at.y + normal.y * 14 })) normal = { x: -normal.x, y: -normal.y }
    const faces = Math.abs(normal.x) > Math.abs(normal.y) ? (normal.x > 0 ? 'right' : 'left') : normal.y > 0 ? 'bottom' : 'top'
    return { x: rect.x + at.x, y: rect.y + at.y, faces }
  })
}

/**
 * How much of a side's length, from its far end, a fold in from it takes from the side's own proteins.
 *
 * @param {Object} shape
 * @param {string} edge
 * @returns {number} 0 for a side with no fold.
 */
function foldReserve(shape, edge) {
  return shape.facets.some((facet) => facet.fold === edge) ? CELL_RADIUS + FOLD.margin + FOLD.width + FOLD.clearance - FACET_INSET : 0
}

/**
 * Gives the centres of a membrane part's slots.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect - The cell.
 * @param {string} part - One of the shape's facet ids.
 * @param {number} count - How many slots.
 * @param {Object} [shape=EPITHELIAL_SHAPE]
 * @param {number[]} [widths] - The names' widths in slot order, which space a top or bottom row out.
 * @returns {Array<{x: number, y: number}>}
 */
export function slotPositions(rect, part, count, shape = EPITHELIAL_SHAPE, widths = []) {
  const { x, y, width, height } = rect
  const fold = facetById(shape, part)
  if (fold?.path) return pathSlotPositions(rect, fold, count, shape).map((slot) => ({ x: slot.x, y: slot.y }))
  if (fold?.fold) return foldSlotPositions(rect, fold, count).map((slot) => ({ x: slot.x, y: slot.y }))
  const edge = edgeOf(shape, part)
  // A fold in from this side takes its far end.
  const reserve = foldReserve(shape, edge.name)
  // Facets that share a side take a stretch of it each, in the order the shape lists them.
  const sharing = shape.facets.filter((facet) => facet.edge === edge.name && !facet.path)
  const share = (from, to) => {
    // A span of a piece's membrane says which stretch of the side it takes (0 to 1).
    const own = facetById(shape, part)
    if (Number.isFinite(own?.from) && Number.isFinite(own?.to)) return [from + own.from * (to - from), from + own.to * (to - from)]
    const each = (to - from) / Math.max(1, sharing.length)
    const index = Math.max(0, sharing.findIndex((facet) => facet.id === part))
    return [from + index * each, from + (index + 1) * each]
  }
  if (edge.axis === 'x') {
    const lineY = edge.name === 'top' ? y : y + height
    return spread(...share(x + FACET_INSET, x + width - FACET_INSET - reserve), count, widths).map((cx) => ({ x: cx, y: lineY }))
  }
  const lineX = edge.name === 'left' ? x : x + width
  return spread(...share(y + FACET_INSET, y + height - FACET_INSET - reserve), count).map((cy) => ({ x: lineX, y: cy }))
}

/**
 * Gives where a membrane part's drop slots are: one on each protein drawn there, where a drop goes before it,
 * and a spare one pitch past the last (the part's middle while it is empty), where a drop goes last.
 *
 * @param {Object} rect - The cell.
 * @param {string} part - One of the shape's facet ids.
 * @param {number} count - Proteins drawn on that part.
 * @param {Object} [shape=EPITHELIAL_SHAPE]
 * @param {{ spare?: boolean, widths?: number[] }} [options] - spare: false leaves out the spare slot; widths: as
 *   for slotPositions.
 * @returns {Array<{x: number, y: number, order: number, spare: boolean}>} In slot order.
 */
export function facetSlots(rect, part, count, shape = EPITHELIAL_SHAPE, { spare = true, widths = [] } = {}) {
  const slots = slotPositions(rect, part, count, shape, widths).map((slot, order) => ({ ...slot, order, spare: false }))
  if (!spare) return slots
  // A fold's spare is the next place down its walls, and a drawn stretch's the next along it.
  if (facetById(shape, part)?.fold || facetById(shape, part)?.path) {
    return [...slots, { ...slotPositions(rect, part, count + 1, shape)[count], order: count, spare: true }]
  }
  const last = slots.at(-1)
  const step =
    edgeOf(shape, part).axis === 'x' ? { x: pitchBetween(widths[count - 1]), y: 0 } : { x: 0, y: SLOT_PITCH }
  const next = last ? { x: last.x + step.x, y: last.y + step.y } : slotPositions(rect, part, 1, shape)[0]
  return [...slots, { ...next, order: count, spare: true }]
}

/**
 * Places a membrane protein in its slot.
 *
 * @param {Object} rect - The cell.
 * @param {string} part - One of the shape's facet ids.
 * @param {number} order - Its slot.
 * @param {number} count - Proteins on that part.
 * @param {Object} [shape=EPITHELIAL_SHAPE]
 * @param {number[]} [widths] - As for slotPositions.
 * @returns {{x: number, y: number, rotation: number, outward: string}} The centre of its cartoon, how far
 *   to turn it, and the side of it facing out of the cell.
 */
export function proteinPlacement(rect, part, order, count, shape = EPITHELIAL_SHAPE, widths = []) {
  const fold = facetById(shape, part)
  if (fold?.path) {
    const slot = pathSlotPositions(rect, fold, Math.max(count, order + 1), shape)[order]
    const { outward, rotation } = EDGES[slot.faces]
    return { x: slot.x, y: slot.y, rotation, outward }
  }
  if (fold?.fold) {
    const slot = foldSlotPositions(rect, fold, order + 1)[order]
    const { outward, rotation } = EDGES[slot.faces]
    return { x: slot.x, y: slot.y, rotation, outward }
  }
  const slot = slotPositions(rect, part, Math.max(count, order + 1), shape, widths)[order]
  const { outward, rotation } = edgeOf(shape, part)
  return { x: slot.x, y: slot.y, rotation, outward }
}

/**
 * Gives where a node-owned cell's part takes a drop. While a protein on that part is dragged, the slots are where
 * the row is drawn now, the dragged one's own included, and there is no spare.
 *
 * @param {{rect: Object, counts?: Object, held?: string, shape?: Object, widths?: Object}} cell - From dropTargets;
 *   widths: the names' widths per part, as the row is drawn.
 * @param {string} part - One of the shape's facet ids.
 * @returns {ReturnType<typeof facetSlots>}
 */
export function cellSlots(cell, part) {
  const count = cell.counts?.[part] ?? 0
  const shape = cell.shape ?? EPITHELIAL_SHAPE
  const widths = cell.widths?.[part] ?? []
  return cell.held === part
    ? facetSlots(cell.rect, part, count + 1, shape, { spare: false, widths })
    : facetSlots(cell.rect, part, count, shape, { widths })
}

/**
 * Finds the slot nearest a point, among every cell's cellSlots.
 *
 * @param {Array<{id: string, rect: Object, counts: Object, held?: string, shape?: Object}>} cells - From
 *   dropTargets: counts has proteins per part; shape defaults to EPITHELIAL_SHAPE.
 * @param {{x: number, y: number}} point
 * @param {number} [maxDistance=60]
 * @returns {{cellId: string, part: string, facet: string, at: string|undefined, order: number, spare: boolean,
 *   x: number, y: number}|null}
 */
export function nearestSlot(cells, point, maxDistance = 60) {
  let best = null
  let bestDistance = maxDistance
  for (const cell of cells) {
    const shape = cell.shape ?? EPITHELIAL_SHAPE
    for (const { id: part } of shape.facets) {
      cellSlots(cell, part).forEach(({ x, y, order, spare }) => {
        const distance = Math.hypot(x - point.x, y - point.y)
        if (distance <= bestDistance) {
          best = { cellId: cell.id, part, ...facetOfPart(part, shape), order, spare, x, y }
          bestDistance = distance
        }
      })
    }
  }
  return best
}

/**
 * Grows a cell so every part of its membrane has room for its proteins and the spare slot past them, whose
 * centre stays clear of the corner insets. Along a top or bottom edge, wide names take more room.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {Object<string, number>} counts - Proteins per part (the shape's facet ids).
 * @param {Object} [shape=EPITHELIAL_SHAPE]
 * @param {Object<string, number[]>} [widths] - The names' widths per part, in slot order.
 * @param {{width: number, height: number}} [least=MIN_CELL] - The smallest it may be, as an organelle's is smaller.
 * @returns {{x: number, y: number, width: number, height: number}} The same corner, at least as big.
 */
export function fitCellRect(rect, counts, shape = EPITHELIAL_SHAPE, widths = {}, least = MIN_CELL) {
  const along = (axis) => shape.facets.filter((facet) => EDGES[facet.edge]?.axis === axis)
  // The proteins' pitches, centred, and the spare's past the last, whose centre stays clear of the inset.
  const row = (facet, axis) => {
    const count = counts[facet.id] ?? 0
    const pitches = rowPitches(count + 1, axis === 'x' ? (widths[facet.id] ?? []) : null)
    const spare = pitches.pop() ?? 0
    const proteins = pitches.reduce((total, pitch) => total + pitch, 0)
    return proteins + spare + Math.max(SLOT_PITCH / 2 + GLYPH_WIDTH, spare)
  }
  // A span that takes only a stretch of its side needs the whole side long enough for its row to fit that stretch.
  const share = (facet) => (Number.isFinite(facet.from) && Number.isFinite(facet.to) ? Math.max(0.05, facet.to - facet.from) : 1)
  // An empty one with no fold in from its side has its spare in its middle, so it needs only its cartoon's room
  // clear of the rounded corners.
  const empty = GLYPH_WIDTH + 2 * CELL_RADIUS
  const need = (facet, axis) =>
    counts[facet.id] || facet.fold || foldReserve(shape, facet.edge)
      ? row(facet, axis) / share(facet) + foldReserve(shape, facet.edge) + 2 * FACET_INSET
      : empty / share(facet)
  const length = (axis) => Math.max(0, ...along(axis).map((facet) => need(facet, axis)))
  // A fold needs its side long enough to come in from, and the cell deep enough to hold it and its proteins.
  const folds = (axis) => shape.facets.filter((facet) => facet.fold && EDGES[facet.fold].axis === axis)
  const mouth = (axis) => (folds(axis).length ? 2 * CELL_RADIUS + 2 * FOLD.margin + FOLD.width : 0)
  const reach = (axis) =>
    Math.max(0, ...folds(axis).map((facet) => Math.max(facet.depth ?? FOLD.depth, foldDepthFor(counts[facet.id] ?? 0)) + CELL_RADIUS + 24))
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(rect.width, least.width, length('x'), mouth('x'), reach('y')),
    height: Math.max(rect.height, least.height, length('y'), mouth('y'), reach('x')),
  }
}

/**
 * Gives the SVG path of a rounded rectangle, drawn clockwise from the top-left corner's end.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {number} [radius=CELL_RADIUS]
 * @returns {string}
 */
export function roundedRectPath({ x, y, width, height }, radius = CELL_RADIUS) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  return [
    `M ${x + r} ${y}`,
    `H ${x + width - r}`,
    `A ${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `V ${y + height - r}`,
    `A ${r} ${r} 0 0 1 ${x + width - r} ${y + height}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + height - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ')
}

/** How far each leaflet of a cell's bilayer sits out from (or in from) its outline. */
export const HEAD_OFFSET = 7

/** How far either side of a cell's outline its membrane is selected or dropped on: the bilayer and a little more. */
export const MEMBRANE_BAND_HALF = HEAD_OFFSET + 5

/**
 * Gives how far a point is from a cell's rounded outline, as its bilayer is drawn: negative inside.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect - The cell.
 * @param {{x: number, y: number}} point
 * @param {number} [radius=CELL_RADIUS]
 * @returns {number}
 */
export function leafletDistance({ x, y, width, height }, point, radius = CELL_RADIUS) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  const qx = Math.abs(point.x - (x + width / 2)) - (width / 2 - r)
  const qy = Math.abs(point.y - (y + height / 2)) - (height / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/**
 * Gives a cell's outline, in the cell's own coordinates, grown by an offset (outward when positive), as
 * its bilayer's leaflets are drawn.
 *
 * @param {number} width - The cell's width.
 * @param {number} height - The cell's height.
 * @param {number} [offset=0]
 * @param {Array<{edge: string, at: number, half: number, depth: number}>} [folds] - The cell's folds, from
 *   foldPocket: the outline dips in round each.
 * @returns {string} An SVG path.
 */
export function leafletPath(width, height, offset = 0, folds = []) {
  const rect = { x: -offset, y: -offset, width: width + 2 * offset, height: height + 2 * offset }
  if (!folds.length) return roundedRectPath(rect, CELL_RADIUS + offset)
  // Round the outline as roundedRectPath goes, with each fold's pocket on the way along its side: down one wall,
  // round its end the other way from a corner, and back up the other. Grown outward, a pocket narrows.
  const r = Math.max(0, Math.min(CELL_RADIUS + offset, rect.width / 2, rect.height / 2))
  const pocket = (edge) => {
    const fold = folds.find((each) => each.edge === edge)
    if (!fold) return []
    const half = Math.max(1, fold.half - offset)
    const end = fold.depth - fold.half
    const arc = (x, y) => `A ${half} ${half} 0 0 0 ${x} ${y}`
    if (edge === 'top') return [`H ${fold.at - half}`, `V ${end}`, arc(fold.at + half, end), `V ${-offset}`]
    if (edge === 'right') return [`V ${fold.at - half}`, `H ${width - end}`, arc(width - end, fold.at + half), `H ${width + offset}`]
    if (edge === 'bottom') return [`H ${fold.at + half}`, `V ${height - end}`, arc(fold.at - half, height - end), `V ${height + offset}`]
    return [`V ${fold.at + half}`, `H ${end}`, arc(end, fold.at - half), `H ${-offset}`]
  }
  const { x, y } = rect
  const right = x + rect.width
  const bottom = y + rect.height
  return [
    `M ${x + r} ${y}`,
    ...pocket('top'),
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${y + r}`,
    ...pocket('right'),
    `V ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    ...pocket('bottom'),
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${bottom - r}`,
    ...pocket('left'),
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ')
}

/** How far apart a bilayer's lipids are, along its leaflets. */
export const LIPID_PITCH = 5

/** A lipid's head group's radius; its tails reach TAIL_HALF either side of the membrane's middle, between the heads. */
export const HEAD_RADIUS = 2.25
export const TAIL_HALF = 4.5
/** Half the width of a straight strip of bilayer: room for both rows of heads. */
export const STRIP_HALF = HEAD_OFFSET + HEAD_RADIUS + 1

/**
 * Gives the straight sides of a cell's outline, each as the transform that lays a strip along it: x runs along the
 * side, from 0 to `length`, and y across it. Each length is a whole number of lipids, stretched or squeezed a
 * little to fill its side exactly, so the lipids meet the corners' (see cornerLipids) without a gap or a crowd.
 *
 * A side a fold dips in from is in two pieces, either side of the fold's mouth, and the fold's two walls are strips
 * too.
 *
 * @param {number} width - The cell's width.
 * @param {number} height - The cell's height.
 * @param {Array<{edge: string, at: number, half: number, depth: number}>} [folds] - From foldPocket.
 * @returns {Array<{edge: string, length: number, transform: string}>}
 */
export function leafletSides(width, height, folds = []) {
  const r = Math.max(0, Math.min(CELL_RADIUS, width / 2, height / 2))
  const sides = [
    { edge: 'top', x: r, y: 0, angle: 0, span: width - 2 * r },
    { edge: 'right', x: width, y: r, angle: 90, span: height - 2 * r },
    { edge: 'bottom', x: width - r, y: height, angle: 180, span: width - 2 * r },
    { edge: 'left', x: 0, y: height - r, angle: 270, span: height - 2 * r },
  ]
  // Each strip in its side's own terms: from how far along the side it starts, how long, and whether it turns in.
  const strips = sides.flatMap((side) => {
    const fold = foldAlong(side, folds, width, height)
    if (!fold) return [{ ...side, from: 0 }]
    const wall = { ...side, span: fold.depth - fold.half, turned: true }
    return [
      { ...side, from: 0, span: fold.at - fold.half },
      { ...side, from: fold.at + fold.half, span: side.span - fold.at - fold.half },
      { ...wall, from: fold.at - fold.half },
      { ...wall, from: fold.at + fold.half },
    ]
  })
  return strips
    .filter((strip) => strip.span >= LIPID_PITCH / 2)
    .map(({ edge, x, y, angle, span, from, turned }) => {
      const length = Math.max(1, Math.round(span / LIPID_PITCH)) * LIPID_PITCH
      const within = `${from ? ` translate(${from} 0)` : ''}${turned ? ' rotate(90)' : ''}`
      const place = `translate(${x} ${y}) rotate(${angle})${within}`
      return { edge, length, transform: `${place} scale(${span / length} 1)` }
    })
}

/**
 * Gives the fold in from a side in the side's own terms: how far along the side, as the outline goes round it,
 * its middle is.
 *
 * @param {{edge: string, span: number}} side
 * @param {Array<Object>} folds - From foldPocket, which measures from a side's left or top end.
 * @param {number} width
 * @param {number} height
 * @returns {{at: number, half: number, depth: number}|null}
 */
function foldAlong(side, folds, width, height) {
  const fold = folds.find((each) => each.edge === side.edge)
  if (!fold) return null
  const r = Math.max(0, Math.min(CELL_RADIUS, width / 2, height / 2))
  // The outline runs the bottom and left sides back towards their start.
  const at = { top: fold.at - r, right: fold.at - r, bottom: width - r - fold.at, left: height - r - fold.at }[side.edge]
  return { at, half: fold.half, depth: fold.depth }
}

/**
 * Gives the rounded end of each fold's pocket, grown by an offset (outward when positive, which narrows it), each
 * with the transform that puts it in its cell and its length in lipids: what of a leaflet the strips down a fold's
 * walls (see leafletSides) leave.
 *
 * @param {number} width - The cell's width.
 * @param {number} height - The cell's height.
 * @param {Array<Object>} folds - From foldPocket.
 * @param {number} [offset=0]
 * @returns {Array<{edge: string, d: string, transform: string, lipids: number}>}
 */
export function leafletFoldEnds(width, height, folds, offset = 0) {
  const r = Math.max(0, Math.min(CELL_RADIUS, width / 2, height / 2))
  const sides = {
    top: `translate(${r} 0)`,
    right: `translate(${width} ${r}) rotate(90)`,
    bottom: `translate(${width - r} ${height}) rotate(180)`,
    left: `translate(0 ${height - r}) rotate(270)`,
  }
  return folds.map((each) => {
    const fold = foldAlong({ edge: each.edge }, folds, width, height)
    const half = Math.max(1, fold.half - offset)
    const end = fold.depth - fold.half
    return {
      edge: each.edge,
      d: `M ${fold.at - half} ${end} A ${half} ${half} 0 0 0 ${fold.at + half} ${end}`,
      transform: sides[each.edge],
      lipids: Math.max(1, Math.round((Math.PI * fold.half) / LIPID_PITCH)),
    }
  })
}

/**
 * Counts the lipids round each corner of a cell's outline: a whole number, as near the usual pitch along the
 * outline as fits. Drawn evenly, half a space in from each end, a corner's lipids line up across its leaflets and
 * carry on from those of the sides it joins.
 *
 * @param {number} width - The cell's width.
 * @param {number} height - The cell's height.
 * @returns {number} At least 1.
 */
export function cornerLipids(width, height) {
  const r = Math.max(0, Math.min(CELL_RADIUS, width / 2, height / 2))
  return Math.max(1, Math.round(((Math.PI / 2) * r) / LIPID_PITCH))
}

/**
 * Gives the four corner arcs of a cell's outline, grown by an offset (outward when positive), as one SVG path of
 * four pieces: what of a leaflet its straight sides (see leafletSides) leave.
 *
 * @param {number} width - The cell's width.
 * @param {number} height - The cell's height.
 * @param {number} [offset=0]
 * @returns {string} An SVG path; empty when the corners have no room.
 */
export function leafletCorners(width, height, offset = 0) {
  const r = Math.max(0, Math.min(CELL_RADIUS, width / 2, height / 2))
  const a = r + offset
  if (a <= 0) return ''
  const arc = (x1, y1, x2, y2) => `M ${x1} ${y1} A ${a} ${a} 0 0 1 ${x2} ${y2}`
  return [
    arc(r - a, r, r, r - a),
    arc(width - r, r - a, width - r + a, r),
    arc(width - r + a, height - r, width - r, height - r + a),
    arc(r, height - r + a, r - a, height - r),
  ].join(' ')
}
