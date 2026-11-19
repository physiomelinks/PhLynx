/**
 * The build palette: what can be dragged or clicked onto the physiology view to build it up, and where on the
 * view a piece dropped there belongs.
 */

/** The media type a dragged tile travels under. */
export const TILE_DRAG_TYPE = 'application/x-phlynx-bio-tile'

/** The device setting that shows the templates written as pieces while they are being built (see isPiecesPreview). */
export const PIECES_PREVIEW_KEY = 'phlynx-bio-pieces-preview'

/**
 * Whether the palette offers the templates written as pieces (schema 4): always while developing, and elsewhere
 * where the device setting is '1'. They replace the templates and pieces above once the refactor is done.
 *
 * @returns {boolean}
 */
export function isPiecesPreview() {
  if (import.meta.env.DEV) return true
  try {
    return globalThis.localStorage?.getItem(PIECES_PREVIEW_KEY) === '1'
  } catch {
    return false
  }
}

/** The built-in template the Cell tile places: a plain cell to build on. */
export const BLANK_CELL_TEMPLATE = 'cell'

/** The built-in template the Tube tile places, away from any other: one stretch of vessel to build on. */
export const BLANK_TUBE_TEMPLATE = 'tube'

/**
 * The tiles, in the order shown: pieces to build on, each placed with a new, empty module on every site that takes
 * one module (see placeholders.js), for a library module to replace later. The pieces other than a cell or a tube
 * go on or beside a cell already placed. A cell's protein sites come with it, and
 * more are added from its menu.
 */
export const PALETTE_TILES = Object.freeze([
  { kind: 'cell', label: 'Cell', icon: 'pi pi-circle', hint: 'An empty cell, to drop a module on and build round: dropped beside a placed template, it joins it, to link to its other cells' },
  { kind: 'tube', label: 'Tube', icon: 'pi pi-minus', hint: 'A stretch of vessel or duct, placed where it is dropped: in the template nearest, or on its own' },
  { kind: 'link', label: 'Link', icon: 'pi pi-arrow-right-arrow-left', hint: 'What carries a flux between two spaces of a template, as a flow between two stretches of vessel or a gap junction between two cells: the two nearest the drop' },
  { kind: 'compartment', label: 'Compartment', icon: 'pi pi-stop', hint: 'An empty compartment against the side of the cell it is dropped beside' },
  { kind: 'organelle', label: 'Organelle', icon: 'pi pi-circle-fill', hint: 'An empty organelle inside the cell it is dropped on, with a membrane of its own' },
  { kind: 'microdomain', label: 'Microdomain', icon: 'pi pi-clone', hint: 'A space inside a cell under the side it is dropped by, or between an organelle and that side when dropped between them' },
  { kind: 'junction', label: 'Junction', icon: 'pi pi-arrows-v', hint: 'What carries a flux between two spaces inside a cell: the two microdomains it is dropped between, or the nearest and the cell’s own inside' },
  { kind: 'fold', label: 'Fold', icon: 'pi pi-arrow-down', hint: 'An invagination of the membrane, such as a T-tubule, in from the side of the cell it is dropped by' },
  { kind: 'zone', label: 'Process zone', icon: 'pi pi-box', hint: 'A place for processes inside a cell' },
])

/**
 * Finds the placed template's cell a point is on, or within a margin of: an organelle the point is on before the
 * cell it is in, and otherwise the nearest centre where several are.
 *
 * @param {Map<string, Object>} layout - The view's places, as layoutPhysiology gives them.
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @param {number} [margin] - How far outside a cell still counts, as its membrane and its sides' labels do.
 * @param {{ organelles?: boolean }} [options] - Whether an organelle counts; without, the cell it is in is found.
 * @returns {{key: string, instance: string, path: string, rect: Object, isOrganelle: boolean}|null}
 */
export function templateCellAt(layout, point, margin = 0, { organelles = true } = {}) {
  let found = null
  let nearest = Infinity
  for (const [key, place] of layout) {
    if (place.kind !== 'cell' || !place.instance || !place.path || !place.rect) continue
    if (place.parent && !organelles) continue
    const { x, y, width, height } = place.rect
    if (point.x < x - margin || point.x > x + width + margin || point.y < y - margin || point.y > y + height + margin) continue
    // An organelle lies wholly within its cell, so it is chosen ahead of any cell.
    const distance = Math.hypot(point.x - (x + width / 2), point.y - (y + height / 2)) - (place.parent ? 1e6 : 0)
    if (distance >= nearest) continue
    nearest = distance
    found = { key, instance: place.instance, path: place.path, rect: place.rect, isOrganelle: !!place.parent }
  }
  return found
}

/** Whether a place is a compartment lying against a cell. */
const isAttached = (place) => (place.kind === 'region' && place.form !== 'free' ? 1 : 0)

/** How far a point is from a rect: 0 inside it. */
const distanceTo = (rect, point) =>
  Math.hypot(
    Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width),
    Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height)
  )

/**
 * Finds the spaces of a placed template a link is dropped between: the space nearest the point and the nearest
 * other space of the same template, cells and compartments standing on their own ahead of compartments against a
 * cell; never one inside a cell.
 *
 * @param {Map<string, Object>} layout - The view's places, as layoutPhysiology gives them.
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @param {number} [reach] - How far from the point the first may be.
 * @returns {{instance: string, between: [string, string]}|{instance: string, between: [string]}|null} Paths in the
 *   template, nearest first; one only where the template has no other space; null with none in reach.
 */
export function linkEndsAt(layout, point, reach = Infinity) {
  const spaces = [...layout.values()]
    .filter((place) => place.instance && place.path && place.rect && !place.parent && (place.kind === 'cell' || place.kind === 'region'))
    .map((place) => ({ place, distance: distanceTo(place.rect, point) }))
    // Cells and spaces standing on their own first: a compartment against a cell reaches out round it, between
    // the cells a link is dropped between, and is linked from its menu (Link To) instead.
    .sort((a, b) => isAttached(a.place) - isAttached(b.place) || a.distance - b.distance)
  const first = spaces[0]
  if (!first || first.distance > reach) return null
  const other = spaces.find(({ place }) => place.instance === first.place.instance && place.path !== first.place.path)
  return { instance: first.place.instance, between: other ? [first.place.path, other.place.path] : [first.place.path] }
}

/**
 * Picks the side of a rect a point is nearest, among those offered.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {{x: number, y: number}} point
 * @param {Array<'top'|'bottom'|'left'|'right'>} edges - The sides to choose between.
 * @returns {string|null} Null when none is offered.
 */
export function nearestEdge(rect, point, edges) {
  const distances = {
    top: Math.abs(point.y - rect.y),
    bottom: Math.abs(point.y - (rect.y + rect.height)),
    left: Math.abs(point.x - rect.x),
    right: Math.abs(point.x - (rect.x + rect.width)),
  }
  return edges.reduce((best, edge) => (best === null || distances[edge] < distances[best] ? edge : best), null)
}
