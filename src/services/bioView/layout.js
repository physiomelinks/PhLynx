/**
 * Lays out the physiological view: cells in a row, each with its membrane proteins in slots along
 * their facets and its cytosolic processes inside. A region lies against what it is adjacent to: a
 * band along the cells' tops or bottoms, or down one cell's side (a paracellular space); one only
 * known from the annotations to face the apical or basolateral side spans the cells they describe. Proteins not
 * yet in a membrane go in a tray to the left, and everything else as cards to the right. What the user
 * placed (data.bioView) is kept; only the rest is worked out, the same way every time.
 */

import {
  CELL_RADIUS,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  MIN_CELL,
  fitCellRect,
  partOf,
  proteinLabelWidth,
  proteinPlacement,
} from './geometry.js'
import { FACET_BAND } from './metrics.js'
import { byName, cellFinder, inSlotOrder, scaffoldFromNodes } from './scaffold.js'
import { EPITHELIAL_SHAPE, facetById, facetOfAnnotation, facetsInGroup } from './shape.js'

/** Size of a card for an instance with no physiological shape. */
export const CARD = { width: 180, height: 72 }

/** Height of a region's band. */
export const REGION_HEIGHT = 140

/** How far out from a cell, on each side it is against, the compartment round it reaches. */
export const SURROUND_DEPTH = 110

/** Width of a region down a cell's side. */
export const SIDE_REGION_WIDTH = 120

/** Space between things laid out side by side. */
export const GAP = 80

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
    for (const id of inSlotOrder(members, nodes)) {
      const fewest = facets.reduce((best, facet) => (parts[facet].length < parts[best].length ? facet : best))
      parts[fewest].push(id)
    }
  }
  for (const facet of shape.facets) parts[facet.id] = inSlotOrder(parts[facet.id], nodes)
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
  if (
    against.length === 2 &&
    against[0].cellKey !== against[1].cellKey &&
    opposite[against[0].edge] === against[1].edge
  ) {
    return 'gap'
  }
  return horizontal(against[0].edge) ? 'band' : 'column'
}

/**
 * Gives where a compartment goes. The first one against a place reaches a corner's depth under the cells,
 * which are drawn over it, to fill beside their rounded corners; later ones stack outward.
 *
 * @param {'band'|'column'|'gap'|'surround'|'free'} form
 * @param {Array<{cellKey: string, edge: string}>} against - For a band, every cell it spans; for a column,
 *   the cell it runs down first; for a gap, the two facing facets.
 * @param {number} index - How many compartments are already against the same place.
 * @param {Map<string, Object>} rects - Cell key -> its rect.
 * @param {number|null} [depth] - Its depth out from the cells: a band's height, a column's width, else the default.
 * @param {number|null} [offset] - How far out from the cells it starts, for a band or column: by default
 *   `index` times its own depth.
 * @returns {Object|null} Its rect, or null for a free compartment.
 */
export function compartmentRect(form, against, index, rects, depth = null, offset = null) {
  const reach = index ? 0 : CELL_RADIUS
  if (form === 'band') {
    const height = depth ?? REGION_HEIGHT
    const out = offset ?? index * height
    const span = spanOf(against.map((entry) => rects.get(entry.cellKey)))
    const across = { x: span.left - GAP, width: span.right - span.left + 2 * GAP }
    if (against[0].edge === 'top') return { ...across, y: span.top - out - height, height: height + reach }
    return { ...across, y: span.bottom + out - reach, height: height + reach }
  }
  if (form === 'column') {
    // Down one cell's side, from its top to its bottom.
    const width = depth ?? SIDE_REGION_WIDTH
    const out = offset ?? index * width
    const cell = rects.get(against[0].cellKey)
    const x = against[0].edge === 'right' ? cell.x + cell.width + out - reach : cell.x - out - width
    return { x, y: cell.y, width: width + reach, height: cell.height }
  }
  if (form === 'surround') {
    // Round one cell: out from each side it is against, and under the cell itself.
    const cell = rects.get(against[0].cellKey)
    const out = depth ?? SURROUND_DEPTH
    const sides = new Set(against.map((entry) => entry.edge))
    const left = sides.has('left') ? out : 0
    const top = sides.has('top') ? out : 0
    return {
      x: cell.x - left,
      y: cell.y - top,
      width: cell.width + left + (sides.has('right') ? out : 0),
      height: cell.height + top + (sides.has('bottom') ? out : 0),
    }
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
  return {
    x: rect.x + CELL_RADIUS + order * (CARD.width + 16),
    y: rect.y + GLYPH_HEIGHT + 24 + area * (CARD.height + 16),
  }
}

/** How far inside a cell's edge its processes are kept, clear of the bilayer. */
export const PROCESS_INSET = 16

/**
 * Keeps a process's card inside its cell, clear of the membrane.
 *
 * @param {{x: number, y: number}} at - The card's top-left.
 * @param {Object} rect - The cell.
 * @returns {{x: number, y: number}}
 */
export function insideCell(at, rect) {
  const within = (value, low, high) => Math.max(low, Math.min(Math.max(low, high), value))
  return {
    x: within(at.x, rect.x + PROCESS_INSET, rect.x + rect.width - PROCESS_INSET - CARD.width),
    y: within(at.y, rect.y + PROCESS_INSET + 12, rect.y + rect.height - PROCESS_INSET - CARD.height),
  }
}

/**
 * Gives the area a cell's processes take up, as drawn round them: their cards' box with a little room, so they
 * read as part of the cell rather than cards left on it.
 *
 * @param {Array<{x: number, y: number}>} cards - Each card's top-left.
 * @returns {{x: number, y: number, width: number, height: number}|null} null with no cards.
 */
export function processesZone(cards) {
  if (!cards.length) return null
  const left = Math.min(...cards.map((card) => card.x)) - 8
  // Room above for the area's name.
  const top = Math.min(...cards.map((card) => card.y)) - 20
  const right = Math.max(...cards.map((card) => card.x + CARD.width)) + 8
  const bottom = Math.max(...cards.map((card) => card.y + CARD.height)) + 8
  return { x: left, y: top, width: right - left, height: bottom - top }
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
 * Lays out the physiological view's modules that aren't on the pieces' sites: the cells and regions that are nodes,
 * and the proteins and cards in and beside them.
 *
 * @param {Array<{id: string, data?: Object}>} allNodes - The flow's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @param {Object} [options]
 * @param {(id: string) => string} [options.detailOf] - What a protein carries, as drawn under its name, so
 *   neighbours along a top or bottom edge are spaced for both.
 * @param {Set<string>} [options.placedElsewhere] - Nodes laid out elsewhere, as those on the pieces' sites are,
 *   which get no place here.
 * @param {Array<Object>} [options.around] - What else is drawn (the pieces' rects), for the tray and the cards to go
 *   beside.
 * @returns {{places: Map<string, Object>}} places: see layoutBioView; a node-owned cell's has its proteins' name
 *   widths per part, in slot order.
 */
export function layoutPhysiology(
  allNodes,
  roles,
  { detailOf = () => '', placedElsewhere = new Set(), around = [] } = {},
) {
  // Nodes bound to a site of the pieces are laid out with them (see layoutPieces), so left out here.
  const nodes = placedElsewhere.size ? allNodes.filter((node) => !placedElsewhere.has(node.id)) : allNodes
  const scaffold = scaffoldFromNodes(nodes, roles)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = nodes.map((node) => node.id).sort(byName(byId))
  const roleOf = (id) => roles.get(id) ?? { role: 'none' }
  const layout = new Map()
  const onCell = cellFinder(scaffold, roles)
  const widthOf = (id) => proteinLabelWidth(byId.get(id)?.data?.name ?? id, detailOf(id))

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
    const parts = partsOf(
      inMembrane.filter((id) => onCell(id) === key),
      roleOf,
      byId,
      shape,
    )
    const counts = Object.fromEntries(shape.facets.map((facet) => [facet.id, parts[facet.id].length]))
    const widths = Object.fromEntries(shape.facets.map((facet) => [facet.id, parts[facet.id].map(widthOf)]))
    const x = nextX + besideCell(key, 'left')
    // A cell the user moved stays where it was put, and still grows to fit proteins added since, and a row of
    // its processes.
    const inside = ids.filter((id) => roleOf(id).role === 'cytosolic' && onCell(id) === key)
    const fitted = fitCellRect(
      isRect(cell.storedRect) ? cell.storedRect : { x, y: 0, ...MIN_CELL },
      counts,
      shape,
      widths,
    )
    const rect = inside.length
      ? { ...fitted, width: Math.max(fitted.width, 2 * CELL_RADIUS + inside.length * (CARD.width + 16) - 16) }
      : fitted
    nextX = Math.max(nextX, rect.x + rect.width + GAP + besideCell(key, 'right'))
    rects.set(key, rect)
    layout.set(key, { kind: 'cell', rect, membrane: cell.membrane, widths })

    for (const { id: part } of shape.facets) {
      parts[part].forEach((id, order) =>
        layout.set(id, {
          kind: 'protein',
          cell: key,
          facet: roleOf(id).facet,
          part,
          order,
          ...proteinPlacement(rect, part, order, parts[part].length, shape, widths[part]),
        }),
      )
    }

    // Cytosolic processes in a row inside the cell, below its top facet's proteins: today all in its
    // implicit area.
    const area = cell.processes.findIndex((process) => process.implicit)
    const cards = inside.map((id, i) => {
      const stored = byId.get(id).data?.bioView?.position
      // Inside the membrane wherever it was put, and however the cell has changed since.
      const at = insideCell(isPoint(stored) ? stored : processSlot(rect, area, i), rect)
      layout.set(id, { kind: 'cytosolic', cell: key, ...at })
      return at
    })
    // The area they take up is kept, for what is placed round them to keep clear of; with processes in it, it is
    // not outlined or named, as a template's area isn't once filled.
    const zone = processesZone(cards)
    if (zone) layout.get(key).zones = [{ processId: null, label: null, rect: zone, filled: true }]
  }
  for (const id of ids)
    if (roleOf(id).role === 'membrane' && onCell(id)) layout.set(id, { kind: 'membrane', cell: onCell(id) })

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
    // One lying against cells is placed by them, so it follows as they move and grow; a place of its own is kept
    // only by one with no cell to lie against.
    const anchored =
      form !== 'free' && (facetId ? cellRects.length > 0 : against.every((entry) => rects.has(entry.cellKey)))
    const stored = !anchored && isRect(piece.storedRect) ? piece.storedRect : null
    let rect = stored ?? compartmentRect(form, against, index, placed, piece.depth)
    if (!rect) {
      rect = { x: left - GAP, y: otherY, width: right - left + 2 * GAP, height: REGION_HEIGHT }
      otherY += REGION_HEIGHT + GAP / 2
    }
    layout.set(piece.key, {
      kind: 'region',
      side: piece.side ?? null,
      adjacent: piece.adjacent,
      rect,
      ...(anchored && { anchored }),
    })
  }

  // The tray and cards go beside every cell, and beside the pieces.
  const allRects = [...cellRects, ...around.filter(isRect)]
  const anchor = allRects.length === cellRects.length ? { left, right, top } : spanOf(allRects)

  // Proteins in no membrane, in a tray left of the cells.
  const all = nodes.map((node) => node.id).sort(byName(byId))
  all
    .filter((id) => roleOf(id).role === 'membraneProtein' && !layout.has(id))
    .forEach((id, i) => {
      const stored = byId.get(id).data?.bioView?.position
      layout.set(id, {
        kind: 'tray',
        ...(isPoint(stored)
          ? stored
          : { x: anchor.left - GAP - GLYPH_WIDTH - GAP, y: anchor.top + i * (GLYPH_HEIGHT + 32) }),
      })
    })

  // Everything else as cards, in a column right of the cells.
  all
    .filter((id) => !layout.has(id))
    .forEach((id, i) => {
      const stored = byId.get(id).data?.bioView?.position
      layout.set(id, {
        kind: 'card',
        ...(isPoint(stored) ? stored : { x: anchor.right + GAP * 2, y: anchor.top + i * (CARD.height + 24) }),
      })
    })

  return { places: layout }
}

/**
 * Lays out the physiological view.
 *
 * @param {Array<{id: string, data?: Object}>} nodes - The flow's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @returns {Map<string, Object>} Node id -> one of:
 *   - { kind: 'cell', rect, membrane: nodeId|null, widths } (widths: its proteins' name widths per part)
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
