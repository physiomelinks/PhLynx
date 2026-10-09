<template>
  <figure class="simulation-plot">
    <figcaption class="plot-head">
      <span class="plot-title">
        <template v-if="titleParts">
          <template v-for="(part, index) in titleParts" :key="index"
            ><span v-if="index" class="plot-title-separator">, </span
            ><!-- A span rather than a button, so the title's ellipsis can cut a long name rather than drop it whole. --><span
              v-if="titleNamesLines && series[index]"
              role="button"
              tabindex="0"
              class="plot-key-toggle"
              :class="{ 'is-hidden': isHidden(series[index]) }"
              :aria-pressed="!isHidden(series[index])"
              :title="toggleHint(series[index])"
              @click="toggleSeries(series[index])"
              @keydown.enter.prevent="toggleSeries(series[index])"
              @keydown.space.prevent="toggleSeries(series[index])"
              ><span class="plot-key-swatch plot-title-swatch" :style="{ background: colourOf(series[index]) }" aria-hidden="true"></span
              ><span v-if="part.component" class="plot-title-component">{{ part.component }}/</span><span>{{ part.name }}</span></span
            ><template v-else
              ><span v-if="part.component" class="plot-title-component">{{ part.component }}/</span><span>{{ part.name }}</span></template
            ></template
          >
        </template>
        <template v-else>{{ title }}</template>
      </span>
      <!-- The values' unit, here rather than as a rotated axis title, which takes a column of the chart. -->
      <span class="plot-unit">{{ unit }}</span>
    </figcaption>
    <!-- A key only when the title names the plot rather than its lines, which it colours itself. -->
    <ul v-if="series.length > 1 && !titleNamesLines" class="plot-key">
      <li v-for="item in series" :key="item.key">
        <button
          type="button"
          class="plot-key-toggle"
          :class="{ 'is-hidden': isHidden(item) }"
          :aria-pressed="!isHidden(item)"
          :title="toggleHint(item)"
          @click="toggleSeries(item)"
        >
          <span class="plot-key-swatch" :style="{ background: colourOf(item) }" aria-hidden="true"></span>{{ item.label }}
        </button>
      </li>
    </ul>
    <div class="plot-area">
      <div ref="chartEl" class="plot-chart"></div>
      <!-- The values under the cursor, beside it, as plotly's hover does, in place of a legend line. -->
      <div v-if="readout" class="plot-readout" :style="{ left: `${readout.left}px`, top: `${readout.top}px` }" aria-hidden="true">
        <div class="plot-readout-time">{{ readout.time }}</div>
        <div v-for="row in readout.rows.filter((row) => !hiddenKeys.has(row.key))" :key="row.key" class="plot-readout-row">
          <span class="plot-key-swatch" :style="{ background: row.colour }"></span>
          <span v-if="series.length > 1" class="plot-readout-label">{{ row.label }}</span>
          <span class="plot-readout-value">{{ row.value }}</span>
        </div>
      </div>
    </div>
  </figure>
</template>

<script setup>
/**
 * One simulation chart: a uPlot line chart of series that share a unit, against the variable of integration.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

import { useColorScheme } from '../../composables/useColorScheme'
import { getChartZoom, setChartZoom } from '../../services/simulation/chartZoom'
import { SERIES_COLOURS } from '../../services/simulation/seriesSlots'

const CHROME = {
  light: { text: '#52514e', grid: '#e1e0d9', axis: '#c3c2b7', band: 'rgba(82, 81, 78, 0.06)' },
  dark: { text: '#c3c2b7', grid: '#2c2c2a', axis: '#383835', band: 'rgba(195, 194, 183, 0.07)' },
}
const props = defineProps({
  title: { type: String, required: true },
  // The title as instance/variable paths, to show each instance muted, or null to show `title`.
  titleParts: { type: Array, default: null },
  unit: { type: String, required: true },
  x: { type: Object, required: true }, // { label, unit, values, segments? }, segments [{ from, to, number }]
  series: { type: Array, required: true }, // [{ key, label, slot, values, isStepped? }]
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

const AXIS_FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
// What an axis takes beside its labels: uPlot's ticks (10px) and the gap after them (5px), and a little to spare.
const AXIS_CHROME_PX = 18
let measuringContext = null

/**
 * Measures a tick label as the axis draws it.
 *
 * @param {string} text
 * @returns {number} Pixels.
 */
function measureLabel(text) {
  measuringContext ??= document.createElement('canvas').getContext('2d')
  if (!measuringContext) return text.length * 7
  measuringContext.font = AXIS_FONT
  return measuringContext.measureText(text).width
}

/**
 * Sizes the value axis to fit its widest tick label; its unit is in the chart's heading.
 *
 * @param {Object} _ - The chart.
 * @param {string[]|null} values - The tick labels, once known.
 * @returns {number} Pixels.
 */
const sizeValueAxis = (_, values) => Math.max(32, Math.ceil(Math.max(0, ...(values ?? []).map(measureLabel))) + AXIS_CHROME_PX)

/**
 * Pads the chart's right side by half its last time label, which is centred on the right edge, so it isn't cut off.
 *
 * @param {Object} chart
 * @returns {number} Pixels.
 */
const padRight = (chart) => Math.max(12, Math.ceil(measureLabel(chart.axes[0]?._values?.at(-1) ?? '') / 2) + 2)

/**
 * Formats a value for the readout, to 5 significant figures.
 *
 * @param {number|null|undefined} value
 * @returns {string}
 */
const formatValue = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(5))) : '–')

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
// The keys of the series hidden by clicking them in the title or key, kept across redraws.
const hiddenKeys = ref(new Set())

/**
 * Tells whether a series is hidden.
 *
 * @param {{key: string}} item
 * @returns {boolean}
 */
const isHidden = (item) => hiddenKeys.value.has(item.key)

// Whether the title names each line, and so carries their toggles; otherwise the key under it does.
const titleNamesLines = computed(() => props.series.length > 1 && props.titleParts?.length === props.series.length)

/**
 * Describes what clicking a series' name does.
 *
 * @param {{label: string}} item
 * @returns {string}
 */
const toggleHint = (item) => `${isHidden(item) ? 'Show' : 'Hide'} ${item.label}`

/**
 * Shows or hides a series' line, refitting the values to the lines left; the time range stays.
 *
 * @param {{key: string}} item
 */
function toggleSeries(item) {
  const hidden = new Set(hiddenKeys.value)
  if (hidden.has(item.key)) hidden.delete(item.key)
  else hidden.add(item.key)
  hiddenKeys.value = hidden
  const index = props.series.findIndex((series) => series.key === item.key)
  if (plot && index >= 0) plot.setSeries(index + 1, { show: !hidden.has(item.key) })
}

/**
 * Gets a series' line colour.
 *
 * @param {{slot: number}} item
 * @returns {string}
 */
const colourOf = (item) => SERIES_COLOURS[isDarkMode.value ? 'dark' : 'light'][item.slot]

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
    time: `${formatValue(chart.data[0][idx])}${props.x.unit ? ` ${shortUnit(props.x.unit)}` : ''}${findSegmentLabel(chart.data[0][idx])}`,
    rows: props.series.map((item) => ({ key: item.key, label: item.label, colour: colourOf(item), value: formatValue(item.values[idx]) })),
  }
}
/**
 * Names the sub-experiment a time falls in, for the readout; the later one at a boundary.
 *
 * @param {number} time
 * @returns {string} ` · sub n`, or nothing outside a protocol.
 */
function findSegmentLabel(time) {
  const segment = (props.x.segments ?? []).findLast(({ from, to }) => time >= from && time <= to)
  return segment ? ` · sub ${segment.number}` : ''
}

/**
 * Shades every other sub-experiment of a protocol's run behind the lines, so where each starts shows.
 *
 * @param {Object} chart - The uPlot chart.
 */
function drawSegments(chart) {
  const segments = props.x.segments ?? []
  if (segments.length < 2) return
  const { ctx, bbox } = chart
  ctx.save()
  ctx.beginPath()
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height)
  ctx.clip()
  ctx.fillStyle = CHROME[isDarkMode.value ? 'dark' : 'light'].band
  segments.forEach(({ from, to }, index) => {
    if (index % 2 === 0) return
    const left = chart.valToPos(from, 'x', true)
    const right = chart.valToPos(to, 'x', true)
    ctx.fillRect(left, bbox.top, right - left, bbox.height)
  })
  ctx.restore()
}

const STEPPED_PATHS = uPlot.paths.stepped({ align: -1 })

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
    font: AXIS_FONT,
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
    hooks: { setScale: [recordZoom], setCursor: [updateReadout], drawClear: [drawSegments] },
    legend: { show: false },
    padding: [8, padRight, 0, 0],
    axes: [{ ...axis(timeTicks), size: 28 }, { ...axis(), size: sizeValueAxis }],
    series: [
      { label: props.x.label },
      ...props.series.map((series) => ({
        label: series.label,
        show: !isHidden(series),
        stroke: SERIES_COLOURS[theme][series.slot],
        width: 2,
        points: { show: false },
        // Every experiment shown at once has points only at its own times; its line carries on across the others'.
        spanGaps: true,
        // A value that changes at a point holds from the point before, so a step shows where its sub-experiment starts.
        ...(series.isStepped && { paths: STEPPED_PATHS }),
      })),
    ],
  }
}

const buildData = () => [props.x.values, ...props.series.map((series) => series.values)]

/**
 * Forgets hidden series no longer plotted, and all of them when one line is left, since it has no name
 * to click to show it again.
 */
function pruneHidden() {
  if (!hiddenKeys.value.size) return
  const keys = new Set(props.series.length > 1 ? props.series.map((series) => series.key) : [])
  const hidden = new Set([...hiddenKeys.value].filter((key) => keys.has(key)))
  if (hidden.size !== hiddenKeys.value.size) hiddenKeys.value = hidden
}

/** Draws the chart afresh, as a change of series or theme needs. */
function draw() {
  pruneHidden()
  plot?.destroy()
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
  resizeObserver.observe(chartEl.value)
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
    // Hidden lines aren't drawn, so the image's title and legend leave them out too.
    const shown = props.series.filter((series) => !isHidden(series))
    const name = titleNamesLines.value && shown.length ? shown.map((series) => series.label).join(', ') : props.title
    // The unit is in the heading, not on the canvas, so the image's title carries it.
    const title = props.unit ? `${name} (${props.unit})` : name
    return { title, canvas: plot.ctx.canvas, legend: shown.map((series) => ({ label: series.label, colour: colours[series.slot] })) }
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
  /* Clip rather than hide, so tabbing to a cut-off name can't scroll the title. */
  overflow: clip;
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

.plot-key-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.plot-title .plot-key-toggle {
  display: inline;
  gap: 0;
}

/* Inside the title, which clips anything outside it. */
.plot-title .plot-key-toggle:focus-visible {
  outline-offset: -2px;
}

.plot-key-toggle:hover {
  text-decoration: underline;
}

.plot-key-toggle:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
  border-radius: 2px;
}

/* A hidden line's name stays, faded, so it can be clicked back on. */
.plot-key-toggle.is-hidden {
  opacity: 0.45;
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

.plot-readout-value {
  margin-left: auto;
  font-weight: 600;
}
</style>
