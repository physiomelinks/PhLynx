import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'
import { indexAt, useVoiCursorStore } from '../../../src/stores/voiCursorStore.js'

const run = (values, extra = {}) => ({
  voi: { name: 't', unit: 's', values: Float64Array.from(values) },
  variables: new Map(),
  ...extra,
})

describe('the VoI cursor', () => {
  let cursor
  let results

  beforeEach(() => {
    setActivePinia(createPinia())
    results = useSimulationResultsStore()
    cursor = useVoiCursorStore()
    results.results = run([0, 1, 2, 3, 4])
  })

  it('finds the last point at or before a value', () => {
    const values = [0, 1, 2, 4]
    expect([-1, 0, 0.5, 1, 3.9, 4, 9].map((value) => indexAt(values, value))).toEqual([0, 0, 0, 1, 2, 3, 3])
  })

  it('sits at the end of the run until moved', () => {
    expect(cursor.range).toEqual([0, 4])
    expect(cursor.index).toBe(4)
    expect(cursor.value).toBe(4)
    expect(cursor.isActive).toBe(false)
    cursor.seek(1)
    expect([cursor.index, cursor.value, cursor.isActive]).toEqual([1, 1, true])
    cursor.step(2)
    expect(cursor.index).toBe(3)
    cursor.step(10)
    expect(cursor.index).toBe(4)
  })

  it('has nothing to follow with no run, a run of one point or a sweep', () => {
    for (const none of [null, run([0]), run([0, 1, 2], { isSweep: true })]) {
      results.results = none
      expect(cursor.voi).toBeNull()
      expect(cursor.index).toBeNull()
      cursor.play()
      expect(cursor.isPlaying).toBe(false)
    }
  })

  it('plays the window through in the time set, stopping at its end', () => {
    cursor.playSeconds = 4
    cursor.play()
    // From the end, it starts again at the start.
    expect([cursor.isPlaying, cursor.index]).toEqual([true, 0])
    cursor.advance(1)
    expect(cursor.value).toBe(1)
    cursor.advance(0.5)
    // Between two points it shows the one it has passed.
    expect(cursor.index).toBe(1)
    cursor.advance(0.5)
    expect(cursor.index).toBe(2)
    cursor.advance(5)
    expect([cursor.isPlaying, cursor.index]).toEqual([false, 4])
  })

  it('starts again at the window’s end while looping', () => {
    cursor.playSeconds = 4
    cursor.isLooping = true
    cursor.seek(3)
    cursor.play()
    cursor.advance(2)
    expect([cursor.isPlaying, cursor.index]).toEqual([true, 1])
  })

  it('keeps to a window of the run, and to the whole of it again', () => {
    cursor.setWindow({ from: 0.5, to: 3 })
    expect(cursor.range).toEqual([1, 3])
    expect(cursor.span).toEqual({ from: 1, to: 3 })
    expect(cursor.index).toBe(3)
    cursor.seek(0)
    expect(cursor.index).toBe(1)
    cursor.setWindow({ from: 2, to: 2 })
    expect(cursor.range).toEqual([0, 4])
    cursor.setWindow(null)
    expect(cursor.window).toBeNull()
  })

  it('goes back to the end of the run when another replaces it', async () => {
    cursor.setWindow({ from: 1, to: 3 })
    cursor.seek(2)
    cursor.play()
    results.results = run([0, 10, 20])
    await Promise.resolve()
    expect([cursor.isPlaying, cursor.isActive, cursor.index, cursor.range]).toEqual([false, false, 2, [0, 2]])
  })
})
