/**
 * Lays out the physiological view: cells in a row, each with its membrane proteins in slots along
 * their facets and its cytosolic processes inside. A region lies against what it is adjacent to: a
 * band along the cells' tops or bottoms, or down one cell's side (a paracellular space); one only
 * known from the annotations to face the apical or basolateral side spans the cells they describe. Proteins not
 * yet in a membrane go in a tray to the left, and everything else as cards to the right. What the user
 * placed (data.bioView) is kept; only the rest is worked out, the same way every time.
 */

import { CELL_RADIUS, FACET_PARTS, GLYPH_HEIGHT, GLYPH_WIDTH, MIN_CELL, fitCellRect, partOf, proteinPlacement } from './geometry.js'

/** Size of a card for an instance with no physiological shape. */
export const CARD = { width: 180, height: 72 }

/** Height of a region's band. */
export const REGION_HEIGHT = 140

/** Width of a region down a cell's side. */
export const SIDE_REGION_WIDTH = 120

/** Space between things laid out side by side. */
export const GAP = 80

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

/**
 * Sorts one cell's membrane proteins into the parts of its membrane, in slot order. A lateral protein
 * with no side goes to whichever side has fewer.
 *
 * @param {string[]} ids - The cell's proteins in a membrane.
 * @param {Function} roleOf
 * @param {Map<string, Object>} nodes
 * @returns {Object<string, string[]>} Part -> ids.
 */
function partsOf(ids, roleOf, nodes) {
  const parts = Object.fromEntries(FACET_PARTS.map((part) => [part, []]))
  const sideless = []
  for (const id of ids) {
    const { facet, at } = roleOf(id)
    if (facet === 'lateral' && !at) sideless.push(id)
    else parts[partOf(facet, at)].push(id)
  }
  for (const id of orderOnFacet(sideless, nodes)) {
    parts[parts['lateral-right'].length < parts['lateral-left'].length ? 'lateral-right' : 'lateral-left'].push(id)
  }
  for (const part of FACET_PARTS) parts[part] = orderOnFacet(parts[part], nodes)
  return parts
}

/**
 * Gives where a region goes: against the cells it is adjacent to, or, known only to face a side,
 * along that side of every cell. The first region against a place reaches a corner's depth under the
 * cells, which are drawn over it, to fill beside their rounded corners; later ones stack outward.
 *
 * @param {Array<Object>|null} adjacent - Entries for cells that are laid out.
 * @param {string|null} facet - What it lies against: its adjacency's, else its annotated side.
 * @param {number} index - How many regions are already against the same place.
 * @param {Map<string, Object>} layout - With the cells laid out.
 * @param {{left: number, right: number, top: number, bottom: number}} all - Around the cells a region
 *   known only from its annotations spans.
 * @returns {Object|null} Its rect, or null when it is against nothing.
 */
function regionRect(adjacent, facet, index, layout, all) {
  const rects = adjacent ? adjacent.filter((entry) => entry.facet === facet).map((entry) => layout.get(entry.cell).rect) : null
  const span = rects
    ? {
        left: Math.min(...rects.map((r) => r.x)),
        right: Math.max(...rects.map((r) => r.x + r.width)),
        top: Math.min(...rects.map((r) => r.y)),
        bottom: Math.max(...rects.map((r) => r.y + r.height)),
      }
    : all
  const reach = index ? 0 : CELL_RADIUS
  const across = { x: span.left - GAP, width: span.right - span.left + 2 * GAP }
  if (facet === 'apical') return { ...across, y: span.top - (index + 1) * REGION_HEIGHT, height: REGION_HEIGHT + reach }
  if (facet === 'basolateral') return { ...across, y: span.bottom + index * REGION_HEIGHT - reach, height: REGION_HEIGHT + reach }
  if (facet === 'lateral' && adjacent) {
    // Down one cell's side, from its top to its bottom.
    const cell = rects[0]
    const x =
      adjacent[0].at === 'right' ? cell.x + cell.width + index * SIDE_REGION_WIDTH - reach : cell.x - (index + 1) * SIDE_REGION_WIDTH
    return { x, y: cell.y, width: SIDE_REGION_WIDTH + reach, height: cell.height }
  }
  return null
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
 *   - { kind: 'protein', cell, facet, part, order, x, y, rotation, outward } (part: see FACET_PARTS;
 *     order: its slot in that part; x, y: the cartoon's centre)
 *   - { kind: 'tray', x, y } (a protein in no membrane; x, y: its top-left)
 *   - { kind: 'cytosolic', cell, x, y }
 *   - { kind: 'region', side, adjacent, rect } (side: the facet it lies against)
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

  // What each region lies against, among the cells there are; adjacency to anything else is ignored.
  const regionIds = ids.filter((id) => roleOf(id).role === 'region')
  const adjacencyOf = new Map(
    regionIds.map((id) => {
      const live = (roleOf(id).adjacent ?? []).filter((entry) => cellIds.includes(entry.cell))
      return [id, live.length ? live : null]
    })
  )
  // Regions down a cell's side push its neighbours along, one region's width for each.
  const sideRegions = (cellId, at) =>
    regionIds.filter((id) => {
      const first = adjacencyOf.get(id)?.[0]
      return first?.facet === 'lateral' && first.cell === cellId && first.at === at
    }).length

  let nextX = 0
  for (const cellId of cellIds) {
    const parts = partsOf(inMembrane.filter((id) => onCell(id) === cellId), roleOf, byId)
    const counts = Object.fromEntries(FACET_PARTS.map((part) => [part, parts[part].length]))
    const stored = byId.get(cellId).data?.bioView?.rect
    const x = nextX + sideRegions(cellId, 'left') * SIDE_REGION_WIDTH
    const rect = isRect(stored) ? stored : fitCellRect({ x, y: 0, ...MIN_CELL }, counts)
    nextX = Math.max(nextX, rect.x + rect.width + GAP + sideRegions(cellId, 'right') * SIDE_REGION_WIDTH)
    const membrane = ids.find((id) => roleOf(id).role === 'membrane' && onCell(id) === cellId) ?? null
    layout.set(cellId, { kind: 'cell', rect, membrane })

    for (const part of FACET_PARTS) {
      parts[part].forEach((id, order) =>
        layout.set(id, { kind: 'protein', cell: cellId, facet: roleOf(id).facet, part, order, ...proteinPlacement(rect, part, order, parts[part].length) })
      )
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
  // A region only known from its annotations to face a side spans the cells the annotations describe,
  // not ones the user added (bioView.added); with none of those, every cell.
  const described = cellIds.filter((id) => !byId.get(id).data?.bioView?.added).map((id) => layout.get(id).rect)
  const annotated = described.length
    ? {
        left: Math.min(...described.map((r) => r.x)),
        right: Math.max(...described.map((r) => r.x + r.width)),
        top: Math.min(...described.map((r) => r.y)),
        bottom: Math.max(...described.map((r) => r.y + r.height)),
      }
    : { left, right, top, bottom }

  // Regions run right up to the membrane, so a protein in it sits in both the region and the cell; each
  // reaches a corner's depth under the cells, which are drawn over them, to fill beside the rounded
  // corners. Ones with nowhere to go are stacked further down.
  // Regions against the same place stack outward from it, so none hides another.
  const stacked = new Map()
  let otherY = bottom + 2 * REGION_HEIGHT + GAP
  for (const id of regionIds) {
    const adjacent = adjacencyOf.get(id)
    const against = adjacent ? adjacent[0].facet : roleOf(id).side
    const key = against === 'lateral' ? `${adjacent[0].cell}/${adjacent[0].at}` : against
    const index = stacked.get(key) ?? 0
    stacked.set(key, index + 1)
    const stored = byId.get(id).data?.bioView?.rect
    let rect = isRect(stored) ? stored : regionRect(adjacent, against, index, layout, annotated)
    if (!rect) {
      rect = { x: left - GAP, y: otherY, width: right - left + 2 * GAP, height: REGION_HEIGHT }
      otherY += REGION_HEIGHT + GAP / 2
    }
    layout.set(id, { kind: 'region', side: against ?? null, adjacent, rect })
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
