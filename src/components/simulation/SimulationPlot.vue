<template>
  <figure class="simulation-plot">
    <figcaption class="plot-head">
      <span class="plot-title">
        <template v-if="titleParts">
          <template v-for="(part, index) in titleParts" :key="index"
            ><span v-if="index" class="plot-title-separator">, </span
            ><span v-if="titleParts.length > 1 && part.slot !== undefined" class="plot-key-swatch plot-title-swatch" :style="{ background: colourOf(part) }" aria-hidden="true"></span
            ><span v-if="part.component" class="plot-title-component">{{ part.component }}/</span><span>{{ part.name }}</span></template
          >
        </template>
        <template v-else>{{ title }}</template>
      </span>
      <!-- The values' unit, here rather than as a rotated axis title, which takes a column of the chart. -->
      <span class="plot-unit">{{ unit }}</span>
    </figcaption>
    <!-- A key only when the title names the plot rather than its lines, which it colours itself. -->
    <ul v-if="series.length > 1 && !titleParts && !x.isSteadyState" class="plot-key">
      <li v-for="item in series" :key="item.key">
        <RunSwatch v-if="item.run" :colour="colourOf(item)" :dash="item.run.dash" /><span v-else class="plot-key-swatch" :style="{ background: colourOf(item) }" aria-hidden="true"></span
        >{{ item.label }}
      </li>
    </ul>
    <!-- With the title naming the lines, which runs they are from: the live run solid, tracked runs dashed. -->
    <ul v-if="runKey.length && titleParts && !x.isSteadyState" class="plot-key" aria-label="Runs">
      <li v-for="item in runKey" :key="item.number">
        <RunSwatch v-if="item.dash" :colour="chrome.text" :dash="item.dash" /><span v-else class="plot-key-swatch" :style="{ background: chrome.text }" aria-hidden="true"></span
        >{{ item.label }}
      </li>
    </ul>
    <!-- A steady state has one value per variable and no time to plot them against. -->
    <ul v-if="x.isSteadyState" class="plot-values">
      <li v-for="item in readoutOrder" :key="item.key">
        <RunSwatch v-if="item.run" :colour="colourOf(item)" :dash="item.run.dash" />
        <span v-else class="plot-key-swatch" :style="{ background: colourOf(item) }" aria-hidden="true"></span>
        <span class="plot-values-label">{{ item.label }}</span>
        <span class="plot-values-value">{{ formatValue(item.values[0]) }}</span>
      </li>
    </ul>
    <div v-else class="plot-area">
      <div ref="chartEl" class="plot-chart"></div>
      <!-- The values under the cursor, beside it, as plotly's hover does, in place of a legend line. -->
      <div v-if="readout" class="plot-readout" :style="{ left: `${readout.left}px`, top: `${readout.top}px` }" aria-hidden="true">
        <div class="plot-readout-time">{{ readout.time }}</div>
        <div v-for="row in readout.rows" :key="row.key" class="plot-readout-row">
          <RunSwatch v-if="row.dash" :colour="row.colour" :dash="row.dash" />
          <span v-else class="plot-key-swatch" :style="{ background: row.colour }"></span>
          <span v-if="row.label" class="plot-readout-label">{{ row.label }}</span>
          <span v-if="row.run" class="plot-readout-run">{{ row.run }}</span>
          <span class="plot-readout-value">{{ row.value }}</span>
        </div>
      </div>
    </div>
  </figure>
</template>

<script setup>
/**
 * One simulation chart: a uPlot line chart of series that share a unit, against the variable of integration.
 * A steady state (a model without ODEs) has no variable of integration, so its values are listed instead.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

import RunSwatch from './RunSwatch.vue'
import { useColorScheme } from '../../composables/useColorScheme'
import { getChartZoom, setChartZoom } from '../../services/simulation/chartZoom'
import { SERIES_COLOURS } from '../../services/simulation/seriesSlots'
import { fadeColour, formatPlotValue as formatValue } from '../../services/simulation/trackedRuns'

const CHROME = {
  light: { text: '#52514e', grid: '#e1e0d9', axis: '#c3c2b7' },
  dark: { text: '#c3c2b7', grid: '#2c2c2a', axis: '#383835' },
}
const props = defineProps({
  title: { type: String, required: true },
  // The title as instance/variable paths, to show each instance muted, or null to show `title`.
  titleParts: { type: Array, default: null },
  unit: { type: String, required: true },
  x: { type: Object, required: true }, // { label, unit, values, isSteadyState }
  // [{ key, label, variableLabel, slot, values, run }], run being a tracked run's `{ number, dash }`, or null for
  // the live run.
  series: { type: Array, required: true },
  height: { type: Number, default: 220 },
  // Charts with the same key show their cursors at the same time.
  syncKey: { type: String, default: null },
  // Names the chart, so it keeps its zoom when rebuilt.
  zoomKey: { type: String, default: null },
})

/**
 * Formats axis ticks to as many decimals as their spacing needs, or in exponent form when very small or
 * large, so ticks a thousandth apart don't all read 0.
 *
 * @param {Object} _ - The chart.
 * @param {number[]} splits - The tick values.
 * @returns {string[]}
 */
function formatTicks(_, splits) {
  const step = splits.length > 1 ? Math.abs(splits[1] - splits[0]) : Math.abs(splits[0]) || 1
  const largest = Math.max(...splits.map(Math.abs))
  if (largest >= 1e6 || (largest > 0 && step < 1e-4)) return splits.map((value) => (value === 0 ? '0' : value.toExponential(2)))
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))
  return splits.map((value) => value.toFixed(decimals))
}

/**
 * Sizes the value axis to fit its longest tick label; its unit is in the chart's heading.
 *
 * @param {Object} _ - The chart.
 * @param {string[]|null} values - The tick labels, once known.
 * @returns {number} Pixels.
 */
const sizeValueAxis = (_, values) => Math.max(32, Math.ceil(Math.max(0, ...(values ?? []).map((value) => value.length)) * 6.5) + 12)

// The readout's width, about, to keep it inside the chart.
const READOUT_WIDTH_PX = 150

// Short forms of time units, for the last tick and the readout.
const SHORT_UNITS = { second: 's', millisecond: 'ms', microsecond: 'µs', minute: 'min', hour: 'h', day: 'd' }

/**
 * Shortens a unit's name when it has a usual short form.
 *
 * @param {string} unit
 * @returns {string}
 */
const shortUnit = (unit) => SHORT_UNITS[unit] ?? unit

const chartEl = ref(null)
const { isDarkMode } = useColorScheme()
const readout = ref(null)

/**
 * Gets a series' line colour.
 *
 * @param {{slot: number}} item
 * @returns {string}
 */
const colourOf = (item) => SERIES_COLOURS[isDarkMode.value ? 'dark' : 'light'][item.slot]

const chrome = computed(() => CHROME[isDarkMode.value ? 'dark' : 'light'])

// The runs the lines are from, once tracked runs are shown.
const runKey = computed(() => {
  const runs = new Map()
  for (const item of props.series) if (item.run) runs.set(item.run.number, { number: item.run.number, label: `#${item.run.number}`, dash: item.run.dash })
  if (!runs.size) return []
  const key = [...runs.values()].sort((a, b) => a.number - b.number)
  return props.series.some((item) => !item.run) ? [{ number: 0, label: 'Live', dash: null }, ...key] : key
})

// How many variables the lines show, however many runs they are from.
const variableCount = computed(() => new Set(props.series.map((item) => item.variableLabel ?? item.label)).size)
const hasRuns = computed(() => props.series.some((item) => item.run))

/**
 * Names a line in the readout: its variable, when the chart has several, and its run, apart from the
 * variable so a long name cut short still says which run it is.
 *
 * @param {{label: string, variableLabel?: string, run: {number: number}|null}} item
 * @returns {{label: string|null, run: string|null}}
 */
function readoutNames(item) {
  const run = hasRuns.value ? (item.run ? `#${item.run.number}` : 'Live') : null
  return { label: variableCount.value > 1 ? item.variableLabel ?? item.label : null, run }
}

// The live run's values first, then each tracked run's, though the tracked runs' lines are drawn first.
const readoutOrder = computed(() => [...props.series].sort((a, b) => (a.run?.number ?? 0) - (b.run?.number ?? 0)))

/**
 * Shows the values under the cursor beside it, flipping to its left near the chart's right edge, or hides
 * them as the cursor leaves.
 *
 * @param {Object} chart - The uPlot chart.
 */
function updateReadout(chart) {
  const { idx, left } = chart.cursor
  if (idx == null || left == null || left < 0) {
    readout.value = null
    return
  }
  const over = chart.over
  const x = over.offsetLeft + left
  const fitsRight = x + 12 + READOUT_WIDTH_PX <= chart.root.clientWidth
  readout.value = {
    left: fitsRight ? x + 12 : Math.max(0, x - 12 - READOUT_WIDTH_PX),
    top: over.offsetTop + 6,
    time: `${formatValue(chart.data[0][idx])}${props.x.unit ? ` ${shortUnit(props.x.unit)}` : ''}`,
    rows: readoutOrder.value.map((item) => ({ key: item.key, ...readoutNames(item), colour: colourOf(item), dash: item.run?.dash ?? null, value: formatValue(item.values[idx]) })),
  }
}
let plot = null
// The time range zoomed into, kept across new values and redraws; null when showing the whole run.
let zoom = getChartZoom(props.zoomKey)
let isUpdatingData = false

/**
 * Sets the zoom again after new values, unless they no longer reach it, as after a change of time course.
 */
function restoreZoom() {
  const times = plot?.data?.[0]
  if (!zoom || !times?.length) return
  if (zoom.max <= times[0] || zoom.min >= times[times.length - 1]) {
    zoom = null
    setChartZoom(props.zoomKey, null)
    return
  }
  plot.setScale('x', zoom)
}

/**
 * Notes a zoom the viewer made (dragging across the chart) or undid (double-clicking it).
 *
 * @param {Object} chart - The uPlot chart.
 * @param {string} key - The scale that changed.
 */
function recordZoom(chart, key) {
  if (key !== 'x' || isUpdatingData) return
  const { min, max } = chart.scales.x
  const times = chart.data[0]
  if (min == null || max == null || !times?.length) return
  zoom = min > times[0] || max < times[times.length - 1] ? { min, max } : null
  setChartZoom(props.zoomKey, zoom)
}
let resizeObserver = null

const ariaLabel = computed(() => {
  const end = props.x.values.length ? ` from ${props.x.values[0]} to ${props.x.values.at(-1)} ${props.x.unit}` : ''
  return `Chart of ${props.title}, in ${props.unit}, against ${props.x.label}${end}`
})

/**
 * Builds the uPlot options for the current series and theme.
 *
 * @param {number} width
 * @returns {Object}
 */
function buildOptions(width) {
  const theme = isDarkMode.value ? 'dark' : 'light'
  const chrome = CHROME[theme]
  const axis = (values = formatTicks) => ({
    values,
    stroke: chrome.text,
    grid: { stroke: chrome.grid, width: 1 },
    ticks: { stroke: chrome.axis, width: 1 },
    font: '11px system-ui, -apple-system, "Segoe UI", sans-serif',
  })
  // The time's unit on its last tick, in place of an axis title under the ticks.
  const timeTicks = (chart, splits) => {
    const labels = formatTicks(chart, splits)
    if (props.x.unit && labels.length) labels[labels.length - 1] += ` ${shortUnit(props.x.unit)}`
    return labels
  }
  return {
    width,
    height: props.height,
    scales: { x: { time: false } },
    // Synced charts plot different series, so hiding one mustn't hide its namesake by position elsewhere.
    cursor: { y: false, points: { size: 8 }, ...(props.syncKey && { sync: { key: props.syncKey, setSeries: false } }) },
    hooks: { setScale: [recordZoom], setCursor: [updateReadout] },
    legend: { show: false },
    padding: [8, 12, 0, 0],
    axes: [{ ...axis(timeTicks), size: 28 }, { ...axis(), size: sizeValueAxis }],
    series: [
      { label: props.x.label },
      // A tracked run's line is its variable's colour, faded and dashed.
      ...props.series.map((series) => ({
        label: series.label,
        stroke: series.run ? fadeColour(SERIES_COLOURS[theme][series.slot]) : SERIES_COLOURS[theme][series.slot],
        width: series.run ? 1.5 : 2,
        ...(series.run && { dash: series.run.dash }),
        // Runs with different output points share a VoI axis on which each has gaps at the others' points.
        spanGaps: true,
        points: { show: false },
      })),
    ],
  }
}

const buildData = () => [props.x.values, ...props.series.map((series) => series.values)]

/** Draws the chart afresh, as a change of series or theme needs. */
function draw() {
  plot?.destroy()
  plot = null
  if (!chartEl.value) return
  isUpdatingData = true
  plot = new uPlot(buildOptions(chartEl.value.clientWidth || 300), buildData(), chartEl.value)
  restoreZoom()
  isUpdatingData = false
  labelCanvas()
}

/** Labels the drawing for screen readers, leaving the legend and its values readable as text. */
function labelCanvas() {
  const drawing = plot?.root.querySelector('.u-wrap')
  drawing?.setAttribute('role', 'img')
  drawing?.setAttribute('aria-label', ariaLabel.value)
}

onMounted(() => {
  draw()
  resizeObserver = new ResizeObserver(([entry]) => {
    const width = Math.floor(entry.contentRect.width)
    if (plot && width > 0 && width !== plot.width) plot.setSize({ width, height: props.height })
  })
  if (chartEl.value) resizeObserver.observe(chartEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  plot?.destroy()
  plot = null
})

watch(
  () => [props.series.map((series) => `${series.key}:${series.slot}`).join('|'), isDarkMode.value, props.x.unit, props.unit, props.syncKey],
  draw
)
// The chart's element comes and goes as the results switch between a time course and a steady state.
watch(
  () => props.x.isSteadyState,
  () => {
    draw()
    if (chartEl.value) resizeObserver?.observe(chartEl.value)
  },
  { flush: 'post' }
)
watch(
  () => props.height,
  (height) => plot?.setSize({ width: plot.width, height })
)

defineExpose({
  /**
   * Gets the chart as drawn, with the colours of its series, for an image of it.
   *
   * @returns {{title: string, canvas: HTMLCanvasElement, legend: Array<{label: string, colour: string}>}|null}
   */
  snapshot() {
    if (!plot) return null
    const colours = SERIES_COLOURS[isDarkMode.value ? 'dark' : 'light']
    // The unit is in the heading, not on the canvas, so the image's title carries it.
    const title = props.unit ? `${props.title} (${props.unit})` : props.title
    return {
      title,
      canvas: plot.ctx.canvas,
      legend: readoutOrder.value.map((series) => ({ label: series.label, colour: colours[series.slot], dash: series.run?.dash ?? null })),
    }
  },
})
// New values, as a slider moving gives, keep a zoomed chart on its time range, with the values refitted to it.
watch(
  () => [props.x.values, ...props.series.map((series) => series.values)],
  () => {
    if (!plot) return
    isUpdatingData = true
    plot.setData(buildData())
    restoreZoom()
    isUpdatingData = false
    labelCanvas()
  }
)
</script>

<style scoped>
.simulation-plot {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.plot-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.plot-title {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--dlg-fs-small, 0.8125rem);
  font-weight: 600;
  color: var(--p-text-color);
}

.plot-title-component,
.plot-title-separator {
  font-weight: 400;
  color: var(--p-text-muted-color);
}

.plot-unit {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.plot-key {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.plot-key li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.plot-title-swatch {
  display: inline-block;
  margin-right: 4px;
  vertical-align: middle;
}

.plot-values {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 4px 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.8125rem;
}

.plot-values li {
  display: contents;
}

.plot-values-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-text-muted-color);
}

.plot-values-value {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.plot-key-swatch {
  flex-shrink: 0;
  width: 10px;
  height: 3px;
  border-radius: 2px;
}

.plot-area {
  position: relative;
}

.plot-chart {
  width: 100%;
  min-width: 0;
}

.plot-readout {
  position: absolute;
  z-index: 1;
  min-width: 6rem;
  max-width: 150px;
  padding: 4px 8px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--p-content-background) 92%, transparent);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--p-text-color) 12%, transparent);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.plot-readout-time {
  color: var(--p-text-muted-color);
}

.plot-readout-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--p-text-color);
}

.plot-readout-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--p-text-muted-color);
}

.plot-readout-run {
  flex-shrink: 0;
  color: var(--p-text-muted-color);
}

.plot-readout-value {
  margin-left: auto;
  font-weight: 600;
}
</style>
