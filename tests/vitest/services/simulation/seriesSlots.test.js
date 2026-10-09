import { describe, expect, it } from 'vitest'

import { assignSeriesSlots, chunkSeries, resolveExperimentColour, SERIES_COLOURS, SLOT_COUNT } from '../../../../src/services/simulation/seriesSlots.js'

describe('assignSeriesSlots', () => {
  it('gives new series the lowest free slots, in order', () => {
    expect([...assignSeriesSlots(new Map(), ['a', 'b', 'c'])]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
  })

  it('keeps a series’ slot when another is unplotted or plotted', () => {
    const first = assignSeriesSlots(new Map(), ['a', 'b', 'c'])
    const withoutA = assignSeriesSlots(first, ['b', 'c'])
    expect(Object.fromEntries(withoutA)).toEqual({ b: 1, c: 2 })

    const withD = assignSeriesSlots(withoutA, ['d', 'b', 'c'])
    expect(Object.fromEntries(withD)).toEqual({ b: 1, c: 2, d: 0 })
  })
})

describe('chunkSeries', () => {
  it('splits series into charts of at most one colour each', () => {
    const series = Array.from({ length: SLOT_COUNT + 3 }, (_, i) => i)
    expect(chunkSeries(series).map((chart) => chart.length)).toEqual([SLOT_COUNT, 3])
    expect(chunkSeries([])).toEqual([])
  })
})

describe('resolveExperimentColour', () => {
  it('reads a matplotlib letter or a hex colour, alpha kept, and falls back to the slot colour', () => {
    expect(resolveExperimentColour('r', 0)).toBe('#e34948')
    expect(resolveExperimentColour('#ff000080', 0)).toBe('#ff000080')
    expect(resolveExperimentColour('#0f0', 0)).toBe('#0f0')
    expect(resolveExperimentColour('#12345', 1)).toBe(SERIES_COLOURS.light[1])
    expect(resolveExperimentColour(null, 9)).toBe(SERIES_COLOURS.light[1])
  })
})
