// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { moduleArrayJson } from '../../../src/services/export/ca.js'
import { IMPORT_KEYS } from '../../../src/utils/constants.js'
import { getImportConfig, parseInstanceArrayJson } from '../../../src/utils/import.js'

const jsonFile = (value, name = 'heart_module_array.json') =>
  new File([typeof value === 'string' ? value : JSON.stringify(value)], name)
const record = (name, extra = {}) => ({ name, module_type: 'arterial_simple', module_subtype: 'vp', ...extra })
const parseRows = async (value) => (await parseInstanceArrayJson(jsonFile(value))).data
const hierarchical = (found, name) =>
  `PhLynx doesn't currently support hierarchical model structures (found ${found} on instance '${name}').`

describe('parseInstanceArrayJson', () => {
  it('joins array, string and null instance lists as the CSV parser gives them', async () => {
    const rows = await parseRows([
      record('a', { inp_instances: ['b', ' c '], out_instances: 'd  e' }),
      record('b', { inp_instances: null }),
    ])
    expect(rows).toEqual([
      { ...record('a'), inp_instances: 'b c', out_instances: 'd e' },
      { ...record('b'), inp_instances: '', out_instances: '' },
    ])
  })

  it('drops phlynx_* keys and keeps scalar extras', async () => {
    const rows = await parseRows([record(' a ', { phlynx_position: [1, 2], parameterisation: 'vp_fast' })])
    expect(rows).toEqual([{ ...record('a'), parameterisation: 'vp_fast', inp_instances: '', out_instances: '' }])
  })

  it('returns readiness when given a library store', async () => {
    const store = { availableModules: new Map(), availableMath: new Map() }
    const { completionStatus } = await parseInstanceArrayJson(jsonFile([record('a')]), store)
    expect(completionStatus.missingResources.modules.has('arterial_simple:vp')).toBe(true)
  })

  it.each([
    ['older vessel-array keys', [{ name: 'a', vessel_type: 'arterial', BC_type: 'vp' }], /older vessel-array keys \(found vessel_type on instance 'a'\)/],
    ['per_submodule_* keys', [record('a', { per_submodule_inputs: {} })], hierarchical('per_submodule_inputs', 'a')],
    ['path instance names', [record('a', { out_instances: ['sub/b'] })], hierarchical('sub/b', 'a')],
    ['zero rows', [], 'Instance array file has no rows.'],
    ['missing keys', [{ name: 'a', module_type: 'x' }], 'Invalid instance array file format. Missing keys: module_subtype.'],
  ])('refuses %s', async (_, value, message) => {
    const error = await parseInstanceArrayJson(jsonFile(value)).catch((e) => e)
    expect(error.message).toMatch(message)
    expect(error.unrelated).toBeFalsy()
  })

  it.each([
    ['an object', { schema_version: 1 }],
    ['a config', [{ name: 'x', component_file: 'a.cellml', module_type: 'x', module_subtype: 'y' }]],
    ['records without names', [{ module_type: 'x' }]],
  ])('marks %s unrelated', async (_, value) => {
    await expect(parseInstanceArrayJson(jsonFile(value))).rejects.toMatchObject({ unrelated: true })
  })

  it('reads the export as the CSV parser reads the equivalent CSV', async () => {
    const exported = [
      { ...record('a'), inp_instances: [], out_instances: ['b', 'c'] },
      { ...record('b'), inp_instances: ['a'], out_instances: [], parameterisation: 'vp_fast' },
      { ...record('c'), inp_instances: ['a'], out_instances: [], parameterisation: 'vp_fast' },
    ]
    const csv = [
      'name,module_type,module_subtype,inp_instances,out_instances,parameterisation',
      ...exported.map((r) => [r.name, r.module_type, r.module_subtype, r.inp_instances.join(' '), r.out_instances.join(' '), r.parameterisation].join(',')),
    ].join('\n')
    const field = getImportConfig(IMPORT_KEYS.INSTANCE_ARRAY).fields[0]
    expect(field.accept).toBe('.csv, .json')

    const fromJson = await field.parser(jsonFile(moduleArrayJson(exported)))
    const fromCsv = await field.parser(new File([csv], 'heart_module_array.csv'))
    // The CSV fills a blank column where JSON leaves the key out.
    expect(fromJson.data).toEqual(fromCsv.data.map(({ parameterisation, ...row }) => (parameterisation ? { ...row, parameterisation } : row)))
  })
})

describe('parseConfigJson', () => {
  it('marks a module array unrelated', async () => {
    const parser = getImportConfig(IMPORT_KEYS.MODULE_CONFIG).fields[0].parser
    await expect(parser(jsonFile([record('a', { inp_instances: [] })]))).rejects.toMatchObject({ unrelated: true })
  })
})
