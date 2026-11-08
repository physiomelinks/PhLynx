import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { normaliseConfig } from '../../../src/utils/config.js'
import {
  classifyParametersCsv,
  csvToParameterFile,
  parameterRefOf,
  parseParametersJson,
  reconcileWithConfig,
} from '../../../src/utils/parameters/parse.js'

const resourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../resources/parameters')
const readResource = (name) => readFileSync(path.join(resourceDir, name), 'utf8')
const configOf = (name) => normaliseConfig(JSON.parse(readResource(name))[0])
const leaf = (value, units = 'mM') => ({ value, units, data_reference: 'paper' })
const json = (object) => JSON.stringify({ schema_version: 1, ...object })

describe('parseParametersJson', () => {
  it('reads a module file with its globals, keeping number text and extra keys', async () => {
    const file = await parseParametersJson(readResource('NKA_parameters.json'), 'parameters/NKA_parameters.json')

    expect(file).toMatchObject({ kind: 'module', ref: 'NKA', warnings: [] })
    expect([...file.globals.keys()]).toEqual(['F', 'RTF', 'RT'])
    expect(file.values.size).toBe(35)
    expect(file.values.get('K_6')).toEqual({
      value: '30250.0',
      units: 'per_fmol',
      data_reference: 'phlynx',
      extra: { sourced: 'no' },
    })
    expect(file.values.get('c_H').value).toBe('1e-07')
    expect(file.globals.get('F').value).toBe('96485.3321')
  })

  it('reads a file with no globals', async () => {
    const file = await parseParametersJson(readResource('lumen_parameters.json'), 'lumen_parameters.json')
    expect(file).toMatchObject({ kind: 'module', ref: 'lumen' })
    expect(file.globals.size).toBe(0)
    expect(file.values.get('pH').value).toBe('7.4')
  })

  it('takes a File, naming the ref after it', async () => {
    const file = await parseParametersJson(new File([readResource('Membrane_parameters.json')], 'Membrane_parameters.json'))
    expect(file.ref).toBe('Membrane')
    expect(file.values.get('scale').value).toBe('1e-12')
  })

  it('leaves blank and EMPTY_MUST_BE_FILLED values to be filled, and counts them', async () => {
    const file = await parseParametersJson(
      json({ global: { F: leaf('') }, a: leaf('EMPTY_MUST_BE_FILLED'), b: leaf(null), c: leaf(2) }),
      'x.json'
    )
    expect(['a', 'b', 'c'].map((name) => file.values.get(name).value)).toEqual([null, null, '2'])
    expect(file.globals.get('F').value).toBeNull()
    expect(file.warnings).toEqual(['3 parameters need a value'])
  })

  it('reads a model file by instance, nesting sub-instances as paths', async () => {
    const file = await parseParametersJson(
      json({ global: { F: leaf(1) }, lumen: { area: leaf(2, 'mm2') }, cell: { volume: leaf(3), mito: { volume: leaf(4) } } }),
      'model_parameters.json'
    )
    expect(file.kind).toBe('model')
    expect([...file.instances.keys()].sort()).toEqual(['cell', 'cell/mito', 'lumen'])
    expect(file.instances.get('cell/mito').get('volume').value).toBe('4')
    expect(file.instances.get('lumen').get('area').units).toBe('mm2')
    expect(file.globals.get('F').value).toBe('1')
  })

  it('sorts a config array and an object of no entries as unrelated', async () => {
    await expect(parseParametersJson(readResource('NKA_NKA_modules_config.json'), 'c.json')).rejects.toMatchObject({ unrelated: true })
    await expect(parseParametersJson('{"protocol_info": {"pre_times": [0]}}', 'obs.json')).rejects.toMatchObject({ unrelated: true })
  })

  it.each([
    ['{"K_1": {"value": 1}}', 'not a parameters file (missing schema_version)'],
    ['{"schema_version": 2, "K_1": {"value": 1}}', 'unsupported schema_version 2 (expected 1)'],
    [json({ global: { value: 1, units: 'mM' } }), '`global` cannot be a variable name'],
    [json({ cell: { value: leaf(1), x: leaf(2) } }), '`value` cannot be a variable name'],
    [json({ global: { schema_version: leaf(1) } }), '`schema_version` cannot be a variable name'],
    [json({ K_1: { units: 'mM', data_reference: 'paper' } }), 'entry `K_1` has no `value`'],
  ])('refuses %s', async (text, message) => {
    const error = await parseParametersJson(text, 'x.json').catch((err) => err)
    expect(error.message).toBe(message)
    expect(error.unrelated).toBeUndefined()
  })
})

describe('parameter CSVs', () => {
  const rowsOf = (fields, values) => values.map((row) => Object.fromEntries(fields.map((field, i) => [field, row[i]])))

  it('sorts a file by its columns', () => {
    expect(classifyParametersCsv(['variable_name', 'units', 'value', 'data_reference'])).toBe('B')
    expect(classifyParametersCsv(['variable_name', 'units', 'value', 'data_reference', 'sourced'])).toBe('A')
    expect(classifyParametersCsv(['vessel_type', 'variable_name', 'units', 'value', 'kind', 'data_reference', 'sourced'])).toBe('C')
  })

  it('reads a module library file as one parameterisation, keeping extra columns', () => {
    const fields = ['variable_name', 'units', 'value', 'data_reference', 'sourced']
    const file = csvToParameterFile(rowsOf(fields, [['K_1', 'per_fmol', '0.01673', 'phlynx', 'no']]), 'NKA_parameters.csv')
    expect(file).toMatchObject({ kind: 'module', ref: 'NKA' })
    expect(file.values.get('K_1')).toEqual({ value: '0.01673', units: 'per_fmol', data_reference: 'phlynx', extra: { sourced: 'no' } })
  })

  it("puts a test library file's global constants under its globals", () => {
    const fields = ['vessel_type', 'variable_name', 'units', 'value', 'kind', 'data_reference']
    const file = csvToParameterFile(
      rowsOf(fields, [
        ['vol', 'V', 'm3', '8e-15', 'constant', 'paper'],
        ['vol', 'R', 'J_per_mol_per_K', '8.314', 'global_constant', 'paper'],
      ]),
      'diffusion_volume_parameters.csv'
    )
    expect(file.kind).toBe('module')
    expect([...file.values.keys()]).toEqual(['V'])
    expect([...file.globals.keys()]).toEqual(['R'])
  })

  it("keeps a CA model file's rows for the instance path", () => {
    const rows = [{ variable_name: 'V_vol', units: 'm3', value: '8', data_reference: 'paper' }]
    expect(csvToParameterFile(rows, 'heart_parameters.csv')).toMatchObject({ kind: 'model', ref: 'heart', rows })
  })
})

describe('reconcileWithConfig', () => {
  it('follows the config type of an entry listed under global, and warns', async () => {
    const file = await parseParametersJson(json({ global: { F: leaf(1, 'C_per_mol'), Scale_NKA: leaf(1, 'dim') } }), 'NKA.json')
    const { globals, values, warnings } = reconcileWithConfig(file, configOf('NKA_NKA_modules_config.json'))
    expect([...globals.keys()]).toEqual(['F'])
    expect([...values.keys()]).toEqual(['Scale_NKA'])
    expect(warnings).toEqual(['`Scale_NKA` is listed under global but NKA.cellml:NKA types it constant, so it is applied as one'])
  })

  it('warns of names the config lacks and units that differ, keeping both', async () => {
    const file = await parseParametersJson(json({ area: leaf(1, 'm2'), K_9: leaf(2) }), 'lumen.json')
    const { values, warnings } = reconcileWithConfig(file, configOf('compartment_lumen_modules_config.json'))
    expect([...values.keys()]).toEqual(['area', 'K_9'])
    expect(warnings).toEqual(['`area` units m2 ≠ config mm2', '`K_9` is not a variable of compartment.cellml:compartment'])
  })

  it('moves a value the config types global to the globals, and passes a matching file cleanly', async () => {
    const file = await parseParametersJson(readResource('Membrane_parameters.json'), 'Membrane_parameters.json')
    expect(reconcileWithConfig(file, configOf('membrane_Membrane_modules_config.json')).warnings).toEqual([])

    const csv = csvToParameterFile([{ variable_name: 'RT', units: 'J_per_mol', value: '2560', data_reference: '', sourced: 'no' }], 'NKA.csv')
    const { globals } = reconcileWithConfig(csv, configOf('NKA_NKA_modules_config.json'))
    expect([...globals.keys()]).toEqual(['RT'])
  })
})

describe('parameterRefOf', () => {
  it('takes the stem minus _parameters, with no colons', () => {
    expect(parameterRefOf('a/GLUT2_api_parameters.json')).toBe('GLUT2_api')
    expect(parameterRefOf('lumen_calibrated.json')).toBe('lumen_calibrated')
    expect(parameterRefOf('a:b_parameters.csv')).toBe('a_b')
  })
})
