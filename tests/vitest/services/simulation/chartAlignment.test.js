import { describe, expect, it } from 'vitest'

import { forgetChartGutters, reportChartGutter, widestChartGutters } from '../../../../src/services/simulation/chartAlignment.js'

describe('chartAlignment', () => {
  it('gives a group the widest gutters of its charts, and forgets a chart leaving it', () => {
    const [a, b] = [Symbol('a'), Symbol('b')]
    reportChartGutter('group', a, 'left', 40)
    reportChartGutter('group', a, 'right', 12)
    reportChartGutter('group', b, 'left', 64)
    reportChartGutter('other', b, 'left', 90)
    expect(widestChartGutters('group')).toEqual({ left: 64, right: 12 })

    forgetChartGutters('group', b)
    expect(widestChartGutters('group')).toEqual({ left: 40, right: 12 })
    forgetChartGutters('group', a)
    expect(widestChartGutters('group')).toEqual({ left: 0, right: 0 })
    expect(widestChartGutters('other')).toEqual({ left: 90, right: 0 })
  })
})
