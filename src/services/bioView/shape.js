/**
 * A cell's shape: the facets of its membrane, each along one edge of its outline, and the process areas
 * inside it. Facets in the same group share proteins that have no side. A facet's annotation alias is the
 * only way an annotation's facet and side reach it; nothing is inferred.
 */

/**
 * Gives a cell's shape from its facets and processes, frozen.
 *
 * @param {{facets?: Array<Object>, processes?: Array<Object>}} cell
 * @returns {{facets: Array<{id: string, label: string, edge: string, group?: string,
 *   annotation?: {facet: string, at?: string}}>, processes: Array<{id: string, label: string}>}}
 */
export function shapeOf(cell) {
  const facets = (cell.facets ?? []).map(({ id, label, edge, fold, depth, group, annotation }) =>
    Object.freeze({
      id,
      label,
      // A fold dips in from a side, in place of lying along one.
      ...(fold ? { fold, ...(depth && { depth }) } : { edge }),
      ...(group && { group }),
      ...(annotation && { annotation: Object.freeze({ ...annotation }) }),
    }),
  )
  const processes = (cell.processes ?? []).map(({ id, label }) => Object.freeze({ id, label }))
  return Object.freeze({ facets: Object.freeze(facets), processes: Object.freeze(processes) })
}

/**
 * Gives a shape with its folds as they are drawn: as deep as their proteins need, or a microdomain against them,
 * which a template's own depth is only the least of; and, with a microdomain between a fold and an organelle, its
 * proteins down the one wall that faces the organelle (`facing`), from where the organelle starts (`lead`).
 *
 * @param {Object} shape
 * @param {(facet: Object) => {depth?: number, lead?: number, facing?: boolean}|undefined} drawnAs - What changes of
 *   a fold; undefined to leave it.
 * @returns {Object} The same shape where no fold changes.
 */
export function withFolds(shape, drawnAs) {
  let changed = false
  const facets = shape.facets.map((facet) => {
    const drawn = facet.fold ? drawnAs(facet) : undefined
    if (!drawn || Object.entries(drawn).every(([key, value]) => facet[key] === value)) return facet
    changed = true
    return Object.freeze({ ...facet, ...drawn })
  })
  return changed ? Object.freeze({ ...shape, facets: Object.freeze(facets) }) : shape
}

/**
 * The shape of an epithelial cell: the geometry the cells a module owns (not built from pieces) are drawn with, and
 * that annotations name the sides of.
 */
export const EPITHELIAL_SHAPE = shapeOf({
  facets: [
    { id: 'apical', label: 'Apical membrane', edge: 'top', annotation: { facet: 'apical' } },
    { id: 'basolateral', label: 'Basolateral membrane', edge: 'bottom', annotation: { facet: 'basolateral' } },
    {
      id: 'lateral-left',
      label: 'Lateral membrane (left)',
      edge: 'left',
      group: 'lateral',
      annotation: { facet: 'lateral', at: 'left' },
    },
    {
      id: 'lateral-right',
      label: 'Lateral membrane (right)',
      edge: 'right',
      group: 'lateral',
      annotation: { facet: 'lateral', at: 'right' },
    },
  ],
  processes: [{ id: 'metabolism', label: 'Metabolism' }],
})

/**
 * @param {Object} shape
 * @param {string} facetId
 * @returns {Object|null} That facet of the shape.
 */
export function facetById(shape, facetId) {
  return shape.facets.find((facet) => facet.id === facetId) ?? null
}

/**
 * Finds the facet an annotation's facet and side name, through the facets' annotation aliases. A facet
 * whose alias has a side matches only that side, so a lateral facet with no side matches none.
 *
 * @param {Object} shape
 * @param {{facet: string, at?: string}} annotation
 * @returns {string|null} The facet's id.
 */
export function facetOfAnnotation(shape, { facet, at }) {
  const match = shape.facets.find(
    ({ annotation }) => annotation?.facet === facet && (annotation.at === undefined || annotation.at === at),
  )
  return match?.id ?? null
}

/**
 * Gives the annotation a facet stands for.
 *
 * @param {Object} shape
 * @param {string} facetId
 * @returns {{facet: string, at?: string}|null}
 */
export function annotationOfFacet(shape, facetId) {
  const annotation = facetById(shape, facetId)?.annotation
  if (!annotation) return null
  return annotation.at === undefined ? { facet: annotation.facet } : { facet: annotation.facet, at: annotation.at }
}

/**
 * @param {Object} shape
 * @param {string} group
 * @returns {string[]} The ids of the facets in that group, in the shape's order.
 */
export function facetsInGroup(shape, group) {
  return shape.facets.filter((facet) => facet.group === group).map((facet) => facet.id)
}
