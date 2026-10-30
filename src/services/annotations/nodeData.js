/**
 * The annotation fields an instance node's data may carry, saved with the workspace as they are:
 * - apiCoord: { subject, coordIri, name }, the ApiCoord this instance is bound to;
 * - annotationOverlay: { heldConstant }, PhLynx-only state, e.g. a reservoir whose aggregators are fixed.
 * Edits to them record these keys with useNodeDataHistory's recordEdit.
 */
export const ANNOTATION_NODE_KEYS = ['apiCoord', 'annotationOverlay']

/**
 * Node data fields kept when a node is rebuilt from a snapshot: the annotation fields, and bioView, the
 * node's place and look in the physiological view (see services/bioView/roles.js).
 */
export const PRESERVED_NODE_KEYS = [...ANNOTATION_NODE_KEYS, 'bioView']

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
 * Copies node data for a pasted copy: without the ApiCoord binding, since two instances at one ApiCoord
 * would conflict, and keeping only the user's role and glyph choices of its bioView, since its place
 * names nodes that the copy is not part of.
 *
 * @param {Object} data - Node data.
 * @returns {Object}
 */
export function nodeDataForCopy(data) {
  const { bioView, ...rest } = withoutApiCoord(data)
  const kept = Object.fromEntries(Object.entries(bioView ?? {}).filter(([key]) => key === 'role' || key === 'glyph'))
  return Object.keys(kept).length ? { ...rest, bioView: kept } : rest
}

/**
 * Copies the preserved fields of one node's data onto another's, e.g. when a node is rebuilt from a snapshot.
 *
 * @param {Object} data - The node data to fill.
 * @param {Object} from - The node data to copy them from.
 * @returns {Object} data, with the fields from has.
 */
export function withAnnotationData(data, from) {
  for (const key of PRESERVED_NODE_KEYS) if (from?.[key] !== undefined) data[key] = from[key]
  return data
}
