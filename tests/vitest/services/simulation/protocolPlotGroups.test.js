import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { computeDataItemFeatures, computeFeatures } from '@physiomelinks/protocol-kit'
import { describe, expect, it } from 'vitest'

import {
  OBS_DATA_PLOT,
  buildObsDataCharts,
  derivePlotVariables,
  findItemWindow,
  isPlottableOverlay,
  obsModelVar,
  overlayItemsFor,
} from '../../../../src/services/simulation/protocolPlotGroups.js'

// CUFLynx's plot.test.js cases (its lib/plot.js), on PhLynx's protocol results.

// SN_simple's obs_data shape: three experiments, prediction items and drawn data items.
const OBS = {
  protocol_info: { experiment_labels: ['SHR', 'SHR M', 'I_ramp'] },
  prediction_items: [
    { variable: 'var_SN/Cai', name_for_plotting: 'Ca_{ter}', experiment_idx: 0 },
    { variable: 'soma_SN/V', name_for_plotting: 'V', experiment_idx: 0 },
  ],
  data_items: [
    { variable: 'soma_SN/V', operands: ['soma_SN/V'], data_type: 'constant', plot_type: 'horizontal', value: 20, experiment_idx: 2 },
    { variable: 'soma_SN/V', operands: ['time', 'soma_SN/V'], data_type: 'constant', plot_type: 'vertical', value: 2.02, experiment_idx: 0 },
    { variable: 'soma_SN/V', operands: ['time', 'soma_SN/V'], data_type: 'constant', plot_type: 'None', value: 0, experiment_idx: 0 },
  ],
}

/**
 * Writes an experiment's results as the runner gives them: its time, each variable's joined series, its
 * sub-experiments' places, and their own series, the joined ones' slices.
 *
 * @param {number[]} time
 * @param {Object<string, number[]>} outputs
 * @param {Array<[number, number]>} subs - Each sub-experiment's first and last index.
 * @returns {Object}
 */
function experimentOf(time, outputs, subs) {
  return {
    voi: { name: 'environment/time', unit: 'second', values: Float64Array.from(time) },
    variables: new Map(Object.entries(outputs).map(([name, values]) => [name, { kind: 'state', unit: 'mmHg', values: Float64Array.from(values) }])),
    subs: subs.map(([startIndex, endIndex]) => ({ startIndex, endIndex, numberOfSteps: endIndex - startIndex })),
    subSeries: subs.map(([start, end]) => Object.fromEntries(Object.entries(outputs).map(([name, values]) => [name, Float64Array.from(values.slice(start, end + 1))]))),
  }
}

/**
 * Gives an experiment's own series as the kit's features take them, each variable under every name in `aliases`, and
 * the time, as buildFeatureSegments gives it with no pre_time.
 *
 * @param {Object} experiment
 * @param {Object<string, string>} [aliases] - Another name, to the variable's.
 * @returns {Array<{values: Object}>}
 */
const segmentsOf = (experiment, aliases = {}) =>
  experiment.subSeries.map((own, s) => ({
    values: {
      ...own,
      ...Object.fromEntries(Object.entries(aliases).map(([alias, name]) => [alias, own[name]])),
      time: experiment.voi.values.slice(experiment.subs[s].startIndex, experiment.subs[s].endIndex + 1),
    },
  }))

/**
 * Builds an obs_data's plots for one experiment shown, its features computed as the store computes them.
 *
 * @param {Object} document
 * @param {Object} experiment
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
function chartsFor(document, experiment, { aliases = {}, index = 0 } = {}) {
  const segments = []
  segments[index] = segmentsOf(experiment, aliases)
  return buildObsDataCharts({
    document,
    shown: [{ experiment: index, name: 'Experiment', results: experiment, place: (values) => values }],
    resolve: (qname) => (experiment.variables.has(qname) ? qname : (aliases[qname] ?? null)),
    features: computeFeatures(document, segments),
    dataItemFeatures: computeDataItemFeatures(document, segments),
  })
}

const linesOf = (chart, role) => chart.references.filter((line) => line.role === role)
const spanOf = (line) => [line.from, line.to]

describe('obs plot helpers', () => {
  it('obsModelVar picks the non-time operand', () => {
    expect(obsModelVar({ operands: ['time', 'soma_SN/V'] })).toBe('soma_SN/V')
    expect(obsModelVar({ operands: ['Lotka_Volterra_module/x'], variable: 'x_max' })).toBe('Lotka_Volterra_module/x')
    expect(obsModelVar({ variable: 'var_SN/Cai' })).toBe('var_SN/Cai')
  })

  it('isPlottableOverlay skips frequency and plot_type None, and takes a series', () => {
    expect(isPlottableOverlay({ plot_type: 'horizontal' })).toBe(true)
    expect(isPlottableOverlay({ plot_type: 'horizontal_from_min' })).toBe(true)
    expect(isPlottableOverlay({ plot_type: 'vertical' })).toBe(true)
    expect(isPlottableOverlay({ plot_type: 'None' })).toBe(false)
    expect(isPlottableOverlay({ plot_type: 'horizontal', data_type: 'frequency' })).toBe(false)
    expect(isPlottableOverlay({ plot_type: 'horizontal', data_type: 'series' })).toBe(true)
    // A zero weight doesn't hide it: weight is about the cost, not the plot.
    expect(isPlottableOverlay({ data_type: 'series', weight: 0 })).toBe(true)
  })

  it('derivePlotVariables unions predictions + plottable data items', () => {
    const variables = derivePlotVariables(OBS)
    expect(variables.map((variable) => variable.qname)).toEqual(['var_SN/Cai', 'soma_SN/V'])
    expect(variables.find((variable) => variable.qname === 'var_SN/Cai').label).toBe('Ca_{ter}')
    expect(derivePlotVariables(undefined)).toEqual([])
  })

  it('overlayItemsFor filters by experiment + variable, skipping None', () => {
    const first = overlayItemsFor(OBS, 0, 'soma_SN/V')
    expect(first).toHaveLength(1)
    expect(first[0].plot_type).toBe('vertical')
    const third = overlayItemsFor(OBS, 2, 'soma_SN/V')
    expect(third).toHaveLength(1)
    expect(third[0].plot_type).toBe('horizontal')
    expect(overlayItemsFor(OBS, 1, 'soma_SN/V')).toHaveLength(0)
  })
})

describe('data-only obs_data (3compartment shape)', () => {
  // A bare list: no prediction items, horizontal and horizontal_from_min items.
  const OBS3 = [
    { variable: 'flow aortic root', operands: ['aortic_root/v'], data_type: 'constant', plot_type: 'horizontal', value: 1e-4 },
    { variable: 'stroke volume', operands: ['heart/q_lv'], data_type: 'constant', plot_type: 'horizontal_from_min', value: 1.04e-4 },
    { variable: 'pressure aortic root', operands: ['aortic_root/u'], data_type: 'constant', plot_type: 'horizontal', value: 16000 },
  ]

  it('derives one plot variable per referenced operand', () => {
    expect(derivePlotVariables(OBS3).map((variable) => variable.qname)).toEqual(['aortic_root/v', 'heart/q_lv', 'aortic_root/u'])
  })

  it('overlays attach by variable for the single (experiment 0) run', () => {
    const items = overlayItemsFor(OBS3, 0, 'aortic_root/u')
    expect(items).toHaveLength(1)
    expect(items[0].value).toBe(16000)
  })
})

describe('findItemWindow', () => {
  const TIMES = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
  const SUBS = [
    { startIndex: 0, endIndex: 4 },
    { startIndex: 4, endIndex: 8 },
  ]

  it('spans the sub-experiment the item belongs to', () => {
    expect(findItemWindow(TIMES, SUBS, 1, 'max')).toEqual({ from: 1, to: 2, start: 4, end: 8 })
  })

  it('narrows a range to the samples its start_frac and end_frac take of the sub-experiment, as CA slices them', () => {
    // x[int(0.5 * 4):int(1 * 4)] of the second's five samples: its third and fourth.
    expect(findItemWindow(TIMES, SUBS, 1, 'max_in_range', { start_frac: 0.5, end_frac: 1 })).toEqual({ from: 1.5, to: 1.75, start: 6, end: 7 })
    // Only a range operation reads them.
    expect(findItemWindow(TIMES, SUBS, 1, 'max', { start_frac: 0.5, end_frac: 1 })).toMatchObject({ from: 1, to: 2 })
  })

  it('keeps the whole sub-experiment for fractions it cannot read, or a range of no samples', () => {
    expect(findItemWindow(TIMES, SUBS, 0, 'max_in_range', { start_frac: 'early' })).toMatchObject({ from: 0, to: 1 })
    expect(findItemWindow(TIMES, SUBS, 0, 'max_in_range', { start_frac: 0.9, end_frac: 0.1 })).toMatchObject({ from: 0, to: 1 })
  })

  it('spans the whole axis for a sub-experiment outside the protocol, and stops where a stopped run did', () => {
    expect(findItemWindow(TIMES, SUBS, 7, 'max')).toEqual({ from: 0, to: 2, start: 0, end: 8 })
    expect(findItemWindow(TIMES.slice(0, 6), SUBS, 1, 'max')).toEqual({ from: 1, to: 1.25, start: 4, end: 5 })
    expect(findItemWindow(TIMES.slice(0, 4), SUBS, 1, 'max')).toBeNull()
  })
})

describe('constant reference lines are confined to the window they describe (#347)', () => {
  // Two sub-experiments, 1 s each, laid end to end. u_AR ramps 0 -> 4 over the first and 10 -> 13 over the second,
  // so a max is unmistakably one or the other.
  const EXPERIMENT = experimentOf([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], { 'ar/u': [0, 1, 2, 3, 4, 10, 11, 12, 13] }, [
    [0, 4],
    [4, 8],
  ])
  const item = (extra) => ({
    data_item_name: 'x',
    trace_name_for_plotting: 'u_{AR}',
    operands: ['ar/u'],
    data_type: 'constant',
    plot_type: 'horizontal',
    experiment_idx: 0,
    subexperiment_idx: 0,
    value: 1,
    ...extra,
  })
  const twoMaxima = { data_items: [item({ data_item_name: 'max sub0', operation: 'max' }), item({ data_item_name: 'max sub1', operation: 'max', subexperiment_idx: 1 })] }

  it('spans only the sub-experiment the item belongs to', () => {
    const [chart] = chartsFor(twoMaxima, EXPERIMENT)
    expect(linesOf(chart, 'obs').map(spanOf)).toEqual([
      [0, 1],
      [1, 2],
    ])
  })

  it('computes the feature from that sub-experiment, not the whole trace', () => {
    const [chart] = chartsFor(twoMaxima, EXPERIMENT)
    expect(linesOf(chart, 'calc').map((line) => line.value)).toEqual([4, 13])
    expect(chart.references.map((line) => line.label)).toEqual(['u_{AR} (obs max)', 'u_{AR} (calc max)', 'u_{AR} (obs max)', 'u_{AR} (calc max)'])
  })

  it('narrows further to start_frac/end_frac within the sub-experiment', () => {
    const [chart] = chartsFor({ data_items: [item({ operation: 'max_in_range', subexperiment_idx: 1, operation_kwargs: { start_frac: 0.5, end_frac: 1 } })] }, EXPERIMENT)
    expect(linesOf(chart, 'obs').map(spanOf)).toEqual([[1.5, 1.75]])
    expect(linesOf(chart, 'calc')[0].value).toBe(12)
  })

  it('leaves a vertical line alone -- it marks a time, not a window', () => {
    // u_AR peaks at 0.5 s in the second sub-experiment.
    const peaked = experimentOf([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], { 'ar/u': [0, 3, 1, 2, 4, 10, 12, 11, 13] }, [
      [0, 4],
      [4, 8],
    ])
    const [chart] = chartsFor({ data_items: [item({ operands: ['time', 'ar/u'], operation: 'first_peak_time', plot_type: 'vertical', value: 0.4 })] }, peaked)
    // The calc is CA's first_peak_time over the item's sub-experiment: its first peak, not the whole trace's highest.
    expect(chart.references).toEqual([
      { key: 'data:0:e0#obs', label: 'u_{AR} (obs first_peak_time)', role: 'obs', slot: 1, orientation: 'vertical', from: null, to: null, value: 0.4 },
      { key: 'data:0:e0#calc', label: 'u_{AR} (calc first_peak_time)', role: 'calc', slot: 1, orientation: 'vertical', from: null, to: null, value: 0.25 },
    ])
    const [second] = chartsFor({ data_items: [item({ operands: ['time', 'ar/u'], operation: 'first_peak_time', plot_type: 'vertical', subexperiment_idx: 1 })] }, peaked)
    expect(linesOf(second, 'calc')[0].value).toBe(1.5)
  })

  it('draws a recorded series as points, obs_dt apart from its sub-experiment start, against the model line', () => {
    const trace = item({
      data_item_name: 'recorded',
      data_type: 'series',
      trace_name_for_plotting: 'u_{AR} recorded',
      operation: null,
      plot_type: 'series',
      weight: 0,
      obs_dt: 0.5,
      value: [10, 11, null, 12],
      subexperiment_idx: 1,
    })
    expect(derivePlotVariables({ data_items: [trace] })).toEqual([{ qname: 'ar/u', label: 'u_{AR} recorded', qnames: ['ar/u'] }])
    const [chart] = chartsFor({ data_items: [trace] }, EXPERIMENT)
    expect(chart.series).toHaveLength(1)
    expect(chart.references).toEqual([
      {
        key: 'data:0:e0#obs',
        label: 'u_{AR} recorded (obs)',
        role: 'obs',
        slot: 1,
        orientation: 'points',
        from: null,
        to: null,
        value: null,
        points: [
          { x: 1, y: 10 },
          { x: 1.5, y: 11 },
          { x: 2.5, y: 12 },
        ],
      },
    ])
  })

  it('draws a max_minus_min up from the least value of its window', () => {
    const [chart] = chartsFor({ data_items: [item({ operation: 'max_minus_min', plot_type: 'horizontal_from_min', subexperiment_idx: 1, value: 2 })] }, EXPERIMENT)
    expect(chart.references.map((line) => [line.role, line.value])).toEqual([
      ['obs', 4 + 2],
      ['calc', 4 + 9],
    ])
  })
})

describe('prediction items', () => {
  const EXPERIMENT = experimentOf([0, 1, 2, 3, 4], { 'soma/V': [0, 5, 2, 7, 1] }, [
    [0, 2],
    [2, 4],
  ])
  const PROTOCOL_INFO = { pre_times: [0], sim_times: [[2, 2]], params_to_change: {} }

  it('plots each variable as a trace, named by its trace label, with a calc line for a feature and an obs line for a held-out value', () => {
    const document = {
      protocol_info: PROTOCOL_INFO,
      prediction_items: [
        { data_item_name: 'V', operands: ['soma/V'], unit: 'mV', trace_name_for_plotting: 'V_{soma}' },
        { data_item_name: 'V_peak', operands: ['soma/V'], unit: 'mV', operation: 'max', item_name_for_plotting: 'V peak' },
        { data_item_name: 'V_first', operands: ['soma/V'], unit: 'mV', operation: 'max', subexperiment_idx: 0, data_type: 'constant', value: 4, std: 1 },
        // One the kit can't read, a value without its data_type, isn't drawn.
        { data_item_name: 'V_bad', operands: ['soma/V'], unit: 'mV', operation: 'max', value: 4 },
      ],
    }
    const [chart] = chartsFor(document, EXPERIMENT)
    expect(chart).toMatchObject({ key: `${OBS_DATA_PLOT}#V_{soma}`, plotId: OBS_DATA_PLOT, title: 'V_{soma}', unit: 'mmHg' })
    expect(chart.series).toEqual([{ key: 'obs-data::soma/V', label: 'V_{soma}', values: EXPERIMENT.variables.get('soma/V').values, slot: 0, isStepped: false }])
    // The first with no subexperiment_idx is the last's; each named by its item label, its variable by default, in a
    // colour of its own.
    expect(chart.references.map(({ label, slot, from, to, value }) => [label, slot, from, to, value])).toEqual([
      ['V peak (calc max)', 1, 2, 4, 7],
      ['soma/V (obs max)', 2, 0, 2, 4],
      ['soma/V (calc max)', 2, 0, 2, 5],
    ])
  })

  it('leaves out a variable the model lacks', () => {
    expect(chartsFor({ prediction_items: [{ data_item_name: 'x', operands: ['axon/x'] }] }, EXPERIMENT)).toEqual([])
  })

  it('draws every experiment at once in its own colour, its lines in that colour too', () => {
    const second = experimentOf([0, 1, 2, 3, 4], { 'soma/V': [1, 6, 3, 9, 2] }, [
      [0, 2],
      [2, 4],
    ])
    const document = {
      protocol_info: { ...PROTOCOL_INFO, sim_times: [[2, 2], [2, 2]] },
      prediction_items: [{ data_item_name: 'V', operands: ['soma/V'] }],
      data_items: [0, 1].map((e) => ({ data_item_name: `peak_${e}`, operands: ['soma/V'], operation: 'max', plot_type: 'horizontal', value: 8, experiment_idx: e, subexperiment_idx: 1 })),
    }
    const segments = [segmentsOf(EXPERIMENT), segmentsOf(second)]
    const [chart] = buildObsDataCharts({
      document,
      shown: [EXPERIMENT, second].map((results, e) => ({ experiment: e, name: ['Control', 'Blocked'][e], results, place: (values) => [...values] })),
      resolve: (qname) => qname,
      features: computeFeatures(document, segments),
      dataItemFeatures: computeDataItemFeatures(document, segments),
    })
    // Each named for its variable and experiment, as the plotted variables' are, so their CSV columns say which.
    expect(chart.series.map(({ key, label, slot }) => [key, label, slot])).toEqual([
      ['obs-data::soma/V#e0', 'soma/V · Control', 0],
      ['obs-data::soma/V#e1', 'soma/V · Blocked', 1],
    ])
    expect(chart.references.map(({ role, slot, value }) => [role, slot, value])).toEqual([
      ['obs', 0, 8],
      ['calc', 0, 7],
      ['obs', 1, 8],
      ['calc', 1, 9],
    ])
  })
})

// The obs_data from #347 itself: two sub-experiments of 10 s, seven data items over three traces, the
// sub-experiment-1 max naming its variable `aortic_root_module/u` where the other u_{AR} items say `aortic_root/u`.
describe('the multi-sub-experiment study from #347', () => {
  const OBS347 = JSON.parse(
    readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../resources/protocols/3compartment_obs_data_multi_subexp.json'), 'utf-8')
  )
  // u ramps 0 -> 4 over the first sub-experiment and 4 -> 13 over the second, so a max is one or the other.
  const EXPERIMENT = experimentOf(
    [0, 5, 10, 15, 20],
    { 'aortic_root/u': [0, 2, 4, 11, 13], 'aortic_root/v': [0, 5, 9, 3, 1], 'heart/q_lv': [1, 4, 7, 2, 0] },
    [
      [0, 2],
      [2, 4],
    ]
  )
  const ALIASES = { 'aortic_root_module/u': 'aortic_root/u' }
  const uniqueTraceLabels = new Set(OBS347.data_items.map((item) => item.trace_name_for_plotting))

  it('draws one plot per unique trace label', () => {
    expect(uniqueTraceLabels.size).toBe(3)
    const variables = derivePlotVariables(OBS347)
    expect(variables).toHaveLength(uniqueTraceLabels.size)
    expect(new Set(variables.map((variable) => variable.label))).toEqual(uniqueTraceLabels)
    expect(chartsFor(OBS347, EXPERIMENT, { aliases: ALIASES }).map((chart) => chart.title)).toEqual(['v_{AR}', 'q_{lv}', 'u_{AR}'])
  })

  it('keeps both spellings of one variable on the same plot', () => {
    const u = derivePlotVariables(OBS347).find((variable) => variable.label === 'u_{AR}')
    expect(u.qnames).toEqual(['aortic_root/u', 'aortic_root_module/u'])
  })

  it('draws one ground-truth and one model line per data_item on each plot', () => {
    const perLabel = Object.fromEntries(
      chartsFor(OBS347, EXPERIMENT, { aliases: ALIASES }).map((chart) => [chart.title, { gt: linesOf(chart, 'obs').length, model: linesOf(chart, 'calc').length }])
    )
    expect(perLabel).toEqual({ 'u_{AR}': { gt: 4, model: 4 }, 'v_{AR}': { gt: 2, model: 2 }, 'q_{lv}': { gt: 1, model: 1 } })
  })

  it('puts each u_{AR} line on the sub-experiment it was measured on', () => {
    const u = chartsFor(OBS347, EXPERIMENT, { aliases: ALIASES }).find((chart) => chart.title === 'u_{AR}')
    // mean/max/min over [0, 10] -> 2 / 4 / 0; the post max over [10, 20] -> 13.
    expect(linesOf(u, 'calc').map((line) => [line.from, line.to, line.value])).toEqual([
      [0, 10, 2],
      [0, 10, 4],
      [0, 10, 0],
      [10, 20, 13],
    ])
  })
})
