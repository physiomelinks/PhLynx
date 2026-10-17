/**
 * The workspace search: finds instances by name or (with `var:`) by variable, highlights them and steps through them.
 * It searches the model (see useModelGraph), so modules inside super instances are found too; the canvas shows each match
 * as the node holding it (`canvasIdOf`), and `reveal` brings a match into view.
 */
import { computed, ref, watch } from 'vue'

import { SEARCH_MODES, findWorkspaceMatches, parseSearchQuery } from '../utils/workspaceSearch'

/**
 * Escapes a value for a double-quoted CSS string.
 *
 * @param {string} value
 * @returns {string}
 */
function cssString(value) {
  return String(value).replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')
}

/**
 * Builds the search state for a workspace.
 *
 * @param {Object} options
 * @param {import('vue').Ref<Array<Object>>} options.nodes - The model's nodes.
 * @param {Function} options.findNode - Gets a model node by id.
 * @param {Function} options.zoomToNode - Centres the view on a canvas node by id.
 * @param {(id: string) => string} [options.canvasIdOf] - The canvas node a model node shows as; itself by default.
 * @param {(id: string) => void} [options.reveal] - Brings a model node into view; by default, zooms to the canvas node
 *   it shows as.
 * @returns {Object} The query, its matches, and the actions the search bar binds to.
 */
export function useWorkspaceSearch({
  nodes: modelNodes,
  findNode,
  zoomToNode,
  canvasIdOf = (id) => id,
  reveal = (id) => zoomToNode(canvasIdOf(id)),
}) {
  const searchQuery = ref('')
  const matches = ref([])
  // -1 until the user steps to a match.
  const currentMatchIndex = ref(-1)
  const isSearchFocused = ref(false)
  const isPickerDismissed = ref(false)
  const pickerIndex = ref(0)

  const parsedQuery = computed(() => parseSearchQuery(searchQuery.value))
  const isActive = computed(() => parsedQuery.value.term !== '')
  const matchIds = computed(() => matches.value.map((match) => match.nodeId))
  const matchingNodeIds = computed(() => new Set(matchIds.value))
  // The canvas nodes showing a match.
  const matchingCanvasIds = computed(() => new Set(matchIds.value.map(canvasIdOf)))
  const matchCount = computed(() => (isActive.value ? matches.value.length : null))
  const matchingNodesList = computed(() =>
    matches.value.map((match) => ({ node: findNode(match.nodeId), variables: match.variables })).filter((match) => match.node)
  )
  const showModePicker = computed(() => isSearchFocused.value && !searchQuery.value && !isPickerDismissed.value)

  /**
   * Re-runs the search, optionally keeping the current match if it still matches.
   *
   * @param {Object} [options]
   * @param {boolean} [options.keepCurrent=false]
   */
  const runSearch = ({ keepCurrent = false } = {}) => {
    const currentId = matchIds.value[currentMatchIndex.value]
    matches.value = findWorkspaceMatches(modelNodes.value, parsedQuery.value)
    currentMatchIndex.value = keepCurrent ? matchIds.value.indexOf(currentId) : -1
  }

  const clearSearch = () => {
    searchQuery.value = ''
    runSearch()
  }

  /**
   * Makes a match current and brings it into view.
   *
   * @param {number} index
   */
  const selectMatch = (index) => {
    if (index < 0 || index >= matchIds.value.length) return
    currentMatchIndex.value = index
    reveal(matchIds.value[index])
  }

  const cycleToNextMatch = () => {
    const count = matchIds.value.length
    if (count) selectMatch((currentMatchIndex.value + 1) % count)
  }

  const cycleToPreviousMatch = () => {
    const count = matchIds.value.length
    if (count) selectMatch(currentMatchIndex.value <= 0 ? count - 1 : currentMatchIndex.value - 1)
  }

  /**
   * Starts a search in a mode: its prefix goes in the box, ready for the term.
   *
   * @param {number} index - Into SEARCH_MODES.
   */
  const pickMode = (index) => {
    searchQuery.value = SEARCH_MODES[index].prefix
    runSearch()
    isPickerDismissed.value = true
  }

  const onSearchFocus = () => {
    isSearchFocused.value = true
    isPickerDismissed.value = false
    pickerIndex.value = 0
  }

  const onSearchBlur = () => {
    isSearchFocused.value = false
  }

  /**
   * Handles the search box's keys: the mode picker's arrows and Enter while it shows (Tab too, unless the name
   * search is highlighted, so Tab still leaves the box), otherwise the arrows or Enter and Shift+Enter to step
   * through matches. Escape clears the box, or leaves it once empty.
   *
   * @param {KeyboardEvent} event
   */
  const onSearchKeydown = (event) => {
    if (showModePicker.value && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      pickerIndex.value = (pickerIndex.value + step + SEARCH_MODES.length) % SEARCH_MODES.length
    } else if (showModePicker.value && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey && pickerIndex.value > 0))) {
      event.preventDefault()
      pickMode(pickerIndex.value)
    } else if (event.key === 'Enter' || (matchIds.value.length && ['ArrowDown', 'ArrowUp'].includes(event.key))) {
      event.preventDefault()
      if (event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey)) cycleToPreviousMatch()
      else cycleToNextMatch()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (searchQuery.value) clearSearch()
      else event.target.blur?.()
    }
  }

  // A stylesheet keyed by node id, not a class per node: a class read in the node slot re-rendered every node on each keystroke.
  const highlightCss = computed(() => {
    if (!isActive.value) return ''
    const matchSelectors = [...matchingCanvasIds.value].map((id) => `.vue-flow__node[data-id="${cssString(id)}"] > .instance-node`)
    const dimmed = '.vue-flow__node > .instance-node { opacity: 0.25 !important; transition: opacity 0.2s ease; }'
    if (!matchSelectors.length) return dimmed
    return `${dimmed}\n${matchSelectors.join(',\n')} { opacity: 1 !important; outline: 3px solid var(--p-primary-color); outline-offset: 2px; border-radius: 4px; }`
  })

  // Emptying the box offers the modes again.
  watch(
    searchQuery,
    (query) => {
      if (!query) {
        isPickerDismissed.value = false
        pickerIndex.value = 0
      }
    },
    { flush: 'sync' }
  )

  // Track only the fields the search reads; a deep watch walked every node on each drag frame and selection change.
  watch(
    () => {
      if (!isActive.value) return ''
      const isVarMode = parsedQuery.value.mode === 'var'
      return modelNodes.value
        .map((n) => {
          const key = `${n.id}|${n.data?.name}|${n.data?.moduleRef}|${n.data?.mathRef}`
          if (!isVarMode) return key
          return `${key}|${(n.data?.variables ?? []).map((row) => `${row?.name}:${row?.type}:${row?.stateRole}`).join(',')}`
        })
        .join('\n')
    },
    () => {
      if (isActive.value) runSearch({ keepCurrent: true })
    }
  )

  return {
    searchQuery,
    parsedQuery,
    isActive,
    matchCount,
    matchingNodeIds,
    matchingNodesList,
    currentMatchIndex,
    isSearchFocused,
    showModePicker,
    pickerIndex,
    runSearch,
    clearSearch,
    selectMatch,
    cycleToNextMatch,
    cycleToPreviousMatch,
    pickMode,
    onSearchFocus,
    onSearchBlur,
    onSearchKeydown,
    highlightCss,
  }
}
