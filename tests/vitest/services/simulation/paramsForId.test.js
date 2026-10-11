import { describe, expect, it } from 'vitest'

import {
  PARAMS_FOR_ID_COLUMNS,
  buildParamsForIdLocation,
  findParamsForIdExtra,
  looksLikeParamsForIdLocation,
  paramsForIdRowsFromSelections,
  parseParamsForId,
  resolveParamsForIdExport,
  resolveParamsForIdRows,
  serialiseParamsForId,
} from '../../../../src/services/simulation/paramsForId.js'

// A real CUFLynx params_for_id.csv, whitespace-padded as CA writes it.
const EXAMPLE_CSV = `vessel_name,                  param_name,       param_type,  min,        max,     name_for_plotting
global,                        q_lv_init,        const,       200e-6,     1500e-6,  q_{sbv}
aortic_root,                   C,                const,       1e-9,       5e-8,     C_{ao}
global,                        E_lv_A,           const,       1e8,        5e8,      E_{lvA}
global,                        E_lv_B,           const,       1e6,        5e7,      E_{lvB}
`

const getGlobalConstant = () => undefined
const nodes = [
  {
    id: 'n1',
    data: {
      name: 'aortic_root',
      variables: [{ name: 'C', type: 'constant', value: '2e-8', units: 'F' }],
    },
  },
  {
    id: 'n2',
    data: {
      name: 'heart',
      variables: [
        { name: 'q_lv_init', type: 'global_constant', value: '800e-6' },
        { name: 'E_lv_A', type: 'global_constant', value: '2e8' },
        { name: 'E_lv_B', type: 'global_constant', value: '2e7' },
        { name: 'v', type: 'variable' },
      ],
    },
  },
]

describe('params_for_id', () => {
  it('recognises a params_for_id filename', () => {
    expect(looksLikeParamsForIdLocation('3compartment_params_for_id.csv')).toBe(true)
    expect(looksLikeParamsForIdLocation('3compartment_obs_data.json')).toBe(false)
  })

  it('finds the params_for_id extra among an archive’s extras', () => {
    const extras = [{ location: 'model_obs_data.json' }, { location: 'model_params_for_id.csv' }]
    expect(findParamsForIdExtra(extras)).toEqual({ index: 1, entry: extras[1] })
    expect(findParamsForIdExtra([])).toBeNull()
  })

  it('parses the real, whitespace-padded CSV', () => {
    const rows = parseParamsForId(EXAMPLE_CSV)
    expect(rows).toHaveLength(4)
    expect(rows[1]).toEqual({
      vessel_name: 'aortic_root',
      param_name: 'C',
      param_type: 'const',
      min: '1e-9',
      max: '5e-8',
      name_for_plotting: 'C_{ao}',
    })
  })

  it('rejects a file missing a required column', () => {
    expect(() => parseParamsForId('vessel_name,param_name,param_type,min,max\nglobal,x,const,0,1')).toThrow(/name_for_plotting/)
  })

  it('resolves rows against the workspace, as sliders with the file’s range and label', () => {
    const rows = parseParamsForId(EXAMPLE_CSV)
    const { selections, warnings } = resolveParamsForIdRows(rows, nodes, getGlobalConstant)
    expect(warnings).toEqual([])
    expect(selections).toHaveLength(4)
    expect(selections.find((s) => s.parameterName === 'C')).toMatchObject({
      nodeId: 'n1',
      nodeName: 'aortic_root',
      type: 'constant',
      min: 1e-9,
      max: 5e-8,
      label: 'C_{ao}',
    })
    expect(selections.find((s) => s.parameterName === 'q_lv_init')).toMatchObject({
      nodeId: 'n2',
      type: 'global_constant',
      min: 200e-6,
      max: 1500e-6,
      label: 'q_{sbv}',
    })
  })

  it('warns about and skips a row that names no variable in the workspace', () => {
    const rows = parseParamsForId('vessel_name,param_name,param_type,min,max,name_for_plotting\nghost_vessel,x,const,0,1,\n')
    const { selections, warnings } = resolveParamsForIdRows(rows, nodes, getGlobalConstant)
    expect(selections).toEqual([])
    expect(warnings).toEqual(['ghost_vessel/x: not found in this workspace.'])
  })

  it('warns about and skips a row naming a non-slidable variable', () => {
    const rows = parseParamsForId('vessel_name,param_name,param_type,min,max,name_for_plotting\nheart,v,const,0,1,\n')
    const { selections, warnings } = resolveParamsForIdRows(rows, nodes, getGlobalConstant)
    expect(selections).toEqual([])
    expect(warnings).toEqual(["heart/v: not a constant, so it can't have a slider."])
  })

  it('round-trips selections to rows and back to a CSV with the right columns', () => {
    const rows = parseParamsForId(EXAMPLE_CSV)
    const { selections } = resolveParamsForIdRows(rows, nodes, getGlobalConstant)
    const rebuilt = paramsForIdRowsFromSelections(selections)
    expect(rebuilt.find((row) => row.param_name === 'C')).toEqual({
      vessel_name: 'aortic_root',
      param_name: 'C',
      param_type: 'const',
      min: 1e-9,
      max: 5e-8,
      name_for_plotting: 'C_{ao}',
    })
    expect(rebuilt.find((row) => row.param_name === 'q_lv_init').vessel_name).toBe('global')

    const csv = serialiseParamsForId(rebuilt)
    expect(csv.split(/\r?\n/)[0]).toBe(PARAMS_FOR_ID_COLUMNS.join(','))
    expect(parseParamsForId(csv)).toHaveLength(4)
  })

  it('names a new file after the model, as CA does, falling back to a flat name', () => {
    expect(buildParamsForIdLocation('3compartment')).toBe('3compartment_params_for_id.csv')
    expect(buildParamsForIdLocation()).toBe('params_for_id.csv')
  })

  describe('resolveParamsForIdExport', () => {
    const selections = [{ nodeName: 'cell', parameterName: 'k', type: 'constant', min: 1, max: 2, label: null }]

    it('is null when there are no sliders, so an untouched extra passes through verbatim', () => {
      expect(resolveParamsForIdExport([], [{ location: 'model_params_for_id.csv' }])).toBeNull()
      expect(resolveParamsForIdExport(null, [])).toBeNull()
    })

    it('names a fresh file when the archive has no params_for_id extra yet', () => {
      const result = resolveParamsForIdExport(selections, [])
      expect(result.location).toBe('params_for_id.csv')
      expect(result.csv).toContain('cell,k,const,1,2,')
    })

    it('reuses an existing extra’s own filename, refreshed from the current sliders', () => {
      const preservedExtras = [{ location: 'model_params_for_id.csv', format: 'text/csv', payload: 'stale' }]
      const result = resolveParamsForIdExport(selections, preservedExtras)
      expect(result.location).toBe('model_params_for_id.csv')
      expect(result.csv).toContain('cell,k,const,1,2,')
      expect(result.csv).not.toContain('stale')
    })
  })
})
