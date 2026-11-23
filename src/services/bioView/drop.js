/**
 * What dropping something in the physiological view changes, as new data.bioView values. Nothing here
 * writes: the caller applies the plan as one undo step.
 */

import {
  SYMBOL_HEIGHT,
  SYMBOL_WIDTH,
  MEMBRANE_BAND_HALF,
  facetSlots,
  foldPocket,
  foldPoint,
  leafletDistance,
} from './geometry.js'
import { processSize } from './layout.js'
import { FACET_BAND } from './metrics.js'
import { facetById } from './shape.js'

/**
 * Fields an older bioView may hold that nothing reads now: a stored role, and where a module was put on a cell or
 * against one that no piece drew. Any edit that places a node drops them.
 */
const RETIRED_KEYS = ['role', 'cell', 'facet', 'at', 'adjacent', 'rect', 'added']

/** Fields Re-layout clears: where a loose module was put, so it goes back to the tray or the cards. */
const PLACEMENT_KEYS = ['position', ...RETIRED_KEYS]

/** Fields binding to a site clears: the site places the node instead, and a slot gives its own order. */
const BIND_CLEARS = ['position', 'order', ...RETIRED_KEYS]

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
 * @param {{width: number, height: number}} size - How big each is drawn (see processSize).
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function cardsRect(slots, size) {
  const [first] = slots
  const right = Math.max(...slots.map((slot) => slot.x)) + size.width
  return { x: first.x - 8, y: first.y - 8, width: right - first.x + 16, height: size.height + 16 }
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
    // A site of the pieces names the place it is drawn on (its group), so its prompts show with that place's.
    const base = { ref, role, kind, label, key, occupants, occupant: site.occupant ?? null, ...(site.group && { group: site.group }) }
    if (kind === 'slots') {
      // A process area's slots are where its cards' corners go; a facet's are its proteins' centres.
      const size = processSize(site)
      const centre = site.process ? ({ x, y }) => ({ x: x + size.width / 2, y: y + size.height / 2 }) : (slot) => slot
      // Without the dragged node a facet's row is spread out again; a process area's keeps its places.
      const slots = !isInRow
        ? site.slots
        : site.process
          ? site.slots.slice(0, -1)
          : facetSlots(site.cellRect, site.facet, occupants.length + 1, site.shape, {
              spare: false,
              widths: site.widths,
            })
      const own = site.process ? null : facetById(site.shape, site.facet)
      const facet = site.process
        ? { ...(site.symbol && { symbol: true }) }
        : { edge: own?.edge, cellRect: site.cellRect, ...(own?.fold && { foldRect: foldReach(site.cellRect, own) }) }
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
      if (site.process) targets.push({ ...base, type: 'area', area: 'process', rect: cardsRect(site.slots, size) })
      continue
    }
    if (role === 'membrane') {
      targets.push({ ...base, type: 'area', area: 'membrane', rect: site.rect })
      continue
    }
    const inner = { ...(site.inner && { inner: true }), ...(site.joint && { joint: true }) }
    targets.push({ ...base, type: 'area', area: role === 'cytosol' ? 'cell' : 'compartment', rect: site.rect, ...inner })
  }
  return targets
}

/**
 * Gives the part of a cell a fold takes, walls and lumen, where a drop is one on the fold.
 *
 * @param {Object} rect - The cell.
 * @param {Object} facet - The fold, from the cell's shape.
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function foldReach(rect, facet) {
  const { edge, at, half, depth } = foldPocket(rect, facet)
  const reach = half + MEMBRANE_BAND_HALF
  const a = foldPoint(rect, edge, at - reach, 0)
  const b = foldPoint(rect, edge, at + reach, depth + MEMBRANE_BAND_HALF)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
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

/** Whether a point is on a slot's protein symbol (turned with its edge) or card. */
function onSlot(target, { x, y }) {
  const isUpright = target.edge !== 'left' && target.edge !== 'right'
  const [width, height] =
    target.role === 'cytosolic'
      ? [processSize(target).width, processSize(target).height]
      : isUpright
        ? [SYMBOL_WIDTH, SYMBOL_HEIGHT]
        : [SYMBOL_HEIGHT, SYMBOL_WIDTH]
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
 * Finds where a point drops, most specific first: a slot whose symbol or card it is on, or within AREA_SNAP of;
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
  // A link's joint lies across the membranes or tube ends it joins, so a drop on it is on it, before their slots.
  const joint = targets.find((target) => target.joint && contains(target.rect, point))
  if (joint) return joint
  if (best && best.distance <= AREA_SNAP) return best
  const covering = targets.find((target) => target.type === 'slot' && onSlot(target, point))
  if (covering) return { ...covering, distance: Math.hypot(covering.x - point.x, covering.y - point.y) }
  // On a fold, lumen or walls, the nearest place down its walls: a fold is membrane, though inside its cell's rect.
  const folded = targets
    .filter((target) => target.type === 'slot' && target.foldRect && contains(target.foldRect, point))
    .map((target) => ({ ...target, distance: Math.hypot(target.x - point.x, target.y - point.y) }))
    .sort((a, b) => a.distance - b.distance)[0]
  if (folded) return folded
  const ring =
    membrane && targets.find((target) => target.type === 'area' && target.area === 'membrane' && holds(target, point))
  if (ring) return ring
  const banded = bandSlot(targets, point)
  if (banded) return banded
  // A microdomain is within its cell, so it ranks with the cell's inside, and being the smaller, is chosen.
  const rank = (target) => AREA_PRIORITY.indexOf(target.inner ? 'cell' : target.area)
  const size = ({ rect }) => rect.width * rect.height
  const area = targets
    .filter((target) => target.type === 'area' && target.rect && (membrane || target.area !== 'membrane'))
    .filter((target) => holds(target, point))
    .sort((a, b) => rank(a) - rank(b) || size(a) - size(b))[0]
  return area ?? best ?? null
}

/**
 * Plans binding a node to a template site. On a slot it takes that slot and the rest of the row moves along;
 * on a process area it goes at the end of the row. A one-module site's occupant is unbound, drawn as its
 * annotations say, so the drop replaces it. The row the node left closes up.
 *
 * @param {Object} options
 * @param {string} options.id - The node bound.
 * @param {Object} options.site - From nearestSite.
 * @param {Map<string, Object>} options.layout - The layout before the drop.
 * @param {Map<string, Object>} options.bioViews - Node id -> its data.bioView.
 * @returns {Map<string, Object>} Node id -> its new bioView.
 */
export function planSiteBind({ id, site, layout, bioViews }) {
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

  write(id, { ...Object.fromEntries(BIND_CLEARS.map((key) => [key, undefined])), site: site.ref })
  if (site.kind === 'slots') {
    const row = rowOf(layout, site.ref).filter((other) => other !== id)
    row.splice(Math.min(site.order ?? row.length, row.length), 0, id)
    row.forEach((other, order) => write(other, { order }))
  } else {
    const occupant = site.occupant
    if (occupant && occupant !== id) write(occupant, UNBOUND)
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

/** The fields that unbind a node: no site or order, so its annotations say what it is. */
const UNBOUND = Object.freeze(Object.fromEntries(['site', 'order', ...RETIRED_KEYS].map((key) => [key, undefined])))

/**
 * Plans unbinding a node from its template site: its row closes up, and it is drawn as its annotations say, at the
 * given position.
 *
 * @param {Object} options
 * @param {string} options.id
 * @param {{x: number, y: number}} [options.position] - Its new top-left.
 * @param {Map<string, Object>} options.layout
 * @param {Map<string, Object>} options.bioViews
 * @returns {Map<string, Object>}
 */
export function planUnbind({ id, position, layout, bioViews }) {
  const plan = new Map()
  const write = (nodeId, patch) => plan.set(nodeId, patchBioView(plan.get(nodeId) ?? bioViews.get(nodeId), patch))
  const from = layout.get(id)
  if (from?.instance && (from.kind === 'protein' || from.kind === 'cytosolic')) closeUp(layout, from.site, id, write)
  write(id, { ...UNBOUND, ...(position && { position: whole(position) }) })
  return plan
}

/**
 * Plans laying the whole view out again: every loose module goes back to the tray or the cards, keeping its skin and
 * any site of the pieces it is on, with its slot there.
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
 * @param {Array<{ref: string, relation: string}>} neighbours - The neighbouring sites (see topologyOf().neighbours).
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

/** The node types whose drag moves a whole structure; any other drag moves only the node dragged. */
export const STRUCTURE_TYPES = new Set(['bioCell', 'bioRegion', 'bioMembrane'])
