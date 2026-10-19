import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { parseParametersFile } from '../../../src/utils/import.js'
import {
  applyParameterValues,
  applyParametersToNodes,
  globalParameters,
  skippedParametersMessage,
} from '../../../src/utils/parameters.js'

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

  // A verbatim copy of apps/api/tests/fixtures/phlynx_send_back_parameters.csv in physiomelinks/CUFLynx (e50ce1bb):
  // the parameters CSV CUFLynx sends back to PhLynx.
  const sendBack = readFileSync('tests/vitest/fixtures/phlynx_send_back_parameters.csv', 'utf8')

  it("applies CUFLynx's send-back to the named instance's rows", async () => {
    const rows = await parseParametersFile(sendBack)
    expect(rows.find((entry) => entry.variable_name === 'C/q').data_reference).toBe(
      'calibrated by workflow selection, step c-alone (YYYY-MM-DD)'
    )

    const nodes = [
      node('A', [dimensionless('p', '0')]),
      node('B', [dimensionless('q', '5'), dimensionless('k', '6')]),
      node('C', [dimensionless('q', '1'), dimensionless('k', '0')]),
    ]
    const { variablesById, updated, skipped } = applyParametersToNodes(nodes, rows)

    expect(updated).toBe(3)
    expect(skipped).toEqual([])
    expect(variablesById.get('C').map(({ value }) => value)).toEqual(['3', '1.0'])
    expect(variablesById.get('A')[0].value).toBe('1.0')
    expect(variablesById.has('B')).toBe(false)
    expect(nodes[1].data.variables.map(({ value }) => value)).toEqual(['5', '6'])
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
      "2 values weren't applied, as their nested names end in the same instance and variable as another: heart/lv/E_B, lung/lv/E_B."
    )
  })

  it("applies a nested name to the node of its flat name (heart__lv for heart/lv/E) before its last instance's", () => {
    const flat = node('heart__lv', [dimensionless('E', '1')])
    const lv = node('lv', [dimensionless('E', '1')])
    const { variablesById, updated, skipped } = applyParametersToNodes(
      [flat, lv],
      ['heart/lv/E,dimensionless,2,', 'lung/lv/E,dimensionless,3,'].map(csvRow)
    )

    expect(skipped).toEqual([])
    expect(updated).toBe(2)
    expect(variablesById.get('heart__lv')[0].value).toBe('2')
    expect(variablesById.get('lv')[0].value).toBe('3')
  })

  it("reports nested names that end in the same instance and variable when there's no such node", () => {
    const { updated, skipped } = applyParametersToNodes(
      [node('A', [dimensionless('E', '1')])],
      ['heart/lv/E,dimensionless,2,', 'lung/lv/E,dimensionless,3,'].map(csvRow)
    )

    expect(updated).toBe(0)
    expect(skipped).toEqual([
      { nodeName: 'heart/lv', name: 'E', ambiguous: true },
      { nodeName: 'lung/lv', name: 'E', ambiguous: true },
    ])
  })

  it('leaves global/<variable> rows to the global constants, even beside a node named global', () => {
    const rows = ['global/R,J_per_K_per_mol,8.314,', 'rho,kg_per_m3,1050,', 'A/p,dimensionless,1,'].map(csvRow)
    const { updated } = applyParametersToNodes([node('global', [dimensionless('R', '1')])], rows)

    expect(updated).toBe(0)
    expect(globalParameters(rows, new Set(['R', 'rho', 'p'])).map(({ name, value }) => [name, value])).toEqual([
      ['R', '8.314'],
      ['rho', '1050'],
    ])
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
