import { computed, ref, watch } from 'vue'

/**
 * "Show only rows with issue X" for the parameter table.
 *
 * @param rows        ref of all rows
 * @param matchers    { [key]: (row) => boolean }, one per kind of issue
 * @param availableKeys ref of the keys that currently have at least one row. A filter whose issue has
 *                      been fully resolved switches itself off.
 */
export function useIssueFilter({ rows, matchers, availableKeys }) {
  const selected = ref([])

  const activeKeys = computed(() => selected.value.filter((key) => availableKeys.value.includes(key)))

  function toggle(key) {
    selected.value = selected.value.includes(key)
      ? selected.value.filter((k) => k !== key)
      : [...selected.value, key]
  }

  function reset() {
    selected.value = []
  }

  const matches = computed(() => {
    const keys = activeKeys.value
    if (keys.length === 0) return new Set()

    const hits = rows.value.filter((row) => keys.some((key) => matchers[key](row)))
    const names = new Set(hits.map((row) => row.name))
    return names
  })

  const sticky = ref(new Set())

  watch(
    () => activeKeys.value.join(','),
    () => {
      sticky.value = new Set(matches.value)
    }
  )

  watch(matches, (names) => {
    if (activeKeys.value.length === 0) return
    const next = new Set(sticky.value)
    names.forEach((name) => next.add(name))
    if (next.size !== sticky.value.size) sticky.value = next
  })

  // Drop any selected keys that are no longer available (e.g. if the user fixed all issues of that type).
  watch(availableKeys, (keys) => {
    const kept = selected.value.filter((key) => keys.includes(key))
    if (kept.length !== selected.value.length) selected.value = kept
  })

  const isShown = (row) => activeKeys.value.length === 0 || sticky.value.has(row.name) || matches.value.has(row.name)

  return {
    selected,
    activeKeys,
    toggle,
    reset,
    isShown
  }
}
