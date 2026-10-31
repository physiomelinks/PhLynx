/**
 * A cell's shape: the facets of its membrane, each along one edge of its outline, and the process areas
 * inside it. Facets in the same group share proteins that have no side. A facet's annotation alias is the
 * only way an annotation's facet and side reach it; nothing is inferred.
 */

import { DEFAULT_TEMPLATE_ID, getBuiltInTemplate } from './builtInTemplates.js'

/**
 * Gives the shape of one of a template's cells.
 *
 * @param {Object} cell - A validated template's cell.
 * @returns {{facets: Array<{id: string, label: string, edge: string, group?: string,
 *   annotation?: {facet: string, at?: string}}>, processes: Array<{id: string, label: string}>}}
 */
export function shapeFromTemplateCell(cell) {
  const facets = (cell.facets ?? []).map(({ id, label, edge, group, annotation }) =>
    Object.freeze({
      id,
      label,
      edge,
      ...(group && { group }),
      ...(annotation && { annotation: Object.freeze({ ...annotation }) }),
    })
  )
  const processes = (cell.processes ?? []).map(({ id, label }) => Object.freeze({ id, label }))
  return Object.freeze({ facets: Object.freeze(facets), processes: Object.freeze(processes) })
}

/** The shape of the built-in epithelial cell: the geometry annotated cells are drawn with. */
export const EPITHELIAL_SHAPE = shapeFromTemplateCell(getBuiltInTemplate(DEFAULT_TEMPLATE_ID).cells[0])

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
    ({ annotation }) => annotation?.facet === facet && (annotation.at === undefined || annotation.at === at)
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
