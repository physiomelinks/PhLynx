/**
 * Sizes the physiological view's pieces and modules are drawn at, and the layout of the modules on no piece: a
 * membrane protein in a tray to the left of the pieces, and everything else as a card to the right. Where the user put
 * one (data.bioView.position) is kept; only the rest is worked out, the same way every time.
 */

import { CELL_RADIUS, SYMBOL_HEIGHT, SYMBOL_WIDTH, MIN_CELL } from './geometry.js'
import { FACET_BAND } from './metrics.js'
import { byName } from './slotOrder.js'

/** Size of a card for an instance with no physiological shape. */
export const CARD = { width: 180, height: 72 }

/** Size of a process drawn as its symbol, named under it, as one in a process zone of the pieces is. */
export const PROCESS_SYMBOL = Object.freeze({ width: SYMBOL_WIDTH, height: SYMBOL_HEIGHT })

/** How big a process's place is drawn: as its symbol where it says so (`symbol`), otherwise as a card. */
export const processSize = (place) => (place?.symbol ? PROCESS_SYMBOL : CARD)

/** Height of a region's band. */
export const REGION_HEIGHT = 140

/** How far out from a cell, on each side it is against, the compartment round it reaches. */
export const SURROUND_DEPTH = 110

/** Width of a region down a cell's side. */
export const SIDE_REGION_WIDTH = 120

/** Space between things laid out side by side. */
export const GAP = 80

const isRect = (rect) => rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]))
const isPoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)

/**
 * Gives the box around some rects.
 *
 * @param {Array<Object>} rects
 * @returns {{left: number, right: number, top: number}}
 */
function spanOf(rects) {
  return {
    left: Math.min(...rects.map((r) => r.x)),
    right: Math.max(...rects.map((r) => r.x + r.width)),
    top: Math.min(...rects.map((r) => r.y)),
  }
}

/**
 * Gives where the next card goes in one of a cell's process areas: a row inside the cell, below its
 * top facet's proteins, one row per area.
 *
 * @param {Object} rect - The cell.
 * @param {number} area - The area's index in the cell.
 * @param {number} order - The card's place in that area's row.
 * @returns {{x: number, y: number}} The card's top-left.
 */
function processSlot(rect, area, order) {
  return {
    x: rect.x + CELL_RADIUS + order * (CARD.width + 16),
    y: rect.y + SYMBOL_HEIGHT + 24 + area * (CARD.height + 16),
  }
}

/**
 * Gives the area of one of a cell's process areas: the row its cards sit in, with room around them.
 *
 * @param {Object} rect - The cell.
 * @param {number} area - The area's index in the cell.
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function processZone(rect, area) {
  const { y } = processSlot(rect, area, 0)
  return { x: rect.x + CELL_RADIUS / 2, y: y - 8, width: rect.width - CELL_RADIUS, height: CARD.height + 16 }
}

/** How big a tube's room is drawn unless it says. */
export const TUBE = Object.freeze({ width: 360, height: 120 })

/**
 * Gives where an empty cell's name and hint go: the middle of its inside below its process areas and
 * above the reach of its bottom facet, so a drop on the hint goes to the cell itself.
 *
 * @param {Object} rect - The cell.
 * @param {Array<{rect: Object}>} zones - Its process areas, and what else lies in it from its top.
 * @param {Array<{rect: Object}>} [below] - What lies in it up from its bottom.
 * @returns {{x: number, y: number}} In the cell's own coordinates.
 */
export function cellHint(rect, zones, below = []) {
  const top = Math.max(FACET_BAND, ...zones.map((zone) => zone.rect.y + zone.rect.height - rect.y))
  // What lies under its bottom side, as a microdomain there does, brings up how far down it may go.
  const floor = Math.min(rect.height - FACET_BAND, ...below.map((zone) => zone.rect.y - rect.y))
  return { x: rect.width / 2, y: (top + Math.max(top, floor)) / 2 }
}

/**
 * Lays out the physiological view's modules that aren't on the pieces' sites: a membrane protein, as its annotations
 * say it is, in a tray left of the pieces, and anything else as a card right of them.
 *
 * @param {Array<{id: string, data?: Object}>} allNodes - The flow's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @param {Object} [options]
 * @param {Set<string>} [options.placedElsewhere] - Nodes laid out elsewhere, as those on the pieces' sites are,
 *   which get no place here.
 * @param {Array<Object>} [options.around] - What else is drawn (the pieces' rects), for the tray and the cards to go
 *   beside.
 * @returns {{places: Map<string, Object>}} places: node id -> { kind: 'tray', x, y } (a protein; x, y: its
 *   top-left) or { kind: 'card', x, y }.
 */
export function layoutPhysiology(allNodes, roles, { placedElsewhere = new Set(), around = [] } = {}) {
  // Nodes bound to a site of the pieces are laid out with them (see layoutPieces), so left out here.
  const nodes = placedElsewhere.size ? allNodes.filter((node) => !placedElsewhere.has(node.id)) : allNodes
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = nodes.map((node) => node.id).sort(byName(byId))
  const isProtein = (id) => roles.get(id)?.role === 'membraneProtein'
  const placed = around.filter(isRect)
  // With no pieces, beside where a cell would be.
  const anchor = placed.length ? spanOf(placed) : { left: 0, right: MIN_CELL.width, top: 0 }
  const layout = new Map()
  const storedOf = (id) => {
    const stored = byId.get(id).data?.bioView?.position
    return isPoint(stored) ? { x: stored.x, y: stored.y } : null
  }

  ids.filter(isProtein).forEach((id, i) => {
    const at = storedOf(id) ?? { x: anchor.left - GAP - SYMBOL_WIDTH - GAP, y: anchor.top + i * (SYMBOL_HEIGHT + 32) }
    layout.set(id, { kind: 'tray', ...at })
  })
  ids
    .filter((id) => !isProtein(id))
    .forEach((id, i) => {
      const at = storedOf(id) ?? { x: anchor.right + GAP * 2, y: anchor.top + i * (CARD.height + 24) }
      layout.set(id, { kind: 'card', ...at })
    })
  return { places: layout }
}
