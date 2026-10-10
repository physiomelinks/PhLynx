import { describe, expect, it } from 'vitest'

import {
  buildFeatureSegments,
  buildOperandTime,
  computeRunFeatures,
  listFeatureOperands,
  resolveFeatureOperands,
} from '../../../../src/services/simulation/protocolFeatures.js'

const NODES = [{ id: 'n1', data: { name: 'soma_SN' } }]
const MAPPING = new Map([
  ['n1::g_M', 'instance_parameters/g_M_soma_SN'],
  ['n1::i_M', 'soma_SN/i_M'],
])
const VARIABLES = new Map([
  ['instance_parameters/g_M_soma_SN', { kind: 'constant' }],
  ['soma_SN/i_M', { kind: 'algebraic' }],
  ['soma_SN/V', { kind: 'state' }],
])

/**
 * Writes a feature, as a prediction item.
 *
 * @param {string} name
 * @param {string[]} operands
 * @param {string} operation
 * @param {Object} [extra] - More of its keys.
 * @returns {Object}
 */
const feature = (name, operands, operation, extra = {}) => ({ data_item_name: name, operands, unit: 'nanoA', operation, ...extra })

const PROTOCOL_INFO = { pre_times: [1], sim_times: [[2, 2]], params_to_change: { 'soma_SN/g_M': [[1, 2]] } }

describe('listFeatureOperands', () => {
  it("lists what the features reduce, once each, leaving out traces and series", () => {
    const document = {
      protocol_info: PROTOCOL_INFO,
      prediction_items: [
        feature('peak', ['soma_SN/i_M'], 'max'),
        feature('mean', ['soma_SN/i_M'], 'mean_in_range', { operation_kwargs: { start_frac: 0, end_frac: 0.5 } }),
        { data_item_name: 'V', operands: ['soma_SN/V'], unit: 'mV' },
        feature('series', ['soma_SN/V'], 'max', { data_type: 'series' }),
        // A legacy item records the variable it is named after.
        { variable: 'soma_SN/g_M', unit: 'S', operation: 'max' },
        feature('when', ['time'], 'mean'),
      ],
    }
    expect(listFeatureOperands(document)).toEqual(['soma_SN/i_M', 'soma_SN/g_M', 'time'])
    expect(listFeatureOperands(undefined)).toEqual([])
    expect(listFeatureOperands([{ variable: 'x' }])).toEqual([])
  })

  it("adds the constant data items' operands after the prediction items'", () => {
    const document = {
      protocol_info: PROTOCOL_INFO,
      data_items: [
        feature('peak_obs', ['soma_SN/V'], 'max', { value: 1, std: 0.1 }),
        feature('peak_again', ['soma_SN/i_M'], 'max', { value: 1, std: 0.1 }),
        feature('trace', ['axon/x'], 'max', { data_type: 'series', value: [1, 2] }),
        { data_item_name: 'no_operation', operands: ['axon/y'], unit: 'mV', value: 1 },
      ],
      prediction_items: [feature('peak', ['soma_SN/i_M'], 'max')],
    }
    expect(listFeatureOperands(document)).toEqual(['soma_SN/i_M', 'soma_SN/V'])
    expect(listFeatureOperands([feature('bare', ['axon/z'], 'min', { value: 1 })])).toEqual(['axon/z'])
  })
})

describe('resolveFeatureOperands', () => {
  it('finds each operand as a protocol parameter is found, leaving out the time and what the model lacks', () => {
    const operands = resolveFeatureOperands({ operands: ['soma_SN/g_M', 'soma_SN/V', 'axon/x', 'time'], nodes: NODES, mapping: new Map(MAPPING), variables: VARIABLES })
    expect(operands).toEqual(new Map([['soma_SN/g_M', 'instance_parameters/g_M_soma_SN'], ['soma_SN/V', 'soma_SN/V']]))
  })
})

describe('buildOperandTime', () => {
  it("gives CA's time: the first sub-experiment's from the end of the warm-up, a later one's from its start", () => {
    const subs = [
      { duration: 2, numberOfSteps: 2 },
      { duration: 2, numberOfSteps: 2 },
    ]
    expect([...buildOperandTime(1, subs, 0)]).toEqual([0, 1, 2])
    expect([...buildOperandTime(1, subs, 1)]).toEqual([3, 4, 5])
  })
})

describe('computeRunFeatures', () => {
  // One experiment of two sub-experiments, whose second doubles g_M, and so i_M at its first point.
  const RESULTS = {
    experiments: [
      {
        voi: { values: new Float64Array([0, 1, 2, 3, 4]) },
        variables: new Map([
          ['soma_SN/i_M', { kind: 'algebraic', values: new Float64Array([1, 2, 3, 3, 3]) }],
          ['instance_parameters/g_M_soma_SN', { kind: 'constant', values: new Float64Array([1, 1, 1, 2, 2]) }],
        ]),
        preTime: 1,
        subs: [
          { startIndex: 0, endIndex: 2, duration: 2, numberOfSteps: 2 },
          { startIndex: 2, endIndex: 4, duration: 2, numberOfSteps: 2 },
        ],
        subSeries: [
          { 'soma_SN/i_M': new Float64Array([1, 2, 3]), 'instance_parameters/g_M_soma_SN': new Float64Array([1, 1, 1]) },
          { 'soma_SN/i_M': new Float64Array([6, 3, 3]), 'instance_parameters/g_M_soma_SN': new Float64Array([2, 2, 2]) },
        ],
      },
    ],
  }
  const OPERANDS = new Map([
    ['soma_SN/i_M', 'soma_SN/i_M'],
    ['soma_SN/g_M', 'instance_parameters/g_M_soma_SN'],
  ])

  it("reduces each sub-experiment's own series, its first point under its own values, and a constant as one value", () => {
    const document = {
      protocol_info: PROTOCOL_INFO,
      prediction_items: [
        feature('step', ['soma_SN/i_M'], 'max_in_range', { subexperiment_idx: 1, operation_kwargs: { start_frac: 0, end_frac: 0.5 } }),
        feature('before', ['soma_SN/i_M'], 'mean', { subexperiment_idx: 0 }),
        // CA records a constant once, so its range takes no sample.
        feature('g_M', ['soma_SN/g_M'], 'max_in_range', { operation_kwargs: { start_frac: 0, end_frac: 1 } }),
        feature('g_M_mean', ['soma_SN/g_M'], 'mean'),
        feature('when', ['time'], 'mean'),
      ],
    }
    const features = computeRunFeatures(document, RESULTS, OPERANDS)
    expect(features.map(({ name, value }) => [name, value])).toEqual([
      ['step', 6],
      ['before', 2],
      ['g_M', NaN],
      ['g_M_mean', 2],
      ['when', 4],
    ])
    expect(features[2].error).toBe('zero-size array to reduction operation maximum which has no identity')
  })

  it("leaves out a sub-experiment not run to its end, and says so of its features", () => {
    const stopped = { experiments: [{ ...RESULTS.experiments[0], subSeries: [RESULTS.experiments[0].subSeries[0], null] }] }
    expect(buildFeatureSegments(stopped, OPERANDS)[0][1]).toBeNull()
    const [peak] = computeRunFeatures({ protocol_info: PROTOCOL_INFO, prediction_items: [feature('peak', ['soma_SN/i_M'], 'max')] }, stopped, OPERANDS)
    expect(peak).toMatchObject({ value: NaN, error: "Sub-experiment 2 of experiment 1 wasn't run." })
    expect(computeRunFeatures(undefined, RESULTS, OPERANDS)).toEqual([])
  })
})
