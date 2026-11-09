/**
 * The annotation fields an instance node's data may carry, saved with the workspace as they are:
 * - annotationOverlay: { heldConstant }, PhLynx-only state, e.g. a reservoir whose summed flows are held at 0.
 * Edits record these keys with useNodeDataHistory's recordEdit.
 */
export const ANNOTATION_NODE_KEYS = ['annotationOverlay']

/**
 * Node data fields kept when a node is rebuilt from a snapshot: the annotation fields.
 */
export const PRESERVED_NODE_KEYS = [...ANNOTATION_NODE_KEYS]

/**
 * The names of a node's variable rows: the variables its math has, which are all a side-car may give ports or
 * couplings to. Undefined for a node without rows, which is left unchecked.
 *
 * @param {Object} data - Node data.
 * @returns {Array<string>|undefined}
 */
export function variableNamesOf(data) {
  return Array.isArray(data?.variables) ? data.variables.map((row) => row.name) : undefined
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
