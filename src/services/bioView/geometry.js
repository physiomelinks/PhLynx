/**
 * Geometry of the physiological view. A cell is a rounded rectangle whose outline is its membrane:
 * the top edge is the apical facet, the bottom edge the basolateral facet, and the left and right
 * edges share the lateral facet. Membrane proteins sit in slots along a facet, centred on the outline,
 * with one spare slot on every facet as somewhere to drop the next.
 */

import { Position } from '@vue-flow/core'

/** Size of a protein's cartoon, drawn with the outside up before it is turned to its facet. */
export const GLYPH_WIDTH = 64
export const GLYPH_HEIGHT = 48

/** Distance between neighbouring slots along a facet. */
export const SLOT_PITCH = 88

/** Space at each end of a facet, so slots stay clear of the rounded corners. */
export const FACET_INSET = 56

/** Corner radius of a cell's outline. */
export const CELL_RADIUS = 40

/** Smallest a cell is drawn. */
export const MIN_CELL = { width: 320, height: 240 }

/** Where each facet points and which way a protein on it is turned. */
const FACET_SIDES = {
  apical: { outward: Position.Top, rotation: 0 },
  basolateral: { outward: Position.Bottom, rotation: 180 },
  'lateral-left': { outward: Position.Left, rotation: -90 },
  'lateral-right': { outward: Position.Right, rotation: 90 },
}

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
 * Gives the centres of a facet's slots.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect - The cell.
 * @param {'apical'|'basolateral'|'lateral'} facet
 * @param {number} count - How many slots.
 * @returns {Array<{x: number, y: number, side: string}>} side is the facet part: apical, basolateral,
 *   lateral-left or lateral-right. Lateral slots alternate left and right, starting left.
 */
export function slotPositions(rect, facet, count) {
  const { x, y, width, height } = rect
  if (facet === 'apical' || facet === 'basolateral') {
    const lineY = facet === 'apical' ? y : y + height
    return spread(x + FACET_INSET, x + width - FACET_INSET, count).map((cx) => ({ x: cx, y: lineY, side: facet }))
  }
  const left = Math.ceil(count / 2)
  const ys = (n) => spread(y + FACET_INSET, y + height - FACET_INSET, n)
  const leftYs = ys(left)
  const rightYs = ys(count - left)
  return Array.from({ length: count }, (_, i) =>
    i % 2 === 0
      ? { x, y: leftYs[i / 2], side: 'lateral-left' }
      : { x: x + width, y: rightYs[(i - 1) / 2], side: 'lateral-right' }
  )
}

/**
 * Places a membrane protein in its slot.
 *
 * @param {Object} rect - The cell.
 * @param {'apical'|'basolateral'|'lateral'} facet
 * @param {number} order - Its slot.
 * @param {number} count - Proteins on that facet.
 * @returns {{x: number, y: number, rotation: number, outward: string}} The centre of its cartoon, how far
 *   to turn it, and the side of it facing out of the cell.
 */
export function proteinPlacement(rect, facet, order, count) {
  const slot = slotPositions(rect, facet, Math.max(count, order + 1))[order]
  const { outward, rotation } = FACET_SIDES[slot.side]
  return { x: slot.x, y: slot.y, rotation, outward }
}

/**
 * Finds the slot nearest a point, among every cell's slots and its spare ones.
 *
 * @param {Array<{id: string, rect: Object, counts: Object}>} cells - counts has proteins per facet.
 * @param {{x: number, y: number}} point
 * @param {number} [maxDistance=60]
 * @returns {{cellId: string, facet: string, order: number, x: number, y: number}|null}
 */
export function nearestSlot(cells, point, maxDistance = 60) {
  let best = null
  let bestDistance = maxDistance
  for (const cell of cells) {
    for (const facet of ['apical', 'basolateral', 'lateral']) {
      slotPositions(cell.rect, facet, (cell.counts?.[facet] ?? 0) + 1).forEach((slot, order) => {
        const distance = Math.hypot(slot.x - point.x, slot.y - point.y)
        if (distance <= bestDistance) {
          best = { cellId: cell.id, facet, order, x: slot.x, y: slot.y }
          bestDistance = distance
        }
      })
    }
  }
  return best
}

/**
 * Grows a cell so every facet has room for its proteins and a spare slot.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {{apical?: number, basolateral?: number, lateral?: number}} counts
 * @returns {{x: number, y: number, width: number, height: number}} The same corner, at least as big.
 */
export function fitCellRect(rect, counts) {
  const across = Math.max(counts.apical ?? 0, counts.basolateral ?? 0) + 1
  const down = Math.ceil(((counts.lateral ?? 0) + 1) / 2)
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
