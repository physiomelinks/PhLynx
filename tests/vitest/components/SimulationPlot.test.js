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
    redraw(...args) {
      this.redraws = [...(this.redraws ?? []), args]
    }
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

  it('keeps a variable hidden once runs are tracked, hiding its tracked lines with its live one', async () => {
    const live = [
      { key: 'a::x', label: 'a/x', variableLabel: 'a/x', slot: 0, values: [1, 2, 3, 4], run: null },
      { key: 'a::y', label: 'a/y', variableLabel: 'a/y', slot: 1, values: [4, 3, 2, 1], run: null },
    ]
    const titleParts = [
      { component: 'a', name: 'x', key: 'a::x', slot: 0 },
      { component: 'a', name: 'y', key: 'a::y', slot: 1 },
    ]
    wrapper = mount(SimulationPlot, { props: { title: 'a/x, a/y', titleParts, unit: 'm', x: X, series: live }, attachTo: document.body })
    await wrapper.findAll('.plot-title .plot-key-toggle')[0].trigger('click')
    expect(wrapper.find('.plot-title .plot-key-toggle').classes()).toContain('is-hidden')

    const trackedBy = (number) =>
      live.map((item) => ({ ...item, key: `run_${number}::${item.key}`, liveKey: item.key, label: `${item.label} [#${number}]`, run: { number, name: null, dash: [4, 4] } }))
    await wrapper.setProps({ series: [...trackedBy(1), ...live] })
    const toggles = wrapper.findAll('.plot-title .plot-key-toggle')
    expect(toggles).toHaveLength(2)
    expect(toggles[0].classes()).toContain('is-hidden')
    expect(charts.at(-1).options.series.slice(1).map((series) => series.show)).toEqual([false, true, false, true])

    // Another run tracked, its line of the hidden variable hidden as it's drawn.
    await wrapper.setProps({ series: [...trackedBy(1), ...trackedBy(2), ...live] })
    expect(charts.at(-1).options.series.slice(1).map((series) => series.show)).toEqual([false, true, false, true, false, true])

    // Showing the variable again shows each of its lines.
    const setSeries = vi.spyOn(charts.at(-1), 'setSeries')
    await wrapper.findAll('.plot-title .plot-key-toggle')[0].trigger('click')
    expect(setSeries.mock.calls).toEqual([
      [1, { show: true }],
      [3, { show: true }],
      [5, { show: true }],
    ])
  })

  it('leaves a variable hidden while runs are tracked out of the image’s title', async () => {
    const live = [
      { key: 'a::x', label: 'a/x', variableLabel: 'a/x', slot: 0, values: [1, 2, 3, 4], run: null },
      { key: 'a::y', label: 'a/y', variableLabel: 'a/y', slot: 1, values: [4, 3, 2, 1], run: null },
    ]
    const tracked = live.map((item) => ({ ...item, key: `run_1::${item.key}`, liveKey: item.key, label: `${item.label} [#1]`, run: { number: 1, name: null, dash: [4, 4] } }))
    const titleParts = [
      { component: 'a', name: 'x', key: 'a::x', slot: 0 },
      { component: 'a', name: 'y', key: 'a::y', slot: 1 },
    ]
    wrapper = mount(SimulationPlot, { props: { title: 'a/x, a/y', titleParts, unit: 'm', x: X, series: [...tracked, ...live] }, attachTo: document.body })
    await wrapper.findAll('.plot-title .plot-key-toggle')[1].trigger('click')
    const snapshot = wrapper.vm.snapshot()
    expect(snapshot.title).toBe('a/x (m)')
    expect(snapshot.legend.map(({ label }) => label)).toEqual(['a/x', 'a/x [#1]'])
  })

  it('keeps a hidden variable hidden while the chart has no lines, as hiding every run leaves it', async () => {
    const live = [
      { key: 'a::x', label: 'a/x', variableLabel: 'a/x', slot: 0, values: [1, 2, 3, 4], run: null },
      { key: 'a::y', label: 'a/y', variableLabel: 'a/y', slot: 1, values: [4, 3, 2, 1], run: null },
    ]
    const tracked = live.map((item) => ({ ...item, key: `run_1::${item.key}`, liveKey: item.key, label: `${item.label} [#1]`, run: { number: 1, name: null, dash: [4, 4] } }))
    const titleParts = [
      { component: 'a', name: 'x', key: 'a::x', slot: 0 },
      { component: 'a', name: 'y', key: 'a::y', slot: 1 },
    ]
    wrapper = mount(SimulationPlot, { props: { title: 'a/x, a/y', titleParts, unit: 'm', x: X, series: tracked }, attachTo: document.body })
    await wrapper.findAll('.plot-title .plot-key-toggle')[0].trigger('click')
    await wrapper.setProps({ series: [] })
    await wrapper.setProps({ series: tracked })
    expect(wrapper.findAll('.plot-title .plot-key-toggle')[0].classes()).toContain('is-hidden')
    expect(charts.at(-1).options.series.slice(1).map((series) => series.show)).toEqual([false, true])
  })

  it('keys each variable once, with the runs keyed apart, when the title doesn’t name the lines', async () => {
    const live = [
      { key: 'a::x', label: 'a/x', variableLabel: 'a/x', slot: 0, values: [1, 2, 3, 4], run: null },
      { key: 'a::y', label: 'a/y', variableLabel: 'a/y', slot: 1, values: [4, 3, 2, 1], run: null },
    ]
    const tracked = live.map((item) => ({ ...item, key: `run_1::${item.key}`, liveKey: item.key, label: `${item.label} [Low]`, run: { number: 1, name: 'Low', dash: [4, 4] } }))
    wrapper = mount(SimulationPlot, { props: { title: 'Plot (2 variables)', unit: 'm', x: X, series: [...tracked, ...live] }, attachTo: document.body })
    const keys = wrapper.findAll('.plot-key:not([aria-label]) .plot-key-toggle')
    expect(keys.map((key) => key.text())).toEqual(['a/x', 'a/y'])
    expect(wrapper.find('.plot-key[aria-label="Runs"]').text()).toContain('Low')

    await keys[1].trigger('click')
    expect(charts.at(-1).options.series.length).toBe(5)
    await wrapper.setProps({ series: [...live, ...tracked] })
    expect(charts.at(-1).options.series.slice(1).map((series) => series.show)).toEqual([true, false, true, false])
  })

  it('hides a run’s lines by clicking it in the Runs key, leaving the variables’ toggles as they are', async () => {
    const live = [
      { key: 'a::x', label: 'a/x', variableLabel: 'a/x', slot: 0, values: [1, 2, 3, 4], run: null },
      { key: 'a::y', label: 'a/y', variableLabel: 'a/y', slot: 1, values: [4, 3, 2, 1], run: null },
    ]
    const tracked = live.map((item) => ({ ...item, key: `run_1::${item.key}`, liveKey: item.key, label: `${item.label} [Low]`, run: { number: 1, name: 'Low', dash: [4, 4] } }))
    wrapper = mount(SimulationPlot, { props: { title: 'Plot (2 variables)', unit: 'm', x: X, series: [...live, ...tracked] }, attachTo: document.body })
    const runs = wrapper.findAll('.plot-key[aria-label="Runs"] .plot-key-toggle')
    expect(runs.map((run) => run.text())).toEqual(['Live', 'Low'])
    const setSeries = vi.spyOn(charts.at(-1), 'setSeries')

    await runs[1].trigger('click')
    expect(setSeries.mock.calls).toEqual([
      [3, { show: false }],
      [4, { show: false }],
    ])
    expect(runs[1].attributes('aria-pressed')).toBe('false')
    expect(runs[1].attributes('title')).toBe('Show Low')
    expect(wrapper.findAll('.plot-key:not([aria-label]) .plot-key-toggle').every((key) => key.attributes('aria-pressed') === 'true')).toBe(true)
    expect(wrapper.vm.snapshot().legend.map((item) => item.label)).toEqual(['a/x', 'a/y'])

    // A redraw keeps the run hidden.
    await wrapper.setProps({ series: [...tracked, ...live] })
    expect(charts.at(-1).options.series.slice(1).map((series) => series.show)).toEqual([false, false, true, true])
  })

  it('sizes a filling chart’s drawing to the space under its heading, not to its height', () => {
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
      return this.classList.contains('plot-chart') ? 250 : 0
    })
    try {
      wrapper = mount(SimulationPlot, { props: { title: 'Plot', unit: 'm', x: X, series: SERIES, height: 300, fill: true } })
      expect(charts.at(-1).options.height).toBe(250)
      expect(wrapper.find('.simulation-plot').classes()).toContain('is-fill')
    } finally {
      clientHeight.mockRestore()
    }
    wrapper.unmount()
    wrapper = mount(SimulationPlot, { props: { title: 'Plot', unit: 'm', x: X, series: SERIES, height: 300 } })
    expect(charts.at(-1).options.height).toBe(300)
  })

  it('names each experiment’s line in the readout, with every experiment shown at once', async () => {
    const lines = [
      { key: 'a::x#e0', label: 'a/x · Exp 1', variableLabel: 'a/x', experiment: 0, slot: 0, values: [1, 2, 3, 4], run: null },
      { key: 'a::y#e0', label: 'a/y · Exp 1', variableLabel: 'a/y', experiment: 0, slot: 1, values: [1, 2, 3, 4], run: null },
      { key: 'a::x#e1', label: 'a/x · Exp 2', variableLabel: 'a/x', experiment: 1, slot: 2, values: [1, 2, 3, 4], run: null },
    ]
    wrapper = mount(SimulationPlot, { props: { title: 'Plot', unit: 'm', x: X, series: lines }, attachTo: document.body })
    const [chart] = charts
    chart.cursor = { idx: 1, left: 10 }
    chart.options.hooks.setCursor[0](chart)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.plot-readout-label').map((label) => label.text())).toEqual(['a/x · Exp 1', 'a/y · Exp 1', 'a/x · Exp 2'])
  })

  it('offers no toggles in a steady state’s title, as its values are listed', () => {
    wrapper = mount(SimulationPlot, {
      props: {
        title: 'lever/y, lever/z',
        titleParts: [
          { component: 'lever', name: 'y', slot: 0 },
          { component: 'lever', name: 'z', slot: 1 },
        ],
        unit: 'metre',
        x: { label: '', unit: '', values: new Float64Array(), isSteadyState: true },
        series: [
          { key: 'lever::y', label: 'lever/y', slot: 0, values: new Float64Array([6]) },
          { key: 'lever::z', label: 'lever/z', slot: 1, values: new Float64Array([2]) },
        ],
      },
    })
    expect(wrapper.findAll('.plot-title .plot-key-toggle')).toHaveLength(0)
    expect(wrapper.findAll('.plot-title .plot-title-swatch')).toHaveLength(2)
  })

  it('says what a sweep of a model with ODEs read from each run, after its parameter', () => {
    wrapper = mount(SimulationPlot, {
      props: { title: 'cell/I', unit: 'nA', x: { label: 'clamp/V', unit: 'mV', values: [-80, 0], isSweep: true, readout: 'min' }, series: [{ key: 'i', label: 'cell/I', slot: 0, values: [1, 2] }] },
      attachTo: document.body,
    })
    expect(wrapper.find('.plot-title-against').text()).toBe('vs clamp/V (min of each run)')
    expect(wrapper.vm.snapshot().title).toBe('cell/I vs clamp/V (min of each run) (nA)')
  })

  it('lists a steady state’s values, as there is no time to plot them against', () => {
    const wrapper = mount(SimulationPlot, {
      props: {
        title: 'lever/y, lever/z',
        unit: 'metre',
        x: { label: '', unit: '', values: new Float64Array(), isSteadyState: true },
        series: [
          { key: 'lever::y', label: 'lever/y', slot: 0, values: new Float64Array([6]) },
          { key: 'lever::z', label: 'lever/z', slot: 1, values: new Float64Array([0.123456789]) },
        ],
      },
    })

    const rows = wrapper.findAll('.plot-values li').map((row) => [row.find('.plot-values-label').text(), row.find('.plot-values-value').text()])
    expect(rows).toEqual([
      ['lever/y', '6'],
      ['lever/z', '0.12346'],
    ])
    expect(wrapper.find('.plot-chart').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('SimulationPlot: lining up', () => {
  const others = []
  afterEach(() => others.splice(0).forEach((other) => other.unmount()))

  /**
   * Mounts a chart against time.
   *
   * @param {Object} [props]
   * @returns {import('@vue/test-utils').VueWrapper}
   */
  const mountChart = (props = {}) => mount(SimulationPlot, { props: { title: 'Plot', unit: 'm', x: X, series: SERIES, syncKey: 'page', ...props } })

  it('gives charts whose cursors move together the widest value axis and right padding among them', async () => {
    wrapper = mountChart()
    others.push(mountChart())
    const [first, second] = charts
    const valueAxis = (chart, labels) => chart.options.axes[1].size(chart, labels)
    const padding = (chart) => chart.options.padding[1](chart)
    first.axes = [{ _values: ['1'] }]
    second.axes = [{ _values: ['100000000 s'] }]

    const narrow = valueAxis(first, ['1'])
    const wide = valueAxis(second, ['-0.000012345'])
    expect(wide).toBeGreaterThan(narrow)
    // The narrow one takes the wide one's, and is redrawn to.
    await wrapper.vm.$nextTick()
    expect(valueAxis(first, ['1'])).toBe(wide)
    expect(first.redraws).toContainEqual([false, true])
    const widePadding = padding(second)
    expect(widePadding).toBeGreaterThan(12)
    expect(padding(first)).toBe(widePadding)

    // Once the wide one goes, the narrow one has its own again.
    others.pop().unmount()
    await wrapper.vm.$nextTick()
    expect(valueAxis(first, ['1'])).toBe(narrow)
  })

  it('zooms the charts it moves with too, unless shift is held, when it zooms alone', () => {
    wrapper = mountChart()
    const [chart] = charts
    const passesOn = (type) => chart.options.cursor.sync.filters.pub(type)
    const press = (type, shiftKey) => chart.root.dispatchEvent(new MouseEvent(type, { bubbles: true, shiftKey }))

    press('mousedown', false)
    expect(['mousedown', 'mouseup', 'dblclick', 'mousemove'].map(passesOn)).toEqual([true, true, true, true])
    press('mousedown', true)
    // The drag, and its end, stay this chart's; the cursor still moves on the others.
    expect(['mousedown', 'mouseup', 'mousemove'].map(passesOn)).toEqual([false, false, true])
    press('dblclick', true)
    expect(passesOn('dblclick')).toBe(false)
    press('dblclick', false)
    expect(passesOn('dblclick')).toBe(true)
  })

  it('keeps its own gutters on its own, and in a phase plot', () => {
    wrapper = mountChart({ syncKey: null })
    others.push(mountChart({ syncKey: null }))
    const [first, second] = charts
    const own = first.options.axes[1].size(first, ['1'])
    second.options.axes[1].size(second, ['-0.000012345'])
    expect(first.options.axes[1].size(first, ['1'])).toBe(own)
  })
})

