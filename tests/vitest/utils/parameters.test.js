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

describe('applyParametersToNodes with <instance>/<variable> names', () => {
  const csvRow = (line) => {
    const [variable_name, units, value, data_reference] = line.split(',')
    return { variable_name, units, value, data_reference }
  }
  const dimensionless = (name, value) => row(name, 'constant', value, 'dimensionless')

  it("applies CUFLynx's send-back to the named instance's rows", () => {
    const nodes = [
      node('A', [dimensionless('p', '1')]),
      node('B', [dimensionless('q', '5')]),
      node('C', [dimensionless('q', '1')]),
    ]
    const { variablesById, updated, skipped } = applyParametersToNodes(
      nodes,
      ['C/q,dimensionless,3.0,', 'A/p,dimensionless,1.0,'].map(csvRow)
    )

    expect(updated).toBe(2)
    expect(skipped).toEqual([])
    expect(variablesById.get('C')[0].value).toBe('3.0')
    expect(variablesById.get('A')[0].value).toBe('1.0')
    expect(variablesById.has('B')).toBe(false)
  })

  it("applies a nested name to its last instance's node, unless another path ends in that instance", () => {
    const lv = node('lv', [dimensionless('E_A', '1'), dimensionless('E_B', '1')])
    const { variablesById, updated, skipped } = applyParametersToNodes(
      [lv],
      ['heart/lv/E_A,dimensionless,2,', 'heart/lv/E_B,dimensionless,3,', 'lung/lv/E_B,dimensionless,4,'].map(csvRow)
    )

    expect(updated).toBe(1)
    expect(variablesById.get('lv').map(({ value }) => value)).toEqual(['2', '1'])
    expect(skipped).toEqual([
      { nodeName: 'heart/lv', name: 'E_B', ambiguous: true },
      { nodeName: 'lung/lv', name: 'E_B', ambiguous: true },
    ])
    expect(skippedParametersMessage(skipped)).toBe(
      "2 values weren't applied, as their nested names match more than one instance: heart/lv/E_B, lung/lv/E_B."
    )
  })

  it('keeps reading <variable>_<instance> names, with the slash name winning for the same row', () => {
    const nodes = [node('C', [dimensionless('q', '1'), dimensionless('r', '1')])]
    const { variablesById, updated } = applyParametersToNodes(
      nodes,
      ['q_C,dimensionless,2,', 'C/q,dimensionless,3,', 'r_C,dimensionless,4,'].map(csvRow)
    )

    expect(updated).toBe(2)
    expect(variablesById.get('C').map(({ value }) => value)).toEqual(['3', '4'])
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
