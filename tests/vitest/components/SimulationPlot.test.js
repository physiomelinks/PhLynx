// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

// uPlot draws on a canvas, which happy-dom lacks: a stand-in keeps what it's given, and places values 1:1.
const charts = []
vi.mock('uplot', () => {
  class FakePlot {
    constructor(options, data, target) {
      Object.assign(this, { options, data, width: options.width, scales: { x: {} } })
      this.root = document.createElement('div')
      this.root.innerHTML = '<div class="u-wrap"></div>'
      this.over = { offsetLeft: 0, offsetTop: 0 }
      this.cursor = { idx: null, left: null }
      this.bbox = { left: 0, top: 0, width: 100, height: 50 }
      const calls = []
      this.calls = calls
      const record = (name) => (...args) => calls.push([name, ...args])
      this.ctx = { canvas: null, save() {}, restore() {}, clip() {}, rect() {}, beginPath: record('begin'), moveTo: record('move'), lineTo: record('line'), stroke: record('stroke'), setLineDash: record('dash'), arc: record('arc'), fill: record('fill') }
      target.appendChild(this.root)
      charts.push(this)
    }
    valToPos(value) {
      return value
    }
    setData(data) {
      this.data = data
    }
    setScale() {}
    setSeries() {}
    setSize() {}
    destroy() {}
  }
  FakePlot.rangeNum = (min, max) => [min, max]
  FakePlot.pxRatio = 1
  FakePlot.paths = { stepped: () => null }
  return { default: FakePlot }
})
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
}

const { default: SimulationPlot } = await import('../../../src/components/simulation/SimulationPlot.vue')

let wrapper
afterEach(() => {
  wrapper?.unmount()
  charts.length = 0
})

const X = { label: 'time', unit: 'second', values: [0, 1, 2, 3] }
const SERIES = [{ key: 'v', label: 'V', slot: 0, values: [1, 3, 2, 4] }]
// A measured max over the second half and the run's, and a measured time up the chart.
const REFERENCES = [
  { key: 'peak#obs', label: 'V (obs max)', role: 'obs', slot: 1, orientation: 'horizontal', from: 2, to: 3, value: 9 },
  { key: 'peak#calc', label: 'V (calc max)', role: 'calc', slot: 1, orientation: 'horizontal', from: 2, to: 3, value: 4.000000000000001 },
  { key: 'when#obs', label: 'V (obs first_peak_time)', role: 'obs', slot: 2, orientation: 'vertical', from: null, to: null, value: 1.5 },
]

/**
 * Mounts a chart of V with the reference lines.
 *
 * @returns {import('@vue/test-utils').VueWrapper}
 */
const mountPlot = () => mount(SimulationPlot, { props: { title: 'V', unit: 'mV', x: X, series: SERIES, references: REFERENCES }, attachTo: document.body })

describe('SimulationPlot: reference lines', () => {
  it('keys the line and each reference line, a measurement dashed, the run’s solid, with its value', () => {
    wrapper = mountPlot()
    const items = wrapper.findAll('.plot-key .plot-key-toggle')
    expect(items.map((item) => item.text())).toEqual(['V', 'V (obs max)', 'V (calc max)', 'V (obs first_peak_time)'])
    expect(items.map((item) => item.find('.plot-key-swatch').classes('is-dashed'))).toEqual([false, true, false, true])
    // Its value at full precision, for reading back, and to 5 figures in its hint.
    expect(items[2].attributes('data-value')).toBe('4.000000000000001')
    expect(items[2].attributes('title')).toBe('Hide V (calc max): 4')
    expect(items[0].attributes('data-value')).toBeUndefined()
  })

  it('keys a single line only with reference lines beside it', () => {
    wrapper = mount(SimulationPlot, { props: { title: 'V', unit: 'mV', x: X, series: SERIES }, attachTo: document.body })
    expect(wrapper.find('.plot-key').exists()).toBe(false)
    expect(charts[0].options.scales.y).toBeUndefined()
  })

  it('draws them in values after the lines, across a window or up the chart, and fits the values to them', () => {
    wrapper = mountPlot()
    const [chart] = charts
    expect(chart.options.hooks.draw).toHaveLength(1)
    chart.options.hooks.draw[0](chart)
    expect(chart.calls.filter(([name]) => name !== 'begin')).toEqual([
      ['dash', [6, 4]],
      ['move', 2, 9],
      ['line', 3, 9],
      ['stroke'],
      ['dash', []],
      ['move', 2, 4.000000000000001],
      ['line', 3, 4.000000000000001],
      ['stroke'],
      ['dash', [6, 4]],
      ['move', 1.5, 0],
      ['line', 1.5, 50],
      ['stroke'],
    ])
    // The measured max is above the trace, so the range reaches it; a vertical line has no say.
    expect(chart.options.scales.y.range(chart, 1, 4)).toEqual([1, 9])
  })

  it('hides a reference line clicked in the key, from the drawing, the range and the image', async () => {
    wrapper = mountPlot()
    await wrapper.findAll('.plot-key .plot-key-toggle')[1].trigger('click')
    const [chart] = charts
    expect(chart.options.scales.y.range(chart, 1, 4)).toEqual([1, 4.000000000000001])
    chart.calls.length = 0
    chart.options.hooks.draw[0](chart)
    expect(chart.calls.filter(([name]) => name === 'stroke')).toHaveLength(2)
    expect(wrapper.vm.snapshot().legend.map(({ label, isDashed }) => [label, !!isDashed])).toEqual([
      ['V', false],
      ['V (calc max)', false],
      ['V (obs first_peak_time)', true],
    ])
  })

  it('draws a recorded series as points, keyed by a point, fitting the values to them', () => {
    const points = {
      key: 'trace#obs',
      label: 'V recorded (obs)',
      role: 'obs',
      slot: 3,
      orientation: 'points',
      from: null,
      to: null,
      value: null,
      points: [
        { x: 0, y: -2 },
        { x: 2, y: 5 },
      ],
    }
    wrapper = mount(SimulationPlot, { props: { title: 'V', unit: 'mV', x: X, series: SERIES, references: [points] }, attachTo: document.body })
    const item = wrapper.findAll('.plot-key .plot-key-toggle')[1]
    expect(item.find('.plot-key-swatch').classes()).toEqual(expect.arrayContaining(['is-point']))
    expect(item.find('.plot-key-swatch').classes()).not.toContain('is-dashed')
    expect(item.attributes('title')).toBe('Hide V recorded (obs)')
    const [chart] = charts
    chart.options.hooks.draw[0](chart)
    expect(chart.calls.filter(([name]) => name === 'arc').map(([, x, y, radius]) => [x, y, radius])).toEqual([
      [0, -2, 3],
      [2, 5, 3],
    ])
    expect(chart.calls.some(([name]) => name === 'stroke')).toBe(false)
    expect(chart.options.scales.y.range(chart, 1, 4)).toEqual([-2, 5])
    expect(wrapper.vm.snapshot().legend.at(-1)).toMatchObject({ label: 'V recorded (obs)', isDashed: false, isPoint: true })
  })
})
