import { describe, expect, it } from 'vitest'

import {
  buildParameterOverrides,
  buildParameterScanRows,
  computeScanBounds,
  createSliderDefinition,
  isSlidableRow,
  pickDefaultValue,
  putSlider,
  removeSlider,
  sliderValueKey,
} from '../../../../src/services/simulation/parameterSliders.js'

const GLOBALS = { R: { value: '8.314' } }
const getGlobalConstant = (name) => GLOBALS[name]
const node = {
  id: 'n1',
  data: {
    name: 'cell',
    variables: [
      { name: 'k', type: 'constant', value: '2', units: 'per_second' },
      { name: 'R', type: 'global_constant', value: '1' },
      { name: 'x_init', type: 'constant', value: '0.5' },
      { name: 'v', type: 'variable' },
      { name: 'u', type: 'boundary_condition', value: '1' },
    ],
  },
}

describe('parameter sliders', () => {
  it('offers constants, global constants and initial values', () => {
    expect(node.data.variables.filter(isSlidableRow).map((row) => row.name)).toEqual(['k', 'R', 'x_init'])
  })

  it('takes a global constant’s shared value rather than the node’s copy', () => {
    expect(pickDefaultValue(node.data.variables[1], getGlobalConstant)).toBe(8.314)
    expect(pickDefaultValue({ type: 'constant', value: 'abc' }, getGlobalConstant)).toBeNull()
  })

  it('starts a slider 10% either side of the value', () => {
    expect(computeScanBounds(2)).toEqual({ min: 1.8, max: 2.2 })
    expect(computeScanBounds(null)).toEqual({ min: null, max: null })
  })

  it('defines a slider as a parameter scan selection', () => {
    expect(createSliderDefinition(node, node.data.variables[0], getGlobalConstant)).toEqual({
      key: 'n1::k',
      nodeId: 'n1',
      nodeName: 'cell',
      parameterName: 'k',
      selected: true,
      units: 'per_second',
      type: 'constant',
      min: 1.8,
      default: 2,
      max: 2.2,
      step: null,
      label: null,
    })
  })

  it('lists scan rows, keeping an existing slider’s settings', () => {
    const existing = new Map([['n1::k', { selected: true, min: 0, max: 5, default: 3, step: 0.5, label: 'k_{ao}' }]])
    const rows = buildParameterScanRows([node], existing, getGlobalConstant)
    expect(rows.map((row) => row.parameterName)).toEqual(['k', 'R', 'x_init'])
    expect(rows[0]).toMatchObject({ selected: true, min: 0, max: 5, default: 3, step: 0.5, label: 'k_{ao}' })
    expect(rows[2]).toMatchObject({ selected: false, default: 0.5, label: null })
  })

  it('adds, replaces and removes sliders, keeping other config', () => {
    const definition = createSliderDefinition(node, node.data.variables[0], getGlobalConstant)
    const added = putSlider({ other: true, selections: [] }, definition)
    const replaced = putSlider(added, { ...definition, max: 9 })
    expect(replaced).toEqual({ other: true, selections: [{ ...definition, max: 9 }] })
    expect(removeSlider(replaced, 'n1::k')).toEqual({ other: true, selections: [] })
  })

  it('keeps one value for every slider on a global constant', () => {
    const onA = createSliderDefinition(node, node.data.variables[1], getGlobalConstant)
    const onB = createSliderDefinition({ ...node, id: 'n2' }, node.data.variables[1], getGlobalConstant)
    expect(sliderValueKey(onA)).toBe('global::R')
    expect(sliderValueKey(onB)).toBe('global::R')
    expect(sliderValueKey(createSliderDefinition(node, node.data.variables[0], getGlobalConstant))).toBe('n1::k')
  })

  it('turns slider values into row and global overrides, for defined sliders only', () => {
    const definitions = [
      createSliderDefinition(node, node.data.variables[0], getGlobalConstant),
      createSliderDefinition(node, node.data.variables[1], getGlobalConstant),
    ]
    const overrides = buildParameterOverrides(definitions, new Map([['n1::k', 3], ['global::R', 9], ['gone::x', 1]]))
    expect([...overrides.rows]).toEqual([['n1::k', 3]])
    expect([...overrides.globals]).toEqual([['R', 9]])
  })
})
