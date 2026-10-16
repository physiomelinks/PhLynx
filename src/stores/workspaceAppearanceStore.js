import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { pruneAppearance, withEdgeAppearance } from '../utils/edges'

/** The workspace's appearance settings, saved as the file's optional `appearance` block. */
export const useWorkspaceAppearanceStore = defineStore('workspaceAppearance', () => {
  // The appearance new connections start with; only values differing from the built-in ones.
  const connectionDefaults = ref({})

  const isDefault = computed(() => Object.keys(connectionDefaults.value).length === 0)

  function resetState() {
    connectionDefaults.value = {}
  }

  /**
   * @param {Object} appearance - The appearance new connections get.
   */
  function setConnectionDefaults(appearance) {
    connectionDefaults.value = pruneAppearance(appearance)
  }

  /**
   * @param {Object} [state] - A saved `appearance` block; none resets.
   */
  function loadState(state) {
    if (!state) {
      resetState()
      return
    }
    setConnectionDefaults(state.connections)
  }

  function getState() {
    return { connections: { ...connectionDefaults.value } }
  }

  /**
   * Copies the default for a new connection, so later default changes leave it alone.
   *
   * @returns {Object}
   */
  function newConnectionAppearance() {
    return { ...connectionDefaults.value }
  }

  /**
   * Gives new edges the default appearance.
   *
   * @param {Array<Object>} edges - Not changed.
   * @returns {Array<Object>} Copies of the edges, with new data.
   */
  function withConnectionDefaults(edges) {
    return edges.map((edge) => ({ ...edge, data: withEdgeAppearance(edge.data, connectionDefaults.value) }))
  }

  return {
    connectionDefaults,
    isDefault,
    resetState,
    setConnectionDefaults,
    loadState,
    getState,
    newConnectionAppearance,
    withConnectionDefaults,
  }
})
