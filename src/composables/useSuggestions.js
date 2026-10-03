import { computed, ref, toValue, watch } from 'vue'

/**
 * Keyboard-driven suggestion list for a text input, after the math editor's command list. Tab takes the highlighted
 * suggestion; Enter only does once an arrow key has picked one, so a new name that prefixes a known one is kept as typed.
 *
 * @param typed ref or getter of the input's text
 * @param suggest ref or getter of `(typed) => Array<string | { value: string, detail?: string }>`, or null for none
 * @param {{ onPick: (value: string) => void }} options
 */
export function useSuggestions(typed, suggest, { onPick }) {
  const toSuggestion = (item) =>
    typeof item === 'string' ? { value: item, detail: '' } : { value: item.value, detail: item.detail ?? '' }

  const isOpen = ref(false)
  const highlighted = ref(-1)
  const hasNavigated = ref(false)

  const matches = computed(() => {
    const getSuggestions = toValue(suggest)
    return isOpen.value && getSuggestions ? getSuggestions(toValue(typed) ?? '').map(toSuggestion) : []
  })

  watch(
    () => toValue(typed),
    () => {
      hasNavigated.value = false
      highlighted.value = matches.value.length ? 0 : -1
    }
  )

  /** Shows the list, e.g. as the user types. */
  function open() {
    if (isOpen.value) return
    isOpen.value = true
    hasNavigated.value = false
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
    onPick(choice.value)
  }

  function moveHighlight(step) {
    const count = matches.value.length
    if (!count) return
    highlighted.value = (highlighted.value + step + count) % count
    hasNavigated.value = true
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
    } else if (event.key === 'Tab' && highlighted.value >= 0) {
      pick(highlighted.value)
    } else if (event.key === 'Enter' && hasNavigated.value) {
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
