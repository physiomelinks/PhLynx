import { computed, nextTick, reactive } from 'vue'
import { describe, expect, it } from 'vitest'

import { useIssueFilter } from '../../../src/composables/useIssueFilter.js'

const MATCHERS = {
  units: (row) => !row.units,
  values: (row) => row.value === '',
}

/** A filter over `rows`, offering each key while some row has that issue. */
function createFilter(rows) {
  const availableKeys = computed(() => Object.keys(MATCHERS).filter((key) => rows.some(MATCHERS[key])))
  return useIssueFilter({ rows: computed(() => rows), matchers: MATCHERS, availableKeys })
}

const shownNames = (rows, filter) => rows.filter(filter.isShown).map((row) => row.name)

describe('useIssueFilter', () => {
  it('shows every row until a key is selected, then only the rows with that issue', async () => {
    const rows = reactive([
      { name: 'a', units: 'metre', value: '1' },
      { name: 'b', units: '', value: '1' },
      { name: 'c', units: 'metre', value: '' },
    ])
    const filter = createFilter(rows)
    expect(shownNames(rows, filter)).toEqual(['a', 'b', 'c'])

    filter.toggle('units')
    await nextTick()
    expect(shownNames(rows, filter)).toEqual(['b'])

    filter.toggle('values')
    await nextTick()
    expect(shownNames(rows, filter)).toEqual(['b', 'c'])

    filter.reset()
    await nextTick()
    expect(shownNames(rows, filter)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a row shown once its issue is fixed while another row still has it', async () => {
    const rows = reactive([
      { name: 'a', units: '', value: '1' },
      { name: 'b', units: '', value: '1' },
      { name: 'c', units: 'metre', value: '1' },
    ])
    const filter = createFilter(rows)
    filter.toggle('units')
    await nextTick()

    rows[0].units = 'metre'
    await nextTick()
    expect(shownNames(rows, filter)).toEqual(['a', 'b'])
  })

  it('shows a row added with the issue while the filter is on', async () => {
    const rows = reactive([
      { name: 'a', units: '', value: '1' },
      { name: 'b', units: 'metre', value: '1' },
    ])
    const filter = createFilter(rows)
    filter.toggle('units')
    await nextTick()

    rows.push({ name: 'new_var', units: '', value: '' })
    await nextTick()
    expect(shownNames(rows, filter)).toEqual(['a', 'new_var'])
  })

  it('switches a key off once no row has its issue, showing every row again', async () => {
    const rows = reactive([
      { name: 'a', units: '', value: '1' },
      { name: 'b', units: 'metre', value: '1' },
    ])
    const filter = createFilter(rows)
    filter.toggle('units')
    await nextTick()

    rows[0].units = 'metre'
    await nextTick()
    expect(filter.selected.value).toEqual([])
    expect(filter.activeKeys.value).toEqual([])
    expect(shownNames(rows, filter)).toEqual(['a', 'b'])
  })

  it('ignores a selected key that has no rows', async () => {
    const rows = reactive([{ name: 'a', units: 'metre', value: '1' }])
    const filter = createFilter(rows)
    filter.toggle('units')
    await nextTick()

    expect(filter.activeKeys.value).toEqual([])
    expect(shownNames(rows, filter)).toEqual(['a'])
  })
})
