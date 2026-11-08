import { describe, expect, it } from 'vitest'

import { seedInstance, seedRefFor, seedVariables } from '../../../src/utils/parameters/seed.js'
import { NO_PARAMETER_SET } from '../../../src/utils/parameters/sets.js'

const param = (value) => ({ value, units: '', data_reference: 'paper', extra: {} })
const row = (name, type, value = '0') => ({ name, type, value, units: '', data_reference: '' })

describe('seedRefFor', () => {
  it('takes the chosen ref, else the module default, else none', () => {
    expect(seedRefFor({ defaultParameterisation: 'a' }, 'b')).toBe('b')
    expect(seedRefFor({ defaultParameterisation: 'a' })).toBe('a')
    expect(seedRefFor({}, '')).toBeNull()
    expect(seedRefFor(null)).toBeNull()
  })

  it('gives none for None, over the module default', () => {
    expect(seedRefFor({ defaultParameterisation: 'a' }, NO_PARAMETER_SET)).toBeNull()
  })
})

describe('seedVariables', () => {
  it('follows each row type, falling back across globals and values', () => {
    const set = {
      globals: new Map([['F', param('96485')], ['Scale_NKA', param('2')], ['both', param('g')]]),
      values: new Map([['K', param('5')], ['T', param('310')], ['both', param('v')], ['blank', param(null)], ['v', param('1')]]),
    }
    const rows = [
      row('F', 'global_constant'),
      row('T', 'global_constant'),
      row('Scale_NKA', 'constant'),
      row('K', 'boundary_condition'),
      row('both', 'constant'),
      row('blank', 'constant'),
      row('v', 'variable'),
    ]

    expect(seedVariables(rows, set).map((r) => r.value)).toEqual(['96485', '310', '2', '5', 'v', '0', '0'])
    expect(seedVariables(rows, set)[0].data_reference).toBe('paper')
    expect(rows[0].value).toBe('0')
  })
})

describe('seedInstance', () => {
  it('records the set on the node, and leaves a node with no set alone', () => {
    const node = { data: { variables: [row('K', 'constant')] } }
    expect(seedInstance(node, null).data).not.toHaveProperty('parameterisation')

    const set = { ref: 'NKA', globals: new Map(), values: new Map([['K', param('5')]]) }
    expect(seedInstance(node, set).data).toMatchObject({ parameterisation: 'NKA', variables: [{ value: '5' }] })
  })
})
