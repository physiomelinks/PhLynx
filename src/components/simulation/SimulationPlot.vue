<template>
  <figure class="simulation-plot" :class="{ 'is-fill': fill }">
    <figcaption class="plot-head">
      <span class="plot-title">
        <template v-if="titleParts">
          <template v-for="(part, index) in titleParts" :key="index"
            ><span v-if="index" class="plot-title-separator">, </span
            ><!-- A span rather than a button, so the title's ellipsis can cut a long name rather than drop it whole. --><span
              v-if="titleToggles[index]"
              role="button"
              tabindex="0"
              class="plot-key-toggle"
              :class="{ 'is-hidden': isHidden(titleToggles[index]) }"
              :aria-pressed="!isHidden(titleToggles[index])"
              :title="toggleHint(titleToggles[index])"
              @click="toggleSeries(titleToggles[index])"
              @keydown.enter.prevent="toggleSeries(titleToggles[index])"
              @keydown.space.prevent="toggleSeries(titleToggles[index])"
              ><span class="plot-key-swatch plot-title-swatch" :style="{ background: colourOf(titleToggles[index]) }" aria-hidden="true"></span
              ><span v-if="part.component" class="plot-title-component">{{ part.component }}/</span><span>{{ part.name }}</span></span
            ><template v-else
              ><span v-if="titleParts.length > 1 && part.slot !== undefined" class="plot-key-swatch plot-title-swatch" :style="{ background: colourOf(part) }" aria-hidden="true"></span
              ><span v-if="part.component" class="plot-title-component">{{ part.component }}/</span><span>{{ part.name }}</span></template
            ></template
          >
        </template>
        <template v-else>{{ title }}</template>
        <!-- What the x-axis is, when it isn't time: a phase plot's variable, or a sweep's parameter. -->
        <span v-if="againstLabel" class="plot-title-against"> vs {{ againstLabel }}{{ readoutNote }}</span>
      </span>
      <!-- The values' unit, here rather than as a rotated axis title, which takes a column of the chart. -->
      <span class="plot-unit">{{ unit }}</span>
    </figcaption>
    <p v-if="note" class="plot-note">{{ note }}</p>
    <!-- A key of the lines when the title names the plot rather than them, which it colours itself, and of the
      reference lines: a measurement dashed (or points, for a recorded series), the run's solid. -->
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
          <RunSwatch v-if="item.run" :colour="colourOf(item)" :dash="item.run.dash" /><span
            v-else
            class="plot-key-swatch"
            :class="{ 'is-dashed': item.role === 'obs' && !item.points, 'is-point': !!item.points }"
            :style="swatchStyle(item)"
            aria-hidden="true"
          ></span
          >{{ item.label }}
        </button>
      </li>
    </ul>
    <!-- With tracked runs, the title or key names the variables, and this which runs the lines are from: the live run
      solid, tracked runs dashed. -->
    <ul v-if="runKey.length && !x.isSteadyState" class="plot-key" aria-label="Runs">
      <li v-for="item in runKey" :key="item.number">
        <button
          type="button"
          class="plot-key-toggle"
          :class="{ 'is-hidden': isHidden(item) }"
          :aria-pressed="!isHidden(item)"
          :title="toggleHint(item)"
          @click="toggleSeries(item)"
        >
          <RunSwatch v-if="item.dash" :colour="chrome.text" :dash="item.dash" /><span v-else class="plot-key-swatch" :style="{ background: chrome.text }" aria-hidden="true"></span
          >{{ item.label }}
        </button>
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
        <div v-for="row in readout.rows.filter((row) => !row.hiddenBy.some((key) => hiddenKeys.has(key)))" :key="row.key" class="plot-readout-row">
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
 * One simulation chart: a uPlot line chart of series that share a unit, against the variable of integration,
 * or against another variable of the same run, as a phase plot is. A steady state (a model without ODEs)
 * has no variable of integration, so its values are listed instead.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

import RunSwatch from './RunSwatch.vue'
import { useColorScheme } from '../../composables/useColorScheme'
import { forgetChartGutters, reportChartGutter, widestChartGutters } from '../../services/simulation/chartAlignment'
import { AXIS_FONT, CHROME, formatTicks, formatValue, measureLabel, sizeValueAxis } from '../../services/simulation/chartStyle'
import { getChartZoom, setChartZoom } from '../../services/simulation/chartZoom'
import { findNearestPoint } from '../../services/simulation/nearestPoint'
import { SERIES_COLOURS } from '../../services/simulation/seriesSlots'
import { READOUTS } from '../../services/simulation/sweepReadouts'
import { fadeColour } from '../../services/simulation/trackedRuns'

const props = defineProps({
  title: { type: String, required: true },
  // The title as instance/variable paths, to show each instance muted, or null to show `title`.
  titleParts: { type: Array, default: null },
  unit: { type: String, required: true },
  // { label, unit, values, segments?, isSteadyState, isSweep, readout, isPhase, run }: segments [{ from, to, number }]
  // are a protocol's sub-experiments; `readout` what a sweep read from each time course; a phase plot's `run` is the
  // run's own x-axis.
  x: { type: Object, required: true },
  // [{ key, label, variableLabel, slot, values, run, xValues, runValues, isStepped? }], run being a tracked run's
  // `{ number, name, dash }`, or null for the live run, and a tracked run's liveKey the live run's line of its variable.
  // On a phase plot, xValues and runValues are the series' own x values and run x-axis values, as a tracked run's differ
  // from the live run's.
  series: { type: Array, required: true },
  // Lines across a window or up the chart, in values, as protocolPlotGroups builds them: [{ key, label, role, slot,
  // orientation, from, to, value }], `role` 'obs' (dashed) or 'calc' (solid); or a recorded series' `points`
  // ([{ x, y }]), orientation 'points'.
  references: { type: Array, default: () => [] },
  height: { type: Number, default: 220 },
  // Fills the height its container gives it, the drawing taking what its heading and keys leave, in place of `height`.
  fill: { type: Boolean, default: false },
  // Charts with the same key show their cursors at the same time.
  syncKey: { type: String, default: null },
  // Names the chart, so it keeps its zoom when rebuilt.
  zoomKey: { type: String, default: null },
  // A line under the title, such as why the plot isn't against the variable it is set to plot against.
  note: { type: String, default: null },
})

/**
 * Pads the chart's right side by half its last x label, which is centred on the right edge, so it isn't cut off.
 *
 * @param {Object} chart
 * @returns {number} Pixels.
 */
const padRight = (chart) => Math.max(12, Math.ceil(measureLabel(chart.axes[0]?._values?.at(-1) ?? '') / 2) + 2)

// Charts against the same time axis, whose cursors move together, line up: each takes its group's widest gutters.
const alignmentId = Symbol('chart')
const alignmentKey = computed(() => (props.syncKey && !props.x.isPhase && !props.x.isSteadyState ? props.syncKey : null))

/**
 * Sizes one of the chart's gutters: its own size, or the widest of the charts it lines up with.
 *
 * @param {'left'|'right'} side - The value axis's, or the right padding.
 * @param {number} own - Pixels.
 * @returns {number} Pixels.
 */
function alignGutter(side, own) {
  const key = alignmentKey.value
  if (!key) return own
  reportChartGutter(key, alignmentId, side, own)
  return Math.max(own, widestChartGutters(key)[side])
}

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

// Names the x-axis in the heading when it isn't time, as no axis title does.
const againstLabel = computed(() => (props.x.isPhase || props.x.isSweep ? props.x.label : null))
// What a sweep of a model with ODEs read from each time course, after the swept parameter.
const readoutNote = computed(() => {
  const readout = props.x.isSweep && READOUTS.find(({ id }) => id === props.x.readout)
  return readout ? ` (${readout.label.toLowerCase()} of each run)` : ''
})

/**
 * Gets the x-axis unit to show on its last tick and in the readout: none for a dimensionless one.
 *
 * @returns {string}
 */
const xUnit = () => (props.x.unit && props.x.unit !== 'dimensionless' ? shortUnit(props.x.unit) : '')

// The least height of a filling chart's drawing, to stay readable in a small window.
const MIN_FILL_HEIGHT_PX = 120

/**
 * Gets the drawing's height: `height`, or a filling chart's the space left under its heading and keys.
 *
 * @returns {number} Pixels.
 */
const plotHeight = () => (props.fill ? Math.max(MIN_FILL_HEIGHT_PX, Math.floor(chartEl.value?.clientHeight ?? 0)) : props.height)

const chartEl = ref(null)
const { isDarkMode } = useColorScheme()
const readout = ref(null)
// The keys of the lines hidden by clicking them in the title or key, kept across redraws: a tracked run's line goes by
// its live run's key, so its variable's toggle hides both, and a run's key in the Runs key hides every line of it.
const hiddenKeys = ref(new Set())

/**
 * Gets the key a line is hidden by: the live run's line of its variable, for a tracked run's.
 *
 * @param {{key: string, liveKey?: string}} item
 * @returns {string}
 */
const lineKeyOf = (item) => item.liveKey ?? item.key

/**
 * Tells whether a series is hidden.
 *
 * @param {{key: string, liveKey?: string}} item
 * @returns {boolean}
 */
const isHidden = (item) => hiddenKeys.value.has(lineKeyOf(item))

/**
 * Gets the key a run's lines are hidden by, the live run's being 0.
 *
 * @param {number} number - The run's number.
 * @returns {string}
 */
const runToggleKey = (number) => `run:${number}`

/**
 * Gets the keys that hide a series' line: its variable's and its run's.
 *
 * @param {{key: string, liveKey?: string, run: {number: number}|null}} series
 * @returns {string[]}
 */
const hiddenKeysOf = (series) => [lineKeyOf(series), runToggleKey(series.run?.number ?? 0)]

/**
 * Tells whether a series' line is hidden, by its variable or by its run.
 *
 * @param {{key: string, liveKey?: string, run: {number: number}|null}} series
 * @returns {boolean}
 */
const isLineHidden = (series) => hiddenKeysOf(series).some((key) => hiddenKeys.value.has(key))

const hasRuns = computed(() => props.series.some((item) => item.run))
// Whether the title names each line, and so carries their toggles; otherwise the key under it does. A steady state
// lists its values, with no lines to hide.
const titleNamesLines = computed(
  () => !hasRuns.value && !props.x.isSteadyState && props.series.length > 1 && props.titleParts?.length === props.series.length
)
// With tracked runs, the variables the lines show, each toggling its live and tracked lines together.
const runVariables = computed(() => {
  if (!hasRuns.value) return []
  const variables = new Map()
  for (const item of readoutOrder.value) {
    const key = lineKeyOf(item)
    if (!variables.has(key)) variables.set(key, { key, label: item.variableLabel ?? item.label, slot: item.slot })
  }
  return [...variables.values()]
})
// The toggle for each part of the title, or none: its line, or with tracked runs, its variable's lines.
const titleToggles = computed(() => {
  if (!props.titleParts) return []
  if (!hasRuns.value) return titleNamesLines.value ? props.titleParts.map((_, index) => props.series[index] ?? null) : []
  if (props.x.isSteadyState || props.titleParts.length < 2) return []
  const byKey = new Map(runVariables.value.map((variable) => [variable.key, variable]))
  return props.titleParts.map((part) => byKey.get(part.key) ?? null)
})
// What the key lists: the lines (with tracked runs, their variables), unless the title names them or there's one with
// nothing beside it, then the reference lines. A steady state lists its values instead.
const keyed = computed(() => {
  if (props.x.isSteadyState) return []
  if (hasRuns.value) return [...(!props.titleParts && runVariables.value.length > 1 ? runVariables.value : []), ...props.references]
  const listsLines = !titleNamesLines.value && (props.series.length > 1 || props.references.length)
  return [...(listsLines ? props.series : []), ...props.references]
})

/**
 * Describes what clicking a series' name does, with a reference line's value.
 *
 * @param {{label: string, role?: string, value?: number}} item
 * @returns {string}
 */
const toggleHint = (item) => `${isHidden(item) ? 'Show' : 'Hide'} ${item.label}${item.role && !item.points ? `: ${formatValue(item.value)}` : ''}`

/**
 * Shows or hides a series' line, with tracked runs every line of its variable or of a run, or a reference line,
 * refitting the values to the lines left; the x range stays.
 *
 * @param {{key: string, liveKey?: string, role?: string}} item
 */
function toggleSeries(item) {
  const key = lineKeyOf(item)
  const wasHidden = props.series.map(isLineHidden)
  const hidden = new Set(hiddenKeys.value)
  if (hidden.has(key)) hidden.delete(key)
  else hidden.add(key)
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
  if (!plot) return
  props.series.forEach((series, index) => {
    if (isLineHidden(series) !== wasHidden[index]) plot.setSeries(index + 1, { show: wasHidden[index] })
  })
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
 * @param {{slot: number, role?: string, points?: Array}} item
 * @returns {Object}
 */
const swatchStyle = (item) => (item.role === 'obs' && !item.points ? { color: colourOf(item) } : { background: colourOf(item) })

const chrome = computed(() => CHROME[isDarkMode.value ? 'dark' : 'light'])

// The runs the lines are from, once tracked runs are shown.
const runKey = computed(() => {
  const runs = new Map()
  for (const item of props.series) {
    if (item.run) runs.set(item.run.number, { key: runToggleKey(item.run.number), number: item.run.number, label: item.run.name || `#${item.run.number}`, dash: item.run.dash })
  }
  if (!runs.size) return []
  const key = [...runs.values()].sort((a, b) => a.number - b.number)
  return props.series.some((item) => !item.run) ? [{ key: runToggleKey(0), number: 0, label: 'Live', dash: null }, ...key] : key
})

// How many variables the lines show, however many runs or experiments they are from.
const variableCount = computed(() => new Set(props.series.map((item) => item.variableLabel ?? item.label)).size)

/**
 * Names a line in the readout: its variable, when the chart has several, and its run, apart from the
 * variable so a long name cut short still says which run it is. Without tracked runs, lines of one variable
 * (every experiment of a protocol at once) go by their own names.
 *
 * @param {{label: string, variableLabel?: string, run: {number: number, name?: string|null}|null}} item
 * @returns {{label: string|null, run: string|null}}
 */
function readoutNames(item) {
  const run = hasRuns.value ? (item.run ? item.run.name || `#${item.run.number}` : 'Live') : null
  // One of every experiment of a protocol shown at once, named for its experiment.
  if (item.experiment != null) return { label: item.label, run }
  if (variableCount.value > 1) return { label: item.variableLabel ?? item.label, run }
  return { label: !hasRuns.value && props.series.length > 1 ? item.label : null, run }
}

// The live run's values first, then each tracked run's, though the tracked runs' lines are drawn first.
const readoutOrder = computed(() => [...props.series].sort((a, b) => (a.run?.number ?? 0) - (b.run?.number ?? 0)))

/**
 * Draws the reference lines shown, in values: a measurement dashed, the run's solid, across its window or up the chart;
 * a recorded series as points.
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
    if (item.points) {
      ctx.fillStyle = colourOf(item)
      for (const { x, y } of item.points) {
        ctx.beginPath()
        ctx.arc(chart.valToPos(x, 'x', true), chart.valToPos(y, 'y', true), 3 * ratio, 0, 2 * Math.PI)
        ctx.fill()
      }
      continue
    }
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
    if (isHidden(item)) continue
    for (const { y } of item.points ?? []) {
      low = Math.min(low, y)
      high = Math.max(high, y)
    }
    if (item.orientation === 'vertical' || !Number.isFinite(item.value)) continue
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
  if (props.x.isPhase) {
    updatePhaseReadout(chart)
    return
  }
  const { idx, left } = chart.cursor
  if (idx == null || left == null || left < 0) {
    readout.value = null
    return
  }
  readout.value = {
    ...placeReadout(chart, left),
    time: `${formatValue(chart.data[0][idx])}${xUnit() ? ` ${xUnit()}` : ''}${findSegmentLabel(chart.data[0][idx])}`,
    rows: readoutOrder.value.map((item) => ({ key: item.key, hiddenBy: hiddenKeysOf(item), ...readoutNames(item), colour: colourOf(item), dash: item.run?.dash ?? null, value: formatValue(item.values[idx]) })),
  }
}

/**
 * Places the readout beside the cursor, flipping to its left near the chart's right edge.
 *
 * @param {Object} chart - The uPlot chart.
 * @param {number} left - The cursor's position in the plot area.
 * @returns {{left: number, top: number}}
 */
function placeReadout(chart, left) {
  const over = chart.over
  const x = over.offsetLeft + left
  const fitsRight = x + 12 + READOUT_WIDTH_PX <= chart.root.clientWidth
  return { left: fitsRight ? x + 12 : Math.max(0, x - 12 - READOUT_WIDTH_PX), top: over.offsetTop + 6 }
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

/**
 * Gets a phase plot series' x values: a tracked run's own, or the live run's.
 *
 * @param {{xValues?: ArrayLike<number>}} item
 * @returns {ArrayLike<number>}
 */
const xValuesOf = (item) => item.xValues ?? props.x.values

// How near the cursor, in pixels, a phase plot's point must be to be read out.
const PHASE_HOVER_RADIUS_PX = 40

/**
 * Finds a phase plot series' point nearest the cursor, for uPlot to mark and the readout to show.
 *
 * @param {Object} chart - The uPlot chart.
 * @param {number} seriesIndex
 * @returns {number|null}
 */
function nearestPhasePoint(chart, seriesIndex) {
  const { left, top } = chart.cursor
  if (seriesIndex === 0 || left == null || left < 0) return null
  const [xs, ys] = chart.data[seriesIndex]
  const toLeft = (value) => chart.valToPos(value, 'x')
  const toTop = (value) => chart.valToPos(value, 'y')
  return findNearestPoint(xs, ys, toLeft, toTop, left, top, PHASE_HOVER_RADIUS_PX)
}

/**
 * Shows a phase plot's points nearest the cursor: the nearest one's x and when in the run it is, then each
 * series' value at its own nearest point.
 *
 * @param {Object} chart - The uPlot chart.
 */
function updatePhaseReadout(chart) {
  const { left, top, idxs } = chart.cursor
  const found = props.series
    .map((item, i) => ({ item, idx: idxs?.[i + 1] }))
    .filter(({ item, idx }) => idx != null && !isLineHidden(item))
    .map((point) => {
      const pointLeft = chart.valToPos(xValuesOf(point.item)[point.idx], 'x')
      const pointTop = chart.valToPos(point.item.values[point.idx], 'y')
      return { ...point, distance: Math.hypot(pointLeft - left, pointTop - top) }
    })
  if (!found.length) {
    readout.value = null
    return
  }
  const nearest = found.reduce((best, point) => (point.distance < best.distance ? point : best))
  const unitOf = (unit) => (unit && unit !== 'dimensionless' ? ` ${shortUnit(unit)}` : '')
  const name = (label) => label?.split('/').pop() ?? ''
  const run = props.x.run
  const runValues = nearest.item.runValues ?? run?.values
  const when = runValues?.length ? ` · ${name(run?.label)} ${formatValue(runValues[nearest.idx])}${unitOf(run?.unit)}` : ''
  readout.value = {
    ...placeReadout(chart, left),
    time: `${name(props.x.label)} ${formatValue(xValuesOf(nearest.item)[nearest.idx])}${xUnit() ? ` ${xUnit()}` : ''}${when}`,
    rows: found
      .sort((a, b) => (a.item.run?.number ?? 0) - (b.item.run?.number ?? 0))
      .map(({ item, idx }) => ({ key: item.key, hiddenBy: hiddenKeysOf(item), ...readoutNames(item), colour: colourOf(item), dash: item.run?.dash ?? null, value: formatValue(item.values[idx]) })),
  }
}

const STEPPED_PATHS = uPlot.paths.stepped({ align: -1 })

let plot = null
// Whether the viewer is zooming this chart alone: dragging across it, or double-clicking it, with shift held.
let isZoomingAlone = false
// The events a chart passes to the charts it moves with, which zoom (or unzoom) them too.
const ZOOM_EVENTS = new Set(['mousedown', 'mouseup', 'dblclick'])

/**
 * Notes whether a press or double-click zooms the chart alone, before the chart acts on it.
 *
 * @param {MouseEvent} event
 */
const noteZoomAlone = (event) => (isZoomingAlone = event.shiftKey)

// The x range zoomed into, kept across new values and redraws; null when showing the whole run.
let zoom = getChartZoom(props.zoomKey)
let isUpdatingData = false

/**
 * Sets the zoom again after new values, unless they no longer reach it, as after a change of time course.
 */
function restoreZoom() {
  if (props.x.isPhase) return
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
  if (key !== 'x' || isUpdatingData || props.x.isPhase) return
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
 * Gives a series' line its look: its colour, or for a tracked run's line, its colour faded and dashed.
 *
 * @param {{slot: number, run: {dash: number[]}|null}} series
 * @param {string} theme
 * @returns {Object}
 */
const lineStyle = (series, theme) => ({
  label: series.label,
  show: !isLineHidden(series),
  stroke: series.run ? fadeColour(SERIES_COLOURS[theme][series.slot]) : SERIES_COLOURS[theme][series.slot],
  width: series.run ? 1.5 : 2,
  ...(series.run && { dash: series.run.dash }),
  points: { show: false },
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
  // The x-axis's unit on its last tick, in place of an axis title under the ticks.
  const xTicks = (chart, splits) => {
    const labels = formatTicks(chart, splits)
    if (xUnit() && labels.length) labels[labels.length - 1] += ` ${xUnit()}`
    return labels
  }
  if (props.x.isPhase) {
    // Each series against the x variable, its points joined in the run's order, as a phase plot needs.
    return {
      mode: 2,
      width,
      height: plotHeight(),
      scales: { x: { time: false }, y: {} },
      // uPlot marks each series' point that nearestPhasePoint finds, as its readout shows.
      cursor: { drag: { x: true, y: true }, points: { size: 8 }, dataIdx: nearestPhasePoint },
      hooks: { setCursor: [updateReadout] },
      legend: { show: false },
      padding: [8, padRight, 0, 0],
      axes: [{ ...axis(xTicks), size: 28 }, { ...axis(), size: sizeValueAxis }],
      series: [
        {},
        ...props.series.map((series) => ({
          ...lineStyle(series, theme),
          facets: [
            { scale: 'x', auto: true },
            { scale: 'y', auto: true },
          ],
          paths: joinInOrder,
        })),
      ],
    }
  }
  return {
    width,
    height: plotHeight(),
    // A chart with reference lines fits them in too.
    scales: { x: { time: false }, ...(props.references.length && { y: { range: rangeY } }) },
    // Synced charts plot different series, so hiding one mustn't hide its namesake by position elsewhere.
    // Synced charts zoom together; with shift held, a chart zooms alone.
    cursor: {
      y: false,
      points: { size: 8 },
      ...(props.syncKey && { sync: { key: props.syncKey, setSeries: false, filters: { pub: (type) => !(isZoomingAlone && ZOOM_EVENTS.has(type)) } } }),
    },
    hooks: { setScale: [recordZoom], setCursor: [updateReadout], drawClear: [drawSegments], draw: [drawReferences] },
    legend: { show: false },
    padding: [8, (chart) => alignGutter('right', padRight(chart)), 0, 0],
    axes: [{ ...axis(xTicks), size: 28 }, { ...axis(), size: (chart, values) => alignGutter('left', sizeValueAxis(chart, values)) }],
    series: [
      { label: props.x.label },
      ...props.series.map((series) => ({
        ...lineStyle(series, theme),
        // Runs with different output points, and every experiment of a protocol shown at once, share an x-axis on
        // which each has gaps at the others' points; its line carries on across them.
        spanGaps: true,
        // A value that changes at a point holds from the point before, so a step shows where its sub-experiment starts.
        ...(series.isStepped && { paths: STEPPED_PATHS }),
      })),
    ],
  }
}

const buildData = () =>
  props.x.isPhase
    ? [null, ...props.series.map((series) => [xValuesOf(series), series.values])]
    : [props.x.values, ...props.series.map((series) => series.values)]

/**
 * Draws a phase plot's series: its points joined in order, as the x values needn't increase. uPlot's own
 * line paths thin out points by assuming they do.
 *
 * @param {Object} chart - The uPlot chart.
 * @param {number} seriesIndex
 * @returns {{stroke: Path2D, fill: null, clip: null, band: null, gaps: null, flags: number}}
 */
function joinInOrder(chart, seriesIndex) {
  const [xs, ys] = chart.data[seriesIndex]
  const stroke = new Path2D()
  let isDrawing = false
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
      isDrawing = false
      continue
    }
    const left = chart.valToPos(xs[i], 'x', true)
    const top = chart.valToPos(ys[i], 'y', true)
    if (isDrawing) stroke.lineTo(left, top)
    else stroke.moveTo(left, top)
    isDrawing = true
  }
  return { stroke, fill: null, clip: null, band: null, gaps: null, flags: 0 }
}

/**
 * Forgets hidden series that no name on the chart can show again: those no longer plotted, every line when one is
 * left, and the lines once a steady state's list of values takes their names' place. A chart left with no lines, as
 * hiding every run gives, keeps them for when a run is shown again.
 */
function pruneHidden() {
  if (!hiddenKeys.value.size || !props.series.length) return
  const keys = new Set([...titleToggles.value, ...keyed.value, ...runKey.value].filter(Boolean).map(lineKeyOf))
  const hidden = new Set([...hiddenKeys.value].filter((key) => keys.has(key)))
  if (hidden.size !== hiddenKeys.value.size) hiddenKeys.value = hidden
}

/** Draws the chart afresh, as a change of series or theme needs. */
function draw() {
  pruneHidden()
  plot?.destroy()
  plot = null
  if (!chartEl.value) return
  isUpdatingData = true
  plot = new uPlot(buildOptions(chartEl.value.clientWidth || 300), buildData(), chartEl.value)
  // Caught on the way down, so it's known before the chart passes the event on.
  for (const type of ['mousedown', 'dblclick']) plot.root.addEventListener(type, noteZoomAlone, true)
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
    const height = plotHeight()
    if (plot && width > 0 && (width !== plot.width || height !== plot.height)) plot.setSize({ width, height })
  })
  if (chartEl.value) resizeObserver.observe(chartEl.value)
})

onBeforeUnmount(() => {
  if (alignmentKey.value) forgetChartGutters(alignmentKey.value, alignmentId)
  resizeObserver?.disconnect()
  plot?.destroy()
  plot = null
})

watch(
  () => [
    props.series.map((series) => `${series.key}:${series.slot}`).join('|'),
    props.references.map((item) => `${item.key}:${item.slot}:${item.from}:${item.to}:${item.value}:${item.points?.length}`).join('|'),
    isDarkMode.value,
    props.x.unit,
    props.x.label,
    props.x.isPhase,
    props.unit,
    props.syncKey,
  ],
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
// Another chart of the group widening a gutter moves this one's to match; one leaving the group forgets its own.
watch(
  () => (alignmentKey.value ? JSON.stringify(widestChartGutters(alignmentKey.value)) : ''),
  (widest) => {
    if (widest) plot?.redraw(false, true)
  }
)
watch(alignmentKey, (now, before) => {
  if (before && before !== now) forgetChartGutters(before, alignmentId)
})
watch(
  () => props.height,
  (height) => {
    if (!props.fill) plot?.setSize({ width: plot.width, height })
  }
)

/**
 * Gets the chart's name for an image of it, leaving out the variables hidden from its title.
 *
 * @param {Array<Object>} shown - The series drawn.
 * @returns {string}
 */
function shownTitle(shown) {
  if (titleNamesLines.value) return shown.length ? shown.map((series) => series.label).join(', ') : props.title
  if (!hasRuns.value || !titleToggles.value.some(Boolean)) return props.title
  const names = props.titleParts
    .map((part, index) => ({ part, toggle: titleToggles.value[index] }))
    .filter(({ toggle }) => !toggle || !isHidden(toggle))
    .map(({ part, toggle }) => toggle?.label ?? (part.component ? `${part.component}/${part.name}` : part.name))
  return names.length ? names.join(', ') : props.title
}

defineExpose({
  /**
   * Gets the chart as drawn, with the colours of its series, for an image of it.
   *
   * @returns {{title: string, canvas: HTMLCanvasElement, legend: Array<{label: string, colour: string, dash?: number[]|null,
   *   isDashed?: boolean, isPoint?: boolean}>}|null} A tracked run's line has its `dash`, a measurement's reference line
   *   `isDashed`, a recorded series' `isPoint`.
   */
  snapshot() {
    if (!plot) return null
    const colours = SERIES_COLOURS[isDarkMode.value ? 'dark' : 'light']
    // Hidden lines aren't drawn, so the image's title and legend leave them out too.
    const shown = readoutOrder.value.filter((series) => !isLineHidden(series))
    const name = shownTitle(shown)
    // The unit is in the heading, not on the canvas, so the image's title carries it.
    const title = `${name}${againstLabel.value ? ` vs ${againstLabel.value}${readoutNote.value}` : ''}${props.unit ? ` (${props.unit})` : ''}`
    const references = props.references.filter((item) => !isHidden(item))
    return {
      title,
      canvas: plot.ctx.canvas,
      legend: [
        ...shown.map((series) => ({ label: series.label, colour: colours[series.slot], dash: series.run?.dash ?? null })),
        ...references.map((item) => ({ label: item.label, colour: colours[item.slot], isDashed: item.role === 'obs' && !item.points, isPoint: !!item.points })),
      ],
    }
  },
})
// New values, as a slider moving gives, keep a zoomed chart on its x range, with the values refitted to it.
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

.plot-title-against {
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

.plot-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
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

/* A recorded series, a point as it's drawn. */
.plot-key-swatch.is-point {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.plot-area {
  position: relative;
}

.plot-chart {
  width: 100%;
  min-width: 0;
}

/* A filling chart's drawing takes the height its heading and keys leave, sized to it rather than sizing it. */
.simulation-plot.is-fill {
  flex: 1;
  min-height: 0;
}

.is-fill .plot-area {
  flex: 1;
  min-height: 120px;
}

.is-fill .plot-chart {
  position: absolute;
  inset: 0;
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
