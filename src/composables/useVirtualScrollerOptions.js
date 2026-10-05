import { computed } from 'vue'

import { TABLE_VIRTUAL_SCROLL_MIN_ROWS, TABLE_ROW_HEIGHT_PX } from '../utils/constants'

/**
 * Virtual scrolling for a large DataTable.
 *
 * PrimeVue's scroller renders nothing when re-enabled after being disabled, so pass all rows, not
 * the filtered ones, and bind `tableKey` as the DataTable's key so it remounts when it does toggle.
 *
 * @param rows ref of all rows
 */
export function useVirtualScrollerOptions(rows) {
  const virtualScrollerOptions = computed(() =>
    rows.value.length > TABLE_VIRTUAL_SCROLL_MIN_ROWS ? { itemSize: TABLE_ROW_HEIGHT_PX } : undefined
  )
  const tableKey = computed(() => (virtualScrollerOptions.value ? 'virtual' : 'plain'))

  return { virtualScrollerOptions, tableKey }
}
