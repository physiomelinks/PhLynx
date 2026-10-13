<template>
  <div ref="pageEl" class="simulation-view" @keydown.f9.prevent="canPlay && play()">
    <header class="page-head">
      <div class="page-head-row">
        <Button
          icon="pi pi-arrow-left"
          label="Workspace"
          text
          size="small"
          severity="secondary"
          class="page-back"
          aria-label="Back to the workspace"
          v-tooltip.bottom="'Back to the workspace'"
          @click="goToWorkspace"
        />
        <!-- Focused on arrival, so keyboard and screen-reader users start on the page. -->
        <h1 ref="titleEl" class="page-title" tabindex="-1">Simulation</h1>
        <SimulationToolbar
          class="page-toolbar"
          :is-running="isRunning"
          :is-loading="isLoading"
          :blocked-reason="blockedReason"
          :is-outdated="isOutdated"
          :has-scope-switch="false"
          :has-float="false"
          @play="play"
          @stop="stop"
        />
      </div>
      <!-- Always there, so the bar showing and hiding never moves what is below it. -->
      <div class="page-progress-slot">
        <ProgressBar
          v-if="isRunning"
          :mode="store.progress > 0 ? 'determinate' : 'indeterminate'"
          :value="Math.round(store.progress * 100)"
          :show-value="false"
          class="page-progress"
          aria-label="Simulation progress"
        />
      </div>
      <div class="page-head-row page-results-bar">
        <SimulationStatusLine :status="statusLine" class="page-status" />
        <!-- As the toolbar's protocol and sweep buttons do, switching runs at once. -->
        <SelectButton
          v-if="runModes.length > 1"
          :model-value="runMode"
          :options="runModes"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          aria-label="What play runs"
          @update:model-value="switchRunMode"
        />
        <ProtocolResultsControls />
        <div class="page-exports" role="group" aria-label="Downloads">
          <Button
            label="CSV"
            icon="pi pi-download"
            size="small"
            outlined
            :disabled="!hasCharts"
            aria-label="Download the results as CSV"
            @click="downloadCsv"
          />
          <Button
            v-if="!xAxis.isSteadyState"
            label="PNG"
            icon="pi pi-image"
            size="small"
            outlined
            :disabled="!hasFigures"
            aria-label="Download the charts as a PNG image"
            @click="downloadPng"
          />
          <!-- Wrapped, so its reason shows while it's disabled. -->
          <span v-tooltip.bottom="sedmlReason ?? sedmlHint" class="export-button">
            <Button
              label="SED-ML"
              icon="pi pi-download"
              size="small"
              outlined
              :disabled="!canExportSedml"
              :loading="isExportingSedml"
              :aria-label="isSedmlProtocol ? 'Download the protocol\'s run as SED-ML' : 'Download the run as SED-ML'"
              @click="exportSedml"
            />
          </span>
        </div>
      </div>
    </header>

    <div class="page-body">
      <aside
        class="page-controls"
        :class="{ 'page-controls--collapsed': isControlsCollapsed }"
        :style="{ width: isControlsCollapsed ? '0px' : `${controlsWidth}px` }"
      >
        <SimulationControls
          v-if="!isControlsCollapsed"
          has-settings
          v-model:view="controlsView"
          v-model:target-plot-id="targetPlotId"
          :nodes="nodes"
          :scope-node-ids="hasScope ? store.scopeNodeIds : null"
          :keep-current="keepCurrent"
          @change="rerunForSliders"
        />
      </aside>
      <div
        class="resize-handle"
        :class="{ 'resize-handle--disabled': isControlsCollapsed }"
        @mousedown="onHandleMousedown"
      >
        <button
          type="button"
          class="aside-collapse-toggle"
          :aria-label="isControlsCollapsed ? 'Show what gets plotted and tried out' : 'Hide what gets plotted and tried out'"
          :aria-expanded="!isControlsCollapsed"
          v-tooltip.right="isControlsCollapsed ? 'Show the controls' : 'Hide the controls'"
          @mousedown.stop
          @click="isControlsCollapsed = !isControlsCollapsed"
        >
          <i :class="isControlsCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-left'" aria-hidden="true"></i>
        </button>
      </div>
      <main class="page-main" aria-label="Simulation results">
        <div ref="chartsEl" class="page-charts">
          <template v-if="hasFigures">
            <SimulationPlot
              v-for="chart in charts"
              :key="chart.key"
              :zoom-key="`page:${chart.key}`"
              :ref="(plot) => setPlot(chart.key, plot)"
              :title="chart.title"
              :title-parts="chart.titleParts"
              :unit="chart.unit"
              :x="chart.x ?? xAxis"
              :note="chart.note"
              :series="chart.series"
              :references="chart.references"
              :height="chartHeight"
              :sync-key="chart.x ? null : 'simulation-page'"
            />
            <section v-if="predictionPlotCharts.length" class="page-prediction-plots" aria-labelledby="page-prediction-plots-title">
              <h2 id="page-prediction-plots-title" class="page-prediction-plots-title">Prediction plots</h2>
              <FeaturePlot
                v-for="chart in predictionPlotCharts"
                :key="chart.key"
                :ref="(plot) => setPlot(chart.key, plot)"
                :title="chart.title"
                :unit="chart.unit"
                :x="chart.x"
                :y-label="chart.yLabel"
                :series="chart.series"
                :height="chartHeight"
              />
            </section>
          </template>
          <div v-else class="page-empty">
            <i class="pi pi-chart-line page-empty-icon" aria-hidden="true"></i>
            <p class="page-empty-title">{{ emptyTitle }}</p>
            <p class="page-empty-text">{{ emptyHint }}</p>
          </div>
        </div>
        <!-- Below the charts' pane rather than in it, so the charts can fill the pane. -->
        <p v-if="hasFigures" class="page-hint">Drag across a chart to zoom in; double-click it to zoom out.</p>
      </main>

    </div>
  </div>
</template>

<script>
export default {
  name: 'SimulationView',
}
</script>

<script setup>
/**
 * The simulation page: the workspace's results across the page, with the toolbar to run them, the charts with their
 * cursors in step, then a protocol run's prediction plots, downloads of the values as CSV, the charts as one PNG and
 * the run as SED-ML, and beside them what gets plotted and tried out.
 */
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import SelectButton from 'primevue/selectbutton'

import FeaturePlot from '../components/simulation/FeaturePlot.vue'
import ProtocolResultsControls from '../components/simulation/ProtocolResultsControls.vue'
import SimulationControls from '../components/simulation/SimulationControls.vue'
import SimulationPlot from '../components/simulation/SimulationPlot.vue'
import SimulationStatusLine from '../components/simulation/SimulationStatusLine.vue'
import SimulationToolbar from '../components/simulation/SimulationToolbar.vue'
import { useSedmlExport } from '../composables/useSedmlExport'
import { useResizableAside } from '../composables/useResizableAside'
import { useSimulationCharts } from '../composables/useSimulationCharts'
import { useSimulationRunner } from '../composables/useSimulationRunner'
import { useSliderReruns } from '../composables/useSliderReruns'
import { buildResultsCsv, collectResultColumns, composeChartsImage } from '../services/simulation/resultsExport'
import { useProtocolStore } from '../stores/protocolStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { legacyDownload } from '../utils/save'

const FILE_NAME = 'simulation-results'
// A chart's title and legend, above and below its plotting area.
const CHART_CHROME_PX = 64
// The space between the charts, and the prediction plots' heading with its rule, as the styles set them.
const CHART_GAP_PX = 16
const PREDICTION_HEADING_PX = 34
const MIN_CHART_HEIGHT = 240

const router = useRouter()
const {
  nodes,
  store,
  scopeNodes,
  isRunning,
  isLoading,
  hasScope,
  isSteadyState,
  blockedReason,
  canPlay,
  isOutdated,
  statusLine,
  play,
  stop,
  keepCurrent,
} = useSimulationRunner({ isWholeModelOnly: true })
const protocolStore = useProtocolStore()
const settingsStore = useSimulationSettingsStore()
// Disabled, with why, while PhLynx can't plan the run.
const { isProtocol: isSedmlProtocol, reason: sedmlReason, canExport: canExportSedml, isExporting: isExportingSedml, exportZip: exportSedml } = useSedmlExport()
const sedmlHint = computed(() =>
  isSedmlProtocol.value ? 'Download the protocol’s run as SED-ML, with the model it runs' : 'Download the run as SED-ML, with the model it runs and its plots'
)
// Slider moves rerun the scope through one shared, lossy queue (see useSliderReruns).
const { rerunForSliders } = useSliderReruns()
const { xAxis, charts, predictionPlotCharts } = useSimulationCharts(scopeNodes)

const hasCharts = computed(() => charts.value.length > 0)
const hasFigures = computed(() => hasCharts.value || predictionPlotCharts.value.length > 0)

const titleEl = ref(null)
onActivated(() => titleEl.value?.focus())

/** Returns to the workspace, as the page left it. */
function goToWorkspace() {
  router.push({ name: 'workspace' })
}

// What play can run: the time course, and the protocol or the sweep when the workspace has one.
const runModes = computed(() => [
  { label: 'Time course', value: 'run' },
  ...(protocolStore.hasProtocol || protocolStore.source?.parseError ? [{ label: 'Protocol', value: 'protocol' }] : []),
  ...(settingsStore.simulationSettings.sweep ? [{ label: 'Sweep', value: 'sweep' }] : []),
])
const runMode = computed(() => (protocolStore.isProtocolMode ? 'protocol' : store.isSweepMode ? 'sweep' : 'run'))

/**
 * Switches what play runs, one mode at a time, and runs it.
 *
 * @param {'run'|'protocol'|'sweep'} mode
 */
function switchRunMode(mode) {
  protocolStore.isProtocolMode = mode === 'protocol'
  store.isSweepMode = mode === 'sweep'
  if (canPlay.value) play()
}

const emptyTitle = computed(() => (store.results ? 'Nothing plotted yet' : 'No results yet'))
const emptyHint = computed(() => {
  if (!store.results) return 'Press play to simulate the whole model or the selected instances; their plots appear here.'
  if (isSteadyState.value) return 'Add variables to a plot, in the controls beside, to see their values here.'
  return 'Add variables to a plot, in the controls beside, to see them here.'
})

const controlsView = ref('plots')
const targetPlotId = ref(null)
const isControlsCollapsed = ref(false)
const { width: controlsWidth, startResize } = useResizableAside(360, 280, 640, 'left')
// As the page's styles stack the controls under the charts.
const NARROW_QUERY = '(max-width: 820px)'

/**
 * Starts resizing the controls from their handle, while they are shown beside the charts.
 *
 * @param {MouseEvent} event
 */
function onHandleMousedown(event) {
  if (isControlsCollapsed.value || window.matchMedia?.(NARROW_QUERY).matches) return
  startResize(event)
}

const pageEl = ref(null)
const chartsEl = ref(null)
const chartsHeight = ref(0)
let chartsObserver = null

// One chart fills the charts' pane; two share it; more take half of it each, the pane scrolling.
const chartHeight = computed(() => {
  if (!chartsHeight.value) return 320
  const count = Math.min(2, Math.max(1, charts.value.length + predictionPlotCharts.value.length))
  const predictionCount = Math.min(count, predictionPlotCharts.value.length)
  // What else the shown charts share the pane with: the gaps between them and before the prediction plots.
  const spacing = (count - 1) * CHART_GAP_PX + (predictionCount ? PREDICTION_HEADING_PX + CHART_GAP_PX : 0)
  return Math.round(Math.max(MIN_CHART_HEIGHT, (chartsHeight.value - spacing) / count - CHART_CHROME_PX))
})

onMounted(() => {
  chartsObserver = new ResizeObserver(([entry]) => {
    if (entry.contentRect.height > 0) chartsHeight.value = entry.contentRect.height
  })
  chartsObserver.observe(chartsEl.value)
})
onBeforeUnmount(() => chartsObserver?.disconnect())

// The mounted charts, by chart key.
const plots = new Map()

/**
 * Keeps a chart's component, or forgets it once unmounted.
 *
 * @param {string} key
 * @param {Object|null} plot
 */
function setPlot(key, plot) {
  if (plot) plots.set(key, plot)
  else plots.delete(key)
}

const columns = computed(() => collectResultColumns(xAxis.value, charts.value))

/** Downloads every plotted series as CSV, at full precision. */
function downloadCsv() {
  legacyDownload(`${FILE_NAME}.csv`, new Blob([buildResultsCsv(columns.value)], { type: 'text/csv' }))
}

/** Downloads the charts, as shown, as one PNG on the page's background, the prediction plots after them. */
function downloadPng() {
  const snapshots = [...charts.value, ...predictionPlotCharts.value].map((chart) => plots.get(chart.key)?.snapshot()).filter(Boolean)
  if (!snapshots.length) return
  const style = getComputedStyle(pageEl.value)
  const image = composeChartsImage(snapshots, { background: style.backgroundColor, text: style.color })
  image.toBlob((blob) => blob && legacyDownload(`${FILE_NAME}.png`, blob), 'image/png')
}
</script>

<style scoped>
.simulation-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--p-content-background);
  color: var(--p-text-color);
}

.page-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  padding: 8px 16px 8px 8px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.page-head-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.page-back {
  flex-shrink: 0;
}

.page-title {
  flex-shrink: 0;
  margin: 0;
  padding-right: 12px;
  border-right: 1px solid var(--p-content-border-color);
  font-size: 1rem;
  font-weight: 600;
}

.page-title:focus {
  outline: none;
}

.page-toolbar {
  flex: 1;
}

.page-progress-slot {
  height: 3px;
}

.page-progress {
  height: 3px;
}

.page-results-bar {
  flex-wrap: wrap;
  padding-left: 8px;
}

.page-status {
  flex: 1;
  min-width: 14rem;
}

.page-exports {
  display: flex;
  align-items: center;
  gap: 8px;
}

.export-button {
  display: inline-flex;
}

.page-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.page-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.page-charts {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  box-sizing: border-box;
  background: var(--p-content-background);
}

.page-prediction-plots {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* After the traces, a group of its own. */
.page-prediction-plots-title {
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid var(--p-content-border-color);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.page-hint {
  flex-shrink: 0;
  margin: 0;
  padding: 4px 20px 8px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.page-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: auto;
  max-width: 26rem;
  text-align: center;
  color: var(--p-text-muted-color);
}

.page-empty-icon {
  font-size: 2.5rem;
  color: var(--p-content-border-color);
}

.page-empty-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.page-empty-text {
  margin: 0;
  font-size: 0.875rem;
}

/* As the workspace's context sidebar is resized and hidden. */
.resize-handle {
  position: relative;
  width: 6px;
  flex-shrink: 0;
  cursor: col-resize;
  background-color: var(--p-content-border-color);
  transition: background-color 120ms ease;
}

.resize-handle:hover {
  background-color: var(--p-primary-color);
}

.resize-handle--disabled {
  cursor: default;
}

.aside-collapse-toggle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--p-content-border-color);
  border-radius: 50%;
  background: var(--p-content-background);
  color: var(--p-text-muted-color);
  font-size: 10px;
  cursor: pointer;
  z-index: 2;
  transition: color 120ms ease, border-color 120ms ease;
}

.aside-collapse-toggle:hover {
  color: var(--p-primary-color);
  border-color: var(--p-primary-color);
}

.page-controls {
  flex-shrink: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  box-sizing: border-box;
  background: var(--p-content-background);
  transition: width 160ms ease, padding 160ms ease;
}

.page-controls--collapsed {
  padding: 0;
  overflow: hidden;
}

/* Too narrow for both side by side: the controls go above the charts. */
@media (max-width: 820px) {
  .page-body {
    flex-direction: column;
  }

  /* A bar below the controls, still with its button to show or hide them, but not dragged. */
  .resize-handle {
    width: auto;
    height: 6px;
    cursor: default;
  }

  .resize-handle:hover {
    background-color: var(--p-content-border-color);
  }

  .aside-collapse-toggle i {
    transform: rotate(90deg);
  }

  .page-controls {
    width: auto !important;
    max-height: 45%;
    border-bottom: 1px solid var(--p-content-border-color);
  }
}
</style>
