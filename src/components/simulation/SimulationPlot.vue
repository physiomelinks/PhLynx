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
    <!-- A key of the lines when the title names the plot rather than them, which it colours itself, and of the
      reference lines: a measurement dashed, the run's solid. -->
    <ul v-if="keyed.length" class="plot-key">
      <li v-for="item in keyed" :key="item.key">
        <button
          type="button"
          class="plot-key-toggle"
          :class="{ 'is-hidden': isHidden(item) }"
          :aria-pressed="!isHidden(item)"
          :title="toggleHint(item)"
          :data-value="item.role ? item.value : undefined"
          @click="toggleSeries(item)"
        >
          <span class="plot-key-swatch" :class="{ 'is-dashed': item.role === 'obs' }" :style="swatchStyle(item)" aria-hidden="true"></span
          >{{ item.label }}
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
import { AXIS_FONT, CHROME, formatTicks, formatValue, measureLabel, sizeValueAxis } from '../../services/simulation/chartStyle'
import { getChartZoom, setChartZoom } from '../../services/simulation/chartZoom'
import { SERIES_COLOURS } from '../../services/simulation/seriesSlots'

const props = defineProps({
  title: { type: String, required: true },
  // The title as instance/variable paths, to show each instance muted, or null to show `title`.
  titleParts: { type: Array, default: null },
  unit: { type: String, required: true },
  x: { type: Object, required: true }, // { label, unit, values, segments? }, segments [{ from, to, number }]
  series: { type: Array, required: true }, // [{ key, label, slot, values, isStepped? }]
  // Lines across a window or up the chart, in values, as protocolPlotGroups builds them: [{ key, label, role, slot,
  // orientation, from, to, value }], `role` 'obs' (dashed) or 'calc' (solid).
  references: { type: Array, default: () => [] },
  height: { type: Number, default: 220 },
  // Charts with the same key show their cursors at the same time.
  syncKey: { type: String, default: null },
  // Names the chart, so it keeps its zoom when rebuilt.
  zoomKey: { type: String, default: null },
})

/**
 * Pads the chart's right side by half its last time label, which is centred on the right edge, so it isn't cut off.
 *
 * @param {Object} chart
 * @returns {number} Pixels.
 */
const padRight = (chart) => Math.max(12, Math.ceil(measureLabel(chart.axes[0]?._values?.at(-1) ?? '') / 2) + 2)

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
// What the key lists: the lines, unless the title names them or there's one with nothing beside it, then the
// reference lines.
const keyed = computed(() => [
  ...(!titleNamesLines.value && (props.series.length > 1 || props.references.length) ? props.series : []),
  ...props.references,
])

/**
 * Describes what clicking a series' name does, with a reference line's value.
 *
 * @param {{label: string, role?: string, value?: number}} item
 * @returns {string}
 */
const toggleHint = (item) => `${isHidden(item) ? 'Show' : 'Hide'} ${item.label}${item.role ? `: ${formatValue(item.value)}` : ''}`

/**
 * Shows or hides a series' line, or a reference line, refitting the values to the lines left; the time range stays.
 *
 * @param {{key: string, role?: string}} item
 */
function toggleSeries(item) {
  const hidden = new Set(hiddenKeys.value)
  if (hidden.has(item.key)) hidden.delete(item.key)
  else hidden.add(item.key)
  hiddenKeys.value = hidden
  if (item.role) {
    // The values' range takes in the reference lines shown, the zoom kept.
    if (!plot) return
    isUpdatingData = true
    plot.setData(buildData())
    restoreZoom()
    isUpdatingData = false
    return
  }
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
 * Colours a key swatch: filled, or a dashed line's colour for a measurement.
 *
 * @param {{slot: number, role?: string}} item
 * @returns {Object}
 */
const swatchStyle = (item) => (item.role === 'obs' ? { color: colourOf(item) } : { background: colourOf(item) })

/**
 * Draws the reference lines shown, in values: a measurement dashed, the run's solid, across its window or up the chart.
 *
 * @param {Object} chart - The uPlot chart.
 */
function drawReferences(chart) {
  const shown = props.references.filter((item) => !isHidden(item))
  if (!shown.length) return
  const { ctx, bbox } = chart
  const ratio = uPlot.pxRatio
  ctx.save()
  ctx.beginPath()
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height)
  ctx.clip()
  ctx.lineWidth = 1.5 * ratio
  for (const item of shown) {
    ctx.strokeStyle = colourOf(item)
    ctx.setLineDash(item.role === 'obs' ? [6 * ratio, 4 * ratio] : [])
    ctx.beginPath()
    if (item.orientation === 'vertical') {
      const x = chart.valToPos(item.value, 'x', true)
      ctx.moveTo(x, bbox.top)
      ctx.lineTo(x, bbox.top + bbox.height)
    } else {
      const y = chart.valToPos(item.value, 'y', true)
      ctx.moveTo(chart.valToPos(item.from, 'x', true), y)
      ctx.lineTo(chart.valToPos(item.to, 'x', true), y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Pads the values' range as uPlot does, taking in the reference lines shown across the chart.
 *
 * @param {Object} _ - The chart.
 * @param {number|null} min
 * @param {number|null} max
 * @returns {number[]}
 */
function rangeY(_, min, max) {
  let low = min ?? Infinity
  let high = max ?? -Infinity
  for (const item of props.references) {
    if (item.orientation === 'vertical' || isHidden(item) || !Number.isFinite(item.value)) continue
    low = Math.min(low, item.value)
    high = Math.max(high, item.value)
  }
  return low <= high ? uPlot.rangeNum(low, high, 0.1, true) : [0, 1]
}

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
    // A chart with reference lines fits them in too.
    scales: { x: { time: false }, ...(props.references.length && { y: { range: rangeY } }) },
    // Synced charts plot different series, so hiding one mustn't hide its namesake by position elsewhere.
    cursor: { y: false, points: { size: 8 }, ...(props.syncKey && { sync: { key: props.syncKey, setSeries: false } }) },
    hooks: { setScale: [recordZoom], setCursor: [updateReadout], drawClear: [drawSegments], draw: [drawReferences] },
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
  const keys = new Set([...(props.series.length > 1 ? props.series.map((series) => series.key) : []), ...props.references.map((item) => item.key)])
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
  () => [
    props.series.map((series) => `${series.key}:${series.slot}`).join('|'),
    props.references.map((item) => `${item.key}:${item.slot}:${item.from}:${item.to}:${item.value}`).join('|'),
    isDarkMode.value,
    props.x.unit,
    props.unit,
    props.syncKey,
  ],
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
   * @returns {{title: string, canvas: HTMLCanvasElement, legend: Array<{label: string, colour: string, isDashed?: boolean}>}|null}
   *   A measurement's reference line `isDashed`.
   */
  snapshot() {
    if (!plot) return null
    const colours = SERIES_COLOURS[isDarkMode.value ? 'dark' : 'light']
    // Hidden lines aren't drawn, so the image's title and legend leave them out too.
    const shown = props.series.filter((series) => !isHidden(series))
    const name = titleNamesLines.value && shown.length ? shown.map((series) => series.label).join(', ') : props.title
    // The unit is in the heading, not on the canvas, so the image's title carries it.
    const title = props.unit ? `${name} (${props.unit})` : name
    const references = props.references.filter((item) => !isHidden(item))
    return {
      title,
      canvas: plot.ctx.canvas,
      legend: [
        ...shown.map((series) => ({ label: series.label, colour: colours[series.slot] })),
        ...references.map((item) => ({ label: item.label, colour: colours[item.slot], isDashed: item.role === 'obs' })),
      ],
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

/* A measurement's reference line, dashed as it's drawn. */
.plot-key-swatch.is-dashed {
  width: 12px;
  height: 0;
  border-radius: 0;
  border-top: 2px dashed currentColor;
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
