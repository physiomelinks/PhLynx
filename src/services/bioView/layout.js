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
  proteinPlacement,
  slotPositions,
} from './geometry.js'
import { byName, cellFinder, inSlotOrder, scaffoldFromNodes, scaffoldFromTemplates } from './scaffold.js'
import { EPITHELIAL_SHAPE, annotationOfFacet, facetById, facetOfAnnotation, facetsInGroup } from './shape.js'

/** Size of a card for an instance with no physiological shape. */
export const CARD = { width: 180, height: 72 }

/** Height of a region's band. */
export const REGION_HEIGHT = 140

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

/**
 * Grows a template cell so each of its process areas has a row for its cards and a spare one, clear of the
 * proteins on its facets.
 *
 * @param {{width: number, height: number}} size
 * @param {Array<{members: string[]}>} processes
 * @returns {{width: number, height: number}}
 */
function fitProcesses(size, processes) {
  if (!processes.length) return size
  const most = Math.max(...processes.map((process) => process.members.length)) + 1
  return {
    width: Math.max(size.width, 2 * CELL_RADIUS + most * (CARD.width + 16) - 16),
    height: Math.max(size.height, 2 * (GLYPH_HEIGHT + 24) + processes.length * (CARD.height + 16) - 16),
  }
}

/**
 * Stops a band short of halfway to the nearest cell in its row it does not span, so bands along neighbouring
 * cells meet without overlapping.
 *
 * @param {Object} rect - The band.
 * @param {Object} piece - The compartment, from scaffoldFromTemplates.
 * @param {Array<Object>} cells - Its instance's cells.
 * @param {Map<string, Object>} rects - Cell key -> rect.
 * @returns {Object} The band's rect.
 */
function clipBand(rect, piece, cells, rects) {
  const spanned = new Set(piece.against.map((entry) => entry.cellKey))
  const { row } = cells.find((cell) => spanned.has(cell.key))
  const span = spanOf([...spanned].map((key) => rects.get(key)))
  const others = cells.filter((cell) => cell.row === row && !spanned.has(cell.key)).map((cell) => rects.get(cell.key))
  const before = others.filter((other) => other.x + other.width <= span.left).map((other) => other.x + other.width)
  const after = others.filter((other) => other.x >= span.right).map((other) => other.x)
  const left = Math.max(rect.x, ...before.map((edge) => (edge + span.left) / 2))
  const right = Math.min(rect.x + rect.width, ...after.map((edge) => (edge + span.right) / 2))
  return { ...rect, x: left, width: right - left }
}

/**
 * Lays out the cells and compartments of template instances. Each instance's cells go in rows from its
 * `at`, below the bands above its first row, left to right in declaration order; neighbours are spaced by
 * the compartment filling the gap between them, else the columns down their facing sides, else GAP. Bands
 * against the same cell's facet stack outward in declaration order, and free compartments go below
 * everything in the instance. No two instances share a stack.
 *
 * @param {Object} scaffold - From scaffoldFromTemplates.
 * @param {Array<Object>} instances - The template instances, for where each goes.
 * @param {Map<string, Object>} layout - Places, added to.
 * @returns {{rects: Map<string, Object>, sites: Array<Object>}} rects: cell key -> rect; sites: where each
 *   template site is drawn.
 */
function layoutTemplates(scaffold, instances, layout) {
  const rects = new Map()
  const zones = new Map()
  for (const { id: instanceId, at } of instances) {
    const cells = scaffold.cells.filter((cell) => cell.instance === instanceId)
    if (!cells.length) continue
    const pieces = scaffold.compartments.filter((piece) => piece.instance === instanceId)
    const origin = isPoint(at) ? at : { x: 0, y: 0 }

    // How far out each band and column starts, stacked per cell and facet in declaration order.
    const outward = new Map()
    const starts = new Map()
    for (const piece of pieces.filter((piece) => piece.form === 'band' || piece.form === 'column')) {
      const facets = (piece.form === 'band' ? piece.against : piece.against.slice(0, 1)).map((e) => `${e.cellKey}/${e.facetId}`)
      const start = Math.max(...facets.map((facet) => outward.get(facet)?.depth ?? 0))
      const index = Math.max(...facets.map((facet) => outward.get(facet)?.count ?? 0))
      const depth = piece.depth ?? (piece.form === 'band' ? REGION_HEIGHT : SIDE_REGION_WIDTH)
      for (const facet of facets) outward.set(facet, { depth: start + depth, count: index + 1 })
      starts.set(piece.key, { offset: start, index })
    }
    const facetOn = (cell, edge) => cell.facets.find((facet) => facet.edge === edge)?.id
    const outOf = (cell, edge) => outward.get(`${cell.key}/${facetOn(cell, edge)}`)?.depth ?? 0
    const gapBetween = (a, b, edge) =>
      pieces.find(
        (piece) =>
          piece.form === 'gap' &&
          piece.against.some((e) => e.cellKey === a.key && e.edge === edge) &&
          piece.against.some((e) => e.cellKey === b.key)
      )
    const gapDepth = (piece, fallback) => piece.depth ?? fallback

    // Cells, row by row.
    const rows = [...new Set(cells.map((cell) => cell.row))].sort((a, b) => a - b)
    const sizes = new Map(
      cells.map((cell) => {
        const counts = Object.fromEntries(cell.facets.map((facet) => [facet.id, facet.members.length]))
        const fitted = fitCellRect({ x: 0, y: 0, ...cell.size }, counts, cell.shape)
        return [cell.key, fitProcesses({ width: fitted.width, height: fitted.height }, cell.processes)]
      })
    )
    // Cells in a row are as tall as its tallest, so a band along their bottoms meets every one.
    for (const row of rows) {
      const inRow = cells.filter((cell) => cell.row === row)
      const height = Math.max(...inRow.map((cell) => sizes.get(cell.key).height))
      for (const cell of inRow) sizes.set(cell.key, { ...sizes.get(cell.key), height })
    }
    let y = origin.y + Math.max(0, ...cells.filter((cell) => cell.row === rows[0]).map((cell) => outOf(cell, 'top')))
    rows.forEach((row, r) => {
      const inRow = cells.filter((cell) => cell.row === row)
      let x = origin.x + outOf(inRow[0], 'left')
      inRow.forEach((cell, i) => {
        const rect = { x, y, ...sizes.get(cell.key) }
        rects.set(cell.key, rect)
        const next = inRow[i + 1]
        if (!next) return
        const gap = gapBetween(cell, next, 'right')
        x += rect.width + (gap ? gapDepth(gap, SIDE_REGION_WIDTH) : outOf(cell, 'right') + outOf(next, 'left') || GAP)
      })
      const below = rows[r + 1] === undefined ? [] : cells.filter((cell) => cell.row === rows[r + 1])
      const bottom = Math.max(...inRow.map((cell) => rects.get(cell.key).y + rects.get(cell.key).height))
      const gap = inRow.map((a) => below.map((b) => gapBetween(a, b, 'bottom')).find(Boolean)).find(Boolean)
      const deepest = (list, edge) => Math.max(0, ...list.map((cell) => outOf(cell, edge)))
      const bands = deepest(inRow, 'bottom') + deepest(below, 'top')
      y = bottom + (gap ? gapDepth(gap, REGION_HEIGHT) : bands + GAP)
    })

    // What is bound to each cell: its membrane, the proteins on its facets and the processes inside it.
    for (const cell of cells) {
      const rect = rects.get(cell.key)
      const cellZones = cell.processes.map((process, area) => ({
        processId: process.id,
        label: process.label,
        rect: processZone(rect, area),
      }))
      zones.set(cell.key, cellZones)
      layout.set(cell.key, {
        kind: 'cell',
        rect,
        membrane: cell.membrane,
        instance: instanceId,
        site: cell.site,
        empty: !cell.node,
        tone: null,
        label: cell.label,
        facetLabels: cell.facets.map(({ id, label, edge }) => ({ facetId: id, label, edge })),
        zones: cellZones,
      })
      if (cell.membrane) {
        layout.set(cell.membrane, { kind: 'membrane', cell: cell.key, instance: instanceId, site: cell.membraneSite })
      }
      for (const facet of cell.facets) {
        facet.members.forEach((id, order) => {
          const placement = proteinPlacement(rect, facet.id, order, facet.members.length, cell.shape)
          const name = annotationOfFacet(cell.shape, facet.id)?.facet ?? facet.id
          const site = { instance: instanceId, site: facet.site }
          layout.set(id, { kind: 'protein', cell: cell.key, facet: name, part: facet.id, order, ...placement, ...site })
        })
      }
      cell.processes.forEach((process, area) => {
        process.members.forEach((id, order) => {
          const site = { instance: instanceId, site: process.site }
          layout.set(id, { kind: 'cytosolic', cell: cell.key, order, ...processSlot(rect, area, order), ...site })
        })
      })
    }

    // Compartments against them, then free ones below everything.
    const placed = []
    for (const piece of pieces.filter((piece) => piece.form !== 'free')) {
      const { offset = null, index = 0 } = starts.get(piece.key) ?? {}
      const rect = compartmentRect(piece.form, piece.against, index, rects, piece.depth, offset)
      placed.push([piece, piece.form === 'band' ? clipBand(rect, piece, cells, rects) : rect])
    }
    const all = [...cells.map((cell) => rects.get(cell.key)), ...placed.map(([, rect]) => rect)]
    const span = spanOf(all)
    const cellSpan = spanOf(cells.map((cell) => rects.get(cell.key)))
    let freeY = span.bottom + GAP
    for (const piece of pieces.filter((piece) => piece.form === 'free')) {
      const height = piece.depth ?? REGION_HEIGHT
      placed.push([piece, { x: cellSpan.left - GAP, y: freeY, width: cellSpan.right - cellSpan.left + 2 * GAP, height }])
      freeY += height + GAP / 2
    }
    for (const [piece, rect] of placed) {
      const edge = piece.form === 'free' ? null : piece.against[0].edge
      layout.set(piece.key, {
        kind: 'region',
        side: null,
        adjacent: null,
        rect,
        instance: instanceId,
        site: piece.site,
        empty: !piece.node,
        tone: piece.tone,
        form: piece.form,
        ...(edge && { edge }),
        label: piece.label,
      })
    }
  }

  // Every site, empty or not, for the drop prompts.
  const sites = []
  for (const site of scaffold.sites.values()) {
    const { ref, instance, path, role, kind, label, occupants, key } = site
    const entry = { ref, instance, path, role, kind, label, occupant: kind === 'single' ? (occupants[0] ?? null) : null }
    const cell = scaffold.cells.find((piece) => piece.key === key)
    if (kind === 'single') {
      sites.push({ ...entry, key, rect: layout.get(key).rect })
      continue
    }
    const rect = rects.get(key)
    if (site.facet) {
      const slots = slotPositions(rect, site.facet, occupants.length + 1, cell.shape)
      sites.push({ ...entry, cell: key, facet: site.facet, occupants, slots })
    } else {
      const area = cell.processes.findIndex((process) => process.id === site.process)
      const slots = Array.from({ length: occupants.length + 1 }, (_, order) => processSlot(rect, area, order))
      sites.push({ ...entry, cell: key, process: site.process, occupants, slots, rect: zones.get(key)[area].rect })
    }
  }
  return { rects, sites }
}

/**
 * Lays out the physiological view on its scaffold: the cells and regions that are nodes, and the template
 * instances with the nodes bound to their sites. A node whose site is dangling falls back to its role.
 *
 * @param {Array<{id: string, data?: Object}>} nodes - The flow's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @param {Object} [templates]
 * @param {Array<{id: string, template: string, at: {x: number, y: number}}>} [templates.instances]
 * @param {Map<string, Object>} [templates.definitions] - Template id -> its validated template.
 * @returns {{places: Map<string, Object>, sites: Array<Object>}}
 *   - places: see layoutBioView; a template piece's place, keyed by its node or 'tpl:<instance>/<path>' while
 *     empty, also has { instance, site, empty, tone, edge?, form, label }, a cell's facetLabels: [{ facetId, label,
 *     edge }] and zones: [{ processId, label, rect }]; a node bound to a site has { instance, site };
 *   - sites: every template site, empty or not: { ref, instance, path, role, kind, label, occupant } with, for
 *     one module, the piece's key and rect, and for slots, the cell, facet or process, occupants and the slots'
 *     positions (one spare), plus a process area's rect.
 */
export function layoutPhysiology(nodes, roles, { instances = [], definitions = new Map() } = {}) {
  // Nodes bound to a template site are placed by it; the rest make the node-owned scaffold.
  const templates = scaffoldFromTemplates(instances, definitions, nodes)
  const free = templates.bound.size ? nodes.filter((node) => !templates.bound.has(node.id)) : nodes
  const scaffold = scaffoldFromNodes(free, roles)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = free.map((node) => node.id).sort(byName(byId))
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

  // Template instances, each from its own corner; the tray and cards go beside every cell.
  const { rects: templateRects, sites } = layoutTemplates(templates, instances, layout)
  const allRects = [...cellRects, ...templateRects.values()]
  const anchor = allRects.length === cellRects.length ? { left, right, top } : spanOf(allRects)

  // Proteins in no membrane, in a tray left of the cells.
  const all = nodes.map((node) => node.id).sort(byName(byId))
  all
    .filter((id) => roleOf(id).role === 'membraneProtein' && !layout.has(id))
    .forEach((id, i) => {
      const stored = byId.get(id).data?.bioView?.position
      layout.set(id, { kind: 'tray', ...(isPoint(stored) ? stored : { x: anchor.left - GAP - GLYPH_WIDTH - GAP, y: anchor.top + i * (GLYPH_HEIGHT + 32) }) })
    })

  // Everything else as cards, in a column right of the cells.
  all
    .filter((id) => !layout.has(id))
    .forEach((id, i) => {
      const stored = byId.get(id).data?.bioView?.position
      layout.set(id, { kind: 'card', ...(isPoint(stored) ? stored : { x: anchor.right + GAP * 2, y: anchor.top + i * (CARD.height + 24) }) })
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
