import { computed, ref, toValue, watch } from 'vue'

/**
 * Keyboard-driven suggestion list for a text input, after the math editor's command list. Tab or Enter takes the
 * highlighted suggestion; Escape closes the list, so the text can be kept as typed.
 *
 * @param typed ref or getter of the input's text
 * @param suggest ref or getter of `(typed) => Array<string | { value: string, detail?: string, onPick?: () => void }>`,
 *   or null for none. An item's own `onPick` runs before its value is taken, e.g. to define a new units.
 * @param {{ onPick: (value: string) => void }} options
 */
export function useSuggestions(typed, suggest, { onPick }) {
  const toSuggestion = (item) => (typeof item === 'string' ? { value: item, detail: '' } : { ...item, detail: item.detail ?? '' })

  const isOpen = ref(false)
  const highlighted = ref(-1)

  const matches = computed(() => {
    const getSuggestions = toValue(suggest)
    return isOpen.value && getSuggestions ? getSuggestions(toValue(typed) ?? '').map(toSuggestion) : []
  })

  watch(
    () => toValue(typed),
    () => {
      highlighted.value = matches.value.length ? 0 : -1
    }
  )

  /** Shows the list, e.g. as the user types. */
  function open() {
    if (isOpen.value) return
    isOpen.value = true
    highlighted.value = matches.value.length ? 0 : -1
  }

  function close() {
    isOpen.value = false
    highlighted.value = -1
  }

  /** Takes the suggestion at `index` and closes the list. */
  function pick(index) {
    const choice = matches.value[index]
    if (choice === undefined) return
    close()
    choice.onPick?.()
    onPick(choice.value)
  }

  function moveHighlight(step) {
    const count = matches.value.length
    if (!count) return
    highlighted.value = (highlighted.value + step + count) % count
  }

  /**
   * Handles the list's keys.
   *
   * @param {KeyboardEvent} event
   * @returns {boolean} Whether the key was used, so the caller can skip its own handling.
   */
  function onKeydown(event) {
    if (!isOpen.value && event.key === 'ArrowDown' && toValue(suggest)) {
      open()
    } else if (!matches.value.length) {
      return false
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
    } else if ((event.key === 'Tab' || event.key === 'Enter') && highlighted.value >= 0) {
      pick(highlighted.value)
    } else if (event.key === 'Escape') {
      close()
    } else {
      return false
    }

    event.preventDefault()
    event.stopPropagation()
    return true
  }

  return { matches, highlighted, open, close, pick, onKeydown }
}
