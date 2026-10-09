import { describe, expect, it } from 'vitest'

import { buildResultsCsv, collectResultColumns, columnHeader } from '../../../../src/services/simulation/resultsExport.js'

const X = { label: 't', unit: 'second', values: new Float64Array([0, 0.5, 1]) }
const V = { key: 'a::V', label: 'V', values: new Float64Array([-65, -60.25, 1e-7]) }
const W = { key: 'b::V', label: 'b.V, "fast"', values: new Float64Array([1, 2, 3]) }

describe('collectResultColumns', () => {
  it('puts the variable of integration first, then each series once, in chart order', () => {
    const charts = [
      { unit: 'mV', series: [V, W] },
      { unit: 'mV', series: [V] },
    ]
    expect(collectResultColumns(X, charts).map((column) => [column.key, column.unit])).toEqual([
      ['__voi__', 'second'],
      ['a::V', 'mV'],
      ['b::V', 'mV'],
    ])
  })
})

describe('buildResultsCsv', () => {
  it('writes a header with units, then every point at full precision', () => {
    const csv = buildResultsCsv(collectResultColumns(X, [{ unit: 'mV', series: [V, W] }]))
    expect(csv).toBe('t (second),V (mV),"b.V, ""fast"" (mV)"\r\n0,-65,1\r\n0.5,-60.25,2\r\n1,1e-7,3\r\n')
  })

  it('stops at the shortest column', () => {
    const short = { ...W, values: new Float64Array([1]) }
    expect(buildResultsCsv(collectResultColumns(X, [{ unit: '', series: [short] }])).trim().split('\r\n')).toHaveLength(2)
  })
})

describe('columnHeader', () => {
  it('leaves out a missing unit', () => {
    expect(columnHeader({ label: 'x', unit: '' })).toBe('x')
  })

  it("leaves a gap empty, where an experiment shown with others has no point", () => {
    const csv = buildResultsCsv([
      { label: 't', unit: 's', values: [0, 1] },
      { label: 'x', unit: '', values: [null, 2] },
    ])
    expect(csv).toBe('t (s),x\r\n0,\r\n1,2\r\n')
  })
})
