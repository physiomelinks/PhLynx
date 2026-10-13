import { describe, expect, it } from 'vitest'
import { readProtocolInfo, validateProtocolInfo } from '@physiomelinks/protocol-kit'

import { findShortestFeature, planDrivers, writeDriverMathML, writeTraceMathML } from '../../../../../src/services/protocol/libopencorEngine/protocolDrivers.js'

/**
 * Reads a protocol_info as PhLynx runs it.
 *
 * @param {Object} protocolInfo
 * @returns {Object}
 */
function read(protocolInfo) {
  const { errors, protocolInfo: valid } = validateProtocolInfo(protocolInfo)
  expect(errors).toEqual([])
  return readProtocolInfo(valid)
}

const NAMES = { output: 'driver_1', selector: 'driver_1_selector', value: 'driver_1_value', time: 'time', valueUnits: 'mV', timeUnits: 'second' }

describe('planDrivers', () => {
  it('drives the parameters with a ramp or a trace, numbering each input once', () => {
    const view = read({
      pre_times: [0, 0],
      sim_times: [[1, 2], [2, 1]],
      params_to_change: { 'a/k': [[1, 2], [3, 4]], 'a/u': [[0, 'rec'], ['up', 0]] },
      protocol_shapes: { up: { type: 'ramp', from: 0, to: 1, duration: 2 } },
      protocol_traces: { rec: { t: [0, 1, 2], values: [0, 5, 0] } },
    })
    expect(planDrivers(view)).toEqual([
      {
        parameter: 'a/u',
        name: 'driver_1',
        traces: [
          { t: [0, 1, 2], values: [0, 5, 0] },
          { t: [0, 2], values: [0, 1] },
        ],
        selectors: [
          [0, 1],
          [2, 0],
        ],
      },
    ])
  })
})

describe('writing drivers as math', () => {
  it('nests a long trace only as deep as the log of its length', () => {
    const t = Array.from({ length: 1025 }, (_, i) => i / 1024)
    const mathml = writeTraceMathML({ t, values: t.map(Math.sin) }, NAMES)
    let depth = 0
    let deepest = 0
    for (const tag of mathml.matchAll(/<(\/?)piecewise>/g)) deepest = Math.max(deepest, (depth += tag[1] ? -1 : 1))
    expect(deepest).toBe(11)
  })

  it('keeps units consistent: values in their units, times in time units, and their ratios dimensionless', () => {
    const mathml = writeTraceMathML({ t: [0, 2], values: [1, 3] }, NAMES)
    expect(mathml).toContain('<apply><divide/><apply><minus/><ci>time</ci><cn cellml:units="second">0</cn></apply><cn cellml:units="second">2</cn></apply>')
    expect(mathml).toContain('<cn cellml:units="mV">2</cn>')
    expect(writeTraceMathML({ t: [0], values: [4] }, NAMES)).toBe('<cn cellml:units="mV">4</cn>')
  })

  it("switches between a driver's number and its traces by its selector", () => {
    const mathml = writeDriverMathML({ traces: [{ t: [0, 1], values: [0, 1] }, { t: [0, 1], values: [1, 1] }] }, NAMES)
    expect(mathml.match(/<ci>driver_1_selector<\/ci><cn cellml:units="dimensionless">([\d.]+)<\/cn>/g).map((m) => m.match(/>([\d.]+)</)[1])).toEqual(['0.5', '1.5', '2.5'])
  })

  it('finds the shortest time between points of any trace', () => {
    expect(findShortestFeature([{ traces: [{ t: [0, 1, 1, 1.25] }, { t: [0, 0.5] }] }])).toBe(0.25)
    expect(findShortestFeature([])).toBe(Infinity)
  })
})
