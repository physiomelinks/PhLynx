/**
 * Opens a connection's dialog from outside the canvas, such as a super instance's broken couplings in the sidebar: the
 * workspace registers how it opens one, as a double-click on the edge does.
 */
import { shallowRef } from 'vue'

// The workspace's opener; none until it mounts.
const opener = shallowRef(null)

/**
 * Gives the way to open a connection's dialog, and to register it.
 *
 * @returns {{openEdgeDialog: (edgeId: string) => void, setEdgeDialogOpener: (open: Function|null) => void}}
 */
export function useEdgeDialog() {
  return {
    /** @param {string} edgeId - Selects the edge and opens its dialog; nothing while no workspace is there to. */
    openEdgeDialog: (edgeId) => opener.value?.(edgeId),
    /** @param {Function|null} open - The workspace's opener, or null as it unmounts. */
    setEdgeDialogOpener: (open) => (opener.value = open),
  }
}
