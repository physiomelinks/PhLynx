import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

/**
 * The coupling suggestions shown on the canvas, derived from the workspace by useCouplingSuggestions. Never saved
 * and never in the undo history: recomputing them from the workspace gives them back.
 */
export const useSuggestionStore = defineStore('couplingSuggestions', () => {
  /** From suggestCouplings, each with a dismissKey (see useCouplingSuggestions). */
  const suggestions = shallowRef([])
  /** Owner or aggregator clashes the matcher found, for a later warning. */
  const conflicts = shallowRef([])
  /** Suggestions the user dismissed that would otherwise show, so they can be brought back. */
  const dismissed = shallowRef([])

  const count = computed(() => suggestions.value.length)

  /**
   * @param {Array<Object>} next
   * @param {Array<Object>} [nextConflicts]
   * @param {Array<Object>} [nextDismissed]
   */
  function setSuggestions(next, nextConflicts = [], nextDismissed = []) {
    suggestions.value = next
    conflicts.value = nextConflicts
    dismissed.value = nextDismissed
  }

  /**
   * Hides suggestions at once, e.g. on accept, before the next recompute drops them.
   *
   * @param {Array<string>} keys
   */
  function remove(keys) {
    const removed = new Set(keys)
    suggestions.value = suggestions.value.filter((suggestion) => !removed.has(suggestion.key))
  }

  function resetState() {
    suggestions.value = []
    conflicts.value = []
    dismissed.value = []
  }

  return { suggestions, conflicts, dismissed, count, setSuggestions, remove, resetState }
})
