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

/** A cell's contents, as the layout places them: its membrane, its membrane's proteins and its processes. */
const CONTENT_KINDS = new Set(['membrane', 'protein', 'cytosolic'])

/**
 * Finds what is in the cells among the instances to delete, and would be left without one: the membrane, proteins
 * and processes of each cell that is a node of its own. A template's cell keeps its places when the module on it
 * goes, so what is on them stays put and is not counted.
 *
 * @param {Array<string>} ids - The instances to delete.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @returns {Array<string>} The ids of the contents that are not themselves being deleted.
 */
export function cellContents(ids, layout) {
  const going = new Set(ids)
  const cells = new Set(ids.filter((id) => layout.get(id)?.kind === 'cell' && !layout.get(id).instance))
  if (!cells.size) return []
  return [...layout]
    .filter(([id, place]) => !going.has(id) && CONTENT_KINDS.has(place.kind) && cells.has(place.cell))
    .map(([id]) => id)
}

/**
 * Works out the bioView changes that keep a deleted cell's contents where they are drawn, out of any cell: each
 * loses its cell and facet and takes its place as its own, so proteins wait in the tray and the rest as cards,
 * where the cell was.
 *
 * @param {Array<string>} contents - From cellContents.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {{width: number, height: number}} glyph - A protein's drawn size; its place is its centre.
 * @returns {Map<string, Object>} Node id -> the bioView fields to set (undefined removes one).
 */
export function releaseFromCell(contents, layout, glyph) {
  const patches = new Map()
  for (const id of contents) {
    const place = layout.get(id)
    const cell = layout.get(place.cell)?.rect ?? { x: 0, y: 0 }
    const at =
      place.kind === 'protein'
        ? { x: place.x - glyph.width / 2, y: place.y - glyph.height / 2 }
        : place.kind === 'cytosolic'
          ? { x: place.x, y: place.y }
          : { x: cell.x, y: cell.y }
    patches.set(id, {
      cell: undefined,
      facet: undefined,
      at: undefined,
      order: undefined,
      position: { x: Math.round(at.x), y: Math.round(at.y) },
    })
  }
  return patches
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
 * @returns {Promise<boolean>} Whether anything was asked to go.
 */
export async function deleteInstances(ids, { removeNodes, history, before }) {
  if (!ids.length) return false
  history.startBatch()
  try {
    await before?.()
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
