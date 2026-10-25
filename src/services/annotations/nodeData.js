/**
 * The annotation fields an instance node's data may carry, saved with the workspace as they are:
 * - apiCoord: { subject, coordIri, name }, the ApiCoord this instance is bound to;
 * - annotationOverlay: { heldConstant }, PhLynx-only state, e.g. a reservoir whose aggregators are fixed.
 * Edits to them record these keys with useNodeDataHistory's recordEdit.
 */
export const ANNOTATION_NODE_KEYS = ['apiCoord', 'annotationOverlay']

/**
 * Copies node data without its ApiCoord binding, for a copy that must not claim the same location.
 *
 * @param {Object} data - Node data.
 * @returns {Object}
 */
export function withoutApiCoord(data) {
  const { apiCoord, ...rest } = data ?? {}
  return rest
}
