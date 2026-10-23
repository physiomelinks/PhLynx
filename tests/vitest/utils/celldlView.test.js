import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chooseOpenView, lastView, rememberView, resetViews } from '../../../src/utils/celldlView'

const BOUNDS = { left: 0, top: 0, right: 100, bottom: 50 }

describe('the view a CellDL diagram opens at', () => {
  it('is 100% for a blank diagram', () => {
    expect(chooseOpenView({ fitScale: null, bounds: null }, null)).toEqual({ zoom: 1 })
    expect(chooseOpenView({ fitScale: null, bounds: null }, { scale: 4, centre: { x: 0, y: 0 } })).toEqual({ zoom: 1 })
  })

  it('fits the diagram, at most 100%, with no last view more zoomed in than both', () => {
    const fit = { zoom: 'fit', maxScale: 1 }
    // Small: fit would zoom in past 100%
    expect(chooseOpenView({ fitScale: 3, bounds: BOUNDS }, null)).toEqual(fit)
    expect(chooseOpenView({ fitScale: 3, bounds: BOUNDS }, { scale: 2, centre: { x: 10, y: 10 } })).toEqual(fit)
    // Large: fit zooms out
    expect(chooseOpenView({ fitScale: 0.4, bounds: BOUNDS }, { scale: 0.8, centre: { x: 10, y: 10 } })).toEqual(fit)
    expect(chooseOpenView({ fitScale: 0.4, bounds: BOUNDS }, { scale: 1, centre: { x: 10, y: 10 } })).toEqual(fit)
  })

  it('restores a last view more zoomed in than both fit and 100%, centred where it was while that is on the diagram', () => {
    expect(chooseOpenView({ fitScale: 0.4, bounds: BOUNDS }, { scale: 1.5, centre: { x: 10, y: 20 } })).toEqual({
      zoom: 1.5,
      centre: { x: 10, y: 20 },
    })
    expect(chooseOpenView({ fitScale: 3, bounds: BOUNDS }, { scale: 4, centre: { x: 100, y: 50 } })).toEqual({
      zoom: 4,
      centre: { x: 100, y: 50 },
    })
    // Off the diagram now, so centred on it instead
    expect(chooseOpenView({ fitScale: 0.4, bounds: BOUNDS }, { scale: 1.5, centre: { x: 500, y: 20 } })).toEqual({ zoom: 1.5 })
  })
})

describe("each module's last CellDL view", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetViews()
  })

  afterEach(() => vi.restoreAllMocks())

  it('is remembered per module, and survives a reload through the browser storage', () => {
    rememberView('a.celldl', { scale: 2, centre: { x: 1, y: 2 }, fitScale: 1, bounds: null })
    rememberView('b.celldl', { scale: 3, centre: { x: 4, y: 5 } })
    resetViews()
    expect(lastView('a.celldl')).toEqual({ scale: 2, centre: { x: 1, y: 2 } })
    expect(lastView('b.celldl')).toEqual({ scale: 3, centre: { x: 4, y: 5 } })
    expect(lastView('c.celldl')).toBeNull()
    expect(lastView(null)).toBeNull()
  })

  it('ignores views it cannot use, and keeps working without storage', () => {
    rememberView('a.celldl', { scale: Number.NaN, centre: { x: 1, y: 2 } })
    rememberView(null, { scale: 2, centre: { x: 1, y: 2 } })
    expect(lastView('a.celldl')).toBeNull()

    window.localStorage.setItem('phlynx.celldl.views', '{"x": {"scale": 0}, "y": "junk"')
    resetViews()
    expect(lastView('x')).toBeNull()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    resetViews()
    rememberView('a.celldl', { scale: 2, centre: { x: 1, y: 2 } })
    expect(lastView('a.celldl')).toEqual({ scale: 2, centre: { x: 1, y: 2 } })
  })

  it('keeps the most recently viewed modules', () => {
    for (let index = 0; index < 205; index += 1) rememberView(`m${index}`, { scale: 2, centre: { x: index, y: 0 } })
    rememberView('m0', { scale: 2, centre: { x: 0, y: 0 } })
    resetViews()
    expect(lastView('m0')).not.toBeNull()
    expect(lastView('m5')).toBeNull()
    expect(lastView('m6')).not.toBeNull()
    expect(lastView('m204')).not.toBeNull()
  })
})
