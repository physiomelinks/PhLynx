/**
 * What dropping something in the physiological view changes, as new data.bioView values. Nothing here
 * writes: the caller applies the plan as one undo step.
 */

import {
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  MEMBRANE_BAND_HALF,
  cellSlots,
  facetOfPart,
  facetSlots,
  leafletDistance,
  partOf,
} from './geometry.js'
import { CARD } from './layout.js'
import { FACET_BAND } from './metrics.js'
import { EPITHELIAL_SHAPE, annotationOfFacet, facetById, facetsInGroup } from './shape.js'

/** Fields that place a node; Re-layout clears them and keeps the user's choices of what it is. */
const PLACEMENT_KEYS = ['cell', 'facet', 'at', 'order', 'position', 'rect']

/** Fields binding to a template site clears: the site places the node instead, and a slot gives its own order. */
const BIND_CLEARS = ['position', 'rect', 'adjacent', 'cell', 'facet', 'at', 'order']

export { FACET_BAND } from './metrics.js'

/** Which area wins where several hold the drop point: the most specific first. */
const AREA_PRIORITY = ['process', 'membrane', 'cell', 'compartment']
/** Inside an area, a slot only wins this close, so drops in a lumen don't snap to its membrane. */
export const AREA_SNAP = 24

/**
 * Merges a patch into a bioView, dropping fields set to undefined.
 *
 * @param {Object|undefined} bioView
 * @param {Object} patch
 * @returns {Object}
 */
export function patchBioView(bioView, patch) {
  return Object.fromEntries(Object.entries({ ...bioView, ...patch }).filter(([, value]) => value !== undefined))
}

/** Whole flow units, so a saved workspace holds no rounding noise from the screen. */
export const whole = ({ x, y }) => ({ x: Math.round(x), y: Math.round(y) })

/**
 * Gives every node-owned cell's slots as drop targets.
 *
 * @param {Map<string, Object>} layout - From layoutBioView.
 * @param {string|null} [dragged] - A protein being dragged: it leaves its own part's count, so its slots are
 *   where the rest are drawn and dropping it back where it was is no move.
 * @returns {Array<{id: string, rect: Object, counts: Object, membrane: string|null, held?: string, widths?: Object}>}
 *   For nearestSlot and cellSites; held is the part the dragged protein is on; widths are the names' as each row is
 *   drawn.
 */
export function dropTargets(layout, dragged = null) {
  const cells = new Map()
  const empty = () => Object.fromEntries(EPITHELIAL_SHAPE.facets.map(({ id: part }) => [part, 0]))
  // A template's cells offer their sites instead (dropSites).
  for (const [id, place] of layout)
    if (place.kind === 'cell' && !place.instance) {
      const widths = place.widths && { widths: place.widths }
      cells.set(id, { id, rect: place.rect, counts: empty(), membrane: place.membrane ?? null, ...widths })
    }
  for (const [id, place] of layout) {
    if (place.kind !== 'protein' || !cells.has(place.cell)) continue
    if (id === dragged) cells.get(place.cell).held = place.part
    else cells.get(place.cell).counts[place.part]++
  }
  return [...cells.values()]
}

/** The role a drop on each area of a node-owned cell gives. */
const CELL_AREA_ROLES = { membrane: 'membrane', cell: 'cytosolic' }

/**
 * Gives node-owned cells' slots and areas as targets nearestSite reads, so a drop on one is found as on a
 * template's cell: each slot (with its `slot`, for planSlotDrop), the cell's membrane while it has none, and its
 * inside.
 *
 * @param {Array<Object>} cells - From dropTargets.
 * @returns {Array<Object>} Each { type: 'slot'|'area', cellId, ... }: a slot as from dropSites, an area with its
 *   area, the cell's rect, and the role a drop there gives.
 */
export function cellSites(cells) {
  const targets = []
  for (const cell of cells) {
    const shape = cell.shape ?? EPITHELIAL_SHAPE
    for (const { id: part, edge } of shape.facets) {
      for (const { x, y, order, spare } of cellSlots(cell, part)) {
        const slot = { cellId: cell.id, part, ...facetOfPart(part, shape), order, spare, x, y }
        targets.push({ type: 'slot', cellId: cell.id, role: 'membraneProtein', edge, cellRect: cell.rect, x, y, order, spare, slot })
      }
    }
    for (const area of cell.membrane ? ['cell'] : ['membrane', 'cell'])
      targets.push({ type: 'area', area, cellId: cell.id, rect: cell.rect, role: CELL_AREA_ROLES[area] })
  }
  return targets
}

/**
 * Plans dropping a node on a node-owned cell's membrane or inside: it becomes that cell's membrane or a process in
 * it, and the row it left, in a membrane or on a template site, closes up.
 *
 * @param {Object} options
 * @param {string} options.id
 * @param {{cellId: string, role: string}} options.area - From cellSites.
 * @param {Map<string, Object>} options.layout
 * @param {Map<string, Object>} options.bioViews
 * @returns {Map<string, Object>}
 */
export function planCellArea({ id, area, layout, bioViews }) {
  const plan = new Map()
  const write = (nodeId, patch) => plan.set(nodeId, patchBioView(plan.get(nodeId) ?? bioViews.get(nodeId), patch))
  const from = layout.get(id)
  if (from?.instance) closeUp(layout, from.site, id, write)
  else if (from?.kind === 'protein') {
    const parts = touchedParts(layout, [{ cell: from.cell, part: from.part }])
    for (const entry of parts.values()) entry.ids = entry.ids.filter((other) => other !== id)
    writeParts(parts, write)
  }
  const clears = Object.fromEntries([...BIND_CLEARS, 'site'].map((key) => [key, undefined]))
  write(id, { ...clears, role: area.role, cell: area.cellId })
  return plan
}

/**
 * The proteins on one part of a cell's membrane, in slot order.
 *
 * @param {Map<string, Object>} layout
 * @param {string} cell
 * @param {string} part - A facet of the cell's shape.
 * @returns {string[]}
 */
function onPart(layout, cell, part) {
  return [...layout]
    .filter(([, place]) => place.kind === 'protein' && place.cell === cell && place.part === part)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id]) => id)
}

/**
 * Gives each part of a cell's membrane that an edit touches, with its proteins as now drawn. Touching a
 * facet in a group (the lateral sides) touches the whole group, since proteins with no side are shared
 * between them by count.
 *
 * @param {Map<string, Object>} layout
 * @param {Array<{cell: string, part: string}>} touched
 * @returns {Map<string, {cell: string, part: string, ids: string[]}>} Keyed `${cell}/${part}`.
 */
function touchedParts(layout, touched) {
  const parts = new Map()
  const add = (cell, part) => parts.set(`${cell}/${part}`, { cell, part, ids: onPart(layout, cell, part) })
  for (const { cell, part } of touched) {
    const group = facetById(EPITHELIAL_SHAPE, part)?.group
    for (const each of group ? facetsInGroup(EPITHELIAL_SHAPE, group) : [part]) add(cell, each)
  }
  return parts
}

/**
 * Writes the order of every protein on each touched part, and the side of every one in a group (lateral),
 * so the result doesn't depend on how the rest would be sorted or shared out.
 *
 * @param {Map<string, Object>} parts - From touchedParts, after the edit.
 * @param {Function} write - (nodeId, patch).
 */
function writeParts(parts, write) {
  for (const { part, ids } of parts.values()) {
    const side = facetById(EPITHELIAL_SHAPE, part)?.group ? annotationOfFacet(EPITHELIAL_SHAPE, part)?.at : undefined
    const at = side ? { at: side } : {}
    ids.forEach((id, order) => write(id, { order, ...at }))
  }
}

/**
 * Plans dropping a node into a membrane slot: it takes the slot, the proteins after it move along,
 * and the part it left closes up.
 *
 * @param {Object} options
 * @param {string} options.id - The dropped node.
 * @param {{cellId: string, part: string, facet: string, at?: string, order: number}} options.slot - From nearestSlot.
 * @param {Map<string, Object>} options.layout - The layout before the drop.
 * @param {Map<string, Object>} options.roles - Node id -> resolveBioRole's result.
 * @param {Map<string, Object>} options.bioViews - Node id -> its data.bioView.
 * @returns {Map<string, Object>} Node id -> its new bioView.
 */
export function planSlotDrop({ id, slot, layout, roles, bioViews }) {
  const plan = new Map()
  const from = layout.get(id)
  const write = (nodeId, patch) => plan.set(nodeId, patchBioView(plan.get(nodeId) ?? bioViews.get(nodeId), patch))
  const isSameSlot =
    from?.kind === 'protein' &&
    !from.instance &&
    from.cell === slot.cellId &&
    from.part === slot.part &&
    onPart(layout, from.cell, from.part).indexOf(id) === slot.order
  if (isSameSlot) return plan

  // Leaving a template's site closes up its row there; leaving a node-owned cell's facet, below.
  if (from?.instance) closeUp(layout, from.site, id, write)
  const parts = touchedParts(layout, [
    ...(from?.kind === 'protein' && !from.instance ? [{ cell: from.cell, part: from.part }] : []),
    { cell: slot.cellId, part: slot.part },
  ])
  for (const entry of parts.values()) entry.ids = entry.ids.filter((other) => other !== id)
  const target = parts.get(`${slot.cellId}/${slot.part}`).ids
  target.splice(Math.min(slot.order, target.length), 0, id)
  writeParts(parts, write)

  const role = roles.get(id)?.role
  write(id, {
    cell: slot.cellId,
    facet: slot.facet,
    at: slot.facet === 'lateral' ? slot.at : undefined,
    position: undefined,
    site: undefined,
    // Dropped into a membrane, anything becomes a membrane protein.
    role: role === 'membraneProtein' ? bioViews.get(id)?.role : 'membraneProtein',
  })
  return plan
}

/**
 * Plans taking a protein out of its membrane, to wherever it was dropped.
 *
 * @param {Object} options
 * @param {string} options.id
 * @param {{x: number, y: number}} options.position - Its new top-left.
 * @param {Map<string, Object>} options.layout
 * @param {Map<string, Object>} options.bioViews
 * @returns {Map<string, Object>}
 */
export function planUnplace({ id, position, layout, bioViews }) {
  const plan = new Map()
  const write = (nodeId, patch) => plan.set(nodeId, patchBioView(plan.get(nodeId) ?? bioViews.get(nodeId), patch))
  const from = layout.get(id)
  if (from?.kind === 'protein') {
    const parts = touchedParts(layout, [{ cell: from.cell, part: from.part }])
    for (const entry of parts.values()) entry.ids = entry.ids.filter((other) => other !== id)
    writeParts(parts, write)
  }
  const patch = { facet: null, at: undefined, order: undefined, cell: undefined, position: whole(position) }
  plan.set(id, patchBioView(bioViews.get(id), patch))
  return plan
}

/**
 * The nodes in one row of a template's slot site as now drawn, in slot order.
 *
 * @param {Map<string, Object>} layout
 * @param {string} ref - The site.
 * @returns {string[]}
 */
function rowOf(layout, ref) {
  return [...layout]
    .filter(([, place]) => place.site === ref && (place.kind === 'protein' || place.kind === 'cytosolic'))
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id]) => id)
}

/**
 * Renumbers a template slot row with one node gone from it.
 *
 * @param {Map<string, Object>} layout
 * @param {string|null} ref
 * @param {string} id - The node leaving.
 * @param {Function} write - (nodeId, patch).
 */
function closeUp(layout, ref, id, write) {
  if (!ref) return
  rowOf(layout, ref)
    .filter((other) => other !== id)
    .forEach((other, order) => write(other, { order }))
}

/**
 * Gives the box a process area's cards and its spare slot take, a little grown: the rest of its zone is the
 * cell's.
 *
 * @param {Array<{x: number, y: number}>} slots - The cards' top-lefts.
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function cardsRect(slots) {
  const [first] = slots
  const right = Math.max(...slots.map((slot) => slot.x)) + CARD.width
  return { x: first.x - 8, y: first.y - 8, width: right - first.x + 16, height: CARD.height + 16 }
}

/**
 * Gives every template site as somewhere to drop: each slot of a facet or process area, taken (a drop goes
 * before its occupant) or spare (a drop goes last), and each area: a process area, a cell's membrane (the ring
 * along its outline), a cell's inside and a compartment.
 *
 * @param {Array<Object>} sites - From layoutPhysiology.
 * @param {string|null} [dragged] - A node being dragged: it leaves its own row, so the row's slots are where
 *   the rest are drawn and dropping it back where it was is no move.
 * @returns {Array<Object>} Each { type: 'slot'|'area', ref, role, kind, label, occupant, occupants, key } with,
 *   for a slot, its order, whether it is spare and its centre (x, y), a facet's also its edge and cellRect, and
 *   for an area, which area it is and its rect, a membrane's being its cell's.
 */
export function dropSites(sites, dragged = null) {
  const targets = []
  for (const site of sites) {
    const { ref, role, kind, label, key } = site
    const isInRow = kind === 'slots' && !!dragged && (site.occupants ?? []).includes(dragged)
    const occupants = (site.occupants ?? []).filter((id) => !isInRow || id !== dragged)
    const base = { ref, role, kind, label, key, occupants, occupant: site.occupant ?? null }
    if (kind === 'slots') {
      // A process area's slots are where its cards' corners go; a facet's are its proteins' centres.
      const centre = site.process ? ({ x, y }) => ({ x: x + CARD.width / 2, y: y + CARD.height / 2 }) : (slot) => slot
      // Without the dragged node a facet's row is spread out again; a process area's keeps its places.
      const slots = !isInRow
        ? site.slots
        : site.process
          ? site.slots.slice(0, -1)
          : facetSlots(site.cellRect, site.facet, occupants.length + 1, site.shape, {
              spare: false,
              widths: site.widths,
            })
      const facet = site.process ? {} : { edge: facetById(site.shape, site.facet)?.edge, cellRect: site.cellRect }
      slots.forEach((slot, order) =>
        targets.push({
          ...base,
          ...facet,
          type: 'slot',
          order,
          spare: !isInRow && !!slot.spare,
          ...centre(slot),
          occupant: occupants[order] ?? null,
        })
      )
      if (site.process) targets.push({ ...base, type: 'area', area: 'process', rect: cardsRect(site.slots) })
      continue
    }
    if (role === 'membrane') {
      targets.push({ ...base, type: 'area', area: 'membrane', rect: site.rect })
      continue
    }
    targets.push({ ...base, type: 'area', area: role === 'cytosol' ? 'cell' : 'compartment', rect: site.rect })
  }
  return targets
}

const contains = (rect, { x, y }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height

/** How far inside a rect a point is from one of its edges. */
function depthFrom(rect, edge, { x, y }) {
  if (edge === 'top') return y - rect.y
  if (edge === 'bottom') return rect.y + rect.height - y
  if (edge === 'left') return x - rect.x
  return rect.x + rect.width - x
}

/** Whether a point is on a cell's membrane: within its band either side of the rounded outline. */
const onMembrane = (rect, point) => Math.abs(leafletDistance(rect, point)) <= MEMBRANE_BAND_HALF

/** Whether a point is inside a cell's rounded outline, as drawn. */
const inCell = (rect, point) => leafletDistance(rect, point) <= 0

/** Whether an area holds a point: a membrane along its cell's outline, a cell inside it, any other inside its rect. */
function holds(target, point) {
  if (target.area === 'membrane') return onMembrane(target.rect, point)
  return target.area === 'cell' ? inCell(target.rect, point) : contains(target.rect, point)
}

/** Whether a point is on a slot's protein glyph (turned with its edge) or card. */
function onSlot(target, { x, y }) {
  const isUpright = target.edge !== 'left' && target.edge !== 'right'
  const [width, height] =
    target.role === 'cytosolic' ? [CARD.width, CARD.height] : isUpright ? [GLYPH_WIDTH, GLYPH_HEIGHT] : [GLYPH_HEIGHT, GLYPH_WIDTH]
  return Math.abs(x - target.x) <= width / 2 && Math.abs(y - target.y) <= height / 2
}

/**
 * The facet slot a point inside a cell goes to: within FACET_BAND of an edge with a facet on it, that facet's
 * nearest slot, the nearest edge's where the bands of two meet.
 *
 * @param {Array<Object>} targets - From dropSites.
 * @param {{x: number, y: number}} point
 * @returns {Object|null} The slot, with its distance.
 */
function bandSlot(targets, point) {
  let best = null
  for (const target of targets) {
    if (target.type !== 'slot' || !target.edge || !target.cellRect || !inCell(target.cellRect, point)) continue
    const depth = depthFrom(target.cellRect, target.edge, point)
    if (depth > FACET_BAND) continue
    const distance = Math.hypot(target.x - point.x, target.y - point.y)
    if (!best || depth < best.depth || (depth === best.depth && distance < best.distance))
      best = { target, depth, distance }
  }
  return best && { ...best.target, distance: best.distance }
}

/**
 * Finds where a point drops, most specific first: a slot whose glyph or card it is on, or within AREA_SNAP of;
 * a cell's membrane, within MEMBRANE_BAND_HALF of its outline; inside a cell within FACET_BAND of an edge with a
 * facet, that facet's nearest slot; else the areas holding it (a process area's cards, a cell's inside, a
 * compartment), the smallest of a kind. Out of every area, the nearest slot within snap.
 *
 * @param {Array<Object>} targets - From dropSites.
 * @param {{x: number, y: number}} point
 * @param {number} [snap=60]
 * @param {Object} [options]
 * @param {boolean} [options.areas=true] - Whether areas count, not just slots.
 * @param {boolean} [options.membrane=true] - Whether a membrane is a target at all: false for a protein, which
 *   should keep finding slots, even round a cell's corners.
 * @returns {Object|null} One of the targets, with distance for a slot.
 */
export function nearestSite(targets, point, snap = 60, { areas = true, membrane = true } = {}) {
  let best = null
  for (const target of targets) {
    if (target.type !== 'slot') continue
    const distance = Math.hypot(target.x - point.x, target.y - point.y)
    if (distance <= snap && (!best || distance < best.distance)) best = { ...target, distance }
  }
  if (!areas) return best
  if (best && best.distance <= AREA_SNAP) return best
  const covering = targets.find((target) => target.type === 'slot' && onSlot(target, point))
  if (covering) return { ...covering, distance: Math.hypot(covering.x - point.x, covering.y - point.y) }
  const ring =
    membrane && targets.find((target) => target.type === 'area' && target.area === 'membrane' && holds(target, point))
  if (ring) return ring
  const banded = bandSlot(targets, point)
  if (banded) return banded
  const rank = (target) => AREA_PRIORITY.indexOf(target.area)
  const size = ({ rect }) => rect.width * rect.height
  const area = targets
    .filter((target) => target.type === 'area' && target.rect && (membrane || target.area !== 'membrane'))
    .filter((target) => holds(target, point))
    .sort((a, b) => rank(a) - rank(b) || size(a) - size(b))[0]
  return area ?? best ?? null
}

/**
 * Plans binding a node to a template site. On a slot it takes that slot and the rest of the row moves along;
 * on a process area it goes at the end of the row. A one-module site's occupant is unbound to a card (a
 * protein to the tray), so the drop replaces it. The row the node left closes up.
 *
 * @param {Object} options
 * @param {string} options.id - The node bound.
 * @param {Object} options.site - From nearestSite.
 * @param {Map<string, Object>} options.layout - The layout before the drop.
 * @param {Map<string, Object>} options.roles - Node id -> resolveBioRole's result.
 * @param {Map<string, Object>} options.bioViews - Node id -> its data.bioView.
 * @returns {Map<string, Object>} Node id -> its new bioView.
 */
export function planSiteBind({ id, site, layout, roles, bioViews }) {
  const plan = new Map()
  const write = (nodeId, patch) => plan.set(nodeId, patchBioView(plan.get(nodeId) ?? bioViews.get(nodeId), patch))
  const from = layout.get(id)
  const isSameSlot =
    site.kind === 'slots' &&
    site.type === 'slot' &&
    from?.site === site.ref &&
    rowOf(layout, site.ref).indexOf(id) === site.order
  if (isSameSlot) return plan

  if (from?.instance && from.site !== site.ref) closeUp(layout, from.site, id, write)
  else if (from?.kind === 'protein' && !from.instance) {
    const parts = touchedParts(layout, [{ cell: from.cell, part: from.part }])
    for (const entry of parts.values()) entry.ids = entry.ids.filter((other) => other !== id)
    writeParts(parts, write)
  }

  write(id, { ...Object.fromEntries(BIND_CLEARS.map((key) => [key, undefined])), role: site.role, site: site.ref })
  if (site.kind === 'slots') {
    const row = rowOf(layout, site.ref).filter((other) => other !== id)
    row.splice(Math.min(site.order ?? row.length, row.length), 0, id)
    row.forEach((other, order) => write(other, { order }))
  } else {
    const occupant = site.occupant
    if (occupant && occupant !== id) write(occupant, unbound(occupant, roles, bioViews, true))
  }
  return plan
}

/**
 * The node a drop on a one-module site would replace: the one there, unless it is the node dropped.
 *
 * @param {Object|null} site - A drop target.
 * @param {string|null} id - The node dropped, or null for a new one.
 * @returns {string|null}
 */
export function replacedOccupant(site, id) {
  return site?.kind === 'single' && site.occupant && site.occupant !== id ? site.occupant : null
}

/**
 * The fields that unbind a node: no site or order, and a protein out of any membrane; replaced, anything else
 * becomes a card.
 */
function unbound(id, roles, bioViews, replaced = false) {
  const role = bioViews.get(id)?.role ?? roles?.get(id)?.role
  const patch = { site: undefined, order: undefined }
  if (role === 'membraneProtein') return { ...patch, facet: null }
  return replaced ? { ...patch, role: 'none' } : patch
}

/**
 * Plans unbinding a node from its template site: its row closes up, and it goes where its role puts it, a
 * protein to the tray at the given position.
 *
 * @param {Object} options
 * @param {string} options.id
 * @param {{x: number, y: number}} [options.position] - Its new top-left.
 * @param {Map<string, Object>} options.layout
 * @param {Map<string, Object>} [options.roles]
 * @param {Map<string, Object>} options.bioViews
 * @returns {Map<string, Object>}
 */
export function planUnbind({ id, position, layout, roles, bioViews }) {
  const plan = new Map()
  const write = (nodeId, patch) => plan.set(nodeId, patchBioView(plan.get(nodeId) ?? bioViews.get(nodeId), patch))
  const from = layout.get(id)
  if (from?.instance && (from.kind === 'protein' || from.kind === 'cytosolic')) closeUp(layout, from.site, id, write)
  write(id, { ...unbound(id, roles, bioViews), ...(position && { position: whole(position) }) })
  return plan
}

/**
 * Plans laying the whole view out again: every node goes back to the place its annotations and the
 * layout give it, keeping the user's role and glyph.
 *
 * @param {Map<string, Object>} bioViews - Node id -> its data.bioView.
 * @returns {Map<string, Object>} Only the nodes that change.
 */
export function planRelayout(bioViews) {
  const plan = new Map()
  for (const [id, bioView] of bioViews) {
    if (!bioView || !PLACEMENT_KEYS.some((key) => key in bioView)) continue
    plan.set(id, Object.fromEntries(Object.entries(bioView).filter(([key]) => !PLACEMENT_KEYS.includes(key))))
  }
  return plan
}

/**
 * The nodes a node dropped on a template site connects to: whatever occupies the sites next to it.
 *
 * @param {Array<Object>} targets - From dropSites.
 * @param {Array<{ref: string, relation: string}>} neighbours - The neighbouring sites (see siteNeighbours).
 * @param {Object} options
 * @param {string} options.id - The dropped node, never its own neighbour.
 * @param {Array<{source: string, target: string}>} [options.edges] - Pairs joined either way are left out.
 * @returns {Array<{id: string, ref: string, relation: string}>} In the neighbours' order, each node once.
 */
export function neighbourNodes(targets, neighbours, { id, edges = [] }) {
  const occupants = new Map()
  for (const target of targets) {
    const ids = target.kind === 'slots' ? target.occupants : [target.occupant]
    occupants.set(target.ref, new Set([...(occupants.get(target.ref) ?? []), ...ids.filter(Boolean)]))
  }
  const joined = new Set(
    edges.flatMap(({ source, target }) => (source === id ? [target] : target === id ? [source] : []))
  )
  const nodes = []
  const seen = new Set([id])
  for (const { ref, relation } of neighbours) {
    for (const other of occupants.get(ref) ?? []) {
      if (seen.has(other) || joined.has(other)) continue
      seen.add(other)
      nodes.push({ id: other, ref, relation })
    }
  }
  return nodes
}

/** The role a node-owned layout entry's kind is, as siteLinks reads it. */
const KIND_ROLES = { cell: 'cytosol', membrane: 'membrane', protein: 'membraneProtein', cytosolic: 'cytosolic', region: 'region' }

/**
 * The nodes a node on a node-owned cell (not a template's) connects to, as for a template site (see
 * siteNeighbours): a protein its cell, the cell's membrane and the compartments against its part; a membrane
 * its cell and the cell's proteins; a cell its membrane, proteins and processes; a process its cell; a
 * compartment the proteins on the parts it lies against.
 *
 * @param {Map<string, Object>} layout - From layoutPhysiology, after the node was placed.
 * @param {string} id
 * @param {Object} [options]
 * @param {Array<{source: string, target: string}>} [options.edges] - Pairs joined either way are left out.
 * @returns {{role: string|null, neighbours: Array<{id: string, relation: string}>}} role: the node's, for
 *   siteLinks; null, with no neighbours, for a node on no node-owned cell.
 */
export function ownedNeighbours(layout, id, { edges = [] } = {}) {
  const place = layout.get(id)
  const role = place && !place.instance ? (KIND_ROLES[place.kind] ?? null) : null
  if (!role) return { role: null, neighbours: [] }
  const owned = (kind, test) =>
    [...layout].filter(([, entry]) => entry.kind === kind && !entry.instance && test(entry)).map(([other]) => other)
  const isCell = (key) => {
    const cell = layout.get(key)
    return cell?.kind === 'cell' && !cell.instance
  }
  const membraneOf = (key) => (isCell(key) ? (layout.get(key).membrane ?? null) : null)
  const proteinsOn = (cell, part) => owned('protein', (entry) => entry.cell === cell && (!part || entry.part === part))
  const against = (entry) => (entry.adjacent ?? []).map(({ cell, facet, at }) => ({ cell, part: partOf(facet, at) }))

  const found = []
  const add = (ids, relation) => ids.forEach((other) => other && found.push({ id: other, relation }))
  if (place.kind === 'protein' && isCell(place.cell)) {
    add([place.cell], 'inside')
    add([membraneOf(place.cell)], 'membrane')
    const facing = (entry) => against(entry).some(({ cell, part }) => cell === place.cell && part === place.part)
    add(owned('region', facing), 'outside')
  } else if (place.kind === 'membrane' && isCell(place.cell)) {
    add([place.cell], 'inside')
    add(proteinsOn(place.cell), 'protein')
  } else if (place.kind === 'cell') {
    add([place.membrane], 'membrane')
    add(proteinsOn(id), 'protein')
    add(owned('cytosolic', (entry) => entry.cell === id), 'process')
  } else if (place.kind === 'cytosolic' && isCell(place.cell)) {
    add([place.cell], 'inside')
  } else if (place.kind === 'region') {
    for (const { cell, part } of against(place)) if (isCell(cell)) add(proteinsOn(cell, part), 'protein')
  }

  const joined = new Set(
    edges.flatMap(({ source, target }) => (source === id ? [target] : target === id ? [source] : []))
  )
  const seen = new Set([id])
  const neighbours = found.filter(({ id: other }) => {
    if (seen.has(other) || joined.has(other) || !layout.has(other)) return false
    seen.add(other)
    return true
  })
  return { role, neighbours }
}

/** The node types whose drag moves a whole structure; any other drag moves only the node dragged. */
export const STRUCTURE_TYPES = new Set(['bioCell', 'bioRegion', 'bioTemplateTitle', 'bioMembrane'])

/** Whether a node-owned region lies against one cell and nothing else. */
const liesOnlyAgainst = (place, cellId) =>
  place.kind === 'region' && !place.instance && !!place.adjacent?.length && place.adjacent.every((entry) => entry.cell === cellId)

/**
 * The other top-level pieces a structure's drag moves with it: a template's other cells and compartments and
 * its name, or the regions lying against only a node-owned cell. A cell's proteins and cards are its children,
 * so they follow it anyway. Any other node, such as a protein, card or node-owned region, moves alone.
 *
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {{id: string, type: string, data?: Object}} node - The dragged bio flow node; a membrane stands for its cell.
 * @returns {string[]} Node ids, without the dragged one.
 */
export function dragCompanions(layout, node) {
  if (!STRUCTURE_TYPES.has(node.type)) return []
  const id = node.type === 'bioMembrane' ? layout.get(node.id)?.cell : node.id
  const place = layout.get(id)
  const instance = node.type === 'bioTemplateTitle' ? node.data?.instance : place?.instance
  if (instance) {
    const pieces = [...layout]
      .filter(([, other]) => other.instance === instance && (other.kind === 'cell' || other.kind === 'region'))
      .map(([other]) => other)
    return [...pieces, `tpl:${instance}`].filter((other) => other !== id)
  }
  if (place?.kind !== 'cell') return []
  return [...layout].filter(([, other]) => liesOnlyAgainst(other, id)).map(([other]) => other)
}

/**
 * What a node-owned cell's move also changes: the cards in it kept at a position of their own, and the regions
 * lying against only it kept at a rect of their own, shift with it, so neither stays behind.
 *
 * @param {Object} options
 * @param {string} options.id - The cell.
 * @param {{x: number, y: number}} options.delta - How far it moved.
 * @param {Map<string, Object>} options.layout
 * @param {Map<string, Object>} options.bioViews
 * @returns {Map<string, Object>} Node id -> its new bioView.
 */
export function planCellMove({ id, delta, layout, bioViews }) {
  const plan = new Map()
  const { x: dx, y: dy } = whole(delta)
  if (!dx && !dy) return plan
  for (const [other, place] of layout) {
    const bioView = bioViews.get(other)
    if (place.kind === 'cytosolic' && place.cell === id && !place.instance && bioView?.position) {
      plan.set(other, patchBioView(bioView, { position: { x: bioView.position.x + dx, y: bioView.position.y + dy } }))
    } else if (liesOnlyAgainst(place, id) && bioView?.rect) {
      plan.set(other, patchBioView(bioView, { rect: { ...bioView.rect, x: bioView.rect.x + dx, y: bioView.rect.y + dy } }))
    }
  }
  return plan
}
