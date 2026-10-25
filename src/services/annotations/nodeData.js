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

/**
 * Copies the annotation fields of one node's data onto another's, e.g. when a node is rebuilt from a snapshot.
 *
 * @param {Object} data - The node data to fill.
 * @param {Object} from - The node data to copy them from.
 * @returns {Object} data, with the fields from has.
 */
export function withAnnotationData(data, from) {
  for (const key of ANNOTATION_NODE_KEYS) if (from?.[key] !== undefined) data[key] = from[key]
  return data
}
