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
  const edge = edgeOf(shape, part)
  if (edge.axis === 'x') {
    const lineY = edge.name === 'top' ? y : y + height
    return spread(x + FACET_INSET, x + width - FACET_INSET, count, widths).map((cx) => ({ x: cx, y: lineY }))
  }
  const lineX = edge.name === 'left' ? x : x + width
  return spread(y + FACET_INSET, y + height - FACET_INSET, count).map((cy) => ({ x: lineX, y: cy }))
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
 * @returns {{x: number, y: number, width: number, height: number}} The same corner, at least as big.
 */
export function fitCellRect(rect, counts, shape = EPITHELIAL_SHAPE, widths = {}) {
  const along = (axis) => shape.facets.filter((facet) => EDGES[facet.edge]?.axis === axis)
  // The proteins' pitches, centred, and the spare's past the last, whose centre stays clear of the inset.
  const row = (facet, axis) => {
    const count = counts[facet.id] ?? 0
    const pitches = rowPitches(count + 1, axis === 'x' ? (widths[facet.id] ?? []) : null)
    const spare = pitches.pop() ?? 0
    const proteins = pitches.reduce((total, pitch) => total + pitch, 0)
    return proteins + spare + Math.max(SLOT_PITCH / 2 + GLYPH_WIDTH, spare)
  }
  const length = (axis) => Math.max(0, ...along(axis).map((facet) => row(facet, axis))) + 2 * FACET_INSET
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(rect.width, MIN_CELL.width, length('x')),
    height: Math.max(rect.height, MIN_CELL.height, length('y')),
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
 * @returns {string} An SVG path.
 */
export function leafletPath(width, height, offset = 0) {
  const rect = { x: -offset, y: -offset, width: width + 2 * offset, height: height + 2 * offset }
  return roundedRectPath(rect, CELL_RADIUS + offset)
}

/** How far apart a bilayer's lipids are, along its leaflets. */
export const LIPID_PITCH = 5

/**
 * Gives the straight sides of a cell's outline, each as the transform that lays a strip along it: x runs along the
 * side, from 0 to `length`, and y across it. Each length is a whole number of lipids, centred on its side.
 *
 * @param {number} width - The cell's width.
 * @param {number} height - The cell's height.
 * @returns {Array<{edge: string, length: number, transform: string}>}
 */
export function leafletSides(width, height) {
  const r = Math.max(0, Math.min(CELL_RADIUS, width / 2, height / 2))
  const sides = [
    { edge: 'top', x: r, y: 0, angle: 0, span: width - 2 * r },
    { edge: 'right', x: width, y: r, angle: 90, span: height - 2 * r },
    { edge: 'bottom', x: width - r, y: height, angle: 180, span: width - 2 * r },
    { edge: 'left', x: 0, y: height - r, angle: 270, span: height - 2 * r },
  ]
  return sides
    .map(({ edge, x, y, angle, span }) => {
      const length = Math.floor(span / LIPID_PITCH) * LIPID_PITCH
      const transform = `translate(${x} ${y}) rotate(${angle}) translate(${(span - length) / 2} 0)`
      return { edge, length, transform }
    })
    .filter((side) => side.length > 0)
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
