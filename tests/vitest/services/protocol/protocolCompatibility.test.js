import { describe, expect, it } from 'vitest'

import { findCircAutogenLimits } from '../../../../src/services/protocol/protocolCompatibility.js'
import { readProtocolInfo } from '../../../../src/services/protocol/protocolModel.js'
import { validateProtocolInfo } from '../../../../src/services/protocol/protocolValidation.js'

const VIEW = readProtocolInfo(
  validateProtocolInfo({
    pre_times: [0, 0],
    sim_times: [[1, 1], [1]],
    params_to_change: { 'a/k': [['up', 1], ['up']], 'a/x': [[0, 1], ['up']], 'a/c': [[2, 'up'], [3]] },
    protocol_shapes: { up: { type: 'ramp', from: 0, to: 1 } },
  }).protocolInfo
)

describe('findCircAutogenLimits', () => {
  it("lists the sub-experiments with more than one input changing over time, and states changing over time", () => {
    expect(findCircAutogenLimits(VIEW, { kinds: new Map([['a/x', 'state']]) })).toEqual([
      "CUFLynx can't run experiment 2, sub-experiment 1: a/k and a/x all change over time, and it follows only one at once.",
      "CUFLynx can't run a/x changing over time, as it is a state.",
    ])
  })

  it('finds nothing in a protocol CA runs', () => {
    expect(findCircAutogenLimits(readProtocolInfo(validateProtocolInfo({ pre_times: [0], sim_times: [[1]], params_to_change: { 'a/k': [[1]] } }).protocolInfo))).toEqual([])
  })
})
