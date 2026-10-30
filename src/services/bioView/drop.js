/**
 * What dropping something in the physiological view changes, as new data.bioView values. Nothing here
 * writes: the caller applies the plan as one undo step.
 */

import { FACET_PARTS } from './geometry.js'

/** Fields that place a node; Re-layout clears them and keeps the user's choices of what it is. */
const PLACEMENT_KEYS = ['cell', 'facet', 'at', 'order', 'position', 'rect']

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
 * Gives every cell's slots as drop targets.
 *
 * @param {Map<string, Object>} layout - From layoutBioView.
 * @returns {Array<{id: string, rect: Object, counts: Object}>} For nearestSlot.
 */
export function dropTargets(layout) {
  const cells = new Map()
  for (const [id, place] of layout) if (place.kind === 'cell') cells.set(id, { id, rect: place.rect, counts: Object.fromEntries(FACET_PARTS.map((part) => [part, 0])) })
  for (const place of layout.values()) if (place.kind === 'protein' && cells.has(place.cell)) cells.get(place.cell).counts[place.part]++
  return [...cells.values()]
}

/**
 * The proteins on one part of a cell's membrane, in slot order.
 *
 * @param {Map<string, Object>} layout
 * @param {string} cell
 * @param {string} part - One of FACET_PARTS.
 * @returns {string[]}
 */
function onPart(layout, cell, part) {
  return [...layout]
    .filter(([, place]) => place.kind === 'protein' && place.cell === cell && place.part === part)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id]) => id)
}

/**
 * Gives each part of a cell's membrane that an edit touches, with its proteins as now drawn. Touching
 * either lateral side touches both, since proteins with no side are shared between them by count.
 *
 * @param {Map<string, Object>} layout
 * @param {Array<{cell: string, part: string}>} touched
 * @returns {Map<string, {cell: string, part: string, ids: string[]}>} Keyed `${cell}/${part}`.
 */
function touchedParts(layout, touched) {
  const parts = new Map()
  const add = (cell, part) => parts.set(`${cell}/${part}`, { cell, part, ids: onPart(layout, cell, part) })
  for (const { cell, part } of touched) {
    if (part.startsWith('lateral-')) {
      add(cell, 'lateral-left')
      add(cell, 'lateral-right')
    } else {
      add(cell, part)
    }
  }
  return parts
}

/**
 * Writes the order of every protein on each touched part, and the side of every lateral one, so the
 * result doesn't depend on how the rest would be sorted or shared out.
 *
 * @param {Map<string, Object>} parts - From touchedParts, after the edit.
 * @param {Function} write - (nodeId, patch).
 */
function writeParts(parts, write) {
  for (const { part, ids } of parts.values()) {
    const at = part.startsWith('lateral-') ? { at: part.slice('lateral-'.length) } : {}
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

  const parts = touchedParts(layout, [
    ...(from?.kind === 'protein' ? [{ cell: from.cell, part: from.part }] : []),
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
