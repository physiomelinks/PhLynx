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
  FOLD,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  MIN_CELL,
  facetSlots,
  fitCellRect,
  foldDepthFor,
  foldPocket,
  foldPoint,
  partOf,
  proteinLabelWidth,
  proteinPlacement,
} from './geometry.js'
import { FACET_BAND } from './metrics.js'
import { byName, cellFinder, inSlotOrder, scaffoldFromNodes, scaffoldFromTemplates } from './scaffold.js'
import { EPITHELIAL_SHAPE, annotationOfFacet, facetById, facetOfAnnotation, facetsInGroup, withFolds } from './shape.js'

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

/**
 * How far below a cell's process areas its inside reaches, at least: an empty cell's name and hint (36), with
 * clearance, above the reach of a bottom-facet protein (half its glyph) and its two-line name (32).
 */
const HINT_ROOM = 36 + 8 + GLYPH_HEIGHT / 2 + 32

/** The bottom of a cell's last process area, or its top facet's band, from the cell's top. */
const processZoneBottom = (count) =>
  count ? processZone({ x: 0, y: 0, width: 0 }, count - 1).y + CARD.height + 16 : FACET_BAND

/** A junction's area: room for a card, and how far it keeps from the spaces it lies between. */
const JUNCTION = { width: CARD.width + CELL_RADIUS, height: CARD.height + 16, gap: 12 }

/**
 * Gives where a junction's area goes in its cell: midway between the two microdomains it joins, or, between a
 * microdomain and the cell's own inside, just inside the cell from the microdomain.
 *
 * @param {Object} cell - The cell's rect.
 * @param {Array<{rect?: Object, edge?: string}>} spaces - The two it joins: a microdomain's rect and the side of
 *   the cell it lies under, or neither for the cell's own inside.
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function junctionZone(cell, spaces) {
  const middle = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  const inner = spaces.filter((space) => space.rect)
  let centre = middle(cell)
  if (inner.length === 2) {
    const [a, b] = inner.map((space) => middle(space.rect))
    centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  } else if (inner.length === 1) {
    const [{ rect, edge }] = inner
    const reach = JUNCTION.gap + JUNCTION.height / 2
    const side = JUNCTION.gap + JUNCTION.width / 2
    centre = {
      top: { x: middle(rect).x, y: rect.y + rect.height + reach },
      bottom: { x: middle(rect).x, y: rect.y - reach },
      left: { x: rect.x + rect.width + side, y: middle(rect).y },
      right: { x: rect.x - side, y: middle(rect).y },
    }[edge ?? 'top']
  }
  return { x: centre.x - JUNCTION.width / 2, y: centre.y - JUNCTION.height / 2, width: JUNCTION.width, height: JUNCTION.height }
}

/** Where the card at a place in a process area's row goes: in from the area's corner, as processSlot puts it. */
const zoneSlot = (zone, order) => ({ x: zone.rect.x + CELL_RADIUS / 2 + order * (CARD.width + 16), y: zone.rect.y + 8 })

/** How far inside a cell's edge a microdomain starts, clear of the bilayer, and how deep it is unless it says. */
const MICRODOMAIN_INSET = 10
const MICRODOMAIN_DEPTH = 84

/**
 * Gives where a microdomain goes: a band inside its cell under the facet it is against; round the outside of the
 * organelle facet it is against; or, against one of each, the space between the two, reaching under the organelle's
 * rounded corners, which are drawn over it.
 *
 * Against a fold it goes round the fold, or between the fold's nearer wall and the organelle's side facing it.
 *
 * @param {Object} piece - The microdomain, from scaffoldFromTemplates.
 * @param {Map<string, Object>} rects - Cell key -> rect, organelles too.
 * @param {Object} [pocket] - The fold it is against, from foldPocket, if it is against one.
 * @returns {Object|null} Its rect; null when a cell it names has no place.
 */
export function microdomainRect(piece, rects, pocket = null) {
  const own = piece.against.find((entry) => entry.cellKey === piece.parent)
  const other = piece.against.find((entry) => entry.cellKey !== piece.parent)
  const cell = rects.get(piece.parent)
  const organelle = other && rects.get(other.cellKey)
  if (!cell || (other && !organelle)) return null
  const depth = piece.depth ?? MICRODOMAIN_DEPTH
  if (own?.fold) return pocket ? foldMicrodomainRect(cell, pocket, organelle, piece.depth ?? FOLD_MICRODOMAIN_DEPTH) : null
  const { edge } = own ?? other
  const isAcross = edge === 'top' || edge === 'bottom'
  // The cell's inner edge on that side, and the organelle's outer edge, pulled in under its corners.
  const inner = {
    top: cell.y + MICRODOMAIN_INSET,
    bottom: cell.y + cell.height - MICRODOMAIN_INSET,
    left: cell.x + MICRODOMAIN_INSET,
    right: cell.x + cell.width - MICRODOMAIN_INSET,
  }[edge]
  const outer = organelle && {
    top: organelle.y + CELL_RADIUS,
    bottom: organelle.y + organelle.height - CELL_RADIUS,
    left: organelle.x + CELL_RADIUS,
    right: organelle.x + organelle.width - CELL_RADIUS,
  }[edge]
  const isLow = edge === 'top' || edge === 'left'
  // From the cell's edge to the organelle's, or for its depth from whichever it is against alone.
  let from
  let to
  if (own && organelle) [from, to] = isLow ? [inner, outer] : [outer, inner]
  else if (own) [from, to] = isLow ? [inner, inner + depth] : [inner - depth, inner]
  else [from, to] = isLow ? [outer - CELL_RADIUS - depth, outer] : [outer, outer + CELL_RADIUS + depth]
  // Along the side: the organelle's straight stretch, or the cell's.
  const along = organelle ?? cell
  const lead = organelle ? CELL_RADIUS / 2 : CELL_RADIUS
  return isAcross
    ? { x: along.x + lead, width: along.width - 2 * lead, y: from, height: Math.max(0, to - from) }
    : { y: along.y + lead, height: along.height - 2 * lead, x: from, width: Math.max(0, to - from) }
}

/** The room beside a cell's organelles for the cell's own name, where a microdomain has the room below them. */
const NAME_ROOM = 190

/** How far round a fold a microdomain against it alone reaches. */
const FOLD_MICRODOMAIN_DEPTH = 46

/** Makes a rect from two corners given in a fold's own terms (see foldPoint). */
function foldRect(cell, edge, [alongA, inwardA], [alongB, inwardB]) {
  const a = foldPoint(cell, edge, alongA, inwardA)
  const b = foldPoint(cell, edge, alongB, inwardB)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/**
 * Gives where a microdomain against a fold goes: round the fold, or, with an organelle, between the organelle's side
 * and the fold's wall facing it, over the stretch the two share.
 *
 * @param {Object} cell - The cell's rect.
 * @param {{edge: string, at: number, half: number, depth: number}} pocket - The fold.
 * @param {Object|undefined} organelle - The organelle's rect.
 * @param {number} depth - How far round the fold it reaches, alone.
 * @returns {Object|null} Null when the organelle and the fold share no stretch.
 */
function foldMicrodomainRect(cell, pocket, organelle, depth) {
  const { edge, at, half } = pocket
  const wall = at - half - MICRODOMAIN_INSET
  if (!organelle) return foldRect(cell, edge, [wall - depth, MICRODOMAIN_INSET], [at + half + MICRODOMAIN_INSET + depth, pocket.depth + depth])
  // In the fold's terms: how far along its side the organelle's far side is, and the stretch inward it covers.
  const isAcross = edge === 'top' || edge === 'bottom'
  const far = isAcross ? organelle.x + organelle.width - cell.x : organelle.y + organelle.height - cell.y
  const [near, deep] = {
    top: [organelle.y - cell.y, organelle.y + organelle.height - cell.y],
    bottom: [cell.y + cell.height - organelle.y - organelle.height, cell.y + cell.height - organelle.y],
    left: [organelle.x - cell.x, organelle.x + organelle.width - cell.x],
    right: [cell.x + cell.width - organelle.x - organelle.width, cell.x + cell.width - organelle.x],
  }[edge]
  const from = Math.max(near + CELL_RADIUS / 2, MICRODOMAIN_INSET)
  const to = Math.min(deep - CELL_RADIUS / 2, pocket.depth - half)
  if (to <= from || wall <= far - CELL_RADIUS) return null
  return foldRect(cell, edge, [far - CELL_RADIUS, from], [wall, to])
}

/**
 * Gives the part of a microdomain round a fold that the fold itself takes, to leave clear.
 *
 * @param {Object} cell - The cell's rect.
 * @param {Object} pocket - The fold.
 * @param {Object} rect - The microdomain.
 * @returns {{x: number, y: number, width: number, height: number, radius: number}} In the microdomain's own coordinates.
 */
function foldCutout(cell, pocket, rect) {
  const { edge, at, half, depth } = pocket
  const reach = half + MICRODOMAIN_INSET
  const hole = foldRect(cell, edge, [at - reach, -reach], [at + reach, depth + MICRODOMAIN_INSET])
  return { x: hole.x - rect.x, y: hole.y - rect.y, width: hole.width, height: hole.height, radius: reach }
}

/** The smallest an organelle is drawn. */
const ORGANELLE_MIN = { width: 200, height: 140 }
/** The room round an organelle, for the proteins on its membrane and their names, and between two. */
const ORGANELLE_ROOM = GLYPH_HEIGHT / 2 + 36
const ORGANELLE_GAP = 2 * ORGANELLE_ROOM
/** How far below a cell's top its organelles start: below its process areas and the proteins on its top facet. */
const organelleTop = (cell) => Math.max(processZoneBottom(cell.processes.length), GLYPH_HEIGHT + 40) + ORGANELLE_ROOM

/**
 * Gives where an empty template cell's name and hint go: the middle of its inside below its process areas and
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
 * Grows a template cell so each of its process areas has a row for its cards and a spare one, clear of the
 * proteins on its facets.
 *
 * @param {{width: number, height: number}} size
 * @param {Array<{members: string[]}>} processes
 * @returns {{width: number, height: number}}
 */
function fitProcesses(size, processes) {
  // Below the process areas, room for an empty cell's name and hint clear of a bottom protein's two-line name.
  const hinted = { ...size, height: Math.max(size.height, processZoneBottom(processes.length) + HINT_ROOM) }
  if (!processes.length) return hinted
  const most = Math.max(...processes.map((process) => process.members.length)) + 1
  return {
    width: Math.max(size.width, 2 * CELL_RADIUS + most * (CARD.width + 16) - 16),
    height: Math.max(hinted.height, 2 * (GLYPH_HEIGHT + 24) + processes.length * (CARD.height + 16) - 16),
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

/** A template cell's proteins' name widths, per facet, in slot order. */
const facetWidths = (cell, widthOf) => Object.fromEntries(cell.facets.map((facet) => [facet.id, facet.members.map(widthOf)]))

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
 * @param {(id: string) => number} widthOf - How wide a protein's name is drawn.
 * @returns {{rects: Map<string, Object>, sites: Array<Object>}} rects: cell key -> rect; sites: where each
 *   template site is drawn.
 */
function layoutTemplates(scaffold, instances, layout, widthOf) {
  const rects = new Map()
  const zones = new Map()
  for (const { id: instanceId, at } of instances) {
    // The cells that go in rows, and with them every organelle, each inside its cell.
    const everyCell = scaffold.cells.filter((cell) => cell.instance === instanceId)
    const cells = everyCell.filter((cell) => !cell.parent)
    const organellesOf = (cell) => everyCell.filter((other) => other.parent === cell.key)
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
    // A fold is as deep as its proteins need, at least: the cell is sized for it, and its slots are found down it.
    const redraw = (cell, drawnAs) => (cell.shape = withFolds(cell.shape, drawnAs))
    const membersOf = (cell, facetId) => cell.facets.find((facet) => facet.id === facetId)?.members.length ?? 0
    for (const cell of cells) {
      redraw(cell, (facet) => ({ depth: Math.max(facet.depth ?? FOLD.depth, foldDepthFor(membersOf(cell, facet.id))) }))
    }
    const sizes = new Map(
      everyCell.map((cell) => {
        const counts = Object.fromEntries(cell.facets.map((facet) => [facet.id, facet.members.length]))
        const least = cell.parent ? ORGANELLE_MIN : MIN_CELL
        const fitted = fitCellRect({ x: 0, y: 0, ...cell.size }, counts, cell.shape, facetWidths(cell, widthOf), least)
        const size = { width: fitted.width, height: fitted.height }
        // An organelle is only as big as what is on and in it needs.
        // Its junctions go between its spaces, not in the rows from its top (see below).
        const rows = cell.processes.filter((process) => !process.between)
        return [cell.key, cell.parent && !rows.length ? size : fitProcesses(size, rows)]
      })
    )
    // A microdomain between a cell's edge and an organelle takes the room under or over the organelle, where the
    // cell's own name would go, so the name goes beside the organelles, in room of its own.
    const microdomainsOf = (cell) => pieces.filter((piece) => piece.form === 'inner' && piece.parent === cell.key)
    const isBridged = (cell) => microdomainsOf(cell).some((piece) => piece.against.length === 2)
    // On both sides, so the organelles stay in the middle, under and over the proteins of the cell's own facets.
    const nameRoom = (cell) => (isBridged(cell) ? 2 * NAME_ROOM : 0)
    // A cell grows to hold the microdomains under its top and bottom sides, and a junction between its spaces,
    // with room left for its own inside.
    for (const cell of cells) {
      const bands = microdomainsOf(cell).filter((piece) => piece.against.length === 1 && ['top', 'bottom'].includes(piece.against[0].edge))
      const junctions = cell.processes.filter((process) => process.between)
      if (!bands.length && !junctions.length) continue
      const size = sizes.get(cell.key)
      const taken = bands.reduce((total, piece) => total + MICRODOMAIN_INSET + (piece.depth ?? MICRODOMAIN_DEPTH), 0)
      const between = junctions.length ? JUNCTION.height + 2 * JUNCTION.gap : 0
      sizes.set(cell.key, { ...size, height: Math.max(size.height, processZoneBottom(cell.processes.length - junctions.length) + taken + between + HINT_ROOM) })
    }
    // A cell grows to hold its organelles, side by side below its process areas.
    for (const cell of cells) {
      const inner = organellesOf(cell).map((organelle) => sizes.get(organelle.key))
      if (!inner.length) continue
      const size = sizes.get(cell.key)
      const across = inner.reduce((total, each) => total + each.width, 0) + (inner.length - 1) * ORGANELLE_GAP
      sizes.set(cell.key, {
        width: Math.max(size.width, across + nameRoom(cell) + 2 * (CELL_RADIUS + ORGANELLE_ROOM)),
        height: Math.max(
          size.height,
          organelleTop(cell) + Math.max(...inner.map((each) => each.height)) + ORGANELLE_ROOM + HINT_ROOM
        ),
      })
    }
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

    // Each cell's organelles, in a row inside it, centred.
    for (const cell of cells) {
      const inner = organellesOf(cell)
      if (!inner.length) continue
      const rect = rects.get(cell.key)
      const across = inner.reduce((total, each) => total + sizes.get(each.key).width, 0) + (inner.length - 1) * ORGANELLE_GAP
      let x = rect.x + (rect.width - across) / 2
      for (const organelle of inner) {
        rects.set(organelle.key, { x, y: rect.y + organelleTop(cell), ...sizes.get(organelle.key) })
        x += sizes.get(organelle.key).width + ORGANELLE_GAP
      }
    }

    // A fold with a microdomain between it and an organelle reaches as far in as the organelle does, and has its
    // proteins down the wall facing the organelle, from where the organelle starts: in the microdomain.
    for (const cell of cells) {
      const rect = rects.get(cell.key)
      redraw(cell, (facet) => {
        const bridge = microdomainsOf(cell).find((piece) => piece.against.length === 2 && piece.against.some((entry) => entry.facetId === facet.id && entry.cellKey === cell.key))
        const organelle = bridge && rects.get(bridge.against.find((entry) => entry.cellKey !== cell.key).cellKey)
        if (!organelle) return undefined
        const [near, far] = {
          top: [organelle.y - rect.y, organelle.y + organelle.height - rect.y],
          bottom: [rect.y + rect.height - organelle.y - organelle.height, rect.y + rect.height - organelle.y],
          left: [organelle.x - rect.x, organelle.x + organelle.width - rect.x],
          right: [rect.x + rect.width - organelle.x - organelle.width, rect.x + rect.width - organelle.x],
        }[facet.fold]
        const lead = near + CELL_RADIUS / 2 + 8
        const drawn = { lead, facing: true }
        return { ...drawn, depth: Math.max(facet.depth, far - CELL_RADIUS / 2 + FOLD.width / 2, foldDepthFor(membersOf(cell, facet.id), drawn)) }
      })
    }
    const pocketsOf = (cell) =>
      cell.shape.facets.filter((facet) => facet.fold).map((facet) => ({ facetId: facet.id, label: facet.label, ...foldPocket(rects.get(cell.key), facet) }))

    // Where each microdomain goes inside its cell: worked out first, as a cell's junctions go between them.
    const innerRects = new Map()
    const cutouts = new Map()
    for (const piece of pieces.filter((piece) => piece.form === 'inner')) {
      const own = piece.against.find((entry) => entry.cellKey === piece.parent)
      const cell = own?.fold && cells.find((each) => each.key === piece.parent)
      const pocket = cell && pocketsOf(cell).find((each) => each.facetId === own.facetId)
      const rect = microdomainRect(piece, rects, pocket)
      if (!rect) continue
      innerRects.set(piece.key, rect)
      // Round a fold alone, it leaves the fold itself clear: the cell's membrane is drawn under it.
      if (pocket && piece.against.length === 1) cutouts.set(piece.key, foldCutout(rects.get(piece.parent), pocket, rect))
    }

    // What is bound to each cell: its membrane, the proteins on its facets and the processes inside it.
    for (const cell of everyCell) {
      const rect = rects.get(cell.key)
      // A process area stops short of a fold that comes down or up through it.
      const through = cell.parent ? [] : pocketsOf(cell).filter((pocket) => pocket.edge === 'top' || pocket.edge === 'bottom')
      const clear = (zone) => {
        const end = Math.min(zone.x + zone.width, ...through.map((pocket) => rect.x + pocket.at - pocket.half - FOLD.clearance))
        return { ...zone, width: Math.max(0, end - zone.x) }
      }
      // A junction's area lies between the two spaces it joins; the others go in rows from the cell's top.
      const rows = cell.processes.filter((process) => !process.between)
      const cellZones = cell.processes.map((process) => {
        if (!process.between) {
          const area = rows.indexOf(process)
          return { processId: process.id, label: process.label, rect: clear(processZone(rect, area)) }
        }
        const spaces = process.between.map((key) => ({ rect: innerRects.get(key), edge: pieces.find((piece) => piece.key === key)?.against.find((entry) => entry.edge)?.edge }))
        const zone = junctionZone(rect, spaces)
        return { processId: process.id, label: process.label, rect: zone, junction: true }
      })
      zones.set(cell.key, cellZones)
      // An empty cell's name goes below its organelles, as below its process areas.
      const within = organellesOf(cell).map((organelle) => ({ rect: rects.get(organelle.key) }))
      // The microdomains under its top and bottom sides take from its inside too, above and below its name.
      const bandsAt = (edge) =>
        microdomainsOf(cell)
          .filter((piece) => piece.against.length === 1 && piece.against[0].edge === edge && innerRects.has(piece.key))
          .map((piece) => ({ rect: innerRects.get(piece.key) }))
      const taken = [...cellZones, ...within, ...bandsAt('top')]
      // Beside its organelles, level with them, where a microdomain has the room below.
      // On the left where a fold comes in on the right.
      const isFolded = cell.shape.facets.some((facet) => facet.fold === 'top' || facet.fold === 'bottom')
      const beside = !cell.parent && isBridged(cell) && within.length
        ? {
            x: isFolded ? CELL_RADIUS + NAME_ROOM / 2 : rect.width - CELL_RADIUS - NAME_ROOM / 2,
            y: within[0].rect.y + within[0].rect.height / 2 - rect.y,
          }
        : null
      // Each fold, in the cell's own coordinates, in the colour of the compartment that fills it.
      const folds = cell.parent ? [] : pocketsOf(cell).map((pocket) => {
        const side = cell.facets.find((facet) => facet.edge === pocket.edge)
        const outside = side && pieces.find((piece) => piece.form !== 'inner' && piece.against.some((entry) => entry.cellKey === cell.key && entry.facetId === side.id))
        return { ...pocket, tone: outside?.tone ?? null }
      })
      layout.set(cell.key, {
        hintAt: cell.parent ? { x: rect.width / 2, y: rect.height / 2 + 10 } : (beside ?? cellHint(rect, taken, bandsAt('bottom'))),
        kind: 'cell',
        ...(cell.parent && { parent: cell.parent }),
        rect,
        membrane: cell.membrane,
        instance: instanceId,
        path: cell.owner.cell,
        site: cell.site,
        empty: !cell.node,
        tone: null,
        label: cell.label,
        facetLabels: cell.facets.filter((facet) => !facet.fold).map(({ id, label, edge }) => ({ facetId: id, label, edge })),
        ...(folds.length && { folds }),
        zones: cellZones,
      })
      if (cell.membrane) {
        layout.set(cell.membrane, { kind: 'membrane', cell: cell.key, instance: instanceId, site: cell.membraneSite })
      }
      for (const facet of cell.facets) {
        const widths = facet.members.map(widthOf)
        facet.members.forEach((id, order) => {
          const placement = proteinPlacement(rect, facet.id, order, facet.members.length, cell.shape, widths)
          const name = annotationOfFacet(cell.shape, facet.id)?.facet ?? facet.id
          const site = { instance: instanceId, site: facet.site }
          layout.set(id, { kind: 'protein', cell: cell.key, facet: name, part: facet.id, order, ...placement, ...site })
        })
      }
      cell.processes.forEach((process, area) => {
        process.members.forEach((id, order) => {
          const site = { instance: instanceId, site: process.site }
          layout.set(id, { kind: 'cytosolic', cell: cell.key, order, ...zoneSlot(cellZones[area], order), ...site })
        })
      })
    }

    // Compartments against them, then free ones below everything.
    const placed = []
    for (const piece of pieces.filter((piece) => piece.form !== 'free' && piece.form !== 'inner')) {
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
    // Microdomains, each inside its cell; they change no other piece's place.
    for (const piece of pieces) if (innerRects.has(piece.key)) placed.push([piece, innerRects.get(piece.key)])
    for (const [piece, rect] of placed) {
      // A microdomain against a fold is named as one down the side of what faces the fold.
      const edge = piece.form === 'free' ? null : (piece.against.find((entry) => entry.edge)?.edge ?? 'top')
      layout.set(piece.key, {
        kind: 'region',
        side: null,
        adjacent: null,
        rect,
        instance: instanceId,
        path: piece.owner.compartment,
        site: piece.site,
        empty: !piece.node,
        tone: piece.tone,
        form: piece.form,
        ...(piece.form === 'inner' && { parent: piece.parent }),
        ...(cutouts.has(piece.key) && { cutout: cutouts.get(piece.key) }),
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
      // A microdomain lies inside its cell, so a drop on it is told from one on the cell (see nearestSite).
      sites.push({ ...entry, key, rect: layout.get(key).rect, ...(layout.get(key).form === 'inner' && { inner: true }) })
      continue
    }
    const rect = rects.get(key)
    if (site.facet) {
      const widths = occupants.map(widthOf)
      const slots = facetSlots(rect, site.facet, occupants.length, cell.shape, { widths })
      sites.push({ ...entry, cell: key, facet: site.facet, occupants, slots, widths, cellRect: rect, shape: cell.shape })
    } else {
      const area = cell.processes.findIndex((process) => process.id === site.process)
      const slots = Array.from({ length: occupants.length + 1 }, (_, order) => ({
        ...zoneSlot(zones.get(key)[area], order),
        spare: order === occupants.length,
      }))
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
 * @param {(id: string) => string} [templates.detailOf] - What a protein carries, as drawn under its name, so
 *   neighbours along a top or bottom edge are spaced for both.
 * @returns {{places: Map<string, Object>, sites: Array<Object>}}
 *   - places: see layoutBioView; a template piece's place, keyed by its node or 'tpl:<instance>/<path>' while
 *     empty, also has { instance, path, site, empty, tone, edge?, form, label }, a cell's facetLabels: [{ facetId, label,
 *     edge }] and zones: [{ processId, label, rect }]; a node bound to a site has { instance, site }; a node-owned
 *     cell's has its proteins' name widths per part, in slot order;
 *   - sites: every template site, empty or not: { ref, instance, path, role, kind, label, occupant } with, for
 *     one module, the piece's key and rect, and for slots, the cell, facet or process, occupants and the slots'
 *     positions, the last marked spare, plus a process area's rect, or a facet's cellRect, shape and its
 *     occupants' name widths.
 */
export function layoutPhysiology(nodes, roles, { instances = [], definitions = new Map(), detailOf = () => '' } = {}) {
  // Nodes bound to a template site are placed by it; the rest make the node-owned scaffold.
  const templates = scaffoldFromTemplates(instances, definitions, nodes)
  const free = templates.bound.size ? nodes.filter((node) => !templates.bound.has(node.id)) : nodes
  const scaffold = scaffoldFromNodes(free, roles)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = free.map((node) => node.id).sort(byName(byId))
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
    const parts = partsOf(inMembrane.filter((id) => onCell(id) === key), roleOf, byId, shape)
    const counts = Object.fromEntries(shape.facets.map((facet) => [facet.id, parts[facet.id].length]))
    const widths = Object.fromEntries(shape.facets.map((facet) => [facet.id, parts[facet.id].map(widthOf)]))
    const x = nextX + besideCell(key, 'left')
    // A cell the user moved stays where it was put, and still grows to fit proteins added since, and a row of
    // its processes.
    const inside = ids.filter((id) => roleOf(id).role === 'cytosolic' && onCell(id) === key)
    const fitted = fitCellRect(isRect(cell.storedRect) ? cell.storedRect : { x, y: 0, ...MIN_CELL }, counts, shape, widths)
    const rect = inside.length
      ? { ...fitted, width: Math.max(fitted.width, 2 * CELL_RADIUS + inside.length * (CARD.width + 16) - 16) }
      : fitted
    nextX = Math.max(nextX, rect.x + rect.width + GAP + besideCell(key, 'right'))
    rects.set(key, rect)
    layout.set(key, { kind: 'cell', rect, membrane: cell.membrane, widths })

    for (const { id: part } of shape.facets) {
      parts[part].forEach((id, order) =>
        layout.set(id, { kind: 'protein', cell: key, facet: roleOf(id).facet, part, order, ...proteinPlacement(rect, part, order, parts[part].length, shape, widths[part]) })
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
    // The area they take up is drawn as a template's process area is.
    const zone = processesZone(cards)
    if (zone) layout.get(key).zones = [{ processId: null, label: 'Processes', rect: zone }]
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
    // One lying against cells is placed by them, so it follows as they move and grow; a place of its own is kept
    // only by one with no cell to lie against.
    const anchored = form !== 'free' && (facetId ? cellRects.length > 0 : against.every((entry) => rects.has(entry.cellKey)))
    const stored = !anchored && isRect(piece.storedRect) ? piece.storedRect : null
    let rect = stored ?? compartmentRect(form, against, index, placed, piece.depth)
    if (!rect) {
      rect = { x: left - GAP, y: otherY, width: right - left + 2 * GAP, height: REGION_HEIGHT }
      otherY += REGION_HEIGHT + GAP / 2
    }
    layout.set(piece.key, { kind: 'region', side: piece.side ?? null, adjacent: piece.adjacent, rect, ...(anchored && { anchored }) })
  }

  // Template instances, each from its own corner; the tray and cards go beside every cell.
  const { rects: templateRects, sites } = layoutTemplates(templates, instances, layout, widthOf)
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
