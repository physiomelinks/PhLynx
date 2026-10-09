import { describe, expect, it } from 'vitest'

import { findValueRange, interpolateTrace, sampleInput, writePolylinePoints } from '../../../../src/services/protocol/protocolPreview.js'

const TRACE = { t: [1, 2, 4], values: [0, 10, 0] }

describe('protocolPreview', () => {
  it('interpolates a trace as CA does, held at its ends', () => {
    expect([0, 1, 1.5, 3, 9].map((time) => interpolateTrace(TRACE, time))).toEqual([0, 0, 5, 5, 0])
  })

  it("samples an input over a window of its clock, with its points inside and its values at the window's ends", () => {
    expect(sampleInput({ kind: 'trace', trace: TRACE }, 1.5, 3)).toEqual({ t: [1.5, 2, 3], values: [5, 10, 5] })
    expect(sampleInput({ kind: 'constant', value: 2 }, 0, 4)).toEqual({ t: [0, 4], values: [2, 2] })
    expect(sampleInput({ kind: 'trace', trace: null }, 0, 1)).toBeNull()
  })

  it('finds a range with room around a flat line', () => {
    expect(findValueRange([{ values: [1, 3] }, null, { values: [2] }])).toEqual({ low: 1, high: 3 })
    expect(findValueRange([{ values: [2, 2] }])).toEqual({ low: 1, high: 3 })
    expect(findValueRange([])).toEqual({ low: 0, high: 1 })
  })

  it('draws samples in a box, the highest value at the top', () => {
    expect(writePolylinePoints({ t: [0, 1], values: [0, 10] }, { from: 0, to: 1, low: 0, high: 10, width: 100, height: 40, inset: 0 })).toBe('0.00,40.00 100.00,0.00')
  })
})
