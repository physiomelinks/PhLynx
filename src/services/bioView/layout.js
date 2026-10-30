/**
 * Lays out the physiological view: cells in a row, each with its membrane proteins in slots along
 * their facets and its cytosolic processes inside. A region lies against what it is adjacent to: a
 * band along the cells' tops or bottoms, or down one cell's side (a paracellular space); one only
 * known from the annotations to face the apical or basolateral side spans the cells they describe. Proteins not
 * yet in a membrane go in a tray to the left, and everything else as cards to the right. What the user
 * placed (data.bioView) is kept; only the rest is worked out, the same way every time.
 */

import { CELL_RADIUS, GLYPH_HEIGHT, GLYPH_WIDTH, MIN_CELL, fitCellRect, partOf, proteinPlacement } from './geometry.js'
import { byName, cellFinder, scaffoldFromNodes } from './scaffold.js'
import { EPITHELIAL_SHAPE, facetById, facetOfAnnotation, facetsInGroup } from './shape.js'

/** Size of a card for an instance with no physiological shape. */
export const CARD = { width: 180, height: 72 }

/** Height of a region's band. */
export const REGION_HEIGHT = 140

/** Width of a region down a cell's side. */
export const SIDE_REGION_WIDTH = 120

/** Space between things laid out side by side. */
export const GAP = 80

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
 * Sorts one cell's membrane proteins into its facets, in slot order. A protein whose annotation names a
 * facet group but no side goes to whichever facet of the group has fewer, the first on a tie.
 *
 * @param {string[]} ids - The cell's proteins in a membrane.
 * @param {Function} roleOf
 * @param {Map<string, Object>} nodes
 * @param {Object} shape - The cell's shape.
 * @returns {Object<string, string[]>} Facet id -> ids.
 */
function partsOf(ids, roleOf, nodes, shape) {
  const parts = Object.fromEntries(shape.facets.map((facet) => [facet.id, []]))
  const sideless = new Map()
  for (const id of ids) {
    const { facet, at } = roleOf(id)
    const part = partOf(facet, at, shape)
    const group = !at && facetById(shape, part)?.annotation?.at !== undefined ? facetById(shape, part).group : null
    if (group) sideless.set(group, [...(sideless.get(group) ?? []), id])
    else parts[part].push(id)
  }
  for (const [group, members] of sideless) {
    const facets = facetsInGroup(shape, group)
    for (const id of orderOnFacet(members, nodes)) {
      const fewest = facets.reduce((best, facet) => (parts[facet].length < parts[best].length ? facet : best))
      parts[fewest].push(id)
    }
  }
  for (const facet of shape.facets) parts[facet.id] = orderOnFacet(parts[facet.id], nodes)
  return parts
}

const isRect = (rect) => rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]))
const isPoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)

/**
 * Gives the box around some rects.
 *
 * @param {Array<Object>} rects
 * @returns {{left: number, right: number, top: number, bottom: number}}
 */
function spanOf(rects) {
  return {
    left: Math.min(...rects.map((r) => r.x)),
    right: Math.max(...rects.map((r) => r.x + r.width)),
    top: Math.min(...rects.map((r) => r.y)),
    bottom: Math.max(...rects.map((r) => r.y + r.height)),
  }
}

/**
 * Gives the form a compartment takes from what it lies against: a band along the top or bottom edges of
 * cells, a column down one cell's left or right edge, the gap between two facing facets, or free.
 *
 * @param {Array<{cellKey: string, edge: string}>} against
 * @returns {'band'|'column'|'gap'|'free'}
 */
export function formOfAgainst(against) {
  if (!against.length) return 'free'
  const horizontal = (edge) => edge === 'top' || edge === 'bottom'
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  if (against.length === 2 && against[0].cellKey !== against[1].cellKey && opposite[against[0].edge] === against[1].edge) {
    return 'gap'
  }
  return horizontal(against[0].edge) ? 'band' : 'column'
}

/**
 * Gives where a compartment goes. The first one against a place reaches a corner's depth under the cells,
 * which are drawn over it, to fill beside their rounded corners; later ones stack outward.
 *
 * @param {'band'|'column'|'gap'|'free'} form
 * @param {Array<{cellKey: string, edge: string}>} against - For a band, every cell it spans; for a column,
 *   the cell it runs down first; for a gap, the two facing facets.
 * @param {number} index - How many compartments are already against the same place.
 * @param {Map<string, Object>} rects - Cell key -> its rect.
 * @param {number|null} [depth] - Its depth out from the cells: a band's height, a column's width, else the default.
 * @returns {Object|null} Its rect, or null for a free compartment.
 */
export function compartmentRect(form, against, index, rects, depth = null) {
  const reach = index ? 0 : CELL_RADIUS
  if (form === 'band') {
    const height = depth ?? REGION_HEIGHT
    const span = spanOf(against.map((entry) => rects.get(entry.cellKey)))
    const across = { x: span.left - GAP, width: span.right - span.left + 2 * GAP }
    if (against[0].edge === 'top') return { ...across, y: span.top - (index + 1) * height, height: height + reach }
    return { ...across, y: span.bottom + index * height - reach, height: height + reach }
  }
  if (form === 'column') {
    // Down one cell's side, from its top to its bottom.
    const width = depth ?? SIDE_REGION_WIDTH
    const cell = rects.get(against[0].cellKey)
    const x = against[0].edge === 'right' ? cell.x + cell.width + index * width - reach : cell.x - (index + 1) * width
    return { x, y: cell.y, width: width + reach, height: cell.height }
  }
  if (form === 'gap') {
    // Filling the space between two facing facets, reaching under both cells' corners.
    const [a, b] = against[0].edge === 'right' || against[0].edge === 'bottom' ? against : [against[1], against[0]]
    const first = rects.get(a.cellKey)
    const second = rects.get(b.cellKey)
    if (a.edge === 'right') {
      const top = Math.max(first.y, second.y)
      const bottom = Math.min(first.y + first.height, second.y + second.height)
      const x = first.x + first.width - CELL_RADIUS
      return { x, y: top, width: second.x + CELL_RADIUS - x, height: Math.max(0, bottom - top) }
    }
    const left = Math.max(first.x, second.x)
    const right = Math.min(first.x + first.width, second.x + second.width)
    const y = first.y + first.height - CELL_RADIUS
    return { x: left, y, width: Math.max(0, right - left), height: second.y + CELL_RADIUS - y }
  }
  return null
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
export function processSlot(rect, area, order) {
  return { x: rect.x + CELL_RADIUS + order * (CARD.width + 16), y: rect.y + GLYPH_HEIGHT + 24 + area * (CARD.height + 16) }
}

/**
 * Lays out the physiological view on its scaffold.
 *
 * @param {Array<{id: string, data?: Object}>} nodes - The flow's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @param {Object} [templates]
 * @param {Array<Object>} [templates.instances] - Template instances, not yet laid out.
 * @param {Map<string, Object>} [templates.definitions] - Template id -> its definition.
 * @returns {{places: Map<string, Object>, sites: Array<Object>}} places: see layoutBioView; sites: where
 *   each template site is drawn.
 */
export function layoutPhysiology(nodes, roles, { instances = [], definitions = new Map() } = {}) {
  // Template instances are not laid out yet: only the nodes' own cells and regions make the scaffold.
  const scaffold = scaffoldFromNodes(nodes, roles)
  const sites = []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = nodes.map((node) => node.id).sort(byName(byId))
  const roleOf = (id) => roles.get(id) ?? { role: 'none' }
  const layout = new Map()
  const onCell = cellFinder(scaffold, roles)

  const proteins = ids.filter((id) => roleOf(id).role === 'membraneProtein')
  const inMembrane = proteins.filter((id) => onCell(id) && roleOf(id).facet)

  // Compartments down a cell's side push its neighbours along, by each one's width.
  const forms = new Map(scaffold.compartments.map((piece) => [piece.key, formOfAgainst(piece.against)]))
  const besideCell = (cellKey, edge) =>
    scaffold.compartments
      .filter((piece) => forms.get(piece.key) === 'column' && piece.against[0].cellKey === cellKey)
      .filter((piece) => piece.against[0].edge === edge)
      .reduce((sum, piece) => sum + (piece.depth ?? SIDE_REGION_WIDTH), 0)

  // Cells, left to right; each grows to fit its proteins.
  const rects = new Map()
  let nextX = 0
  for (const cell of scaffold.cells) {
    const { key, shape } = cell
    const parts = partsOf(inMembrane.filter((id) => onCell(id) === key), roleOf, byId, shape)
    const counts = Object.fromEntries(shape.facets.map((facet) => [facet.id, parts[facet.id].length]))
    const x = nextX + besideCell(key, 'left')
    const rect = isRect(cell.storedRect) ? cell.storedRect : fitCellRect({ x, y: 0, ...MIN_CELL }, counts, shape)
    nextX = Math.max(nextX, rect.x + rect.width + GAP + besideCell(key, 'right'))
    rects.set(key, rect)
    layout.set(key, { kind: 'cell', rect, membrane: cell.membrane })

    for (const { id: part } of shape.facets) {
      parts[part].forEach((id, order) =>
        layout.set(id, { kind: 'protein', cell: key, facet: roleOf(id).facet, part, order, ...proteinPlacement(rect, part, order, parts[part].length, shape) })
      )
    }

    // Cytosolic processes in a row inside the cell, below its top facet's proteins: today all in its
    // implicit area.
    const area = cell.processes.findIndex((process) => process.implicit)
    ids
      .filter((id) => roleOf(id).role === 'cytosolic' && onCell(id) === key)
      .forEach((id, i) => {
        const stored = byId.get(id).data?.bioView?.position
        layout.set(id, { kind: 'cytosolic', cell: key, ...(isPoint(stored) ? stored : processSlot(rect, area, i)) })
      })
  }
  for (const id of ids) if (roleOf(id).role === 'membrane' && onCell(id)) layout.set(id, { kind: 'membrane', cell: onCell(id) })

  const cellRects = [...rects.values()]
  const { left, right, top, bottom } = cellRects.length
    ? spanOf(cellRects)
    : { left: 0, right: MIN_CELL.width, top: 0, bottom: MIN_CELL.height }

  // Compartments run right up to the membrane, so a protein in it sits in both the compartment and the cell;
  // each reaches a corner's depth under the cells, which are drawn over them, to fill beside the rounded
  // corners. Ones with nowhere to go are stacked further down. Those against the same place stack outward
  // from it, so none hides another.
  const stacked = new Map()
  let otherY = bottom + 2 * REGION_HEIGHT + GAP
  for (const piece of scaffold.compartments) {
    let form = forms.get(piece.key)
    let { against } = piece
    let placed = rects
    // Facing a side with no cells to span: along that side of where a cell would be.
    const facetId = piece.side && !against.length ? facetOfAnnotation(EPITHELIAL_SHAPE, { facet: piece.side }) : null
    if (facetId) {
      form = 'band'
      against = [{ cellKey: '', facetId, edge: facetById(EPITHELIAL_SHAPE, facetId).edge }]
      placed = new Map([['', { x: left, y: top, width: right - left, height: bottom - top }]])
    }
    const [first] = against
    const key = form === 'column' ? `${first.cellKey}/${first.facetId}` : form === 'free' ? piece.side : first.facetId
    const index = stacked.get(key) ?? 0
    stacked.set(key, index + 1)
    let rect = isRect(piece.storedRect) ? piece.storedRect : compartmentRect(form, against, index, placed, piece.depth)
    if (!rect) {
      rect = { x: left - GAP, y: otherY, width: right - left + 2 * GAP, height: REGION_HEIGHT }
      otherY += REGION_HEIGHT + GAP / 2
    }
    layout.set(piece.key, { kind: 'region', side: piece.side ?? null, adjacent: piece.adjacent, rect })
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

  return { places: layout, sites }
}

/**
 * Lays out the physiological view.
 *
 * @param {Array<{id: string, data?: Object}>} nodes - The flow's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @returns {Map<string, Object>} Node id -> one of:
 *   - { kind: 'cell', rect, membrane: nodeId|null }
 *   - { kind: 'membrane', cell } (drawn as the cell's outline)
 *   - { kind: 'protein', cell, facet, part, order, x, y, rotation, outward } (part: the facet id of the cell's
 *     shape; order: its slot in that part; x, y: the cartoon's centre)
 *   - { kind: 'tray', x, y } (a protein in no membrane; x, y: its top-left)
 *   - { kind: 'cytosolic', cell, x, y }
 *   - { kind: 'region', side, adjacent, rect } (side: the facet it lies against)
 *   - { kind: 'card', x, y }
 */
export function layoutBioView(nodes, roles) {
  return layoutPhysiology(nodes, roles).places
}
