/**
 * Placeholders: the new, empty module each compartment, membrane and tube is given when it is made without one (see
 * pieces/pairing.js), since none is ever without a module. Each stands until a library module takes its place.
 */

import { NEW_INSTANCE_MODULE_REF } from '../../utils/constants.js'
import { sanitiseName } from '../../utils/identifiers.js'
import { isPlacementEdge } from './links.js'

/**
 * Whether a node is a placeholder still: an instance of the new module, its maths never saved as a module of its
 * own, joined only by the edges placement made.
 *
 * @param {{id: string, data?: Object}|undefined} node
 * @param {Array<{source: string, target: string, data?: Object}>} edges - The workspace's edges.
 * @returns {boolean}
 */
export function isPlaceholder(node, edges) {
  if (node?.data?.moduleRef !== NEW_INSTANCE_MODULE_REF) return false
  return edges.filter((edge) => edge.source === node.id || edge.target === node.id).every(isPlacementEdge)
}

/**
 * Names a placeholder after the piece it is on, as instance names are written, so the piece keeps its name while
 * it holds one: 'Cell 2' is Cell_2, and Cell_2_1 where that is taken.
 *
 * @param {string} label - The site's name.
 * @param {Iterable<string>} taken - Instance names in use.
 * @returns {string|null} Null when the label leaves no name, for the instance to keep its own.
 */
export function placeholderName(label, taken) {
  const base = sanitiseName(label ?? '')
  if (!base) return null
  const used = new Set(taken)
  let name = base
  for (let n = 1; used.has(name); n++) name = `${base}_${n}`
  return name
}
