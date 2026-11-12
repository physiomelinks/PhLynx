/**
 * Deleting in the physiological view: which instances a Delete key or menu item takes away, and taking them away
 * as the diagram's Delete does, as one undo step.
 */

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
 * @returns {Promise<boolean>} Whether anything was asked to go.
 */
export async function deleteInstances(ids, { removeNodes, history }) {
  if (!ids.length) return false
  history.startBatch()
  try {
    removeNodes(ids, true)
    await settle()
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
