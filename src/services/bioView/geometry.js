/**
 * Geometry of the physiological view. A cell is a rounded rectangle whose outline is its membrane, and its
 * shape (shape.js) puts each facet of the membrane along one edge. The default shape is the epithelial cell:
 * the top edge is the apical facet, the bottom edge the basolateral facet, and the left and right edges are
 * the lateral facet's two sides. Membrane proteins sit in slots along a facet, centred on the outline, with
 * one spare slot on every facet as somewhere to drop the next.
 */

import { Position } from '@vue-flow/core'

import { CELL_RADIUS, FACET_INSET, GLYPH_WIDTH, MIN_CELL, SLOT_PITCH } from './metrics.js'
import { EPITHELIAL_SHAPE, annotationOfFacet, facetById, facetOfAnnotation } from './shape.js'

export { CELL_RADIUS, FACET_INSET, GLYPH_HEIGHT, GLYPH_WIDTH, MIN_CELL, SLOT_PITCH } from './metrics.js'

/**
 * Where each edge of a cell points, which way a protein on it is turned, and the axis its slots run along.
 */
export const EDGES = Object.freeze({
  top: Object.freeze({ outward: Position.Top, rotation: 0, axis: 'x' }),
  bottom: Object.freeze({ outward: Position.Bottom, rotation: 180, axis: 'x' }),
  left: Object.freeze({ outward: Position.Left, rotation: -90, axis: 'y' }),
  right: Object.freeze({ outward: Position.Right, rotation: 90, axis: 'y' }),
})

/**
 * Spreads slot centres along a line, centred on its middle.
 *
 * @param {number} start
 * @param {number} end
 * @param {number} count
 * @returns {number[]}
 */
function spread(start, end, count) {
  const middle = (start + end) / 2
  return Array.from({ length: count }, (_, i) => middle + (i - (count - 1) / 2) * SLOT_PITCH)
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
 * @returns {Array<{x: number, y: number}>}
 */
export function slotPositions(rect, part, count, shape = EPITHELIAL_SHAPE) {
  const { x, y, width, height } = rect
  const edge = edgeOf(shape, part)
  if (edge.axis === 'x') {
    const lineY = edge.name === 'top' ? y : y + height
    return spread(x + FACET_INSET, x + width - FACET_INSET, count).map((cx) => ({ x: cx, y: lineY }))
  }
  const lineX = edge.name === 'left' ? x : x + width
  return spread(y + FACET_INSET, y + height - FACET_INSET, count).map((cy) => ({ x: lineX, y: cy }))
}

/**
 * Places a membrane protein in its slot.
 *
 * @param {Object} rect - The cell.
 * @param {string} part - One of the shape's facet ids.
 * @param {number} order - Its slot.
 * @param {number} count - Proteins on that part.
 * @param {Object} [shape=EPITHELIAL_SHAPE]
 * @returns {{x: number, y: number, rotation: number, outward: string}} The centre of its cartoon, how far
 *   to turn it, and the side of it facing out of the cell.
 */
export function proteinPlacement(rect, part, order, count, shape = EPITHELIAL_SHAPE) {
  const slot = slotPositions(rect, part, Math.max(count, order + 1), shape)[order]
  const { outward, rotation } = edgeOf(shape, part)
  return { x: slot.x, y: slot.y, rotation, outward }
}

/**
 * Finds the slot nearest a point, among every cell's slots and its spare ones.
 *
 * @param {Array<{id: string, rect: Object, counts: Object, shape?: Object}>} cells - counts has proteins per
 *   part; shape defaults to EPITHELIAL_SHAPE.
 * @param {{x: number, y: number}} point
 * @param {number} [maxDistance=60]
 * @returns {{cellId: string, part: string, facet: string, at: string|undefined, order: number, x: number,
 *   y: number}|null}
 */
export function nearestSlot(cells, point, maxDistance = 60) {
  let best = null
  let bestDistance = maxDistance
  for (const cell of cells) {
    const shape = cell.shape ?? EPITHELIAL_SHAPE
    for (const { id: part } of shape.facets) {
      slotPositions(cell.rect, part, (cell.counts?.[part] ?? 0) + 1, shape).forEach((slot, order) => {
        const distance = Math.hypot(slot.x - point.x, slot.y - point.y)
        if (distance <= bestDistance) {
          best = { cellId: cell.id, part, ...facetOfPart(part, shape), order, x: slot.x, y: slot.y }
          bestDistance = distance
        }
      })
    }
  }
  return best
}

/**
 * Grows a cell so every part of its membrane has room for its proteins and a spare slot.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {Object<string, number>} counts - Proteins per part (the shape's facet ids).
 * @param {Object} [shape=EPITHELIAL_SHAPE]
 * @returns {{x: number, y: number, width: number, height: number}} The same corner, at least as big.
 */
export function fitCellRect(rect, counts, shape = EPITHELIAL_SHAPE) {
  const along = (axis) => shape.facets.filter((facet) => EDGES[facet.edge]?.axis === axis)
  const most = (axis) => Math.max(0, ...along(axis).map((facet) => counts[facet.id] ?? 0)) + 1
  const across = most('x')
  const down = most('y')
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(rect.width, MIN_CELL.width, (across - 1) * SLOT_PITCH + GLYPH_WIDTH + 2 * FACET_INSET),
    height: Math.max(rect.height, MIN_CELL.height, (down - 1) * SLOT_PITCH + GLYPH_WIDTH + 2 * FACET_INSET),
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
