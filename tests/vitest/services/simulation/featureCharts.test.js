import { describe, expect, it } from 'vitest'

import { addInputUnits, buildFeatureGroupCharts, buildPredictionPlotCharts } from '../../../../src/services/simulation/featureCharts.js'

const NAMES = ['Control', 'Blocked', 'Washout']

/**
 * Writes a feature as computeFeatures gives it.
 *
 * @param {string} group
 * @param {number} experiment
 * @param {number} value
 * @param {Object} [extra]
 * @returns {Object}
 */
const feature = (group, experiment, value, extra = {}) => ({ name: `${group}_${experiment}`, group, experiment, subexperiment: 1, operation: 'max', unit: 'mV', value, error: null, ...extra })

describe('buildFeatureGroupCharts', () => {
  it('plots each group across its experiments, named, a point in each experiment’s colour on a line of none', () => {
    const [chart] = buildFeatureGroupCharts([feature('peak', 0, 3), feature('peak', 2, 5), feature('peak', 1, 4)], NAMES)
    expect(chart).toMatchObject({ key: 'feature:peak', title: 'peak', unit: 'mV', x: { label: 'Experiment', values: [1, 2, 3], labels: NAMES } })
    expect(chart.series.map(({ label, slot, values, showsLine, showsPoints }) => ({ label, slot, values, showsLine, showsPoints }))).toEqual([
      { label: '', slot: null, values: [3, 4, 5], showsLine: true, showsPoints: false },
      { label: 'Control', slot: 0, values: [3, null, null], showsLine: false, showsPoints: true },
      { label: 'Blocked', slot: 1, values: [null, 4, null], showsLine: false, showsPoints: true },
      { label: 'Washout', slot: 2, values: [null, null, 5], showsLine: false, showsPoints: true },
    ])
  })

  it('draws a line per operation and sub-experiment when a group has more than one in an experiment, and leaves out one with no value', () => {
    const charts = buildFeatureGroupCharts(
      [
        feature('peak', 0, 3),
        feature('peak', 0, 1, { operation: 'min' }),
        feature('peak', 1, 4),
        feature('peak', 1, 2, { operation: 'min' }),
        feature('lost', 0, NaN, { error: "Sub-experiment 2 of experiment 1 wasn't run." }),
      ],
      NAMES
    )
    expect(charts).toHaveLength(1)
    expect(charts[0].series.map(({ label, values }) => [label, values])).toEqual([
      ['max, sub-experiment 2', [3, 4]],
      ['min, sub-experiment 2', [1, 2]],
    ])
  })

  it('draws a line per item, telling apart two of one operation and sub-experiment by their operands and kwargs', () => {
    const items = [
      { operands: ['i_Na/i'], operation_kwargs: { start_frac: 0, end_frac: 0.2 } },
      { operands: ['i_K/i'] },
      { operands: ['i_K/i'] },
      { operands: ['i_Na/i'], operation_kwargs: { start_frac: 0, end_frac: 0.2 } },
    ]
    // The second experiment lists its items the other way round.
    const [chart] = buildFeatureGroupCharts(
      [feature('I_peak', 0, -3, { index: 0 }), feature('I_peak', 0, -1, { index: 1 }), feature('I_peak', 1, -2, { index: 2 }), feature('I_peak', 1, -4, { index: 3 })],
      NAMES,
      items
    )
    expect(chart.series.map(({ label, values }) => [label, values])).toEqual([
      ['max, sub-experiment 2 (i_Na/i; start_frac 0, end_frac 0.2)', [-3, -4]],
      ['max, sub-experiment 2 (i_K/i)', [-1, -2]],
    ])
  })
})

describe('buildPredictionPlotCharts', () => {
  const plot = (extra) => ({
    index: 0,
    name: 'Peak vs V',
    kind: 'feature_vs_input',
    x: { label: 'clamp/V (sub-experiment 2)', unit: '' },
    y: { label: 'peak', unit: 'nA' },
    series: null,
    points: [],
    skipped: [],
    errors: [],
    ...extra,
  })

  it('plots a line per series value in its own colour, on the x values of every point', () => {
    const [chart] = buildPredictionPlotCharts(
      [
        plot({
          series: { label: 'clamp/T (sub-experiment 1)' },
          points: [
            { experiment: 0, x: -20, y: 1, series: 10 },
            { experiment: 1, x: 0, y: 2, series: 10 },
            { experiment: 2, x: -20, y: 3, series: 20 },
          ],
        }),
      ],
      NAMES
    )
    expect(chart).toMatchObject({ title: 'Peak vs V', unit: 'nA', yLabel: 'peak', x: { label: 'clamp/V (sub-experiment 2)', values: [-20, 0], labels: null } })
    expect(chart.series.map(({ label, slot, values }) => [label, slot, values])).toEqual([
      ['clamp/T (sub-experiment 1) = 10', 0, [1, 2]],
      ['clamp/T (sub-experiment 1) = 20', 1, [3, null]],
    ])
  })

  it('colours the points by experiment without a series, and leaves out a plot with errors', () => {
    const charts = buildPredictionPlotCharts([plot({ points: [{ experiment: 1, x: 2, y: 4, series: null }] }), plot({ index: 1, errors: ['prediction_plots[1]: y names no prediction items.'] })], NAMES)
    expect(charts).toHaveLength(1)
    expect(charts[0].x).toMatchObject({ values: [2], labels: null })
    expect(charts[0].series.map(({ label, slot }) => [label, slot])).toEqual([
      ['', null],
      ['Blocked', 1],
    ])
  })

  it('draws the measured values, with their std, as a series of their own, or one per line', () => {
    const measured = (value, std) => ({ value, std })
    const points = [
      { experiment: 0, x: -20, y: 1, series: 10, measured: measured(1.5, 0.2) },
      { experiment: 1, x: 0, y: 2, series: 10, measured: null },
      { experiment: 2, x: -20, y: 3, series: 20, measured: measured(2.5, null) },
    ]
    const [alone] = buildPredictionPlotCharts([plot({ points: points.map((point) => ({ ...point, series: null })) })], NAMES)
    expect(alone.series.at(-1)).toMatchObject({ label: 'Measured', slot: null, values: [2.5, null], errors: [null, null], showsLine: false, isMeasured: true })
    const [byLine] = buildPredictionPlotCharts([plot({ series: { label: 'clamp/T (sub-experiment 1)', unit: 'K' }, points })], NAMES)
    expect(byLine.series.map(({ label, slot, values, errors }) => [label, slot, values, errors ?? null])).toEqual([
      ['clamp/T (sub-experiment 1) = 10 K', 0, [1, 2], null],
      ['clamp/T (sub-experiment 1) = 10 K, measured', 0, [1.5, null], [0.2, null]],
      ['clamp/T (sub-experiment 1) = 20 K', 1, [3, null], null],
      ['clamp/T (sub-experiment 1) = 20 K, measured', 1, [2.5, null], [null, null]],
    ])
    expect(buildPredictionPlotCharts([plot({ points: [{ experiment: 0, x: 1, y: 1, series: null, measured: null }] })], NAMES)[0].series.some(({ isMeasured }) => isMeasured)).toBe(false)
  })
})

describe('addInputUnits', () => {
  it("gives an input's x and series their units, and leaves a feature's x as it is", () => {
    const references = [
      { kind: 'feature_vs_input', x: { params_to_change: 'clamp/V', subexperiment_idx: 1 }, series: { params_to_change: 'clamp/T', subexperiment_idx: 0 } },
      { kind: 'feature_vs_feature', x: 'V_step', series: null },
    ]
    const units = { 'clamp/V': 'mV', 'clamp/T': 'K' }
    const plots = [
      { index: 0, kind: 'feature_vs_input', x: { label: 'clamp/V (sub-experiment 2)', unit: '' }, series: { label: 'clamp/T (sub-experiment 1)' } },
      { index: 1, kind: 'feature_vs_feature', x: { label: 'V_step', unit: 'mV' }, series: null },
    ]
    const [byInput, byFeature] = addInputUnits(plots, references, (key) => units[key])
    expect(byInput.x).toEqual({ label: 'clamp/V (sub-experiment 2)', unit: 'mV' })
    expect(byInput.series).toEqual({ label: 'clamp/T (sub-experiment 1)', unit: 'K' })
    expect(byFeature).toEqual(plots[1])
  })
})
