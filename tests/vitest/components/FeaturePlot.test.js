// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

// uPlot draws on a canvas, which happy-dom lacks: a stand-in keeps what it's given.
const charts = []
vi.mock('uplot', () => {
  class FakePlot {
    constructor(options, data, target) {
      Object.assign(this, { options, data, width: options.width, ctx: { canvas: null } })
      this.root = document.createElement('div')
      this.root.innerHTML = '<div class="u-wrap"></div>'
      this.over = { offsetLeft: 0, offsetTop: 0 }
      this.cursor = { idx: null, left: null }
      target.appendChild(this.root)
      charts.push(this)
    }
    setSize() {}
    destroy() {}
  }
  FakePlot.rangeNum = (min, max) => [min, max]
  FakePlot.pxRatio = 1
  return { default: FakePlot }
})
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
}

const { default: FeaturePlot } = await import('../../../src/components/simulation/FeaturePlot.vue')

let wrapper
afterEach(() => {
  wrapper?.unmount()
  charts.length = 0
})

// A line of no colour through two experiments' points, and a measured value with its std.
const SERIES = [
  { key: 'line', label: '', slot: null, values: [1, 2], showsLine: true, showsPoints: false, isInKey: false },
  { key: 'e0', label: 'Control', slot: 0, values: [1, null], showsLine: false, showsPoints: true, isInKey: true },
  { key: 'e1', label: 'Blocked', slot: 1, values: [null, 2], showsLine: false, showsPoints: true, isInKey: true },
  { key: 'measured', label: 'Measured', slot: null, values: [1.5, null], errors: [0.5, null], showsLine: false, showsPoints: true, isInKey: true, isMeasured: true },
]

describe('FeaturePlot', () => {
  it('keys points as points and a measured value as a ring, and names the chart for a screen reader', () => {
    wrapper = mount(FeaturePlot, { props: { title: 'peak', unit: 'mV', x: { label: 'g', unit: 'mS', values: [1, 2], labels: null }, series: SERIES }, attachTo: document.body })
    const swatches = wrapper.findAll('.plot-key .plot-key-swatch')
    expect(swatches.map((swatch) => [swatch.classes('is-point'), swatch.classes('is-measured')])).toEqual([
      [true, false],
      [true, false],
      [true, true],
    ])
    expect(wrapper.find('.u-wrap').attributes('aria-label')).toBe('Feature plot of peak, in mV, against g (mS)')
  })

  it('shows the readout’s swatches as the key does, with a measured value’s std', async () => {
    wrapper = mount(FeaturePlot, { props: { title: 'peak', x: { label: 'g', unit: '', values: [1, 2], labels: null }, series: SERIES }, attachTo: document.body })
    const [chart] = charts
    chart.cursor = { idx: 0, left: 10 }
    chart.options.hooks.setCursor[0](chart)
    await wrapper.vm.$nextTick()
    const rows = wrapper.findAll('.plot-readout-row')
    expect(rows.map((row) => [row.find('.plot-readout-label').text(), row.find('.plot-readout-value').text()])).toEqual([
      ['Control', '1'],
      ['Measured', '1.5 ± 0.5'],
    ])
    expect(rows.map((row) => [row.find('.plot-key-swatch').classes('is-point'), row.find('.plot-key-swatch').classes('is-measured')])).toEqual([
      [true, false],
      [true, true],
    ])
    // The y range takes in the whiskers.
    expect(chart.options.scales.y.range(chart, 1, 2)).toEqual([1, 2])
    expect(chart.options.scales.y.range(chart, 1.2, 1.4)).toEqual([1, 2])
  })
})
