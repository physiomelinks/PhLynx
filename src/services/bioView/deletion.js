/**
 * Deleting in the physiological view: which instances a Delete key or menu item takes away, and taking them away
 * as the diagram's Delete does, as one undo step. A compartment, membrane or tube is its module, so deleting either,
 * in either view, takes both, with everything on the piece (see planDeletion).
 */

import { removePieces } from './pieces/edits.js'
import { PIECES_INSTANCE, layoutPieces } from './pieces/layout.js'
import { validatePieces } from './pieces/model.js'
import { modulesOf, piecesOrphanedBy } from './pieces/pairing.js'
import { topologyOf } from './pieces/topology.js'
import { parseSiteRef } from './siteRefs.js'

/**
 * Whether a key press asks to delete: Delete or Backspace, without a modifier that would make it another shortcut.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isDeleteKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return event.key === 'Delete' || event.key === 'Backspace'
}

/**
 * The instances a node's Delete item takes away: the selection when the node is in it, else the node alone.
 *
 * @param {string} id - The node the menu is on.
 * @param {Array<{id: string, selected?: boolean}>} nodes - The diagram's nodes.
 * @returns {Array<string>}
 */
export function deletionScope(id, nodes) {
  const selected = nodes.filter((node) => node.selected).map((node) => node.id)
  return selected.includes(id) ? selected : [id]
}

/**
 * Names a node's Delete item by what it takes away.
 *
 * @param {string} id
 * @param {Array<{id: string, selected?: boolean}>} nodes
 * @returns {string}
 */
export function deletionLabel(id, nodes) {
  const count = deletionScope(id, nodes).length
  return count > 1 ? `Delete Selection (${count})` : 'Delete'
}

/** Waits out the handles that turn ghost a tick after their edges go, so they land in the same step. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Deletes instances from the workspace with their edges, by the diagram's own path (vue-flow's removeNodes, which
 * the workspace records as it does a Delete there), as one undo step.
 *
 * @param {Array<string>} ids - Diagram node ids.
 * @param {Object} options
 * @param {Function} options.removeNodes - The diagram flow's removeNodes.
 * @param {Object} options.history - The history store.
 * @param {() => Promise<*>} [options.before] - Edits to make first, in the same step.
 * @param {() => Promise<*>} [options.after] - Edits to make once they have gone, in the same step.
 * @returns {Promise<boolean>} Whether anything was asked to go.
 */
export async function deleteInstances(ids, { removeNodes, history, before, after }) {
  if (!ids.length) return false
  history.startBatch()
  try {
    await before?.()
    removeNodes(ids, true)
    await settle()
    await after?.()
  } finally {
    history.endBatch('remove')
  }
  return true
}

/**
 * Deletes a connection by the diagram's own edge removal, re-deriving the couplings left at its ends, as one undo
 * step. A user's delete takes any edge, placement made it or not.
 *
 * @param {string} edgeId
 * @param {Object} options
 * @param {Function} options.disconnectInstances - Removes edges in the current step (see WorkspaceView).
 * @param {Object} options.history - The history store.
 * @returns {Promise<void>}
 */
export async function deleteConnection(edgeId, { disconnectInstances, history }) {
  history.startBatch()
  try {
    await disconnectInstances([edgeId])
  } finally {
    history.endBatch('remove-edge')
  }
}

/**
 * What deleting some modules and pieces takes: the pieces chosen and those whose module is among the modules chosen,
 * everything that goes with them (see removedWith), and every module on what goes. What it takes that was not chosen
 * is for asking about: the pieces that go with those chosen (a fold, which has no node to choose, goes unasked), and
 * the modules on the rows of what goes. The modules that are the pieces going are named by those pieces.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {Array<{id: string, data?: Object}>} nodes - The diagram's nodes.
 * @param {{instances?: Iterable<string>, pieces?: Iterable<string>}} chosen - Node ids and piece ids.
 * @returns {{next: ReadonlyArray<Object>|null, errors: string[], pieces: string[], going: string[],
 *   alongWith: string[], modulesToo: string[]}} next: the pieces left, null where no piece goes or the removal is
 *   invalid (errors say why); pieces: those asked to go; going: the node ids to delete; alongWith: piece ids;
 *   modulesToo: node ids.
 */
export function planDeletion(pieces, nodes, { instances = [], pieces: pieceIds = [] }) {
  const chosen = new Set(instances)
  const known = new Set(pieces.map((piece) => piece.id))
  const asked = [...new Set([...pieceIds, ...piecesOrphanedBy(pieces, nodes, chosen)])].filter((id) => known.has(id))
  const none = { next: null, errors: [], pieces: asked, going: [...chosen], alongWith: [], modulesToo: [] }
  if (!asked.length) return none
  // What a membrane deleted alone leaves standing stands where it is drawn.
  const { pieces: raw, removed } = removePieces(pieces, asked, { rects: layoutPieces(pieces).rects })
  const { pieces: next, errors } = validatePieces(raw)
  if (!next) return { ...none, errors: plainProblems(errors) }
  const offeredNow = new Set(topologyOf(pieces).sites.map((site) => site.path))
  const offered = new Set(topologyOf(next).sites.map((site) => site.path))
  const stranded = nodes
    .filter((node) => {
      const parsed = parseSiteRef(node.data?.bioView?.site)
      return parsed?.instance === PIECES_INSTANCE && offeredNow.has(parsed.path) && !offered.has(parsed.path)
    })
    .map((node) => node.id)
  const kindOf = new Map(pieces.map((piece) => [piece.id, piece.kind]))
  const named = modulesOf(pieces, nodes, removed)
  return {
    next,
    errors: [],
    pieces: asked,
    going: [...new Set([...chosen, ...stranded])],
    alongWith: [...removed].filter((id) => !asked.includes(id) && kindOf.get(id) !== 'fold'),
    modulesToo: stranded.filter((id) => !chosen.has(id) && !named.has(id)),
  }
}

/** A problem left by taking away part of a cell's inside, where the cell has no other inside along that stretch. */
const EMPTIED = /meets no compartment inside/

/**
 * Why a deletion can't be done, in the user's words: the validation's own, but for part of a cell's inside that would
 * leave a stretch of its membrane with nothing inside, which is said once, plainly.
 *
 * @param {string[]} errors - From validatePieces.
 * @returns {string[]}
 */
function plainProblems(errors) {
  const others = errors.filter((error) => !EMPTIED.test(error))
  if (others.length === errors.length) return errors
  return [
    'It is part of the inside of a cell with no other inside along that stretch of its membrane. Delete the membrane on its own first, or the whole cell.',
    ...others,
  ]
}

/**
 * What to ask before a deletion that takes what was not chosen (see planDeletion), or null when it takes nothing more.
 *
 * @param {{alongWith: string[], modulesToo: string[]}} plan
 * @param {Object} names
 * @param {(id: string) => string} names.pieceName
 * @param {(id: string) => string} names.nodeName
 * @returns {string|null}
 */
export function deletionMessage({ alongWith, modulesToo }, { pieceName, nodeName }) {
  if (!alongWith.length && !modulesToo.length) return null
  return [
    alongWith.length ? `${alongWith.map(pieceName).join(', ')} go${alongWith.length === 1 ? 'es' : ''} with it.` : '',
    modulesToo.length ? `These modules on it are deleted too: ${modulesToo.map(nodeName).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
