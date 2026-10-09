import { describe, expect, it } from 'vitest'

import { findNameCandidates, resolveParameterName } from '../../../../src/services/protocol/protocolNames.js'

describe('protocolNames', () => {
  it("tries names in CA's order, then PhLynx's parameter components before the bare name", () => {
    expect(findNameCandidates('soma_SN/g_M')).toEqual([
      'soma_SN/g_M',
      'soma_SN/g_M',
      'parameters/g_M_soma_SN',
      'parameters/g_M_soma_SN',
      'parameters_soma_SN/g_M',
      'parameters_soma_SN/g_M',
      'soma_SN_module/g_M',
      'parameters/soma_SN_g_M',
      'parameters/soma_SN_g_M',
      'parameters/g_M',
      'parameters_global/g_M',
      'instance_parameters/soma_SN_g_M',
      'instance_parameters/g_M',
      'global_parameters/g_M',
      'g_M',
    ])
    expect(findNameCandidates('heart_module.C', { withPhlynxComponents: false })).toContain('heart/C')
    expect(findNameCandidates('k')).toEqual(['k'])
  })

  it("resolves a name as Myokit keeps a PhLynx model's parameters: only where they're defined", () => {
    const myokitNames = new Set(['instance_parameters/g_M', 'instance_parameters/soma_SN_I_in', 'soma_SN/V'])
    const isKnown = (name) => myokitNames.has(name)
    expect(resolveParameterName('soma_SN/g_M', isKnown)).toBe('instance_parameters/g_M')
    expect(resolveParameterName('soma_SN/I_in', isKnown)).toBe('instance_parameters/soma_SN_I_in')
    expect(resolveParameterName('soma_SN/V', isKnown)).toBe('soma_SN/V')
    expect(resolveParameterName('soma_SN/g_M', isKnown, { withPhlynxComponents: false })).toBeNull()
  })
})
