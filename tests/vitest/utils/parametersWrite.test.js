import { describe, expect, it } from 'vitest'

import { parseParametersJson } from '../../../src/utils/parameters/parse.js'
import { modelParametersJson, parametersFileName, parametersJson } from '../../../src/utils/parameters/write.js'

describe('parametersJson', () => {
  it('reads back as the set it was written from', async () => {
    const text = `{
 "schema_version": 1,
 "global": {"F": {"value": 96485.3321, "units": "C_per_mol", "data_reference": "phlynx", "sourced": "no"}},
 "K_1": {"value": 1e-3, "units": "per_fmol", "data_reference": "paper", "sourced": "yes"},
 "K_2": {"value": "EMPTY_MUST_BE_FILLED", "units": "per_fmol", "data_reference": "phlynx"}
}`
    const file = await parseParametersJson(text, 'NKA_parameters.json')

    const written = await parseParametersJson(parametersJson(file), 'NKA_parameters.json')

    expect(written.kind).toBe('module')
    expect(written.globals).toEqual(file.globals)
    expect(written.values).toEqual(file.values)
    expect(written.values.get('K_1').value).toBe('1e-3')
  })

  it('names the file as a ref resolves', () => {
    expect(parametersFileName('lumen_calibrated')).toBe('lumen_calibrated_parameters.json')
  })
})

describe('modelParametersJson', () => {
  const param = (value, extra = {}) => ({ value, units: 'J_per_m3', data_reference: 'paper', extra })

  it('reads back as the model it was written from, sub-instances nested', async () => {
    const model = {
      globals: new Map([['T', param('1')]]),
      instances: new Map([
        ['aortic_root', new Map([['C', param('1.2e-8', { origin: 'measured' })]])],
        ['heart', new Map([['T', param(null)]])],
        ['heart/lv', new Map([['E_A', param('366575000')]])],
      ]),
    }
    const text = modelParametersJson(model)
    expect(JSON.parse(text).heart.lv.E_A.value).toBe(366575000)
    expect(text).toContain('"C": {"value": 1.2e-8, "units": "J_per_m3", "data_reference": "paper", "origin": "measured"}')

    const written = await parseParametersJson(text, 'model_parameters.json')
    expect(written.kind).toBe('model')
    expect(written.globals).toEqual(model.globals)
    expect(written.instances).toEqual(model.instances)
  })

  it('keeps the first of an entry and a sub-instance of one name', () => {
    const instances = new Map([
      ['a', new Map([['lv', param('1')]])],
      ['a/lv', new Map([['E', param('2')]])],
    ])
    expect(JSON.parse(modelParametersJson({ globals: new Map(), instances }))).toEqual({
      schema_version: 1,
      a: { lv: { value: 1, units: 'J_per_m3', data_reference: 'paper' } },
    })
  })
})
