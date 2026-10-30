/**
 * Lays out the physiological view: cells in a row, each with its membrane proteins in slots along
 * their facets and its cytosolic processes inside; the region an apical facet faces in a band against
 * the cells' tops, and the one a basolateral facet faces in a band against their bottoms; proteins not yet in a membrane in a tray to
 * the left; and everything else as cards to the right. What the user placed (data.bioView) is kept;
 * only the rest is worked out, the same way every time.
 */

import { CELL_RADIUS, GLYPH_HEIGHT, GLYPH_WIDTH, MIN_CELL, fitCellRect, proteinPlacement } from './geometry.js'

/** Size of a card for an instance with no physiological shape. */
export const CARD = { width: 180, height: 72 }

/** Height of a region's band. */
export const REGION_HEIGHT = 140

/** Space between things laid out side by side. */
export const GAP = 80

const FACETS = ['apical', 'basolateral', 'lateral']

const byName = (nodes) => (a, b) => (nodes.get(a)?.data?.name ?? a).localeCompare(nodes.get(b)?.data?.name ?? b) || a.localeCompare(b)

/**
 * Orders the proteins on one facet: those the user ordered first, by their order, then the rest by name.
 *
 * @param {string[]} ids
 * @param {Map<string, Object>} nodes
 * @returns {string[]}
 */
function orderOnFacet(ids, nodes) {
  const ordered = (id) => Number.isInteger(nodes.get(id)?.data?.bioView?.order)
  const placed = ids.filter(ordered).sort((a, b) => nodes.get(a).data.bioView.order - nodes.get(b).data.bioView.order || byName(nodes)(a, b))
  return [...placed, ...ids.filter((id) => !ordered(id)).sort(byName(nodes))]
}

const isRect = (rect) => rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]))
const isPoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)

/**
 * Lays out the physiological view.
 *
 * @param {Array<{id: string, data?: Object}>} nodes - The flow's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @returns {Map<string, Object>} Node id -> one of:
 *   - { kind: 'cell', rect, membrane: nodeId|null }
 *   - { kind: 'membrane', cell } (drawn as the cell's outline)
 *   - { kind: 'protein', cell, facet, order, x, y, rotation, outward } (x, y: the cartoon's centre)
 *   - { kind: 'tray', x, y } (a protein in no membrane; x, y: its top-left)
 *   - { kind: 'cytosolic', cell, x, y }
 *   - { kind: 'region', side, rect }
 *   - { kind: 'card', x, y }
 */
export function layoutBioView(nodes, roles) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = nodes.map((node) => node.id).sort(byName(byId))
  const roleOf = (id) => roles.get(id) ?? { role: 'none' }
  const layout = new Map()

  // Cells, left to right; each grows to fit its proteins.
  const cellIds = ids.filter((id) => roleOf(id).role === 'cytosol')
  const onCell = (id) => {
    const { cell } = roleOf(id)
    if (cellIds.includes(cell)) return cell
    return cellIds.length === 1 ? cellIds[0] : null
  }
  const proteins = ids.filter((id) => roleOf(id).role === 'membraneProtein')
  const inMembrane = proteins.filter((id) => onCell(id) && roleOf(id).facet)

  let nextX = 0
  for (const cellId of cellIds) {
    const counts = Object.fromEntries(FACETS.map((facet) => [facet, inMembrane.filter((id) => onCell(id) === cellId && roleOf(id).facet === facet).length]))
    const stored = byId.get(cellId).data?.bioView?.rect
    const rect = isRect(stored) ? stored : fitCellRect({ x: nextX, y: 0, ...MIN_CELL }, counts)
    nextX = Math.max(nextX, rect.x + rect.width + GAP)
    const membrane = ids.find((id) => roleOf(id).role === 'membrane' && onCell(id) === cellId) ?? null
    layout.set(cellId, { kind: 'cell', rect, membrane })

    for (const facet of FACETS) {
      const onFacet = orderOnFacet(inMembrane.filter((id) => onCell(id) === cellId && roleOf(id).facet === facet), byId)
      onFacet.forEach((id, order) => layout.set(id, { kind: 'protein', cell: cellId, facet, order, ...proteinPlacement(rect, facet, order, onFacet.length) }))
    }

    // Cytosolic processes in a row inside the cell, below its apical proteins.
    ids
      .filter((id) => roleOf(id).role === 'cytosolic' && onCell(id) === cellId)
      .forEach((id, i) => {
        const stored = byId.get(id).data?.bioView?.position
        layout.set(id, { kind: 'cytosolic', cell: cellId, ...(isPoint(stored) ? stored : { x: rect.x + CELL_RADIUS + i * (CARD.width + 16), y: rect.y + GLYPH_HEIGHT + 24 }) })
      })
  }
  for (const id of ids) if (roleOf(id).role === 'membrane' && onCell(id)) layout.set(id, { kind: 'membrane', cell: onCell(id) })

  const cellRects = cellIds.map((id) => layout.get(id).rect)
  const left = cellRects.length ? Math.min(...cellRects.map((r) => r.x)) : 0
  const right = cellRects.length ? Math.max(...cellRects.map((r) => r.x + r.width)) : MIN_CELL.width
  const top = cellRects.length ? Math.min(...cellRects.map((r) => r.y)) : 0
  const bottom = cellRects.length ? Math.max(...cellRects.map((r) => r.y + r.height)) : MIN_CELL.height

  // Regions: the apical side's and the basolateral side's run right up to the membrane, so a protein
  // in it sits in both the region and the cell; each reaches a corner's depth under the cells, which
  // are drawn over them, to fill the space beside the rounded corners. Others go further down.
  const bands = {
    apical: { y: top - REGION_HEIGHT, height: REGION_HEIGHT + CELL_RADIUS },
    basolateral: { y: bottom - CELL_RADIUS, height: REGION_HEIGHT + CELL_RADIUS },
  }
  let otherY = bottom + REGION_HEIGHT + GAP
  for (const id of ids.filter((id) => roleOf(id).role === 'region')) {
    const { side } = roleOf(id)
    const stored = byId.get(id).data?.bioView?.rect
    let rect = isRect(stored) ? stored : null
    if (!rect) {
      const band = bands[side] ?? { y: otherY, height: REGION_HEIGHT }
      if (!(side in bands)) otherY += REGION_HEIGHT + GAP / 2
      rect = { x: left - GAP, y: band.y, width: right - left + 2 * GAP, height: band.height }
    }
    layout.set(id, { kind: 'region', side: side ?? null, rect })
  }

  // Proteins in no membrane, in a tray left of the cells.
  ids
    .filter((id) => roleOf(id).role === 'membraneProtein' && !layout.has(id))
    .forEach((id, i) => {
      const stored = byId.get(id).data?.bioView?.position
      layout.set(id, { kind: 'tray', ...(isPoint(stored) ? stored : { x: left - GAP - GLYPH_WIDTH - GAP, y: top + i * (GLYPH_HEIGHT + 32) }) })
    })

  // Everything else as cards, in a column right of the cells.
  ids
    .filter((id) => !layout.has(id))
    .forEach((id, i) => {
      const stored = byId.get(id).data?.bioView?.position
      layout.set(id, { kind: 'card', ...(isPoint(stored) ? stored : { x: right + GAP * 2, y: top + i * (CARD.height + 24) }) })
    })

  return layout
}
