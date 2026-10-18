import { describe, expect, it } from 'vitest'

import {
  applyRowsByName,
  findParameterFile,
  globalRows,
  isParameterisationPath,
  matchParameterFile,
  parameterFileLoader,
  referencedParameterFiles,
  rowIndex,
} from '../../../../src/services/import/caParameters.js'
import { applyParametersToNodes } from '../../../../src/utils/parameters.js'

const rec = (name, module_type, module_subtype, extra = {}) => ({ name, module_type, module_subtype, ...extra })
const HEART = {
  moduleRef: 'heart:v1',
  module_type: 'heart',
  module_subtype: 'v1',
  default_parameterisation: 'default',
  default_parameters: '../legacy.csv',
  submodules: [rec('lv', 'chamber', 'c', { parameterisation: 'lv' }), rec('aov', 'valve', 'pp')],
}

describe('CA parameter files', () => {
  it('recognises a parameterisation by its path', () => {
    expect(isParameterisationPath('heart/versions/v1/parameterisations/default/default_parameters.csv')).toBe(true)
    expect(isParameterisationPath('parameterisations/lv/other.csv')).toBe(false)
    expect(isParameterisationPath('model_parameters.csv')).toBe(false)
  })

  it('finds a file next to its config, else at the library layout', () => {
    const paths = [
      'lib/modules/heart/versions/v1/parameterisations/default/default_parameters.csv',
      'lib/modules/chamber/versions/c/parameterisations/default/default_parameters.csv',
      'lib/modules/heart/versions/legacy.csv',
    ]
    const heart = { module_type: 'heart', module_subtype: 'v1' }
    expect(findParameterFile(paths, new Map(), heart, { parameterisation: 'default' })).toBe(paths[0])
    const configPaths = new Map([['heart:v1', 'lib/modules/heart/versions/v1/heart_v1_modules_config.json']])
    expect(findParameterFile(paths, configPaths, heart, { file: '../legacy.csv' })).toBe(paths[2])
    expect(findParameterFile(paths, configPaths, heart, { parameterisation: 'rest' })).toBeNull()
    const load = parameterFileLoader(new Map(paths.map((path, i) => [path, [i]])), configPaths)
    expect(load({ module_type: 'chamber', module_subtype: 'c' }, { parameterisation: 'default' })).toEqual([1])
  })

  it('falls back to the library layout when the file is not next to the config path known', () => {
    const paths = ['lib/heart/versions/v1/parameterisations/default/default_parameters.csv']
    const heart = { module_type: 'heart', module_subtype: 'v1' }
    // A config picked on its own is known only by its name.
    const configPaths = new Map([['heart:v1', 'heart_v1_modules_config.json']])
    expect(findParameterFile(paths, configPaths, heart, { parameterisation: 'default' })).toBe(paths[0])
  })

  it('gives the candidates when several files match, and the loader names them', () => {
    const paths = [
      'a/heart/versions/v1/parameterisations/default/default_parameters.csv',
      'b/heart/versions/v1/parameterisations/default/default_parameters.csv',
    ]
    const heart = { module_type: 'heart', module_subtype: 'v1' }
    expect(matchParameterFile(paths, new Map(), heart, { parameterisation: 'default' })).toEqual({ path: null, ambiguous: paths })
    expect(findParameterFile(paths, new Map(), heart, { parameterisation: 'default' })).toBeNull()
    const load = parameterFileLoader(new Map(paths.map((path) => [path, []])))
    expect(() => load(heart, { parameterisation: 'default' })).toThrow(/matches several files: a\/heart.*, b\/heart/)
  })

  it('lists what each instance reads: named ones required, an entry default when there', () => {
    const files = referencedParameterFiles([rec('h', 'heart', 'v1'), rec('svc', 'venous', 'vp', { parameterisation: 'default' })], new Map([['heart:v1', HEART]]))
    expect(files.map(({ label, required }) => [label, required])).toEqual([
      ['heart:v1 parameterisations/default/default_parameters.csv', false],
      ['heart:v1 ../legacy.csv', true],
      ['chamber:c parameterisations/lv/lv_parameters.csv', true],
    ])
  })
})

describe('CA parameter rows on modules', () => {
  const node = (id, name, variables) => ({ id, data: { name, variables: variables.map((v) => ({ name: v, value: null, units: 'J', type: 'constant' })) } })

  it('match exact model names, `<variable>_<name>`, where suffix matching also gives `v` the row of `lv`', () => {
    const nodes = [node('a', 'lv', ['E']), node('b', 'v', ['E_l'])]
    const rows = [{ variable_name: 'E_lv', units: 'J', value: '5', data_reference: 'ref' }]
    const { nodes: out, used } = applyRowsByName(nodes, rowIndex(rows))
    expect(out.map((n) => n.data.variables.map((v) => v.value))).toEqual([['5'], [null]])
    expect([...used]).toEqual(['E_lv'])
    expect([...applyParametersToNodes(nodes, rows).variablesById.keys()]).toEqual(['a', 'b'])
  })

  it('gives the rows no module took that name a variable to global constants, the first winning', () => {
    const nodes = [node('a', 'soma', ['R', 'C'])]
    const rows = ['R:1', 'C_soma:2', 'R:3', 'X:4'].map((text) => {
      const [variable_name, value] = text.split(':')
      return { variable_name, units: 'u', value, data_reference: '' }
    })
    const { used } = applyRowsByName(nodes, rowIndex(rows))
    expect(globalRows(rows, used, nodes)).toEqual([{ name: 'R', value: '1', units: 'u', data_reference: '' }])
  })
})
