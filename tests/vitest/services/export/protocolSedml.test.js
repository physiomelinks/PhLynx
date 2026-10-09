import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import {
  BUNDLE_FILES,
  BUNDLE_REQUIREMENTS,
  buildBundleReadme,
  buildProtocolSedml,
  countSharedSubexperiments,
  FEATURE_OPERATIONS,
  generateProtocolSedmlZip,
  readLoggedTimeCourse,
  validateExportFeatures,
  writeTarget,
} from '../../../../src/services/export/protocolSedml.js'
import { planDrivers } from '../../../../src/services/protocol/libopencorEngine/protocolDrivers.js'
import { readProtocolInfo } from '../../../../src/services/protocol/protocolModel.js'
import { validateProtocolInfo } from '../../../../src/services/protocol/protocolValidation.js'
import { CLOCK_TIME, DRIVER_COMPONENT } from '../../../../src/services/simulation/protocolDriverModel.js'
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
function build({ view, drivers, run }, options = {}) {
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
    drivers,
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
      'model.cellml',
    ])
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

  describe('features and feature plots', () => {
    const features = [
      { name: 'mean x', operation: 'mean', operand: 'decay/x', subexperiment: 1 },
      { name: 'min x', operation: 'min', operand: 'decay/x', subexperiment: 0 },
      { name: 'max x', operation: 'max', operand: 'decay/x', subexperiment: 0 },
      { name: 'swing', operation: 'max_minus_min', operand: 'decay/x', subexperiment: 1 },
    ]
    const featurePlots = [
      { title: 'Swing against mean', y: 'swing', x: { kind: 'feature', feature: 'mean x' }, series: null },
      { title: 'I–V', y: 'mean x', x: { kind: 'input', parameter: 'instance_parameters/k', subexperiment: 0 }, series: null },
      { title: '', y: 'max x', x: { kind: 'experiment' }, series: { parameter: 'instance_parameters/u', subexperiment: 1 } },
    ]
    const sedml = parse(build(prepared, { features, featurePlots }))
    /** Reads a data generator's variables as `[id, target, task, reduction]`. */
    const variablesOf = (id) =>
      all(byId(sedml, id), 'variable').map((v) => [v.getAttribute('id'), v.getAttribute('target'), v.getAttribute('taskReference'), v.getAttribute('dimensionTerm')])

    it("reduces each feature over its sub-experiment's points, in each experiment", () => {
      expect(variablesOf('dg_e1_f0')).toEqual([['v', X, 'exp1_sub1', 'KISAO:0000841']])
      expect(variablesOf('dg_e0_f1')).toEqual([['v', X, 'exp0_sub0', 'KISAO:0000840']])
      expect(variablesOf('dg_e0_f2')).toEqual([['v', X, 'exp0_sub0', 'KISAO:0000830']])
      expect(variablesOf('dg_e1_f3')).toEqual([
        ['vmax', X, 'exp1_sub1', 'KISAO:0000830'],
        ['vmin', X, 'exp1_sub1', 'KISAO:0000840'],
      ])
      const [apply] = all(byId(sedml, 'dg_e1_f3'), 'apply')
      expect([...apply.children].map((child) => child.localName + child.textContent)).toEqual(['minus', 'civmax', 'civmin'])
      expect(byId(sedml, 'dg_e0_f3').getAttribute('name')).toBe('swing · Low & "slow" <1>')
    })

    it('plots a feature against another, joining the experiments by a shared line, each point in its colour', () => {
      const plot = byId(sedml, 'plot_fp0')
      expect([plot.getAttribute('name'), all(plot, 'xAxis')[0].getAttribute('name'), all(plot, 'yAxis')[0].getAttribute('name')]).toEqual([
        'Swing against mean',
        'mean x',
        'swing',
      ])
      expect(all(plot, 'curve').map((c) => [c.getAttribute('id'), c.getAttribute('name'), c.getAttribute('xDataReference'), c.getAttribute('yDataReference'), c.getAttribute('style')])).toEqual([
        ['c_fp0_e0', 'Low & "slow" <1>', 'dg_e0_f0', 'dg_e0_f3', 'style_fp0_e0'],
        ['c_fp0_e1', "High's", 'dg_e1_f0', 'dg_e1_f3', 'style_fp0_e1'],
      ])
      const shared = byId(sedml, 'style_fp0')
      expect(all(shared, 'line')[0].getAttribute('color')).toBe('7F7F7F')
      expect(all(shared, 'marker')[0].getAttribute('type')).toBe('circle')
      const own = byId(sedml, 'style_fp0_e0')
      expect(own.getAttribute('baseStyle')).toBe('style_fp0')
      expect(all(own, 'line')).toHaveLength(0)
      expect(all(own, 'marker')[0].getAttribute('fill')).toBe('E34948')
    })

    it("plots a feature against an input's number, as the protocol sets it in that sub-experiment", () => {
      expect(variablesOf('dg_e1_fp1_x')).toEqual([])
      expect(all(byId(sedml, 'dg_e0_fp1_x'), 'cn').map((cn) => cn.textContent)).toEqual(['0.5'])
      expect(all(byId(sedml, 'dg_e1_fp1_x'), 'cn').map((cn) => cn.textContent)).toEqual(['1'])
      expect(all(byId(sedml, 'plot_fp1'), 'xAxis')[0].getAttribute('name')).toBe('instance_parameters/k (per_second)')
      expect(all(byId(sedml, 'c_fp1_e1'), '*')).toHaveLength(0)
      expect(byId(sedml, 'c_fp1_e1').getAttribute('xDataReference')).toBe('dg_e1_fp1_x')
    })

    it("plots against the experiment's number, in series by a driven input's number", () => {
      expect(all(byId(sedml, 'dg_e1_fp2_x'), 'cn').map((cn) => cn.textContent)).toEqual(['2'])
      expect(variablesOf('dg_e1_fp2_x')).toEqual([])
      const plot = byId(sedml, 'plot_fp2')
      expect(plot.getAttribute('name')).toBe('max x')
      expect(all(plot, 'curve').map((c) => [c.getAttribute('name'), c.getAttribute('style')])).toEqual([
        ['instance_parameters/u = 0', 'style_fp2_series0'],
        ['instance_parameters/u = 0.5', 'style_fp2_series1'],
      ])
      expect(all(byId(sedml, 'style_fp2_series1'), 'line')[0].getAttribute('color')).toBe(SERIES_COLOURS.light[1].slice(1).toUpperCase())
    })

    it('reports every data generator', () => {
      const dataSets = all(byId(sedml, 'report'), 'dataSet')
      const generators = all(sedml, 'dataGenerator')
      expect(dataSets.map((set) => [set.getAttribute('id'), set.getAttribute('label'), set.getAttribute('dataReference')])).toEqual(
        generators.map((g) => [`ds_${g.getAttribute('id')}`, g.getAttribute('name'), g.getAttribute('id')])
      )
    })

    it("refuses an input that isn't one number throughout, and a feature or operation that doesn't exist", () => {
      const pulsed = { title: '', y: 'mean x', x: { kind: 'input', parameter: 'instance_parameters/k', subexperiment: 1 }, series: null }
      expect(() => build(prepared, { features, featurePlots: [pulsed] })).toThrow("instance_parameters/k isn't one number throughout experiment 1, sub-experiment 2.")
      const ramped = { title: '', y: 'mean x', x: { kind: 'input', parameter: 'instance_parameters/u', subexperiment: 0 }, series: null }
      expect(() => build(prepared, { features, featurePlots: [ramped] })).toThrow("isn't one number")
      expect(() => build(prepared, { features, featurePlots: [{ title: '', y: 'nope', x: { kind: 'experiment' } }] })).toThrow('No feature is called nope.')
      expect(() => build(prepared, { features: [{ name: 'f', operation: 'median', operand: 'decay/x', subexperiment: 0 }] })).toThrow("median isn't an operation")
    })
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

  it("plots against the number a protocol sets a state to, not the state's mean over the sub-experiment", () => {
    const states = prepare({ pre_times: [0.5, 0.5], sim_times: [[2], [2]], params_to_change: { 'decay/x': [[0.3], [0.6]] } })
    const features = [{ name: 'mean x', operation: 'mean', operand: 'decay/x', subexperiment: 0 }]
    const featurePlots = [{ title: '', y: 'mean x', x: { kind: 'input', parameter: 'decay/x', subexperiment: 0 }, series: null }]
    const sedml = parse(build(states, { features, featurePlots }))
    expect(all(byId(sedml, 'dg_e0_fp0_x'), 'cn').map((cn) => cn.textContent)).toEqual(['0.3'])
    expect(all(byId(sedml, 'dg_e1_fp0_x'), 'cn').map((cn) => cn.textContent)).toEqual(['0.6'])
    expect(all(byId(sedml, 'dg_e1_fp0_x'), 'variable')).toHaveLength(0)
  })

  it('writes negative and tiny numbers as numbers', () => {
    const negative = prepare({ pre_times: [0], sim_times: [[1]], params_to_change: { 'instance_parameters/k': [[-6e-8]] } })
    expect(build(negative)).toContain('<cn>-6e-08</cn>')
  })
})

describe('validateExportFeatures', () => {
  const { view } = prepare(PROTOCOL)
  const operandNames = ['decay/x']
  const feature = { name: 'mean x', operation: 'mean', operand: 'decay/x', subexperiment: 0 }

  it('accepts features and plots that every experiment can give', () => {
    const featurePlots = [
      { title: '', y: 'mean x', x: { kind: 'input', parameter: 'instance_parameters/k', subexperiment: 0 }, series: { parameter: 'instance_parameters/u', subexperiment: 1 } },
      { title: '', y: 'mean x', x: { kind: 'experiment' }, series: null },
      { title: '', y: 'mean x', x: { kind: 'feature', feature: 'mean x' }, series: null },
    ]
    expect(validateExportFeatures({ view, features: [feature], featurePlots, operandNames })).toEqual({ errors: [] })
    expect(FEATURE_OPERATIONS).toEqual(['mean', 'min', 'max', 'max_minus_min'])
  })

  it('says what is wrong with each, by its path', () => {
    const features = [
      feature,
      { ...feature, operation: 'median', operand: 'decay/y', subexperiment: 2 },
      { ...feature, name: ' ' },
      { ...feature, operand: '' },
    ]
    const featurePlots = [
      { title: '', y: 'nope', x: { kind: 'feature', feature: '' }, series: null },
      { title: '', y: 'mean x', x: { kind: 'input', parameter: 'instance_parameters/k', subexperiment: 1 }, series: { parameter: 'decay/y', subexperiment: 0 } },
      { title: '', y: 'mean x', x: { kind: 'input', parameter: 'instance_parameters/u', subexperiment: 0 }, series: null },
      { title: '', y: '', x: { kind: 'sideways' }, series: null },
    ]
    expect(validateExportFeatures({ view, features, featurePlots, operandNames }).errors).toEqual([
      { path: 'features[1].name', message: 'Another feature is already called mean x.' },
      { path: 'features[1].operation', message: 'Choose an operation: mean, min, max or max − min.' },
      { path: 'features[1].operand', message: "decay/y isn't a variable of the model." },
      { path: 'features[1].subexperiment', message: 'Choose a sub-experiment from 1 to 2, which every experiment has.' },
      { path: 'features[2].name', message: 'A feature needs a name.' },
      { path: 'features[3].name', message: 'Another feature is already called mean x.' },
      { path: 'features[3].operand', message: 'Choose a variable.' },
      { path: 'featurePlots[0].y', message: 'No feature is called nope.' },
      { path: 'featurePlots[0].x.feature', message: 'Choose a feature to plot against.' },
      { path: 'featurePlots[1].x', message: "instance_parameters/k isn't a number in experiment 1, sub-experiment 2." },
      { path: 'featurePlots[1].series.parameter', message: "decay/y isn't an input of the protocol." },
      { path: 'featurePlots[2].x', message: "instance_parameters/u isn't a number in experiment 1, sub-experiment 1." },
      { path: 'featurePlots[3].y', message: 'Choose a feature to plot.' },
      { path: 'featurePlots[3].x.kind', message: 'Plot against a feature, an input or the experiment.' },
    ])
  })
})

describe('countSharedSubexperiments', () => {
  it('counts the sub-experiments every experiment has', () => {
    expect(countSharedSubexperiments({ experiments: [{ subs: [{}, {}] }, { subs: [{}, {}, {}] }] })).toBe(2)
    expect(countSharedSubexperiments(null)).toBe(0)
  })
})

describe('feature names', () => {
  it('reads them trimmed, as the dialog lists them, in the checks and the document alike', () => {
    const prepared = prepare(PROTOCOL)
    const features = [{ name: 'peak ', operation: 'max', operand: 'decay/x', subexperiment: 0 }]
    const featurePlots = [{ title: '', y: 'peak', x: { kind: 'experiment' }, series: null }]
    expect(validateExportFeatures({ view: prepared.view, features, featurePlots, operandNames: ['decay/x'] })).toEqual({ errors: [] })
    const sedml = parse(build(prepared, { features, featurePlots }))
    expect(byId(sedml, 'c_fp0_e0').getAttribute('yDataReference')).toBe('dg_e0_f0')
    expect(byId(sedml, 'dg_e0_f0').getAttribute('name')).toBe('peak · Low & "slow" <1>')
  })
})

describe('buildBundleReadme', () => {
  it('says how to install and run the bundle, its warnings, and its limits', () => {
    const written = buildBundleReadme({ stem: 'heart', warnings: ['Experiment 1: a warning.'], hasDrivers: true })
    const readme = written.replaceAll(/\s+/g, ' ')
    expect(written.startsWith('# heart')).toBe(true)
    for (const text of ['protocol.sedml', 'model.cellml', 'run_sedml.py', 'obs_data.json', 'manifest.xml', 'requirements.txt']) expect(readme).toContain(text)
    for (const text of ['pip install myokit', 'brew install sundials', 'conda-forge', 'C compiler', 'python run_sedml.py']) expect(readme).toContain(text)
    for (const flag of ['--out', '--no-show', '--format', '--dpi', '--verbose']) expect(readme).toContain(flag)
    expect(readme).toContain('- Experiment 1: a warning.')
    expect(readme).toContain(`\`${DRIVER_COMPONENT}\``)
    expect(readme).toContain(`\`${CLOCK_TIME}\``)
    expect(readme).toContain('_single')
    expect(readme).toContain('first point')
    expect(readme).toContain('once it supports RepeatedTask')
    expect(readme).toContain('circulatory_autogen and CUFLynx')
  })

  it('says when there are no warnings, and leaves drivers out of a model without', () => {
    const readme = buildBundleReadme({ stem: 'heart' })
    expect(readme).toContain('- None.')
    expect(readme).not.toContain(DRIVER_COMPONENT)
  })
})

describe('generateProtocolSedmlZip', () => {
  /** Reads a zip's files as text. */
  const readZip = async (blob) => {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    return Object.fromEntries(await Promise.all(Object.keys(zip.files).map(async (name) => [name, await zip.file(name).async('string')])))
  }
  const parts = { sedml: '<sedML/>', cellml: '<model/>', script: 'print("run")\n', readme: '# heart\n' }

  it('bundles the SED-ML, model, script, requirements, README and obs_data, byte for byte, with a manifest', async () => {
    const obsData = new TextEncoder().encode('{"protocol_info": {"pre_times": [0]}}  \n').buffer
    const zip = await JSZip.loadAsync(await (await generateProtocolSedmlZip({ ...parts, obsDataPayload: obsData })).arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(Object.values(BUNDLE_FILES).sort())
    expect(new Uint8Array(await zip.file('obs_data.json').async('uint8array'))).toEqual(new Uint8Array(obsData))
    expect(await zip.file('protocol.sedml').async('string')).toBe('<sedML/>')
    expect(await zip.file('requirements.txt').async('string')).toBe(BUNDLE_REQUIREMENTS)
    const manifest = parse(await zip.file('manifest.xml').async('string'))
    const contents = Object.fromEntries(all(manifest, 'content').map((c) => [c.getAttribute('location'), [c.getAttribute('format'), c.getAttribute('master')]]))
    expect(contents).toEqual({
      '.': ['http://identifiers.org/combine.specifications/omex', null],
      'protocol.sedml': ['http://identifiers.org/combine.specifications/sed-ml', 'true'],
      'model.cellml': ['http://identifiers.org/combine.specifications/cellml', null],
      'run_sedml.py': ['text/x-python', null],
      'requirements.txt': ['text/plain', null],
      'README.md': ['text/markdown', null],
      'obs_data.json': ['application/json', null],
    })
  })

  it('leaves obs_data out when the workspace has none', async () => {
    const files = await readZip(await generateProtocolSedmlZip({ ...parts, obsDataPayload: null }))
    expect(Object.keys(files)).not.toContain('obs_data.json')
    expect(files['manifest.xml']).not.toContain('obs_data.json')
  })

  it('lists the packages the script needs', () => {
    expect(BUNDLE_REQUIREMENTS.trim().split('\n')).toEqual(['python-libsedml>=2.0.34', 'myokit>=1.39', 'numpy', 'pandas', 'matplotlib>=3.8', 'seaborn>=0.13'])
  })
})

// tests/python/fixtures/decay, which tests/python runs run_sedml.py on: two experiments of two sub-experiments after a
// 1 s warm-up. The first steps k from 0.5 to 2; the second steps k from 1 to 0.25 and
// turns u on for the last 0.1 s, a one-step segment whose first point is dropped (the _single edge case). Its
// protocol.sedml is this builder's, so a change to the encoding fails here until the fixture is rewritten with
// `yarn vitest run tests/vitest/services/export/protocolSedml.test.js -u` (and checked with the Python tests).
describe('the decay fixture the Python tests run', () => {
  it('is what the builder writes', async () => {
    const variables = new Map([
      ['environment/time', { kind: 'voi', unit: 'second' }],
      ['decay/x', { kind: 'state', unit: 'dimensionless' }],
      ['instance_parameters/k', { kind: 'constant', unit: 'per_second' }],
      ['instance_parameters/u', { kind: 'constant', unit: 'per_second' }],
      ['protocol_clock/time_offset', { kind: 'constant', unit: 'second' }],
      ['protocol_clock/experiment_time', { kind: 'computed', unit: 'second' }],
    ])
    const validated = validateProtocolInfo({
      pre_times: [1, 1],
      sim_times: [
        [1, 2],
        [1, 2],
      ],
      params_to_change: {
        'instance_parameters/k': [
          [0.5, 2],
          [1, 0.25],
        ],
        'instance_parameters/u': [
          [0, 0],
          [0, 'late'],
        ],
      },
      protocol_shapes: { late: { events: [{ level: 0.5, start: 1.9, length: 0.1 }] } },
      experiment_colors: ['b', '#eb683480'],
    })
    expect(validated.errors).toEqual([])
    const view = readProtocolInfo(validated.protocolInfo)
    const drivers = planDrivers(view)
    const settings = { solver: 'CVODE', tolerance: 1e-10, maxSteps: 50000, timeStep: 0.01, pointInterval: 0.1 }
    const run = prepareProtocolRun({ view, drivers, nodes: [], mapping: new Map(), variables, settings })
    expect(run.errors).toEqual([])
    const sedml = buildProtocolSedml({
      plan: run.plan,
      targets: run.targets,
      variables,
      settings: run.settings,
      experiments: view.experiments.map(({ label, colour }, e) => ({ label: label ?? `Experiment ${e + 1}`, colour })),
      time: { unit: 'second' },
      groups: [
        { id: 'state', name: 'State' },
        { id: 'input', name: 'Input' },
      ],
      traces: [
        { name: 'decay/x', label: 'x', unit: 'dimensionless', groupId: 'state' },
        { name: 'instance_parameters/u', label: 'u', unit: 'per_second', groupId: 'input' },
      ],
      inputs: [{ name: 'instance_parameters/k', label: 'k', unit: 'per_second' }],
      features: [
        { name: 'mean_x_sub2', operation: 'mean', operand: 'decay/x', subexperiment: 1 },
        { name: 'swing_x_sub1', operation: 'max_minus_min', operand: 'decay/x', subexperiment: 0 },
      ],
      featurePlots: [
        { title: 'Mean x against k', y: 'mean_x_sub2', x: { kind: 'input', parameter: 'instance_parameters/k', subexperiment: 1 }, series: null },
        { title: 'Swing by experiment', y: 'swing_x_sub1', x: { kind: 'experiment' }, series: null },
      ],
      overlay: false,
      drivers,
    })
    await expect(sedml).toMatchFileSnapshot('../../../python/fixtures/decay/protocol.sedml')
  })
})
