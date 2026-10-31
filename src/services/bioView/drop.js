/**
 * What dropping something in the physiological view changes, as new data.bioView values. Nothing here
 * writes: the caller applies the plan as one undo step.
 */

import { CELL_RADIUS } from './metrics.js'
import { CARD } from './layout.js'
import { EPITHELIAL_SHAPE, annotationOfFacet, facetById, facetsInGroup } from './shape.js'

/** Fields that place a node; Re-layout clears them and keeps the user's choices of what it is. */
const PLACEMENT_KEYS = ['cell', 'facet', 'at', 'order', 'position', 'rect']

/** Fields binding to a template site clears: the site places the node instead. */
const BIND_CLEARS = ['position', 'rect', 'adjacent', 'cell', 'facet', 'at']

/** Size of the chip a cell's membrane site is dropped on, across the cell's bottom-left corner. */
export const MEMBRANE_CHIP = { width: 180, height: 28 }

/** Which area wins where several hold the drop point: the most specific first. */
const AREA_PRIORITY = ['process', 'membrane', 'cell', 'compartment']
/** Inside an area, a slot only wins this close, so drops in a lumen or cell don't snap to its membrane. */
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

/**
 * Gives every node-owned cell's slots as drop targets.
 *
 * @param {Map<string, Object>} layout - From layoutBioView.
 * @returns {Array<{id: string, rect: Object, counts: Object}>} For nearestSlot.
 */
export function dropTargets(layout) {
  const cells = new Map()
  const empty = () => Object.fromEntries(EPITHELIAL_SHAPE.facets.map(({ id: part }) => [part, 0]))
  // A template's cells offer their sites instead (dropSites).
  for (const [id, place] of layout)
    if (place.kind === 'cell' && !place.instance) cells.set(id, { id, rect: place.rect, counts: empty() })
  for (const place of layout.values()) if (place.kind === 'protein' && cells.has(place.cell)) cells.get(place.cell).counts[place.part]++
  return [...cells.values()]
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
  plan.set(id, patchBioView(bioViews.get(id), { facet: null, at: undefined, order: undefined, cell: undefined, position }))
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
 * Gives every template site as somewhere to drop: each slot of a facet or process area, spare or taken, and
 * each area: a process area, a cell's membrane chip, a cell's inside and a compartment.
 *
 * @param {Array<Object>} sites - From layoutPhysiology.
 * @returns {Array<Object>} Each { type: 'slot'|'area', ref, role, kind, label, occupant, occupants, key } with,
 *   for a slot, its order and centre (x, y), and for an area, which area it is and its rect.
 */
export function dropSites(sites) {
  const targets = []
  for (const site of sites) {
    const { ref, role, kind, label, key } = site
    const occupants = site.occupants ?? []
    const base = { ref, role, kind, label, key, occupants, occupant: site.occupant ?? null }
    if (kind === 'slots') {
      // A process area's slots are where its cards' corners go; a facet's are its proteins' centres.
      const centre = site.process ? ({ x, y }) => ({ x: x + CARD.width / 2, y: y + CARD.height / 2 }) : (slot) => slot
      site.slots.forEach((slot, order) =>
        targets.push({ ...base, type: 'slot', order, ...centre(slot), occupant: occupants[order] ?? null })
      )
      if (site.process) targets.push({ ...base, type: 'area', area: 'process', rect: site.rect })
      continue
    }
    if (role === 'membrane') {
      const { x, y, height } = site.rect
      const chip = { x: x + CELL_RADIUS - MEMBRANE_CHIP.width, y: y + height - MEMBRANE_CHIP.height / 2 }
      targets.push({ ...base, type: 'area', area: 'membrane', rect: { ...chip, ...MEMBRANE_CHIP } })
      continue
    }
    targets.push({ ...base, type: 'area', area: role === 'cytosol' ? 'cell' : 'compartment', rect: site.rect })
  }
  return targets
}

const contains = (rect, { x, y }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height

/**
 * Finds where a point drops: the nearest slot within reach, else the most specific area holding it (a process
 * area, then a membrane chip, a cell, a compartment), the smallest of those. Inside an area a slot only wins
 * within AREA_SNAP.
 *
 * @param {Array<Object>} targets - From dropSites.
 * @param {{x: number, y: number}} point
 * @param {number} [snap=60]
 * @param {Object} [options]
 * @param {boolean} [options.areas=true] - Whether areas count, not just slots.
 * @returns {Object|null} One of the targets, with distance for a slot.
 */
export function nearestSite(targets, point, snap = 60, { areas = true } = {}) {
  let best = null
  for (const target of targets) {
    if (target.type !== 'slot') continue
    const distance = Math.hypot(target.x - point.x, target.y - point.y)
    if (distance <= snap && (!best || distance < best.distance)) best = { ...target, distance }
  }
  if (!areas) return best
  const rank = (target) => AREA_PRIORITY.indexOf(target.area)
  const size = ({ rect }) => rect.width * rect.height
  const area = targets
    .filter((target) => target.type === 'area' && target.rect && contains(target.rect, point))
    .sort((a, b) => rank(a) - rank(b) || size(a) - size(b))[0]
  if (best && (!area || best.distance <= AREA_SNAP)) return best
  return area ?? null
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

  if (from?.instance && from.site !== site.ref) closeUp(layout, from.site, id, write)
  else if (from?.kind === 'protein' && !from.instance) {
    const parts = touchedParts(layout, [{ cell: from.cell, part: from.part }])
    for (const entry of parts.values()) entry.ids = entry.ids.filter((other) => other !== id)
    writeParts(parts, write)
  }

  const cleared = Object.fromEntries(BIND_CLEARS.map((key) => [key, undefined]))
  if (site.kind === 'slots') {
    const row = rowOf(layout, site.ref).filter((other) => other !== id)
    row.splice(Math.min(site.order ?? row.length, row.length), 0, id)
    row.forEach((other, order) => write(other, { order }))
  } else {
    const occupant = site.occupant
    if (occupant && occupant !== id) write(occupant, unbound(occupant, roles, bioViews, true))
  }
  write(id, { ...cleared, role: site.role, site: site.ref, ...(site.kind === 'slots' ? {} : { order: undefined }) })
  return plan
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
  write(id, { ...unbound(id, roles, bioViews), ...(position && { position }) })
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
