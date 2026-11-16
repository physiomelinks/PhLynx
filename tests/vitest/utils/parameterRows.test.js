import { describe, expect, it } from 'vitest'
import { getUnknownUnitsNotice, isTypeFixed, typeOptionsFor } from '../../../src/utils/parameterRows'

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
