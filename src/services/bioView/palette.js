/**
 * The build palette: what can be dragged or clicked onto the physiology view to build it up, and where on the
 * view a piece dropped there belongs.
 */

/** The media type a dragged tile travels under. */
export const TILE_DRAG_TYPE = 'application/x-phlynx-bio-tile'

/** The built-in template the Cell tile places: a plain cell to build on. */
export const BLANK_CELL_TEMPLATE = 'cell'

/**
 * The tiles, in the order shown: empty pieces to drop modules on later, as a template's are. All but the cell go
 * on or beside a cell already placed.
 */
export const PALETTE_TILES = Object.freeze([
  { kind: 'cell', label: 'Cell', icon: 'pi pi-circle', hint: 'An empty cell, to drop a module on and build round' },
  { kind: 'compartment', label: 'Compartment', icon: 'pi pi-stop', hint: 'An empty compartment against the side of the cell it is dropped beside' },
  { kind: 'organelle', label: 'Organelle', icon: 'pi pi-circle-fill', hint: 'An empty organelle inside the cell it is dropped on, with a membrane of its own' },
  { kind: 'microdomain', label: 'Microdomain', icon: 'pi pi-clone', hint: 'A space inside a cell under the side it is dropped by, or between an organelle and that side when dropped between them' },
  { kind: 'fold', label: 'Fold', icon: 'pi pi-arrow-down', hint: 'An invagination of the membrane, such as a T-tubule, in from the side of the cell it is dropped by' },
  { kind: 'site', label: 'Protein site', icon: 'pi pi-plus', hint: 'A stretch of membrane for proteins, on the nearest free side of a cell or organelle' },
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
