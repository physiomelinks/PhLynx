import { describe, expect, it } from 'vitest'

import {
  MAX_TRACKED_RUNS,
  RUN_DASHES,
  alignVoi,
  describeRunInputs,
  displayVoi,
  fadeColour,
  formatPlotValue,
  haveSameVoi,
  nextRunNumber,
  runDash,
  runLabel,
} from '../../../../src/services/simulation/trackedRuns.js'

describe('tracked run numbers and dashes', () => {
  it('numbers a run with the lowest number free, so runs tracked at once never share a dash', () => {
    expect(nextRunNumber([])).toBe(1)
    expect(nextRunNumber([{ number: 1 }, { number: 3 }])).toBe(2)
    expect(nextRunNumber([{ number: 1 }, { number: 2 }])).toBe(3)
  })

  it('gives as many distinct dashes as runs can be tracked', () => {
    const dashes = Array.from({ length: MAX_TRACKED_RUNS }, (_, index) => JSON.stringify(runDash(index + 1)))
    expect(new Set(dashes).size).toBe(MAX_TRACKED_RUNS)
    expect(RUN_DASHES.length).toBeGreaterThanOrEqual(MAX_TRACKED_RUNS)
  })

  it('names a run’s line after its variable’s, and fades its colour', () => {
    expect(runLabel('a/V', 2)).toBe('a/V [#2]')
    expect(fadeColour('#2a78d6')).toMatch(/^#2a78d6[0-9a-f]{2}$/)
  })
})

describe('formatPlotValue', () => {
  it('shows 5 significant figures, without trailing zeros, and a dash for no value', () => {
    expect(formatPlotValue(3.14159265)).toBe('3.1416')
    expect(formatPlotValue(2)).toBe('2')
    expect(formatPlotValue(0.000123456789)).toBe('0.00012346')
    expect(formatPlotValue(null)).toBe('–')
    expect(formatPlotValue(NaN)).toBe('–')
  })
})

describe('alignVoi', () => {
  it('keeps the live run’s VoI values while the tracked runs share them', () => {
    const live = new Float64Array([0, 0.5, 1])
    const { values, align } = alignVoi(live, [new Float64Array([0, 0.5, 1 + 1e-12])])
    expect(values).toBe(live)
    const series = new Float64Array([1, 2, 3])
    expect(align(live, series)).toBe(series)
  })

  it('holds every run’s VoI values when they differ, each run with gaps at the others’', () => {
    const live = new Float64Array([0, 1, 2])
    const tracked = new Float64Array([0, 0.5, 1])
    const { values, align } = alignVoi(live, [tracked])
    expect(values).toEqual([0, 0.5, 1, 2])
    expect(align(live, [10, 11, 12])).toEqual([10, null, 11, 12])
    expect(align(tracked, [20, 21, 22])).toEqual([20, 21, 22, null])
  })

  it('aligns a run stopped early, with no values past where it stopped', () => {
    const live = new Float64Array([0, 1])
    const { values, align } = alignVoi(live, [new Float64Array([0, 1, 2])])
    expect(values).toEqual([0, 1, 2])
    expect(align(live, [5, 6])).toEqual([5, 6, null])
  })
})

describe('haveSameVoi', () => {
  it('tells runs with other output points apart', () => {
    expect(haveSameVoi([0, 1], [0, 1])).toBe(true)
    expect(haveSameVoi([0, 1], [0, 1, 2])).toBe(false)
    expect(haveSameVoi([0, 1], [0, 1.1])).toBe(false)
  })
})

describe('displayVoi', () => {
  it('counts the VoI from the plots’ start when they start after the solve does', () => {
    const results = { voi: { values: new Float64Array([5, 6, 7]) } }
    expect(displayVoi(results, { initialPoint: 0, startingPoint: 5 })).toEqual({ values: new Float64Array([0, 1, 2]), offset: 5 })
    expect(displayVoi(results, { initialPoint: 5, startingPoint: 5 })).toEqual({ values: results.voi.values, offset: 0 })
    expect(displayVoi(null, { initialPoint: 0, startingPoint: 0 }).values).toHaveLength(0)
  })
})

describe('describeRunInputs', () => {
  it('names each slider value a run tried out as instance/parameter', () => {
    const definitions = [
      { key: 'n1::k', nodeName: 'cell', parameterName: 'k', units: 'per_second', type: 'constant' },
      { key: 'n2::g', nodeName: 'other', parameterName: 'g', units: 'mS', type: 'global_constant' },
    ]
    const overrides = { rows: new Map([['n1::k', 2], ['gone::c', 3]]), globals: new Map([['g', 0.5]]) }
    expect(describeRunInputs(overrides, definitions, 'global_parameters')).toEqual([
      { key: 'n1::k', label: 'cell/k', value: 2, units: 'per_second' },
      { key: 'gone::c', label: 'gone/c', value: 3, units: '' },
      { key: 'global::g', label: 'global_parameters/g', value: 0.5, units: 'mS' },
    ])
    expect(describeRunInputs(null, definitions, 'global_parameters')).toEqual([])
  })
})
