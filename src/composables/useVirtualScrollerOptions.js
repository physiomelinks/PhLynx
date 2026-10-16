import { computed, watch } from 'vue'

import { TABLE_VIRTUAL_SCROLL_MIN_ROWS, TABLE_ROW_HEIGHT_PX } from '../utils/constants'

/**
 * Virtual scrolling for a large DataTable.
 *
 * PrimeVue's scroller renders nothing when re-enabled after being disabled, so pass all rows, not
 * the filtered ones, and bind `tableKey` as the DataTable's key so it remounts when it does toggle.
 * Given the shown rows and the table, it scrolls back to the top when a search or filter shrinks them.
 *
 * @param rows ref of all rows
 * @param options.shownRows ref of the rows the table shows
 * @param options.tableRef  template ref of the DataTable
 */
export function useVirtualScrollerOptions(rows, { shownRows, tableRef } = {}) {
  const virtualScrollerOptions = computed(() =>
    rows.value.length > TABLE_VIRTUAL_SCROLL_MIN_ROWS ? { itemSize: TABLE_ROW_HEIGHT_PX } : undefined
  )
  const tableKey = computed(() => (virtualScrollerOptions.value ? 'virtual' : 'plain'))

  // The scroller keeps its first row and offset when its rows shrink. Firefox sends no scroll event to
  // update them, so send one.
  if (shownRows && tableRef) {
    watch(
      () => shownRows.value.length,
      (length, previousLength) => {
        if (!virtualScrollerOptions.value || length >= previousLength) return
        const scroller = tableRef.value?.getVirtualScrollerRef?.()
        if (!scroller?.$el) return
        scroller.scrollToIndex(0)
        scroller.$el.dispatchEvent(new Event('scroll'))
      },
      { flush: 'post' }
    )
  }

  return { virtualScrollerOptions, tableKey }
}
