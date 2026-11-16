/**
 * The facets of an epithelial cell's membrane that templates and the physiological view name, and the sides of
 * the lateral facet. They are names only: their order means nothing.
 */

/** The facets a membrane protein or a region can be placed on or against. */
export const FACETS = Object.freeze(['apical', 'lateral', 'basolateral'])

/** The sides of the lateral facet. */
export const LATERAL_SIDES = Object.freeze(['left', 'right'])

/**
 * @param {*} value
 * @returns {boolean} Whether `value` names a facet.
 */
export const isFacet = (value) => FACETS.includes(value)
