/**
 * Geometry of the physiological view. A cell is a rounded rectangle whose outline is its membrane:
 * the top edge is the apical facet, the bottom edge the basolateral facet, and the left and right
 * edges are the lateral facet's two sides. Membrane proteins sit in slots along a facet, centred on the outline,
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
 * The parts of a cell's membrane that hold their own row of slots: the lateral facet has one down
 * each side.
 */
export const FACET_PARTS = ['apical', 'basolateral', 'lateral-left', 'lateral-right']

/**
 * Gives the part of the membrane a facet and side name.
 *
 * @param {'apical'|'basolateral'|'lateral'} facet
 * @param {'left'|'right'} [at] - Which side, for lateral.
 * @returns {string} One of FACET_PARTS.
 */
export function partOf(facet, at) {
  return facet === 'lateral' ? `lateral-${at === 'right' ? 'right' : 'left'}` : facet
}

/**
 * Gives the facet and side a part of the membrane is.
 *
 * @param {string} part - One of FACET_PARTS.
 * @returns {{facet: string, at: 'left'|'right'|undefined}}
 */
export function facetOfPart(part) {
  return part.startsWith('lateral-') ? { facet: 'lateral', at: part.slice('lateral-'.length) } : { facet: part, at: undefined }
}

/**
 * Gives the centres of a membrane part's slots.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect - The cell.
 * @param {string} part - One of FACET_PARTS.
 * @param {number} count - How many slots.
 * @returns {Array<{x: number, y: number}>}
 */
export function slotPositions(rect, part, count) {
  const { x, y, width, height } = rect
  if (part === 'apical' || part === 'basolateral') {
    const lineY = part === 'apical' ? y : y + height
    return spread(x + FACET_INSET, x + width - FACET_INSET, count).map((cx) => ({ x: cx, y: lineY }))
  }
  const lineX = part === 'lateral-left' ? x : x + width
  return spread(y + FACET_INSET, y + height - FACET_INSET, count).map((cy) => ({ x: lineX, y: cy }))
}

/**
 * Places a membrane protein in its slot.
 *
 * @param {Object} rect - The cell.
 * @param {string} part - One of FACET_PARTS.
 * @param {number} order - Its slot.
 * @param {number} count - Proteins on that part.
 * @returns {{x: number, y: number, rotation: number, outward: string}} The centre of its cartoon, how far
 *   to turn it, and the side of it facing out of the cell.
 */
export function proteinPlacement(rect, part, order, count) {
  const slot = slotPositions(rect, part, Math.max(count, order + 1))[order]
  const { outward, rotation } = FACET_SIDES[part]
  return { x: slot.x, y: slot.y, rotation, outward }
}

/**
 * Finds the slot nearest a point, among every cell's slots and its spare ones.
 *
 * @param {Array<{id: string, rect: Object, counts: Object}>} cells - counts has proteins per part.
 * @param {{x: number, y: number}} point
 * @param {number} [maxDistance=60]
 * @returns {{cellId: string, part: string, facet: string, at: string|undefined, order: number, x: number,
 *   y: number}|null}
 */
export function nearestSlot(cells, point, maxDistance = 60) {
  let best = null
  let bestDistance = maxDistance
  for (const cell of cells) {
    for (const part of FACET_PARTS) {
      slotPositions(cell.rect, part, (cell.counts?.[part] ?? 0) + 1).forEach((slot, order) => {
        const distance = Math.hypot(slot.x - point.x, slot.y - point.y)
        if (distance <= bestDistance) {
          best = { cellId: cell.id, part, ...facetOfPart(part), order, x: slot.x, y: slot.y }
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
 * @param {Object<string, number>} counts - Proteins per part (FACET_PARTS).
 * @returns {{x: number, y: number, width: number, height: number}} The same corner, at least as big.
 */
export function fitCellRect(rect, counts) {
  const across = Math.max(counts.apical ?? 0, counts.basolateral ?? 0) + 1
  const down = Math.max(counts['lateral-left'] ?? 0, counts['lateral-right'] ?? 0) + 1
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
