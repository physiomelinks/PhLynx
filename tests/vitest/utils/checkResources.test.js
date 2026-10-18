import { describe, expect, it } from 'vitest'

import { checkResourcesAreLoaded } from '../../../src/utils/import.js'

describe('checkResourcesAreLoaded', () => {
  const store = (modules, variants, math) => ({ availableModules: new Map(modules), caVariants: new Map(variants), availableMath: new Set(math) })
  const variant = ['arterial_simple:vp__abcdefgh', { moduleRef: 'arterial_simple:vp__abcdefgh', mathRef: 'User_modules.cellml:copy_type' }]

  it("finds a module ref among the CA export's variants kept aside from the library, and checks its math", () => {
    const rows = [{ module_type: 'arterial_simple', module_subtype: 'vp__abcdefgh' }]
    expect(checkResourcesAreLoaded(rows, store([], [variant], ['User_modules.cellml:copy_type'])).resourcesAreLoaded).toBe(true)

    const missing = checkResourcesAreLoaded(rows, store([], [variant], []))
    expect(missing.resourcesAreLoaded).toBe(false)
    expect([...missing.missingResources.math]).toEqual(['User_modules.cellml:copy_type'])
  })

  it('reports a module ref neither the library nor the variants hold', () => {
    const result = checkResourcesAreLoaded([{ module_type: 'arterial_simple', module_subtype: 'vp__zzzzzzzz' }], store([], [variant], []))
    expect([...result.missingResources.modules]).toEqual(['arterial_simple:vp__zzzzzzzz'])
  })
})

describe('checkResourcesAreLoaded with super-modules', () => {
  const rec = (name, module_type, module_subtype, extra = {}) => ({ name, module_type, module_subtype, inp_instances: [], out_instances: [], ...extra })
  const heart = {
    moduleRef: 'heart:v1',
    module_type: 'heart',
    module_subtype: 'v1',
    submodules: [rec('ra', 'chamber', 'v'), rec('aov', 'valve', 'pp'), rec('pace', 'pacer', 's')],
  }
  const pacer = { moduleRef: 'pacer:s', module_type: 'pacer', module_subtype: 's', submodules: [rec('clock', 'clock', 'c')] }
  const store = (modules, supermodules, math = []) => ({
    availableModules: new Map(modules.map(([ref, mathRef]) => [ref, { moduleRef: ref, mathRef }])),
    availableMath: new Set(math),
    availableSupermodules: new Map(supermodules.map((t) => [t.moduleRef, t])),
  })

  it("asks for the leaves' configs and CellML, through nested super-modules, not for the super-module itself", () => {
    const rows = [rec('heart', 'heart', 'v1'), rec('svc', 'venous', 'vp')]
    const status = checkResourcesAreLoaded(rows, store([['valve:pp', 'valve.cellml:valve'], ['venous:vp', 'v.cellml:venous']], [heart, pacer], ['v.cellml:venous']))
    expect([...status.missingResources.modules]).toEqual(['chamber:v', 'clock:c'])
    expect([...status.missingResources.math]).toEqual(['valve.cellml:valve'])
  })

  it('takes a module array that instantiates a super-module, and asks for the parameter files it names', () => {
    const loaded = store([['chamber:v', 'c:c'], ['valve:pp', 'c:c'], ['clock:c', 'c:c']], [heart, pacer], ['c:c'])
    const status = checkResourcesAreLoaded([rec('heart', 'heart', 'v1', { parameterisation: 'rest' })], loaded)
    expect(status.errors).toEqual([])
    expect(status.supermoduleInstances).toEqual(['heart (heart:v1)'])
    expect([...status.missingResources.parameterisations]).toEqual(['heart:v1 parameterisations/rest/rest_parameters.csv'])
    expect(status.resourcesAreLoaded).toBe(false)

    const path = 'lib/heart/versions/v1/parameterisations/rest/rest_parameters.csv'
    const found = checkResourcesAreLoaded([rec('heart', 'heart', 'v1', { parameterisation: 'rest' })], {
      ...loaded,
      caParameterFiles: new Map([[path, []]]),
    })
    expect(found.resourcesAreLoaded).toBe(true)
    // An entry's default parameterisation is read when it is there, as CA reads it, so it is not asked for.
    expect(checkResourcesAreLoaded([rec('heart', 'heart', 'v1')], { ...loaded, availableSupermodules: new Map([['heart:v1', { ...heart, default_parameterisation: 'default' }], ['pacer:s', pacer]]) }).resourcesAreLoaded).toBe(true)

    const unknown = rec('neuron', 'neuron', 'sym', { per_submodule_inputs: { soma: ['x'] } })
    expect(checkResourcesAreLoaded([unknown], store([], [])).supermoduleInstances).toEqual(['neuron (neuron:sym)'])
  })

  it('stops on a parameter file several dropped files could be, naming them', () => {
    const loaded = store([['chamber:v', 'c:c'], ['valve:pp', 'c:c'], ['clock:c', 'c:c']], [heart, pacer], ['c:c'])
    const paths = ['a/heart/versions/v1/parameterisations/rest/rest_parameters.csv', 'b/heart/versions/v1/parameterisations/rest/rest_parameters.csv']
    const status = checkResourcesAreLoaded([rec('heart', 'heart', 'v1', { parameterisation: 'rest' })], {
      ...loaded,
      caParameterFiles: new Map(paths.map((path) => [path, []])),
    })
    expect(status.errors).toEqual([expect.stringContaining(`matches several files: ${paths.join(', ')}`)])
    expect(status.missingResources.parameterisations.size).toBe(0)
    expect(status.resourcesAreLoaded).toBe(false)
  })

  it('stops on a named parameter file that could not be read, and leaves out a default one with a note', () => {
    const withDefault = { ...heart, default_parameterisation: 'default' }
    const loaded = store([['chamber:v', 'c:c'], ['valve:pp', 'c:c'], ['clock:c', 'c:c']], [withDefault, pacer], ['c:c'])
    const rest = 'lib/heart/versions/v1/parameterisations/rest/rest_parameters.csv'
    const fallback = 'lib/heart/versions/v1/parameterisations/default/default_parameters.csv'
    const files = { caParameterFiles: new Map([[rest, null], [fallback, null]]), caParameterFileErrors: new Map([[rest, 'no rows'], [fallback, 'no rows']]) }

    const named = checkResourcesAreLoaded([rec('heart', 'heart', 'v1', { parameterisation: 'rest' })], { ...loaded, ...files })
    expect(named.errors).toEqual([`Parameter file ${rest}: no rows`])

    const optional = checkResourcesAreLoaded([rec('heart', 'heart', 'v1')], { ...loaded, ...files })
    expect(optional.errors).toEqual([])
    expect(optional.notes).toEqual([`Parameter file ${fallback} is left out: no rows`])
    expect(optional.resourcesAreLoaded).toBe(true)
  })

  it('stops on a module array the import could not expand', () => {
    const loaded = store([['chamber:v', 'c:c'], ['valve:pp', 'c:c'], ['clock:c', 'c:c']], [heart, pacer], ['c:c'])
    const status = checkResourcesAreLoaded([rec('heart', 'heart', 'v1', { per_submodule_inputs: { nope: ['x'] } })], loaded)
    expect(status.errors).toEqual([expect.stringContaining('"heart"')])
    expect(status.resourcesAreLoaded).toBe(false)
  })

  it('reports staging errors and nesting cycles without looping', () => {
    const loopA = { moduleRef: 'a:s', submodules: [rec('b', 'b', 's')] }
    const loopB = { moduleRef: 'b:s', submodules: [rec('a', 'a', 's')] }
    const status = checkResourcesAreLoaded([rec('x', 'a', 's')], { ...store([], [loopA, loopB]), supermoduleErrors: ['clash'] })
    expect(status.errors.slice(0, 2)).toEqual(['clash', 'Supermodules nest in a cycle (a/s -> b/s -> a/s).'])
  })
})
