import { describe, expect, it } from 'vitest'

import { buildFeatureGroupCharts, buildPredictionPlotCharts } from '../../../../src/services/simulation/featureCharts.js'

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

  it('colours the points by experiment without a series, names experiments on their axis, and leaves out a plot with errors', () => {
    const charts = buildPredictionPlotCharts(
      [
        plot({ kind: 'feature_vs_experiment', x: { label: 'Experiment', unit: '' }, points: [{ experiment: 1, x: 2, y: 4, series: null }] }),
        plot({ index: 1, errors: ['prediction_plots[1]: y names no prediction items.'] }),
      ],
      NAMES
    )
    expect(charts).toHaveLength(1)
    expect(charts[0].x).toMatchObject({ values: [2], labels: ['Blocked'] })
    expect(charts[0].series.map(({ label, slot }) => [label, slot])).toEqual([
      ['', null],
      ['Blocked', 1],
    ])
  })
})
