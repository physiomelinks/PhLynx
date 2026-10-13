import { describe, expect, it } from 'vitest'

import { applyParameterValues, applyParametersToNodes, skippedParametersMessage } from '../../../src/utils/parameters.js'

const row = (name, type, value = '', units = 'mM') => ({ name, type, value, units, data_reference: '' })
const node = (id, variables) => ({ id, data: { name: id, variables } })
const param = (variable_name, value, units = 'mM') => ({ variable_name, value, units, data_reference: 'paper' })

describe('applyParametersToNodes', () => {
  it("applies each instance's values without changing any row's type", () => {
    const face = node('face', [
      row('C_up', 'boundary_condition'),
      row('A_f', 'constant'),
      row('sigma', 'global_constant'),
      row('other', 'constant', '7'),
    ])
    const { variablesById, updated, skipped } = applyParametersToNodes(
      [face],
      [param('C_up_face', '0.06'), param('A_f_face', '4e-10'), param('sigma_face', '2')]
    )

    expect(updated).toBe(3)
    expect(skipped).toEqual([])
    expect(variablesById.get('face')).toEqual([
      { ...row('C_up', 'boundary_condition'), value: '0.06', data_reference: 'paper' },
      { ...row('A_f', 'constant'), value: '4e-10', data_reference: 'paper' },
      { ...row('sigma', 'global_constant'), value: '2', data_reference: 'paper' },
      row('other', 'constant', '7'),
    ])
  })

  it("doesn't apply a computed row's value, and reports it", () => {
    const vol = node('vol', [row('C_P', 'variable', ''), row('V', 'constant')])
    const { variablesById, updated, skipped } = applyParametersToNodes([vol], [param('C_P_vol', '1'), param('V_vol', '8')])

    expect(updated).toBe(1)
    expect(skipped).toEqual([{ nodeName: 'vol', name: 'C_P' }])
    expect(variablesById.get('vol')[0]).toEqual(row('C_P', 'variable', ''))
  })

  it('leaves the nodes as they were, and skips nodes no row names', () => {
    const vol = node('vol', [row('V', 'constant', '1')])
    const other = node('other', [row('V', 'constant', '2')])
    const { variablesById } = applyParametersToNodes([vol, other], [param('V_vol', '8')])

    expect(vol.data.variables[0].value).toBe('1')
    expect([...variablesById.keys()]).toEqual(['vol'])
  })
})

describe('applyParameterValues', () => {
  it('keeps each type, and lists the computed rows it leaves alone', () => {
    const values = { BC: { value: ' 3 ' }, x: { value: '4' } }
    const { variables, updated, skipped } = applyParameterValues(
      [row('BC', 'boundary_condition'), row('x', 'variable')],
      (name) => values[name]
    )
    expect(variables.map(({ type, value }) => [type, value])).toEqual([
      ['boundary_condition', '3'],
      ['variable', ''],
    ])
    expect(updated).toBe(1)
    expect(skipped).toEqual(['x'])
  })
})

describe('skippedParametersMessage', () => {
  it('names at most three rows', () => {
    const skipped = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ nodeName: 'n', name }))
    expect(skippedParametersMessage(skipped)).toBe(
      "5 values weren't applied, as their variables are computed by their modules' math: n.a, n.b, n.c and 2 more."
    )
    expect(skippedParametersMessage(skipped.slice(0, 1))).toBe(
      "1 value wasn't applied, as its variable is computed by its module's math: n.a."
    )
  })
})
