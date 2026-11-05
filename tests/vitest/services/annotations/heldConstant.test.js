import { beforeAll, describe, expect, it } from 'vitest'
import {
  aggregatorVariables,
  asBoundaryConditions,
  holdAtZero,
  isHeldAtZero,
} from '../../../../src/services/annotations/heldConstant.js'
import { loadToy } from './toyModel.js'

describe('holding summed flows at 0', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToy()
  })

  it('makes the named constant rows boundary conditions, keeping their values', () => {
    const rows = [
      { name: 'c_A_i', type: 'constant', value: '' },
      { name: 'area', type: 'constant', value: '1e-3' },
      { name: 'u', type: 'global_constant' },
      { name: 'j_A', type: 'variable' },
      { name: 'k', type: 'constant', value: '2' },
    ]
    expect(asBoundaryConditions(rows, ['area', 'c_A_i', 'c_A_o', 'u']).map(({ type, value }) => [type, value])).toEqual([
      ['boundary_condition', ''],
      ['boundary_condition', '1e-3'],
      ['global_constant', undefined],
      ['variable', undefined],
      ['constant', '2'],
    ])
  })

  it('finds the sums of a side-car, and whether they are constant 0 already', () => {
    expect(aggregatorVariables(toy.sidecars.get('pool'))).toEqual(['v_A'])
    expect(aggregatorVariables(toy.sidecars.get('wall'))).toEqual(['i_tot'])
    expect(aggregatorVariables(toy.sidecars.get('porter'))).toEqual([])
    expect(aggregatorVariables(null)).toEqual([])

    const rows = (variables) => [{ name: 'c_A', type: 'constant', value: '1' }, ...variables]
    expect(isHeldAtZero(rows([{ name: 'v_A', type: 'constant', value: '0' }]), ['v_A'])).toBe(true)
    expect(isHeldAtZero(rows([{ name: 'v_A', type: 'constant', value: 0 }]), ['v_A'])).toBe(true)
    expect(isHeldAtZero(rows([{ name: 'v_A', type: 'constant', value: '' }]), ['v_A'])).toBe(false)
    expect(isHeldAtZero(rows([{ name: 'v_A', type: 'variable', value: null }]), ['v_A'])).toBe(false)
    expect(isHeldAtZero(rows([{ name: 'v_A', type: 'boundary_condition', value: '0' }]), ['v_A'])).toBe(false)
    expect(isHeldAtZero(rows([]), ['v_A'])).toBe(false)
    expect(isHeldAtZero(rows([]), [])).toBe(false)
  })

  it('holds the named rows at constant 0 and keeps the others', () => {
    const rows = [
      { name: 'v_A', type: 'variable', value: null, units: 'u' },
      { name: 'c_A', type: 'constant', value: '2' },
    ]
    expect(holdAtZero(rows, ['v_A'])).toEqual([
      { name: 'v_A', type: 'constant', value: '0', units: 'u' },
      { name: 'c_A', type: 'constant', value: '2' },
    ])
    expect(rows[0].type).toBe('variable')
  })
})
