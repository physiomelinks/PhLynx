import { describe, expect, it } from 'vitest'

import {
  CELL_RADIUS,
  FOLD,
  fitCellRect,
  foldPocket,
  slotPositions,
} from '../../../../../src/services/bioView/geometry.js'

const rect = { x: 0, y: 0, width: 600, height: 300 }
const shape = {
  facets: [
    { id: 'left-half', label: 'Left half', edge: 'top', from: 0, to: 0.5 },
    { id: 'right-half', label: 'Right half', edge: 'top', from: 0.5, to: 1 },
  ],
}

describe('a span along part of its side', () => {
  it('has its slots in its own stretch', () => {
    const [left] = slotPositions(rect, 'left-half', 1, shape)
    const [right] = slotPositions(rect, 'right-half', 1, shape)
    expect(left.x).toBeLessThan(300)
    expect(right.x).toBeGreaterThan(300)
    expect(left.y).toBe(0)
  })

  it('needs its whole side long enough for its row to fit its stretch', () => {
    const narrow = { facets: [{ id: 'tip', label: 'Tip', edge: 'top', from: 0, to: 0.25 }] }
    const whole = { facets: [{ id: 'tip', label: 'Tip', edge: 'top' }] }
    const counts = { tip: 4 }
    expect(fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, counts, narrow).width).toBeGreaterThan(
      fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, counts, whole).width,
    )
  })
})

describe('a fold at a point along its side', () => {
  it('dips in there, kept clear of the corners', () => {
    expect(foldPocket(rect, { fold: 'top', at: 0.5 }).at).toBe(300)
    expect(foldPocket(rect, { fold: 'top', at: 0 }).at).toBe(CELL_RADIUS + FOLD.margin + FOLD.width / 2)
    expect(foldPocket(rect, { fold: 'top', at: 1 }).at).toBe(600 - CELL_RADIUS - FOLD.margin - FOLD.width / 2)
  })

  it('dips in near the far end without one, as a template’s fold does', () => {
    expect(foldPocket(rect, { fold: 'top' }).at).toBe(600 - CELL_RADIUS - FOLD.margin - FOLD.width / 2)
  })
})
