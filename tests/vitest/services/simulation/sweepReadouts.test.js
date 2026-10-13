import { describe, expect, it } from 'vitest'

import { READOUTS, reduceSeries } from '../../../../src/services/simulation/sweepReadouts.js'

describe('reduceSeries', () => {
  const course = Float64Array.of(0, -3, 2, 1)

  it.each([
    ['end', 1],
    ['min', -3],
    ['max', 2],
    ['peak', -3],
  ])('reads a time course’s %s', (readout, expected) => {
    expect(reduceSeries(course, course.length, readout)).toBe(expected)
  })

  it('keeps the sign of the peak, and takes the first of two as far from 0', () => {
    expect(reduceSeries(Float64Array.of(1, 4, -2), 3, 'peak')).toBe(4)
    expect(reduceSeries(Float64Array.of(-4, 4), 2, 'peak')).toBe(-4)
  })

  it('reads a peak as NaN when the time course has a NaN, as min and max are', () => {
    const course = Float64Array.of(1, Number.NaN, -5)
    for (const readout of ['min', 'max', 'peak']) expect(reduceSeries(course, 3, readout)).toBeNaN()
  })

  it('reads only the values the run computed', () => {
    const longer = Float64Array.of(1, 2, 9, 9)
    expect(reduceSeries(longer, 2, 'end')).toBe(2)
    expect(reduceSeries(longer, 2, 'max')).toBe(2)
  })

  it('reads a single value as itself, and nothing as NaN', () => {
    for (const { id } of READOUTS) expect(reduceSeries(Float64Array.of(5), 1, id)).toBe(5)
    expect(reduceSeries(new Float64Array(), 0, 'end')).toBeNaN()
  })
})
