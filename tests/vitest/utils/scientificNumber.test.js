import { describe, expect, it } from 'vitest'

import { formatScientificNumber, parseScientificNumber } from '../../../src/utils/scientificNumber.js'

describe('parseScientificNumber', () => {
  it.each([
    ['1e-20', 1e-20],
    ['1E-18', 1e-18],
    ['2.5e+3', 2500],
    ['0.001', 0.001],
    ['.5', 0.5],
    ['3.', 3],
    ['-4', -4],
    ['+4', 4],
    [' 1e-7 ', 1e-7],
    ['1 e-7', 1e-7],
    ['−1e-3', -1e-3],
  ])('reads %j as %s', (text, value) => {
    expect(parseScientificNumber(text)).toBe(value)
  })

  it.each(['', '   ', null, undefined])('reads %j as blank', (text) => {
    expect(parseScientificNumber(text)).toBeNull()
  })

  it.each(['e-7', '1e', '1e-', '-', '.', 'abc', '1,000', '0x10', '1e400', 'Infinity', '1..2'])('reads %j as no number', (text) => {
    expect(parseScientificNumber(text)).toBeUndefined()
  })
})

describe('formatScientificNumber', () => {
  it.each([
    [1e-20, '1e-20'],
    [1e-7, '1e-7'],
    [0.001, '0.001'],
    [20, '20'],
    [0, '0'],
  ])('writes %s as %j', (value, text) => {
    expect(formatScientificNumber(value)).toBe(text)
  })

  it.each([null, undefined, Number.NaN])('writes %s as blank', (value) => {
    expect(formatScientificNumber(value)).toBe('')
  })

  it('writes what it reads back to the same number', () => {
    for (const value of [1e-20, 1.234e-15, 0.1, 123.456]) expect(parseScientificNumber(formatScientificNumber(value))).toBe(value)
  })
})
