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
 * it holds one: 'Cell 2' is Cell_2, and Cell_2_2 where that is taken.
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
  // Numbered from 2, as the pieces' own labels are (Compartment, Compartment 2, …).
  for (let n = 2; used.has(name); n++) name = `${base}_${n}`
  return name
}

/**
 * Whether a module's name is still one placeholderName gave it for a piece's label, numbered or not.
 *
 * @param {string} name
 * @param {string} label
 * @returns {boolean}
 */
export function isPlaceholderNameFor(name, label) {
  const base = sanitiseName(label ?? '')
  // An instance name is letters, digits and underscores only, so the base needs no escaping.
  return !!base && (name === base || new RegExp(`^${base}_\\d+$`).test(name))
}

