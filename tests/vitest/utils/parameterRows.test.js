import { describe, expect, it } from 'vitest'
import { getUnknownUnitsNotice, isTypeFixed, rowUnitConflicts, typeOptionsFor } from '../../../src/utils/parameterRows'
import { mergeUnitDefinitions } from '../../../src/utils/units'

const values = (options) => options.map((option) => option.value)

describe('parameter row types', () => {
  it('fixes the type of states, text-initialised rows and computed variables', () => {
    expect(isTypeFixed({ name: 'v', type: 'constant', stateRole: 'state' })).toBe(true)
    expect(isTypeFixed({ name: 'k', type: 'constant', textInit: '1' })).toBe(true)
    expect(isTypeFixed({ name: 'x', type: 'variable' })).toBe(true)
  })

  it('fixes the type of a row the math computes, when the analysis is known', () => {
    const row = { name: 'k', type: 'constant' }
    expect(isTypeFixed(row)).toBe(false)
    expect(isTypeFixed(row, new Map([['k', 'computed_constant']]))).toBe(true)
  })

  it('offers parameters every type except variable', () => {
    expect(values(typeOptionsFor({ name: 'k', type: 'constant' }))).not.toContain('variable')
    expect(values(typeOptionsFor({ name: 'x', type: 'variable' }))).toContain('variable')
  })
})

describe('unknown units notice', () => {
  const library = new Set(['mM'])

  it('flags a unit that is not in the library', () => {
    expect(getUnknownUnitsNotice({ units: 'furlong' }, library)).toContain('furlong')
  })

  it('stays quiet for a known unit and for no unit at all', () => {
    expect(getUnknownUnitsNotice({ units: 'mM' }, library)).toBe('')
    expect(getUnknownUnitsNotice({ units: '' }, library)).toBe('')
    expect(getUnknownUnitsNotice({}, library)).toBe('')
  })
})

describe('rowUnitConflicts', () => {
  const definitions = mergeUnitDefinitions([
    `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
      <units name="mm"><unit units="metre" prefix="milli"/></units>
      <units name="per_second"><unit units="second" exponent="-1"/></units>
    </model>`,
  ])
  const declared = [
    { name: 'L', units: 'metre' },
    { name: 'k', units: 'per_second' },
  ]

  it('names a row whose units have other dimensions than the math', () => {
    expect(rowUnitConflicts([{ name: 'k', units: 'second' }], declared, definitions)).toEqual([
      '"k" is in second, but its math uses per_second',
    ])
  })

  it('allows a scale-only difference, the same units, and units it cannot resolve', () => {
    const rows = [
      { name: 'L', units: 'mm' },
      { name: 'k', units: 'per_second' },
      { name: 'L', units: 'furlong' },
      { name: 'z', units: 'second' },
    ]
    expect(rowUnitConflicts(rows, declared, definitions)).toEqual([])
  })
})
