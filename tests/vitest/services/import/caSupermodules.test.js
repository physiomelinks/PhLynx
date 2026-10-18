import { describe, expect, it } from 'vitest'

import { normaliseModuleRecords } from '../../../../src/services/import/caModuleArray.js'
import {
  registerSupermodule,
  resolveModuleRefs,
  supermoduleTemplate,
} from '../../../../src/services/import/caModuleConfig.js'
import {
  componentParameterRows,
  expandSupermodules,
  loadExpandedRecords,
  mergeDefaultParameters,
  modelName,
  supermoduleRowName,
  SupermoduleExpansionError,
} from '../../../../src/services/import/caSupermodules.js'

const rec = (name, type, { inp = [], out = [], subtype = 'nn', ...extra } = {}) => ({
  name,
  module_type: type,
  module_subtype: subtype,
  inp_instances: inp,
  out_instances: out,
  ...extra,
})
const row = (variable_name, value = '1', units = 'u') => ({ variable_name, units, value, data_reference: 'ref' })
const registry = (...entries) => {
  const map = new Map()
  entries.forEach((entry) => registerSupermodule(map, supermoduleTemplate(entry, 'sm.json'), new Map()))
  return map
}

const PAIR = { module_type: 'pair', module_subtype: 'v1', module_format: 'supermodule', default_parameterisation: 'default', submodules: [rec('a', 'gain', { out: ['b'] }), rec('b', 'reader', { inp: ['a'] })] }
const OUTER = { module_type: 'outer', module_subtype: 'v1', submodules: [rec('p', 'pair', { subtype: 'v1' }), rec('c', 'gain')] }
const HOST = normaliseModuleRecords([rec('o', 'outer', { subtype: 'v1' }), rec('k', 'gain', { parameterisation: 'fast' })])
const FILES = {
  'parameterisations/default/default_parameters.csv': [row('a/E', '2'), row('T', '10')],
  'outer:parameterisations/default/default_parameters.csv': [row('p/a/E', '3'), row('c/E', '4'), row('T', '20')],
  'gain:parameterisations/fast/fast_parameters.csv': [row('E', '5'), row('T', '30'), row('G', '7')],
  'gain:parameterisations/default/default_parameters.csv': [row('E', '6')],
}
const load = (entry, { parameterisation }) => {
  const path = `parameterisations/${parameterisation}/${parameterisation}_parameters.csv`
  return FILES[entry.module_type === 'pair' ? path : `${entry.module_type}:${path}`] ?? null
}

describe('expandSupermodules', () => {
  it('gives each expanded record its path, and joins levels with the separator asked for', () => {
    const supermodules = registry(PAIR, { ...OUTER, default_parameterisation: 'default' })
    const ca = expandSupermodules(HOST, supermodules)
    expect(ca.records.map((r) => r.name)).toEqual(['o_p_a', 'o_p_b', 'o_c', 'k'])
    expect(ca.paths.get('o_p_a')).toEqual(['o', 'p', 'a'])
    expect(ca.records[0].out_instances).toEqual(['o_p_b'])

    const phlynx = expandSupermodules(HOST, supermodules, { separator: '__', load })
    expect(phlynx.records.map((r) => r.name)).toEqual(['o__p__a', 'o__p__b', 'o__c', 'k'])
    expect(phlynx.parameterRows.map((r) => r.variable_name)).toEqual(['E_o__p__a', 'E_o__c', 'T'])
  })

  it('does not change the records it is given', () => {
    const records = structuredClone(HOST)
    expandSupermodules(records, registry(PAIR, OUTER))
    expect(records).toEqual(HOST)
  })

  it('reads no parameters without a loader, and refuses a parameterisation that is not there', () => {
    const supermodules = registry(PAIR, OUTER)
    expect(expandSupermodules(HOST, supermodules).parameterRows).toEqual([])
    const named = normaliseModuleRecords([rec('o', 'pair', { subtype: 'v1', parameterisation: 'missing' })])
    expect(() => expandSupermodules(named, supermodules, { load })).toThrow(
      `module array: supermodule instance "o" ('pair', 'v1'): unknown parameterisation "missing" of (pair, v1)`
    )
  })

  it('throws a typed error naming the instance it could not expand', () => {
    const named = normaliseModuleRecords([rec('o', 'pair', { subtype: 'v1', parameterisation: 'missing' })])
    const error = (() => {
      try {
        expandSupermodules(named, registry(PAIR, OUTER), { load })
      } catch (thrown) {
        return thrown
      }
    })()
    expect(error).toBeInstanceOf(SupermoduleExpansionError)
    expect(error.instance).toBe('o')
  })

  it('puts parameters in CA precedence: outer super-module, nested super-module, then components', () => {
    const supermodules = registry(PAIR, { ...OUTER, default_parameterisation: 'default' })
    const components = new Map([['gain:nn', { module_type: 'gain', module_subtype: 'nn', default_parameterisation: 'default', variables_and_units: [['T', 's', 'access', 'global_constant']] }]])
    const { parameterRows, warnings } = loadExpandedRecords(HOST, supermodules, components, { load })
    // The outer super-module's E_o_p_a (3) wins over the nested pair's (2) and the gain's own (6).
    expect(parameterRows.map((r) => [r.variable_name, r.value])).toEqual([
      ['E_o_p_a', '3'],
      ['E_o_c', '4'],
      ['T', '20'],
      ['E_k', '5'],
      ['G_k', '7'],
    ])
    // The pair inside the outer super-module set T to 10, which the outer one may override; k, outside it, is a conflict.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('the global constant "T" is set to different values')
    expect(warnings[0]).toContain('30 u by "k" (parameterisation "fast")')
  })

  it("names a component parameterisation's rows after the record, keeping the module's globals", () => {
    const components = new Map([['gain:nn', { module_type: 'gain', module_subtype: 'nn', variables_and_units: [['T', 's', 'access', 'global_constant']] }]])
    const rows = componentParameterRows(normaliseModuleRecords([rec('k', 'gain', { parameterisation: 'fast' })]), components, { load })
    expect(rows.map((r) => r.variable_name)).toEqual(['E_k', 'T', 'G_k'])
  })
})

describe('parameter names', () => {
  const paths = [['lv'], ['soma'], ['soma', 'i_M']]

  it('reads super-module rows in the "/" form, as globals, or in the older suffix form', () => {
    expect(supermoduleRowName('lv/E', 'heart', paths)).toEqual({ name: 'E_heart_lv', oldForm: false, global: false })
    expect(supermoduleRowName('soma/i_M/rho_M', 'SN', paths).name).toBe('rho_M_SN_soma_i_M')
    expect(supermoduleRowName('global/R', 'SN', paths)).toEqual({ name: 'R', oldForm: false, global: true })
    expect(supermoduleRowName('rho_M_soma_i_M', 'SN', paths)).toEqual({ name: 'rho_M_SN_soma_i_M', oldForm: true, global: false })
    expect(supermoduleRowName('lv/E', 'heart', paths, { separator: '__' }).name).toBe('E_heart__lv')
    expect(() => supermoduleRowName('rv/E', 'heart', paths)).toThrow(`"rv" is not a submodule of this supermodule (its submodules: ['lv', 'soma', 'soma/i_M']`)
  })

  it('reads host rows in the "/" form as model names, the host winning a merge', () => {
    expect(modelName('heart/lv/E')).toBe('E_heart_lv')
    expect(modelName('heart/lv/E', { separator: '__' })).toBe('E_heart__lv')
    expect(modelName('global/R')).toBe('R')
    expect(mergeDefaultParameters([row('heart/lv/E', '9')], [row('E_heart_lv', '2'), row('T', '1'), row('T', '3')])).toEqual([
      row('E_heart_lv', '9'),
      row('T', '1'),
    ])
  })
})

describe('the super-module registry', () => {
  const template = (entry, file = 'a.json') => supermoduleTemplate(entry, file)

  it('keeps one copy of the same definition, and refuses another file defining it differently', () => {
    const map = new Map()
    expect(registerSupermodule(map, template(PAIR), new Map())).toBe(true)
    expect(registerSupermodule(map, template(PAIR, 'b.json'), new Map())).toBe(false)
    expect(() => registerSupermodule(map, template({ ...PAIR, description: 'other' }, 'b.json'), new Map())).toThrow(
      "supermodule ('pair', 'v1') is defined twice: in a.json and in b.json."
    )
    // the same file again replaces it
    registerSupermodule(map, template({ ...PAIR, description: 'new' }), new Map())
    expect(map.get('pair:v1').description).toBe('new')
  })

  it('refuses a type that is also a component module', () => {
    expect(() => registerSupermodule(new Map(), template(PAIR), new Map([['pair:v1', {}]]))).toThrow(
      "[('pair', 'v1')] are defined both as supermodules and as component modules"
    )
  })

  it('refuses the super-module that closes a nesting cycle, keeping the rest', () => {
    const loop = (name, other) => ({ module_type: name, module_subtype: 's', submodules: [rec('x', other, { subtype: 's' })] })
    const map = new Map()
    registerSupermodule(map, template(loop('loop_a', 'loop_b')), new Map())
    expect(() => registerSupermodule(map, template(loop('loop_b', 'loop_a')), new Map())).toThrow(
      'supermodules nest in a cycle (loop_b/s -> loop_a/s -> loop_b/s).'
    )
    expect([...map.keys()]).toEqual(['loop_a:s'])
  })

  it("resolves a module array's refs through nested super-modules", () => {
    const resolved = resolveModuleRefs([rec('o', 'outer', { subtype: 'v1' }), rec('k', 'gain')], registry(PAIR, OUTER))
    expect([...resolved.components]).toEqual(['gain:nn', 'reader:nn'])
    expect([...resolved.supermodules]).toEqual(['outer:v1', 'pair:v1'])
  })
})
