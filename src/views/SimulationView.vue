<template>
  <div ref="pageEl" class="simulation-view" @keydown.f9.prevent="canPlay && play()">
    <!-- Named for screen readers and focused on arrival; the global nav shows which page this is. -->
    <h1 ref="titleEl" class="visually-hidden" tabindex="-1">Simulation</h1>
    <!-- An action bar, as the workspace's: run and what it runs, track and the protocol, then the exports. -->
    <header class="page-action-bar">
      <SimulationToolbar
        class="page-toolbar"
        :is-running="isRunning"
        :is-loading="isLoading"
        :blocked-reason="blockedReason"
        :is-outdated="isOutdated"
        :has-scope-switch="false"
        :has-float="false"
        :has-settings="false"
        @play="play"
        @stop="stop"
      >
        <template #end>
          <Divider layout="vertical" class="page-action-divider" />
          <!-- Wrapped, so the reason it is disabled shows. -->
          <span v-tooltip.bottom="exportHint" class="page-export">
            <SplitButton
              text
              size="small"
              severity="primary"
              :model="exportMenuItems"
              :disabled="!!currentExport.disabledReason"
              :button-props="{ 'data-testid': 'sim-export', 'aria-label': `Download ${currentExport.label}` }"
              :menu-button-props="{ 'aria-label': 'Choose what to download' }"
              @click="currentExport.action()"
            >
              <template #icon><ExportIcon /></template>
            </SplitButton>
          </span>
        </template>
      </SimulationToolbar>
    </header>
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
    <div class="page-results-bar">
      <SimulationStatusLine :status="statusLine" class="page-status" />
      <ProtocolResultsControls />
    </div>

    <div class="page-body">
      <!-- Beside the charts, or over them when the window is too narrow for both. -->
      <ResizableLibraryPanel
        v-model:collapsed="isControlsCollapsed"
        title="Controls"
        subject="controls"
        class="page-controls-panel"
        :overlay="isNarrow"
        :initial-width="360"
        :min-width="280"
        :max-width="640"
      >
        <div class="page-controls">
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
        </div>
      </ResizableLibraryPanel>
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
 * The simulation page: the workspace's results across the page, with an action bar to run them, track the run, edit
 * the protocol and download the values as CSV, the charts as one PNG or the run as SED-ML, the charts with their
 * cursors in step, then a protocol run's prediction plots, and beside them what gets plotted and tried out.
 */
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'

import Divider from 'primevue/divider'
import ProgressBar from 'primevue/progressbar'
import SplitButton from 'primevue/splitbutton'

import ResizableLibraryPanel from '../components/ResizableLibraryPanel.vue'
import ExportIcon from '../components/icons/ExportIcon.vue'
import FeaturePlot from '../components/simulation/FeaturePlot.vue'
import ProtocolResultsControls from '../components/simulation/ProtocolResultsControls.vue'
import SimulationControls from '../components/simulation/SimulationControls.vue'
import SimulationPlot from '../components/simulation/SimulationPlot.vue'
import SimulationStatusLine from '../components/simulation/SimulationStatusLine.vue'
import SimulationToolbar from '../components/simulation/SimulationToolbar.vue'
import { useSedmlExport } from '../composables/useSedmlExport'
import { useSimulationCharts } from '../composables/useSimulationCharts'
import { useSimulationRunner } from '../composables/useSimulationRunner'
import { useSliderReruns } from '../composables/useSliderReruns'
import { buildResultsCsv, collectResultColumns, composeChartsImage } from '../services/simulation/resultsExport'
import { legacyDownload } from '../utils/save'

const FILE_NAME = 'simulation-results'
// A chart's title and legend, above and below its plotting area.
const CHART_CHROME_PX = 64
// The space between the charts, and the prediction plots' heading with its rule, as the styles set them.
const CHART_GAP_PX = 16
const PREDICTION_HEADING_PX = 34
const MIN_CHART_HEIGHT = 240

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

const emptyTitle = computed(() => (store.results ? 'Nothing plotted yet' : 'No results yet'))
const emptyHint = computed(() => {
  if (!store.results) return 'Press play to simulate the whole model or the selected instances; their plots appear here.'
  if (isSteadyState.value) return 'Add variables to a plot, in the controls beside, to see their values here.'
  return 'Add variables to a plot, in the controls beside, to see them here.'
})

const controlsView = ref('plots')
const targetPlotId = ref(null)
const isControlsCollapsed = ref(false)
// Too narrow for the controls beside the charts: they float over them instead.
const NARROW_QUERY = '(max-width: 820px)'
const narrowMedia = window.matchMedia?.(NARROW_QUERY)
const isNarrow = ref(narrowMedia?.matches ?? false)
/** @param {MediaQueryListEvent} event */
const onNarrowChange = (event) => (isNarrow.value = event.matches)
narrowMedia?.addEventListener?.('change', onNarrowChange)
onBeforeUnmount(() => narrowMedia?.removeEventListener?.('change', onNarrowChange))

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

// The downloads, the export button running the one picked last, as the workspace's Export does.
const exportOptions = computed(() => [
  {
    key: 'csv',
    label: 'CSV',
    icon: 'pi pi-table',
    hint: 'Download the plotted values as CSV',
    disabledReason: hasCharts.value ? null : 'Plot a variable to download its values',
    action: downloadCsv,
  },
  {
    key: 'png',
    label: 'PNG',
    icon: 'pi pi-image',
    hint: 'Download the charts as one PNG image',
    disabledReason: xAxis.value.isSteadyState ? 'A steady state has no time-course charts' : hasFigures.value ? null : 'Plot a variable to download its chart',
    action: downloadPng,
  },
  {
    key: 'sedml',
    label: 'SED-ML',
    icon: 'pi pi-file-export',
    hint: sedmlHint.value,
    disabledReason: isExportingSedml.value ? 'Exporting…' : canExportSedml.value ? null : (sedmlReason.value ?? 'Not available yet'),
    action: exportSedml,
  },
])
const currentExportKey = ref('csv')
const currentExport = computed(() => exportOptions.value.find(({ key }) => key === currentExportKey.value))
const exportHint = computed(() => currentExport.value.disabledReason ?? `${currentExport.value.hint}. Other formats in the menu`)
const exportMenuItems = computed(() =>
  exportOptions.value.map((option) => ({
    label: option.label,
    icon: option.icon,
    disabled: !!option.disabledReason,
    command: () => {
      currentExportKey.value = option.key
      option.action()
    },
  }))
)

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

/* As the workspace's action bar. */
.page-action-bar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: var(--view-header-height, 46px);
  box-sizing: border-box;
  padding: 0 var(--view-header-padding-x, 1rem);
  border-bottom: 1px solid var(--p-content-border-color);
  background-color: var(--p-content-background);
}

:global(.p-dark) .page-action-bar {
  background-color: var(--p-surface-900);
  border-bottom-color: var(--p-surface-800);
}

.page-toolbar {
  flex: 1;
  min-width: 0;
}

.page-action-divider {
  margin: 0 8px;
  align-self: stretch;
}

.page-export {
  display: inline-flex;
  flex-shrink: 0;
}

.page-progress-slot {
  height: 3px;
  flex-shrink: 0;
}

.page-progress {
  height: 3px;
}

.page-results-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 4px var(--view-header-padding-x, 1rem) 8px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.page-status {
  flex: 1;
  min-width: 14rem;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.visually-hidden:focus {
  outline: none;
}

.page-body {
  position: relative;
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

/* The panel's aside pads and frames it; the controls scroll inside. */
.page-controls {
  height: 100%;
  overflow-y: auto;
}
</style>
