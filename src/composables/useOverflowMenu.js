/**
 * Fitting a row of controls to its width: when they don't all fit, some are hidden, in a set order, for a menu to offer
 * instead. It measures rather than uses breakpoints, as which controls a row shows, and how wide they are, varies.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * Hides as few of a row's controls as fit it, and hides more or fewer as its width or contents change.
 *
 * @param {import('vue').Ref<HTMLElement|null>} rowRef The row, which overflows (rather than wraps or clips) when its
 *   controls don't fit.
 * @param {import('vue').Ref<Array<string>>} ids The ids of the controls that can be hidden, the first to go first.
 * @param {Function} [contents] Gives what, besides its width, changes how wide the row's controls are, such as a
 *   button's label, so the row is fitted again when it changes.
 * @returns {{hidden: import('vue').ComputedRef<Set<string>>, fit: Function}}
 */
export function useOverflowMenu(rowRef, ids, contents = () => null) {
  const hiddenCount = ref(0)
  const hidden = computed(() => new Set(ids.value.slice(0, hiddenCount.value)))

  // A later fit supersedes one still going, as the row has changed under it.
  let fitCount = 0

  /**
   * Shows every control, then hides them one by one until the row fits. Each step waits only for Vue to update the
   * DOM, not for the browser to paint, so the row is never seen part way.
   */
  async function fit() {
    const row = rowRef.value
    if (!row) return
    const thisFit = ++fitCount
    hiddenCount.value = 0
    await nextTick()
    while (thisFit === fitCount && hiddenCount.value < ids.value.length && row.scrollWidth > row.clientWidth) {
      hiddenCount.value++
      await nextTick()
    }
  }

  // Fitted again when what it can hide, or how wide its controls are, changes. Not on hiding, which fitting does.
  watch(() => [ids.value.join('\n'), contents()], fit, { flush: 'post', deep: true })

  let resizeObserver = null
  onMounted(() => {
    fit()
    // Its width only: hiding a control changes what is in the row, not how wide it is.
    if (typeof ResizeObserver === 'undefined' || !rowRef.value) return
    let lastWidth = null
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === lastWidth) return
      lastWidth = entry.contentRect.width
      fit()
    })
    resizeObserver.observe(rowRef.value)
  })
  onBeforeUnmount(() => resizeObserver?.disconnect())

  return { hidden, fit }
}
