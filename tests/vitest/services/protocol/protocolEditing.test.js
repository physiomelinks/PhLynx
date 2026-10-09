import { describe, expect, it } from 'vitest'

import { readProtocolInfo, buildShapeFromForm, readShapeForm } from '../../../../src/services/protocol/protocolModel.js'
import { compileProtocolPlan } from '../../../../src/services/protocol/libopencorEngine/protocolPlan.js'
import { normaliseShape } from '../../../../src/services/protocol/protocolShapes.js'
import {
  addEmptyExperiment,
  addExperiment,
  alignWithWarmUp,
  addParameter,
  addSubExperiment,
  ensureProtocol,
  findObservationsAt,
  moveExperiment,
  removeExperiment,
  removeParameter,
  removeSubExperiment,
  setInput,
  setTiming,
  setValue,
} from '../../../../src/services/protocol/protocolEditing.js'
import { validateProtocolInfo } from '../../../../src/services/protocol/protocolValidation.js'

const DOCUMENT = {
  protocol_info: {
    pre_times: [1, 2],
    sim_times: [[1, 2], [3]],
    params_to_change: { 'a/k': [[1, 'p'], [3]] },
    protocol_shapes: { p: { events: [{ level: 1, length: 1 }] } },
    experiment_labels: ['rest', 'exercise'],
    experiment_colors: ['r', 'b'],
    comment: 'kept',
  },
  data_items: [
    { data_item_name: 'first', subexperiment_idx: 1 },
    { data_item_name: 'second', experiment_idx: 1 },
  ],
  prediction_items: [{ data_item_name: 'shown', experiment_idx: 1 }],
  unknown: { kept: true },
}

/** Checks a document still reads as CA reads it. */
const expectValid = (document) => expect(validateProtocolInfo(document.protocol_info).errors).toEqual([])

describe('protocolEditing', () => {
  it('starts a protocol of one experiment, keeping the data items of a bare list', () => {
    expect(ensureProtocol([{ data_item_name: 'x' }])).toEqual({
      data_items: [{ data_item_name: 'x' }],
      protocol_info: { pre_times: [0], sim_times: [[1]], params_to_change: {} },
    })
  })

  it('copies an experiment, without changing the document given', () => {
    const before = JSON.stringify(DOCUMENT)
    const edited = addExperiment(DOCUMENT, 0)
    expect(JSON.stringify(DOCUMENT)).toBe(before)
    expect(edited.protocol_info).toMatchObject({
      pre_times: [1, 2, 1],
      sim_times: [[1, 2], [3], [1, 2]],
      // The copy's pulse is its own.
      params_to_change: { 'a/k': [[1, 'p'], [3], [1, 'a_k_e2s1']] },
      experiment_labels: ['rest', 'exercise', 'rest (copy)'],
      experiment_colors: ['r', 'b', 'g'],
      comment: 'kept',
    })
    expect(edited.unknown).toEqual({ kept: true })
    expectValid(edited)
  })

  it('adds an experiment afresh, each parameter at the value given for it', () => {
    const edited = addEmptyExperiment(DOCUMENT, { duration: 5, values: new Map([['a/k', 0.5]]) })
    expect(edited.protocol_info).toMatchObject({
      pre_times: [1, 2, 0],
      sim_times: [[1, 2], [3], [5]],
      params_to_change: { 'a/k': [[1, 'p'], [3], [0.5]] },
      experiment_labels: ['rest', 'exercise', 'Experiment 3'],
      experiment_colors: ['r', 'b', 'g'],
    })
    expectValid(edited)
  })

  it('removes an experiment and its observations, renumbering the rest', () => {
    const edited = removeExperiment(DOCUMENT, 0)
    expect(edited.protocol_info).toMatchObject({ pre_times: [2], sim_times: [[3]], experiment_labels: ['exercise'] })
    expect(edited.data_items).toEqual([{ data_item_name: 'second', experiment_idx: 0 }])
    expect(edited.prediction_items).toEqual([{ data_item_name: 'shown', experiment_idx: 0 }])
    // Its pulse is no longer used, which CA refuses, so it goes too.
    expect(edited.protocol_info.protocol_shapes).toEqual({})
    expectValid(edited)
  })

  it('moves an experiment, its observations with it', () => {
    const edited = moveExperiment(DOCUMENT, 1, 0)
    expect(edited.protocol_info.experiment_labels).toEqual(['exercise', 'rest'])
    expect(edited.protocol_info.params_to_change['a/k']).toEqual([[3], [1, 'p']])
    expect(edited.data_items).toEqual([
      { data_item_name: 'first', subexperiment_idx: 1, experiment_idx: 1 },
      { data_item_name: 'second', experiment_idx: 0 },
    ])
    expectValid(edited)
  })

  it('adds and removes sub-experiments, carrying each input on from where it ended, and renumbering observations', () => {
    const added = addSubExperiment(DOCUMENT, 0)
    expect(added.protocol_info.sim_times[0]).toEqual([1, 2, 2])
    // The pulse of 1 lasting 1 has ended by the end of its 2.
    expect(added.protocol_info.params_to_change['a/k'][0]).toEqual([1, 'p', 0])
    expectValid(added)

    const removed = removeSubExperiment(DOCUMENT, 0, 0)
    expect(removed.protocol_info.sim_times[0]).toEqual([2])
    expect(removed.data_items).toEqual([{ data_item_name: 'first', subexperiment_idx: 0 }, DOCUMENT.data_items[1]])
    expect(removeSubExperiment(DOCUMENT, 1, 0).protocol_info.sim_times[1]).toEqual([3])
  })

  it('carries a ramp, a step and a trace on from the value each ended on', () => {
    const document = {
      protocol_info: {
        pre_times: [2],
        sim_times: [[4]],
        params_to_change: { 'a/r': [['up']], 'a/s': [['on']], 'a/t': [['rec']], 'a/n': [[7]] },
        protocol_shapes: { up: { type: 'ramp', from: 0, to: 3 }, on: { baseline: 1, events: [{ level: 5, start: 1, length: 9 }] } },
        protocol_traces: { rec: { t: [0, 2, 4], values: [0, 8, 2] } },
      },
    }
    const added = addSubExperiment(document, 0).protocol_info.params_to_change
    // The first sub-experiment's clock starts with the 2 of warm-up, so it ends at 6: the ramp of 4 has ended on 3,
    // and the trace is held at its last value.
    expect(Object.fromEntries(Object.entries(added).map(([name, rows]) => [name, rows[0][1]]))).toEqual({ 'a/r': 3, 'a/s': 5, 'a/t': 2, 'a/n': 7 })
  })

  it('keeps a step held to the end of its sub-experiment as its length changes', () => {
    const document = setInput(
      { protocol_info: { pre_times: [0], sim_times: [[10]], params_to_change: { 'a/k': [[1]] } } },
      { parameter: 'a/k', experiment: 0, sub: 0, shape: buildShapeFromForm({ type: 'step', baseline: 1, level: 5, start: 4 }, 10) }
    )
    const formAt = (edited, duration) => {
      const info = edited.protocol_info
      return readShapeForm(normaliseShape(info.protocol_shapes[info.params_to_change['a/k'][0][0]], 's'), duration)
    }
    expect(formAt(setTiming(document, { experiment: 0, sub: 0, duration: 20 }), 20)).toEqual({ type: 'step', baseline: 1, level: 5, start: 4 })
    expect(formAt(setTiming(document, { experiment: 0, sub: 0, duration: 6 }), 6)).toEqual({ type: 'step', baseline: 1, level: 5, start: 4 })
    expectValid(setTiming(document, { experiment: 0, sub: 0, duration: 6 }))
  })

  it('sets timings, labels, parameters and values', () => {
    let edited = setTiming(DOCUMENT, { experiment: 1, preTime: 0, sub: 0, duration: 5, label: 'run' })
    expect(edited.protocol_info).toMatchObject({ pre_times: [1, 0], sim_times: [[1, 2], [5]], experiment_labels: ['rest', 'run'] })
    edited = addParameter(edited, 'a/g', 0.5)
    expect(edited.protocol_info.params_to_change['a/g']).toEqual([[0.5, 0.5], [0.5]])
    edited = setValue(edited, { parameter: 'a/k', experiment: 0, sub: 1, value: 4 })
    expect(edited.protocol_info.protocol_shapes).toEqual({})
    edited = removeParameter(edited, 'a/g')
    expect(Object.keys(edited.protocol_info.params_to_change)).toEqual(['a/k'])
    expectValid(edited)
    expect(setTiming({ protocol_info: { pre_times: [0], sim_times: [[1]] } }, { experiment: 0, label: 'x' }).protocol_info.experiment_labels).toEqual(['x'])
    // Naming one names the others as they were shown, and a cleared name goes back to its place.
    const unlabelled = { protocol_info: { pre_times: [0, 0, 0], sim_times: [[1], [1], [1]] } }
    const named = setTiming(unlabelled, { experiment: 1, label: ' control ' })
    expect(named.protocol_info.experiment_labels).toEqual(['Experiment 1', 'control', 'Experiment 3'])
    expect(setTiming(named, { experiment: 1, label: '  ' }).protocol_info.experiment_labels).toEqual(['Experiment 1', 'Experiment 2', 'Experiment 3'])
  })

  it('finds the observations of an experiment or a sub-experiment', () => {
    expect(findObservationsAt(DOCUMENT, 1)).toEqual(['second', 'shown'])
    expect(findObservationsAt(DOCUMENT, 0, 1)).toEqual(['first'])
    expect(findObservationsAt([{ data_item_name: 'bare' }], 0, 0)).toEqual(['bare'])
  })

  it("keeps every experiment's inputs its own: editing one never changes another", () => {
    const ramp = (to) => ({ type: 'ramp', from: 0, to })
    const shapeOf = (document, experiment, sub) => {
      const info = document.protocol_info
      return info.protocol_shapes[info.params_to_change['a/k'][experiment][sub]]
    }
    // Duplicated, then the original edited.
    let edited = setInput(addExperiment(DOCUMENT, 0), { parameter: 'a/k', experiment: 0, sub: 1, shape: ramp(9) })
    expect(shapeOf(edited, 0, 1)).toEqual(ramp(9))
    expect(shapeOf(edited, 2, 1)).toEqual(DOCUMENT.protocol_info.protocol_shapes.p)
    // Duplicated, then the copy edited.
    edited = setInput(addExperiment(DOCUMENT, 0), { parameter: 'a/k', experiment: 2, sub: 1, shape: ramp(4) })
    expect(shapeOf(edited, 0, 1)).toEqual(DOCUMENT.protocol_info.protocol_shapes.p)
    // A sub-experiment removed, leaving one under the name of the place it moved to.
    const two = setInput(setInput(DOCUMENT, { parameter: 'a/k', experiment: 0, sub: 0, shape: ramp(1) }), { parameter: 'a/k', experiment: 0, sub: 1, shape: ramp(2) })
    const shifted = removeSubExperiment(addSubExperiment(two, 0), 0, 0)
    edited = setInput(shifted, { parameter: 'a/k', experiment: 0, sub: 1, shape: ramp(7) })
    expect(shapeOf(edited, 0, 0)).toEqual(ramp(2))
    expect(shapeOf(edited, 0, 1)).toEqual(ramp(7))
    expectValid(edited)
  })

  it("writes a cell's own shape or trace under its name, replacing the other", () => {
    let edited = setInput(DOCUMENT, { parameter: 'a/k', experiment: 1, sub: 0, trace: { t: [0, 3], values: [0, 1] } })
    expect(edited.protocol_info.params_to_change['a/k'][1]).toEqual(['a_k_e1s0'])
    expect(edited.protocol_info.protocol_traces).toEqual({ a_k_e1s0: { t: [0, 3], values: [0, 1] } })
    edited = setInput(edited, { parameter: 'a/k', experiment: 1, sub: 0, shape: { type: 'ramp', from: 1, to: 2 } })
    expect(edited.protocol_info.protocol_traces).toEqual({})
    expect(edited.protocol_info.protocol_shapes.a_k_e1s0).toEqual({ type: 'ramp', from: 1, to: 2 })
    expectValid(edited)
  })
})

describe('buildShapeFromForm', () => {
  it.each([
    [{ type: 'step', baseline: 1, level: 2, start: 3 }],
    [{ type: 'pulse', baseline: 0, level: 2, start: 3, end: 5 }],
    [{ type: 'pacing', baseline: 0, level: 1, start: 0.5, length: 0.1, period: 1, multiplier: 3 }],
    [{ type: 'ramp', from: -1, to: 1 }],
  ])('writes %o as the shape it reads back as', (form) => {
    expect(readShapeForm(normaliseShape(buildShapeFromForm(form, 10), 's'), 10)).toEqual(form)
  })
})

describe('alignWithWarmUp', () => {
  /**
   * Plans an experiment of one 4 s sub-experiment after a 2 s warm-up.
   *
   * @param {Object} document
   * @returns {Object}
   */
  const planOf = (document) => {
    const { protocolInfo } = validateProtocolInfo(document.protocol_info)
    const view = readProtocolInfo(protocolInfo)
    const drivers = new Map()
    return compileProtocolPlan({ view, pointInterval: 0.5, drivers })
  }
  const withInput = (leaf, extra) => ({ protocol_info: { pre_times: [2], sim_times: [[4]], params_to_change: { 'a/k': [[leaf]] }, ...extra } })

  it('starts a pulse with its sub-experiment, not with the warm-up, and stops the warning', () => {
    const document = withInput('p', { protocol_shapes: { p: { events: [{ level: 5, start: 1, length: 2 }] } } })
    expect(planOf(document).warnings).toHaveLength(1)
    const shape = normaliseShape(document.protocol_info.protocol_shapes.p, 'p')
    const aligned = alignWithWarmUp(document, { parameter: 'a/k', experiment: 0, shape })
    expectValid(aligned)
    const plan = planOf(aligned)
    expect(plan.warnings).toEqual([])
    // Logged from t = 2, the pulse is 1 to 3 into the sub-experiment, as written.
    expect(plan.experiments[0].segments.filter(({ isLogged }) => isLogged).map(({ timeCourse, values }) => [timeCourse.outputStartTime, values[0].value])).toEqual([
      [2, 0],
      [3, 5],
      [5, 0],
    ])
  })

  it('holds a ramp or a trace at its first value through the warm-up', () => {
    const ramp = alignWithWarmUp(withInput('r', { protocol_shapes: { r: { type: 'ramp', from: 1, to: 3 } } }), { parameter: 'a/k', experiment: 0, shape: { type: 'ramp', from: 1, to: 3 } })
    expect(ramp.protocol_info.protocol_traces.a_k_e0s0).toEqual({ t: [0, 2, 6], values: [1, 1, 3] })
    expectValid(ramp)
    const trace = alignWithWarmUp(withInput('x', { protocol_traces: { x: { t: [0, 1], values: [4, 5] } } }), { parameter: 'a/k', experiment: 0, trace: { t: [0, 1], values: [4, 5] } })
    expect(trace.protocol_info.protocol_traces.a_k_e0s0).toEqual({ t: [0, 2, 3], values: [4, 4, 5] })
    expect(planOf(trace).warnings).toEqual([])
  })
})
