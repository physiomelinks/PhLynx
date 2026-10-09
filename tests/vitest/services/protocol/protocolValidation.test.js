import { describe, expect, it } from 'vitest'

import { readAsCircAutogen, validateProtocolInfo } from '../../../../src/services/protocol/protocolValidation.js'

const MINIMAL = { pre_times: [0], sim_times: [[5]], params_to_change: {} }

describe('readAsCircAutogen', () => {
  it('refuses keys outside CA schema, as CA does', () => {
    expect(readAsCircAutogen({ ...MINIMAL, zeta: 1, phlynx_ids: [] }).error).toBe("Unknown protocol_info keys not in schema: ['phlynx_ids', 'zeta']")
  })

  it('needs pre_times and sim_times', () => {
    expect(readAsCircAutogen({ sim_times: null }).error).toBe("Missing required protocol_info keys: ['pre_times', 'sim_times']")
  })

  it('reports values of the wrong type as CA prints them', () => {
    expect(readAsCircAutogen({ ...MINIMAL, comment: 3, params_to_change: [] }).error).toBe(
      "Invalid protocol_info value types:\n" +
        "protocol_info['params_to_change']: expected (<class 'dict'>,), got <class 'list'>\n" +
        "protocol_info['comment']: expected (<class 'str'>,), got <class 'int'>"
    )
  })

  it('fills in the defaults CA gives', () => {
    const { error, protocolInfo } = readAsCircAutogen({ pre_times: [0], sim_times: [[5]] })
    expect(error).toBeNull()
    expect(protocolInfo).toMatchObject({ params_to_change: {}, protocol_traces: {}, protocol_shapes: {}, experiment_labels: null, comment: null })
  })

  it('leaves what it was given alone', () => {
    const given = { ...MINIMAL, params_to_change: { 'a/b': [['s']] }, protocol_shapes: { s: { type: 'ramp', from: 0, to: 1 } } }
    const copy = structuredClone(given)
    expect(readAsCircAutogen(given).protocolInfo.protocol_traces).toEqual({ s: { t: [0, 5], values: [0, 1] } })
    expect(given).toEqual(copy)
  })
})

describe('validateProtocolInfo', () => {
  it('passes a protocol CA and PhLynx can run', () => {
    expect(validateProtocolInfo({ ...MINIMAL, params_to_change: { 'a/b': [[2]] } })).toMatchObject({ errors: [], warnings: [] })
  })

  it("reports CA's error alone, as CA stops there", () => {
    expect(validateProtocolInfo({ ...MINIMAL, extra: 1 })).toEqual({
      errors: ["Unknown protocol_info keys not in schema: ['extra']"],
      warnings: [],
      protocolInfo: null,
    })
  })

  it('needs sub-experiments of positive length and warm-ups of 0 or more', () => {
    const { errors } = validateProtocolInfo({ pre_times: [-1, 0, 0], sim_times: [[1, 0], [], ['x']], params_to_change: {} })
    expect(errors).toEqual([
      'Experiment 1, sub-experiment 2 needs a length greater than 0.',
      'Experiment 2 has no sub-experiments.',
      'Experiment 3, sub-experiment 1 needs a length greater than 0.',
      'Experiment 1 needs a warm-up (pre_time) of 0 or more.',
    ])
    expect(validateProtocolInfo({ pre_times: [], sim_times: [], params_to_change: {} }).errors).toEqual(['The protocol has no experiments.'])
  })

  it('needs a warm-up for each experiment, though CA checks only when parameters change', () => {
    expect(validateProtocolInfo({ pre_times: [0, 0], sim_times: [[1]] }).errors).toEqual(['pre_times has 2 values for 1 experiments.'])
  })

  it('needs a number or a trace for each value', () => {
    expect(validateProtocolInfo({ ...MINIMAL, params_to_change: { 'a/b': [[null]] } }).errors).toEqual([
      'a/b has no number or trace for experiment 1, sub-experiment 1.',
    ])
  })

  it('warns of labels that do not match the experiments, and of a calibration-only warm-up', () => {
    expect(validateProtocolInfo({ ...MINIMAL, experiment_labels: ['a', 'b'], offline_pre_time: 10 }).warnings).toEqual([
      'experiment_labels has 2 entries for 1 experiments.',
      'offline_pre_time is only used for calibration, so PhLynx ignores it.',
    ])
  })
})
