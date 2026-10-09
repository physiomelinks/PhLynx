import { describe, expect, it } from 'vitest'

import { formatPythonG, isPythonFalsy, formatPythonFloat, formatPythonRepr, getPythonTypeName } from '../../../../src/services/protocol/pythonFormat.js'

// Python's own output for each value (format(x, 'g') and repr(float(x))).
const VALUES = [1, 0.0001, 1e-5, 123456, 1234567, 0.1 + 0.2, 2000, -0.5, 1e-12, 2.5e6, 1e7, 1 / 3]
const AS_G = ['1', '0.0001', '1e-05', '123456', '1.23457e+06', '0.3', '2000', '-0.5', '1e-12', '2.5e+06', '1e+07', '0.333333']
const AS_FLOAT = ['1.0', '0.0001', '1e-05', '123456.0', '1234567.0', '0.30000000000000004', '2000.0', '-0.5', '1e-12', '2500000.0', '10000000.0', '0.3333333333333333']

describe('pythonFormat', () => {
  it('formats numbers as Python formats them with g', () => {
    expect(VALUES.map(formatPythonG)).toEqual(AS_G)
  })

  it('formats numbers as Python prints a float', () => {
    expect(VALUES.map(formatPythonFloat)).toEqual(AS_FLOAT)
    expect([1e16, 1.5e20, 123456789012345680].map(formatPythonFloat)).toEqual(['1e+16', '1.5e+20', '1.2345678901234568e+17'])
  })

  it('formats JSON values as Python prints them', () => {
    expect([null, true, false, 3, 1.5, 'a', ["it's"], { k: [1] }].map(formatPythonRepr)).toEqual(['None', 'True', 'False', '3', '1.5', "'a'", '["it\'s"]', "{'k': [1]}"])
    expect([null, true, 1, 1.5, 's', [], {}].map(getPythonTypeName)).toEqual(['NoneType', 'bool', 'int', 'float', 'str', 'list', 'dict'])
  })

  it('knows what Python counts as false', () => {
    expect([null, undefined, false, 0, '', [], {}].every(isPythonFalsy)).toBe(true)
    expect([true, 1, 'x', [0], { a: 1 }].some(isPythonFalsy)).toBe(false)
  })
})
