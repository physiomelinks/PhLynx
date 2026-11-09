import { describe, expect, it } from 'vitest'

import { buildWorkflowGraph } from '../../../../src/services/import/buildWorkflow.js'

const MATH_REF = 'compartment.cellml:compartment'
const param = (value) => ({ value, units: 'mM', data_reference: '', extra: {} })
const set = (ref, value) => ({ ref, globals: new Map(), values: new Map([['c', param(value)]]) })
const sets = new Map([['lumen', set('lumen', '140')], ['lumen_calibrated', set('lumen_calibrated', '150')]])

const modules = new Map([
  [
    'compartment:lumen',
    {
      moduleRef: 'compartment:lumen',
      mathRef: MATH_REF,
      defaultParameterisation: 'lumen',
      ports: [],
      variables: [{ name: 'c', type: 'constant', value: '1', units: 'mM' }],
    },
  ],
])
const instance = (name, parameterisation) => ({
  name,
  module_type: 'compartment',
  module_subtype: 'lumen',
  inp_instances: '',
  out_instances: '',
  ...(parameterisation !== undefined && { parameterisation }),
})

describe('buildWorkflowGraph parameter sets', () => {
  it("seeds each instance from its row's set, else its module's default", () => {
    const { pendingInstances } = buildWorkflowGraph(
      [instance('a'), instance('b', 'lumen_calibrated'), instance('c', '')],
      modules,
      () => null,
      [],
      null,
      () => new Map(),
      (mathRef, ref) => (mathRef === MATH_REF ? (sets.get(ref) ?? null) : null)
    )

    expect(pendingInstances.map((node) => [node.data.parameterisation, node.data.variables[0].value])).toEqual([
      ['lumen', '140'],
      ['lumen_calibrated', '150'],
      ['lumen', '140'],
    ])
  })

  it('keeps the module values without a set lookup', () => {
    const { pendingInstances } = buildWorkflowGraph([instance('a')], modules, () => null, [])
    expect(pendingInstances[0].data).not.toHaveProperty('parameterisation')
    expect(pendingInstances[0].data.variables[0].value).toBe('1')
  })
})
