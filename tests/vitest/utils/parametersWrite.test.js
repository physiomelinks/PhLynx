import { describe, expect, it } from 'vitest'

import { parseParametersJson } from '../../../src/utils/parameters/parse.js'
import { parametersFileName, parametersJson } from '../../../src/utils/parameters/write.js'

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
