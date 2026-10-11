import { describe, expect, it } from 'vitest'
import { readProtocolInfo, validateProtocolInfo } from '@physiomelinks/protocol-kit'

import { buildProtocolSedml, readLoggedTimeCourse, SEDML_MODEL, writeTarget } from '../../../../src/services/export/protocolSedml.js'
import { planDrivers } from '../../../../src/services/protocol/libopencorEngine/protocolDrivers.js'
import { prepareProtocolRun } from '../../../../src/services/simulation/protocolRun.js'
import { SERIES_COLOURS } from '../../../../src/services/simulation/seriesSlots.js'

const SETTINGS = { solver: 'CVODE', tolerance: 1e-7, maxSteps: 500, timeStep: 0, pointInterval: 0.5 }

// The decay model as the simulator lists it once a driver for u and the protocol's clock are written in.
const VARIABLES = new Map([
  ['environment/time', { kind: 'voi', unit: 'second' }],
  ['decay/x', { kind: 'state', unit: 'dimensionless' }],
  ['instance_parameters/k', { kind: 'constant', unit: 'per_second' }],
  ['instance_parameters/u', { kind: 'computed', unit: 'per_second' }],
  ['protocol_drivers/driver_1', { kind: 'computed', unit: 'per_second' }],
  ['protocol_drivers/driver_1_selector', { kind: 'constant', unit: 'dimensionless' }],
  ['protocol_drivers/driver_1_value', { kind: 'constant', unit: 'per_second' }],
  ['protocol_clock/time_offset', { kind: 'constant', unit: 'second' }],
  ['protocol_clock/experiment_time', { kind: 'computed', unit: 'second' }],
])

// Two experiments of two sub-experiments, each after a warm-up: k is 0.5 then a pulse in the first, 1 then 2 in the
// second; u ramps (so has a driver) in the first experiment's first sub-experiment, and is a number elsewhere.
const PROTOCOL = {
  pre_times: [1, 1],
  sim_times: [
    [2, 2],
    [2, 2],
  ],
  params_to_change: {
    'instance_parameters/k': [
      [0.5, 'pulse'],
      [1, 2],
    ],
    'instance_parameters/u': [
      ['up', 0],
      [0, 0.5],
    ],
  },
  protocol_shapes: {
    pulse: { events: [{ level: 3, start: 1, length: 0.5 }] },
    up: { type: 'ramp', from: 0, to: 2 },
  },
  experiment_labels: ['Low & "slow" <1>', "High's"],
  experiment_colors: ['r', null],
}

const NS = 'http://sed-ml.org/sed-ml/level1/version4'

/**
 * Prepares a protocol's run as PhLynx does, its parameters named as the model reports them.
 *
 * @param {Object} protocolInfo
 * @param {Map} [variables]
 * @returns {{view: Object, drivers: Array, run: Object}}
 */
function prepare(protocolInfo, variables = VARIABLES) {
  const validated = validateProtocolInfo(protocolInfo)
  expect(validated.errors).toEqual([])
  const view = readProtocolInfo(validated.protocolInfo)
  const drivers = planDrivers(view)
  const run = prepareProtocolRun({ view, drivers, nodes: [], mapping: new Map(), variables, settings: SETTINGS })
  expect(run.errors).toEqual([])
  return { view, drivers, run }
}

/**
 * Builds a protocol's SED-ML, with what the options don't say taken from a plain export of decay/x.
 *
 * @param {Object} prepared - From prepare.
 * @param {Object} [options] - As buildProtocolSedml takes them.
 * @returns {string}
 */
function build({ view, run }, options = {}) {
  return buildProtocolSedml({
    plan: run.plan,
    targets: run.targets,
    variables: VARIABLES,
    settings: run.settings,
    experiments: view.experiments.map(({ label, colour }, e) => ({ label: label ?? `Experiment ${e + 1}`, colour })),
    time: { unit: 'second' },
    groups: [{ id: 'g', name: 'Decay' }],
    traces: [{ name: 'decay/x', label: 'x', unit: 'dimensionless', groupId: 'g' }],
    inputs: null,
    overlay: true,
    ...options,
  })
}

/**
 * Parses SED-ML.
 *
 * @param {string} xml
 * @returns {Document}
 */
function parse(xml) {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  expect(document.getElementsByTagName('parsererror')).toHaveLength(0)
  return document
}

/** Lists the elements of a tag, anywhere below a node. */
const all = (node, tag) => [...node.getElementsByTagName(tag)]
/** Finds the element with an id. */
const byId = (document, id) => all(document, '*').find((node) => node.getAttribute('id') === id)
/** Lists a node's children of a tag. */
const children = (node, tag) => [...node.children].filter((child) => child.localName === tag)
/** Reads a sub-task's changes as `{target: value}`. */
const changesOf = (subTask) =>
  Object.fromEntries(all(subTask, 'setValue').map((change) => [change.getAttribute('target'), Number(all(change, 'cn')[0].textContent)]))
/** Reads a simulation's time course. */
const timeCourseOf = (simulation) =>
  ['initialTime', 'outputStartTime', 'outputEndTime', 'numberOfSteps'].map((name) => Number(simulation.getAttribute(name)))
/** Gives the time course a sub-task's task runs. */
const subTaskCourse = (document, id) => {
  const task = byId(document, byId(document, id).getAttribute('task'))
  return timeCourseOf(byId(document, task.getAttribute('simulationReference')))
}

const K = writeTarget('instance_parameters/k')
const X = writeTarget('decay/x')
const OFFSET = writeTarget('protocol_clock/time_offset')
const SELECTOR = writeTarget('protocol_drivers/driver_1_selector')
const VALUE = writeTarget('protocol_drivers/driver_1_value')

describe('writeTarget', () => {
  it("writes a reported name as the XPath of its CellML variable", () => {
    expect(writeTarget('soma_SN/V')).toBe("/cellml:model/cellml:component[@name='soma_SN']/cellml:variable[@name='V']")
  })
})

describe('readLoggedTimeCourse', () => {
  const timeCourse = { initialTime: 1, outputStartTime: 1, outputEndTime: 3, numberOfSteps: 4 }

  it('keeps a time course whose first point is its own', () => {
    expect(readLoggedTimeCourse({ timeCourse, dropsFirstPoint: false })).toEqual({ timeCourse, isSingle: false })
  })

  it('starts the output a point later when the first point belongs to the segment before', () => {
    expect(readLoggedTimeCourse({ timeCourse, dropsFirstPoint: true })).toEqual({
      timeCourse: { initialTime: 1, outputStartTime: 1.5, outputEndTime: 3, numberOfSteps: 3 },
      isSingle: false,
    })
  })

  it('keeps only the last point of a one-step segment, starting and ending its output there', () => {
    const oneStep = { initialTime: 1, outputStartTime: 1, outputEndTime: 1.5, numberOfSteps: 1 }
    expect(readLoggedTimeCourse({ timeCourse: oneStep, dropsFirstPoint: true })).toEqual({
      timeCourse: { initialTime: 1, outputStartTime: 1.5, outputEndTime: 1.5, numberOfSteps: 1 },
      isSingle: true,
    })
  })
})

describe('buildProtocolSedml', () => {
  const prepared = prepare(PROTOCOL)
  const xml = build(prepared)
  const document = parse(xml)

  it('writes a Level 1 Version 4 document of the model, indented two spaces a level', () => {
    const root = document.documentElement
    expect(root.localName).toBe('sedML')
    expect(root.namespaceURI).toBe(NS)
    expect([root.getAttribute('level'), root.getAttribute('version')]).toEqual(['1', '4'])
    expect(root.getAttribute('xmlns:cellml')).toBe('http://www.cellml.org/cellml/2.0#')
    const [model] = all(document, 'model')
    expect([model.getAttribute('id'), model.getAttribute('language'), model.getAttribute('source')]).toEqual([
      'model',
      'urn:sedml:language:cellml.2_0',
      SEDML_MODEL,
    ])
    expect(SEDML_MODEL).toBe('protocol_model.cellml')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<sedML ')).toBe(true)
    expect(xml).toContain('\n  <listOfModels>\n    <model ')
    // XPaths keep their quotes as written.
    expect(xml).toContain(`target="${X}"`)
  })

  it('writes one simulation and task for each distinct time course, with the run settings', () => {
    const simulations = all(document, 'uniformTimeCourse')
    const courses = simulations.map(timeCourseOf)
    expect(new Set(courses.map(String)).size).toBe(courses.length)
    // The warm-up, both first sub-experiments (shared), the pulse's three parts, the second experiment's second.
    expect(courses).toEqual([
      [0, 0, 1, 2],
      [1, 1, 3, 4],
      [0, 0.5, 1, 1],
      [1, 1.5, 1.5, 1],
      [1.5, 2, 2, 1],
      [0, 0.5, 2, 3],
    ])
    expect(simulations.map((simulation) => simulation.getAttribute('id'))).toEqual(['sim1', 'sim2', 'sim3', 'sim4', 'sim5', 'sim6'])
    const tasks = all(document, 'task')
    expect(tasks.map((task) => [task.getAttribute('id'), task.getAttribute('modelReference'), task.getAttribute('simulationReference')])).toEqual(
      simulations.map((_, n) => [`task${n + 1}`, 'model', `sim${n + 1}`])
    )
    const [algorithm] = all(simulations[0], 'algorithm')
    expect(algorithm.getAttribute('kisaoID')).toBe('KISAO:0000019')
    const parameters = Object.fromEntries(all(algorithm, 'algorithmParameter').map((p) => [p.getAttribute('kisaoID'), p.getAttribute('value')]))
    expect(parameters['KISAO:0000209']).toBe('1e-07')
    expect(parameters['KISAO:0000415']).toBe('500')
  })

  it('runs each experiment afresh: its warm-up, then its sub-experiments, each of its segments', () => {
    const ids = all(document, 'repeatedTask').map((task) => task.getAttribute('id'))
    expect(ids).toEqual(['exp0', 'exp0_warmup', 'exp0_logged', 'exp0_sub0', 'exp0_sub1', 'exp1', 'exp1_warmup', 'exp1_logged', 'exp1_sub0', 'exp1_sub1'])
    const experiment = byId(document, 'exp1')
    expect([experiment.getAttribute('resetModel'), experiment.getAttribute('concatenate'), experiment.getAttribute('range')]).toEqual([
      'true',
      'true',
      'exp1_range',
    ])
    const [range] = all(experiment, 'vectorRange')
    expect(range.getAttribute('id')).toBe('exp1_range')
    expect(all(range, 'value').map((value) => value.textContent)).toEqual(['1'])
    expect(all(experiment, 'subTask').map((subTask) => [subTask.getAttribute('id'), subTask.getAttribute('order'), subTask.getAttribute('task')])).toEqual([
      ['exp1_warmup_st', '1', 'exp1_warmup'],
      ['exp1_logged_st', '2', 'exp1_logged'],
    ])
    expect(byId(document, 'exp1_logged').getAttribute('resetModel')).toBe('false')
    expect(all(byId(document, 'exp1_logged'), 'subTask').map((subTask) => subTask.getAttribute('task'))).toEqual(['exp1_sub0', 'exp1_sub1'])
    expect(all(byId(document, 'exp0_sub1'), 'subTask').map((subTask) => [subTask.getAttribute('id'), subTask.getAttribute('order')])).toEqual([
      ['exp0_s1_seg0', '1'],
      ['exp0_s1_seg1_single', '2'],
      ['exp0_s1_seg2_single', '3'],
    ])
  })

  it("splits the pulse, and keeps only the last point of each one-step part after the first", () => {
    expect(subTaskCourse(document, 'exp0_s1_seg0')).toEqual([0, 0.5, 1, 1])
    expect(subTaskCourse(document, 'exp0_s1_seg1_single')).toEqual([1, 1.5, 1.5, 1])
    expect(subTaskCourse(document, 'exp0_s1_seg2_single')).toEqual([1.5, 2, 2, 1])
    expect(changesOf(byId(document, 'exp0_s1_seg1_single'))[K]).toBe(3)
    expect(changesOf(byId(document, 'exp0_s1_seg2_single'))[K]).toBe(0)
    // The first sub-experiment keeps its first point; the warm-up's is its own.
    expect(subTaskCourse(document, 'exp0_s0_seg0')).toEqual([1, 1, 3, 4])
  })

  it("sets each segment's numbers, the driver's, and the clock's offset before it runs", () => {
    expect(changesOf(byId(document, 'exp0_w0'))).toEqual({ [K]: 0.5, [SELECTOR]: 1, [VALUE]: 0, [OFFSET]: 1 })
    expect(changesOf(byId(document, 'exp0_s0_seg0'))).toEqual({ [K]: 0.5, [SELECTOR]: 1, [VALUE]: 0, [OFFSET]: 1 })
    expect(changesOf(byId(document, 'exp1_s1_seg0'))).toEqual({ [K]: 2, [SELECTOR]: 0, [VALUE]: 0.5, [OFFSET]: -2 })
    expect(all(byId(document, 'exp1_s1_seg0'), 'setValue').every((change) => change.getAttribute('modelReference') === 'model')).toBe(true)
    expect(all(byId(document, 'exp1_s1_seg0'), 'math')[0].namespaceURI).toBe('http://www.w3.org/1998/Math/MathML')
  })

  it("plots each experiment's time and traces over its logged run, not its warm-up", () => {
    const time = byId(document, 'dg_e1_time')
    const [variable] = all(time, 'variable')
    expect([variable.getAttribute('target'), variable.getAttribute('taskReference')]).toEqual([writeTarget('protocol_clock/experiment_time'), 'exp1_logged'])
    expect(all(time, 'ci').map((ci) => ci.textContent)).toEqual(['v'])
    const trace = byId(document, 'dg_e0_tr0')
    expect([all(trace, 'variable')[0].getAttribute('target'), all(trace, 'variable')[0].getAttribute('taskReference')]).toEqual([X, 'exp0_logged'])
    expect(all(document, 'variable').some((v) => v.getAttribute('taskReference').includes('warmup'))).toBe(false)
  })

  it('escapes labels, and colours each experiment as the protocol does or by its slot', () => {
    expect(byId(document, 'dg_e0_tr0').getAttribute('name')).toBe('x · Low & "slow" <1>')
    expect(byId(document, 'c_g0_e1_tr0').getAttribute('name')).toBe("x · High's")
    const colour = (id) => all(byId(document, id), 'line')[0].getAttribute('color')
    expect(colour('style_e0')).toBe('E34948')
    expect(colour('style_e1')).toBe(SERIES_COLOURS.light[1].slice(1).toUpperCase())
    expect(all(byId(document, 'style_e0'), 'line')[0].getAttribute('type')).toBe('solid')
    const given = parse(build(prepared, { experiments: [{ label: 'a', colour: '#ff000080' }, { label: 'b', colour: '#0f0' }] }))
    expect(all(byId(given, 'style_e0'), 'line')[0].getAttribute('color')).toBe('FF000080')
    expect(all(byId(given, 'style_e1'), 'line')[0].getAttribute('color')).toBe('00FF00')
  })

  it("overlays each plot group's experiments, the inputs first, telling a group's traces apart by line", () => {
    const sedml = parse(
      build(prepared, {
        groups: [
          { id: 'g', name: 'States' },
          { id: 'empty', name: 'Nothing' },
        ],
        traces: [
          { name: 'decay/x', label: 'x', unit: 'dimensionless', groupId: 'g' },
          { name: 'protocol_drivers/driver_1', label: 'u', unit: 'per_second', groupId: 'g' },
        ],
        inputs: [{ name: 'instance_parameters/k', label: 'k', unit: 'per_second' }],
      })
    )
    const plots = all(sedml, 'plot2D')
    expect(plots.map((plot) => [plot.getAttribute('id'), plot.getAttribute('name'), plot.getAttribute('legend')])).toEqual([
      ['plot_inputs', 'Inputs', 'true'],
      ['plot_g0', 'States', 'true'],
    ])
    expect(all(plots[0], 'xAxis')[0].getAttribute('name')).toBe('Time (second)')
    expect(all(plots[0], 'yAxis')[0].getAttribute('name')).toBe('k (per_second)')
    expect(all(plots[1], 'yAxis')[0].getAttribute('name')).toBe('States')
    const curves = all(plots[1], 'curve').map((curve) => [curve.getAttribute('id'), curve.getAttribute('style'), curve.getAttribute('xDataReference'), curve.getAttribute('yDataReference')])
    expect(curves).toEqual([
      ['c_g0_e0_tr0', 'style_e0', 'dg_e0_time', 'dg_e0_tr0'],
      ['c_g0_e0_tr1', 'style_e0_l1', 'dg_e0_time', 'dg_e0_tr1'],
      ['c_g0_e1_tr0', 'style_e1', 'dg_e1_time', 'dg_e1_tr0'],
      ['c_g0_e1_tr1', 'style_e1_l1', 'dg_e1_time', 'dg_e1_tr1'],
    ])
    expect(all(plots[0], 'curve')[0].getAttribute('yDataReference')).toBe('dg_e0_in0')
    const dashed = byId(sedml, 'style_e1_l1')
    expect(dashed.getAttribute('baseStyle')).toBe('style_e1')
    expect(all(dashed, 'line')[0].getAttribute('type')).toBe('dash')
    expect(all(sedml, 'figure')).toHaveLength(0)
    expect(all(byId(sedml, 'dg_e0_in0'), 'variable')[0].getAttribute('taskReference')).toBe('exp0_logged')
  })

  it('gives each experiment its own trace plots, in a grid of groups by experiments, when not overlaid', () => {
    const sedml = parse(build(prepared, { overlay: false, inputs: [{ name: 'instance_parameters/k', label: 'k', unit: 'per_second' }] }))
    expect(all(sedml, 'plot2D').map((plot) => plot.getAttribute('id'))).toEqual(['plot_inputs_e0', 'plot_inputs_e1', 'plot_g0_e0', 'plot_g0_e1'])
    expect(byId(sedml, 'plot_g0_e1').getAttribute('name')).toBe("Decay · High's")
    const [figure] = all(sedml, 'figure')
    expect([figure.getAttribute('id'), figure.getAttribute('numRows'), figure.getAttribute('numCols')]).toEqual(['figure_traces', '2', '2'])
    expect(all(figure, 'subPlot').map((subPlot) => [subPlot.getAttribute('plot'), subPlot.getAttribute('row'), subPlot.getAttribute('col')])).toEqual([
      ['plot_inputs_e0', '1', '1'],
      ['plot_inputs_e1', '1', '2'],
      ['plot_g0_e0', '2', '1'],
      ['plot_g0_e1', '2', '2'],
    ])
  })

  it('reports every data generator, and nothing else', () => {
    const dataSets = all(byId(document, 'report'), 'dataSet')
    const generators = all(document, 'dataGenerator')
    expect(dataSets.map((set) => [set.getAttribute('id'), set.getAttribute('label'), set.getAttribute('dataReference')])).toEqual(
      generators.map((g) => [`ds_${g.getAttribute('id')}`, g.getAttribute('name'), g.getAttribute('id')])
    )
    expect(generators.map((g) => g.getAttribute('id'))).toEqual(['dg_e0_time', 'dg_e0_tr0', 'dg_e1_time', 'dg_e1_tr0'])
    expect(all(document, 'variable').some((v) => v.hasAttribute('dimensionTerm'))).toBe(false)
  })

  it("sets a state on the experiment's first segment only, and writes no warm-up without one", () => {
    const state = prepare({
      pre_times: [0.5],
      sim_times: [[2]],
      params_to_change: { 'decay/x': [[0.3]], 'instance_parameters/k': [['pulse']] },
      protocol_shapes: { pulse: { events: [{ level: 3, start: 1, length: 0.5 }] } },
    })
    const sedml = parse(build(state))
    expect(changesOf(byId(sedml, 'exp0_w0'))).toEqual({ [X]: 0.3, [K]: 0, [OFFSET]: 0.5 })
    expect(changesOf(byId(sedml, 'exp0_s0_seg0'))).toEqual({ [K]: 0, [OFFSET]: 0.5 })
    expect(changesOf(byId(sedml, 'exp0_s0_seg1_single'))).toEqual({ [K]: 3, [OFFSET]: 0.5 })
    expect(changesOf(byId(sedml, 'exp0_s0_seg2'))).toEqual({ [K]: 0, [OFFSET]: 0.5 })
    // The first logged segment after a warm-up keeps its first point.
    expect(subTaskCourse(sedml, 'exp0_s0_seg0')).toEqual([0.5, 0.5, 1, 1])

    const plain = prepare({ pre_times: [0], sim_times: [[2]], params_to_change: { 'decay/x': [[0.3]] } })
    const unwarmed = parse(build(plain))
    expect(all(unwarmed, 'repeatedTask').map((task) => task.getAttribute('id'))).toEqual(['exp0', 'exp0_logged', 'exp0_sub0'])
    expect(all(byId(unwarmed, 'exp0'), 'subTask').map((subTask) => [subTask.getAttribute('order'), subTask.getAttribute('task')])).toEqual([['2', 'exp0_logged']])
    expect(changesOf(byId(unwarmed, 'exp0_s0_seg0'))).toEqual({ [X]: 0.3, [OFFSET]: 0 })
  })

  it('writes negative and tiny numbers as numbers', () => {
    const negative = prepare({ pre_times: [0], sim_times: [[1]], params_to_change: { 'instance_parameters/k': [[-6e-8]] } })
    expect(build(negative)).toContain('<cn>-6e-08</cn>')
  })
})
