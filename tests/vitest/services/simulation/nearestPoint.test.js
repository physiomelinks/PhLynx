import { describe, expect, it } from 'vitest'

import { findNearestPoint } from '../../../../src/services/simulation/nearestPoint.js'

const identity = (value) => value

describe('findNearestPoint', () => {
  it('finds the nearest point on a loop, where x goes back on itself', () => {
    // Around a unit circle: points at the same x on the top and the bottom.
    const angles = Array.from({ length: 360 }, (_, i) => (i * Math.PI) / 180)
    const xs = angles.map(Math.cos)
    const ys = angles.map(Math.sin)
    expect(findNearestPoint(xs, ys, identity, identity, 0, -1)).toBe(270)
    expect(findNearestPoint(xs, ys, identity, identity, 0, 1)).toBe(90)
  })

  it('measures in pixels, so the axes’ units don’t skew it', () => {
    const xs = [0, 1000]
    const ys = [0, 0.001]
    // x spans 1000 over 100 px and y spans 0.001 over 100 px: (1000, 0.001) is the point at (100, 100).
    expect(findNearestPoint(xs, ys, (x) => x / 10, (y) => y * 1e5, 90, 90)).toBe(1)
  })

  it('finds nothing beyond the radius, and skips missing values', () => {
    expect(findNearestPoint([0, 10], [0, 0], identity, identity, 5, 50, 20)).toBeNull()
    expect(findNearestPoint([0, NaN, 10], [0, 0, 0], identity, identity, 5, 0)).toBe(0)
  })

  it('finds the nearest of a very long series', () => {
    const count = 400001
    const xs = Float64Array.from({ length: count }, (_, i) => i)
    const ys = new Float64Array(count)
    expect(findNearestPoint(xs, ys, identity, identity, 123457.2, 0)).toBe(123457)
  })
})
