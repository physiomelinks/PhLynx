import { describe, expect, it } from 'vitest'

import { parameterRows } from '../../../../src/services/export/ca.js'
import {
  caIdentityProblems,
  parameterRows as nativeParameterRows,
  supermoduleConfigPath,
  withCaIdentities,
} from '../../../../src/services/export/caNative.js'
import { module, supermodule } from '../../fixtures/hierarchy/graph.js'

const library = { availableModules: new Map([['vp:simple', {}]]), availableSupermodules: new Map() }
const pump = { module_type: 'pump', module_subtype: 'phlynx_v1' }

describe('caIdentityProblems', () => {
  const requests = [{ smId: 'sm_1' }, { smId: 'sm_2' }]

  it('finds none in identities each free', () => {
    const given = new Map([['sm_1', pump], ['sm_2', { module_type: 'valve', module_subtype: 'phlynx_v1' }]])
    expect(caIdentityProblems(requests, given, { library, taken: new Map() })).toEqual(new Map([['sm_1', null], ['sm_2', null]]))
  })

  it('refuses one identity for two super-modules asked for together, and one taken already', () => {
    const both = caIdentityProblems(requests, new Map([['sm_1', pump], ['sm_2', pump]]), { library, taken: new Map() })
    expect([...both.values()]).toEqual(['Another super-module here is pump:phlynx_v1.', 'Another super-module here is pump:phlynx_v1.'])
    const taken = caIdentityProblems([{ smId: 'sm_1' }], new Map([['sm_1', pump]]), { library, taken: new Map([['pump:phlynx_v1', 'sm_9']]) })
    expect(taken.get('sm_1')).toBe('Another super-module here is pump:phlynx_v1.')
    expect(caIdentityProblems([{ smId: 'sm_1' }], new Map([['sm_1', { module_type: 'vp', module_subtype: 'simple' }]]), { library, taken: new Map() }).get('sm_1')).toBe("vp:simple is a component module's.")
  })
})

describe('withCaIdentities', () => {
  it('gives the super-modules named their identities, leaving the store as it is', () => {
    const sm = supermodule('sm_1', 'pump')
    const child = module('p', 'p', { scope: 'sm_1' })
    const nodes = [sm, child]
    const named = withCaIdentities(nodes, new Map([['sm_1', pump], ['p', pump]]))
    expect(named[0].data.supermodule.ca).toEqual(pump)
    expect(named[1]).toBe(child)
    expect(sm.data.supermodule.ca ?? null).toBeNull()
    expect(withCaIdentities(nodes, new Map())).toBe(nodes)
  })
})

describe('the shared CA export helpers', () => {
  it('names a super-module config file', () => {
    expect(supermoduleConfigPath('supermodules/pump/versions/v1', { module_type: 'pump', module_subtype: 'v1' })).toBe(
      'supermodules/pump/versions/v1/pump_v1_modules_config.json'
    )
  })

  it('writes the flat and native parameter rows the same way, named as asked', () => {
    expect(parameterRows).toBe(nativeParameterRows)
    const rows = [
      { name: 'E', type: 'constant', units: 'J', value: '' },
      { name: 'u', type: 'boundary_condition', units: 'Pa', value: '' },
      { name: 'q', type: 'state', units: 'm3', value: '1' },
    ]
    expect(parameterRows(rows, (name) => `lv/${name}`).map((row) => [row.variable_name, row.value])).toEqual([
      ['lv/E', ''],
      ['lv/u', expect.any(String)],
    ])
  })
})
