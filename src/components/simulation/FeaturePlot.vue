<template>
  <figure class="feature-plot">
    <figcaption class="plot-head">
      <span class="plot-title">{{ title }}</span>
      <span class="plot-unit">{{ unit }}</span>
    </figcaption>
    <ul v-if="keyed.length > 1" class="plot-key">
      <li v-for="item in keyed" :key="item.key">
        <span class="plot-key-swatch" :class="swatchClass(item)" :style="swatchStyle(item)" aria-hidden="true"></span>{{ item.label }}
      </li>
    </ul>
    <div class="plot-area">
      <div ref="chartEl" class="plot-chart"></div>
      <div v-if="readout" class="plot-readout" :style="{ left: `${readout.left}px`, top: `${readout.top}px` }" aria-hidden="true">
        <div class="plot-readout-x">{{ readout.x }}</div>
        <div v-for="row in readout.rows" :key="row.key" class="plot-readout-row">
          <span class="plot-key-swatch" :class="swatchClass(row)" :style="swatchStyle(row)"></span>
          <span v-if="row.label" class="plot-readout-label">{{ row.label }}</span>
          <span class="plot-readout-value">{{ row.value }}</span>
        </div>
      </div>
    </div>
  </figure>
</template>

<script setup>
/**
 * One feature plot of a protocol run: a uPlot chart of points joined by lines, against the experiments, another
 * feature or a protocol input, and any measured values as rings with their std as whiskers (see
 * services/simulation/featureCharts.js).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

import { useColorScheme } from '../../composables/useColorScheme'
import { AXIS_FONT, CHROME, formatTicks, formatValue, measureLabel, sizeValueAxis } from '../../services/simulation/chartStyle'
import { SERIES_COLOURS } from '../../services/simulation/seriesSlots'

const props = defineProps({
  title: { type: String, required: true },
  unit: { type: String, default: '' },
  x: { type: Object, required: true }, // { label, unit, values, labels }, `labels` naming each value, or null
  // What the y axis is, when the title doesn't say.
  yLabel: { type: String, default: '' },
  // [{ key, label, slot, values, showsLine, showsPoints, isInKey, errors?, isMeasured? }], slot null for no colour,
  // `errors` each value's std for a measured series
  series: { type: Array, required: true },
  height: { type: Number, default: 220 },
})

// The readout's width, about, to keep it inside the chart.
const READOUT_WIDTH_PX = 150
// A point's size, and a measured one's ring, which its whiskers stop short of.
const POINT_SIZE_PX = 8
const WHISKER_CAP_PX = 4
const AXIS_LABEL_FONT = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif'

const chartEl = ref(null)
const { isDarkMode } = useColorScheme()
const readout = ref(null)

const keyed = computed(() => props.series.filter((item) => item.isInKey))
const xTitle = computed(() => (props.x.unit && props.x.unit !== 'dimensionless' ? `${props.x.label} (${props.x.unit})` : props.x.label))

/**
 * Gets a series' colour: its slot's, or the chart's own for a line of none.
 *
 * @param {{slot: number|null}} item
 * @returns {string}
 */
const colourOf = (item) => (item.slot == null ? CHROME[isDarkMode.value ? 'dark' : 'light'].neutral : SERIES_COLOURS[isDarkMode.value ? 'dark' : 'light'][item.slot])

/**
 * Classes a key or readout swatch: a line, a point, or a measured value's ring.
 *
 * @param {{showsLine: boolean, isMeasured?: boolean}} item
 * @returns {Object}
 */
const swatchClass = (item) => ({ 'is-point': !item.showsLine, 'is-measured': !!item.isMeasured })

/**
 * Colours a key or readout swatch: filled, or a ring for a measured value.
 *
 * @param {Object} item - A series, or a readout row with its `colour`.
 * @returns {Object}
 */
function swatchStyle(item) {
  const colour = item.colour ?? colourOf(item)
  return item.isMeasured ? { borderColor: colour } : { background: colour }
}

/**
 * Names an x value: its label, or the value.
 *
 * @param {number} value
 * @returns {string}
 */
function nameX(value) {
  const index = props.x.values.indexOf(value)
  if (props.x.labels && index >= 0) return props.x.labels[index]
  return `${xTitle.value} ${formatValue(value)}`
}

/**
 * Pads the x range, so the first and last points aren't on the chart's edges.
 *
 * @param {Object} _ - The chart.
 * @param {number} min
 * @param {number} max
 * @returns {number[]}
 */
function rangeX(_, min, max) {
  const pad = max > min ? (max - min) * 0.08 : Math.abs(min) * 0.1 || 1
  return props.x.labels ? [min - 0.5, max + 0.5] : [min - pad, max + pad]
}

/**
 * Shows the values at the point under the cursor beside it, or hides them as the cursor leaves.
 *
 * @param {Object} chart - The uPlot chart.
 */
function updateReadout(chart) {
  const { idx, left } = chart.cursor
  const rows = idx == null ? [] : keyed.value.filter((item) => item.values[idx] != null)
  if (idx == null || left == null || left < 0 || !rows.length) {
    readout.value = null
    return
  }
  const over = chart.over
  const x = over.offsetLeft + left
  const fitsRight = x + 12 + READOUT_WIDTH_PX <= chart.root.clientWidth
  readout.value = {
    left: fitsRight ? x + 12 : Math.max(0, x - 12 - READOUT_WIDTH_PX),
    top: over.offsetTop + 6,
    x: nameX(chart.data[0][idx]),
    rows: rows.map((item) => ({
      key: item.key,
      label: keyed.value.length > 1 ? item.label : '',
      colour: colourOf(item),
      showsLine: item.showsLine,
      isMeasured: !!item.isMeasured,
      value: Number.isFinite(item.errors?.[idx]) ? `${formatValue(item.values[idx])} ± ${formatValue(item.errors[idx])}` : formatValue(item.values[idx]),
    })),
  }
}

/**
 * Pads the y range around the values and the measured values' whiskers, as uPlot pads its own.
 *
 * @param {Object} _ - The chart.
 * @param {number|null} min
 * @param {number|null} max
 * @returns {number[]}
 */
function rangeY(_, min, max) {
  let low = min ?? Infinity
  let high = max ?? -Infinity
  for (const { values, errors } of props.series) {
    if (!errors) continue
    values.forEach((value, index) => {
      if (value == null || !Number.isFinite(errors[index])) return
      low = Math.min(low, value - errors[index])
      high = Math.max(high, value + errors[index])
    })
  }
  return low <= high ? uPlot.rangeNum(low, high, 0.1, true) : [0, 1]
}

/**
 * Draws each measured value's std as a whisker above and below its ring, capped.
 *
 * @param {Object} chart - The uPlot chart.
 */
function drawWhiskers(chart) {
  const { ctx } = chart
  const ratio = uPlot.pxRatio
  const gap = (POINT_SIZE_PX / 2 + 1) * ratio
  const cap = (WHISKER_CAP_PX / 2) * ratio
  ctx.save()
  ctx.lineWidth = 1.5 * ratio
  props.series.forEach((item) => {
    if (!item.errors) return
    ctx.strokeStyle = colourOf(item)
    ctx.beginPath()
    item.values.forEach((value, index) => {
      const error = item.errors[index]
      if (value == null || !Number.isFinite(error) || error <= 0) return
      const x = chart.valToPos(chart.data[0][index], 'x', true)
      const centre = chart.valToPos(value, 'y', true)
      for (const end of [chart.valToPos(value + error, 'y', true), chart.valToPos(value - error, 'y', true)]) {
        const toward = Math.sign(end - centre)
        if (Math.abs(end - centre) <= gap) continue
        ctx.moveTo(x, centre + toward * gap)
        ctx.lineTo(x, end)
        ctx.moveTo(x - cap, end)
        ctx.lineTo(x + cap, end)
      }
    })
    ctx.stroke()
  })
  ctx.restore()
}

let plot = null
let resizeObserver = null

const ariaLabel = computed(() => `Feature plot of ${props.title}${props.unit ? `, in ${props.unit}` : ''}, against ${xTitle.value}`)

/**
 * Builds the uPlot options for the current series and theme.
 *
 * @param {number} width
 * @returns {Object}
 */
function buildOptions(width) {
  const theme = isDarkMode.value ? 'dark' : 'light'
  const chrome = CHROME[theme]
  const axis = {
    stroke: chrome.text,
    grid: { stroke: chrome.grid, width: 1 },
    ticks: { stroke: chrome.axis, width: 1 },
    font: AXIS_FONT,
    labelFont: AXIS_LABEL_FONT,
  }
  // The experiments, named, at their own ticks; or the values another feature or an input took.
  const xAxis = props.x.labels
    ? { ...axis, splits: () => props.x.values, values: (_, splits) => splits.map((value) => props.x.labels[props.x.values.indexOf(value)] ?? '') }
    : { ...axis, values: formatTicks }
  return {
    width,
    height: props.height,
    scales: { x: { time: false, range: rangeX }, y: { range: rangeY } },
    cursor: { y: false, points: { size: 9 } },
    hooks: { setCursor: [updateReadout], draw: [drawWhiskers] },
    legend: { show: false },
    padding: [8, ({ axes }) => Math.max(12, Math.ceil(measureLabel(axes[0]?._values?.at(-1) ?? '') / 2) + 2), 0, 0],
    axes: [
      { ...xAxis, label: xTitle.value, labelSize: 18, size: 30 },
      { ...axis, values: formatTicks, size: sizeValueAxis, ...(props.yLabel && { label: props.yLabel, labelSize: 18 }) },
    ],
    series: [
      { label: props.x.label },
      ...props.series.map((item) => ({
        label: item.label,
        stroke: colourOf(item),
        width: item.showsLine ? 2 : 0,
        // A series of points alone draws no line.
        ...(!item.showsLine && { paths: () => null }),
        // A measured value is a ring, its whiskers drawn after (drawWhiskers).
        points: item.isMeasured
          ? { show: true, size: POINT_SIZE_PX, width: 1.5, stroke: colourOf(item), fill: 'transparent' }
          : { show: item.showsPoints, size: POINT_SIZE_PX, width: 1, stroke: colourOf(item), fill: colourOf(item) },
        spanGaps: true,
      })),
    ],
  }
}

const buildData = () => [props.x.values, ...props.series.map((item) => item.values)]

/** Draws the chart afresh, as a change of series or theme needs. */
function draw() {
  plot?.destroy()
  if (!chartEl.value) return
  plot = new uPlot(buildOptions(chartEl.value.clientWidth || 300), buildData(), chartEl.value)
  const drawing = plot.root.querySelector('.u-wrap')
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

watch(() => [props.series, props.x, isDarkMode.value, props.yLabel], draw)
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
    const title = props.unit ? `${props.title} (${props.unit})` : props.title
    return { title, canvas: plot.ctx.canvas, legend: keyed.value.map((item) => ({ label: item.label, colour: colourOf(item) })) }
  },
})
</script>

<style scoped>
.feature-plot {
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
  overflow: clip;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--dlg-fs-small, 0.8125rem);
  font-weight: 600;
  color: var(--p-text-color);
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

.plot-key-swatch {
  flex-shrink: 0;
  width: 10px;
  height: 3px;
  border-radius: 2px;
}

/* A point of its experiment's colour, rather than a line. */
.plot-key-swatch.is-point {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* A measured value: a ring. */
.plot-key-swatch.is-measured {
  box-sizing: border-box;
  border: 1.5px solid;
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

.plot-readout-x {
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
