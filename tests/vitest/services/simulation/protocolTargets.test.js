import { describe, expect, it } from 'vitest'

import { findProtocolTarget, resolveProtocolTargets } from '../../../../src/services/simulation/protocolTargets.js'

const NODES = [{ id: 'n1', data: { name: 'soma_SN' } }]
const MAPPING = new Map([
  ['n1::g_M', 'instance_parameters/g_M_soma_SN'],
  ['n1::V', 'soma_SN/V'],
  ['n1::I', 'soma_SN/I'],
])
const VARIABLES = new Map([
  ['instance_parameters/g_M_soma_SN', { kind: 'constant' }],
  ['soma_SN/V', { kind: 'state' }],
  ['soma_SN/I', { kind: 'algebraic' }],
  ['environment/k', { kind: 'constant' }],
  ['instance_parameters/pace', { kind: 'constant' }],
])

describe('resolveProtocolTargets', () => {
  it("finds a parameter by its instance and variable, as circulatory autogen names it, or as libOpenCOR reports it", () => {
    const { targets, kinds, errors } = resolveProtocolTargets({
      parameters: ['soma_SN/g_M', 'soma_SN/V', 'environment/k'],
      nodes: NODES,
      mapping: MAPPING,
      variables: VARIABLES,
    })
    expect(errors).toEqual([])
    expect(targets).toEqual(new Map([['soma_SN/g_M', 'instance_parameters/g_M_soma_SN'], ['soma_SN/V', 'soma_SN/V'], ['environment/k', 'environment/k']]))
    expect(kinds).toEqual(new Map([['soma_SN/g_M', 'constant'], ['soma_SN/V', 'state'], ['environment/k', 'constant']]))
  })

  it("explains parameters it can't set", () => {
    const { targets, errors } = resolveProtocolTargets({ parameters: ['soma_SN/I', 'axon/g', 'g'], nodes: NODES, mapping: MAPPING, variables: VARIABLES })
    expect(targets.size).toBe(0)
    expect(errors).toEqual([
      "The protocol sets soma_SN/I, which the model computes, so it can't be set. Only constants and states can.",
      "The protocol sets axon/g, which isn't in the model being simulated.",
      "The protocol sets g, which isn't in the model being simulated.",
    ])
  })

  it('falls back to the names circulatory autogen would try, such as a CUFLynx key in PhLynx\'s components', () => {
    const { targets, errors } = resolveProtocolTargets({ parameters: ['engine/pace'], nodes: NODES, mapping: MAPPING, variables: VARIABLES })
    expect(errors).toEqual([])
    expect(targets).toEqual(new Map([['engine/pace', 'instance_parameters/pace']]))
  })
})

describe('findProtocolTarget', () => {
  it('finds a variable whatever its kind, or none', () => {
    expect(findProtocolTarget('soma_SN/I', { nodes: NODES, mapping: MAPPING, variables: VARIABLES })).toBe('soma_SN/I')
    expect(findProtocolTarget('axon/g', { nodes: NODES, mapping: MAPPING, variables: VARIABLES })).toBeNull()
  })
})
