<template>
  <section ref="panelEl" class="simulation-panel" @keydown.f9.prevent="canPlay && play()">
    <header class="panel-head">
      <SimulationToolbar
        v-model:scope-mode="scopeMode"
        :part-name="instanceId ? 'this instance' : 'the selection'"
        :part-label="instanceId ? 'This instance' : null"
        :is-running="isRunning"
        :is-loading="libopencor.status === 'loading'"
        :blocked-reason="blockedReason"
        :selected-count="selectedNodeIds.length"
        :is-outdated="isOutdated"
        :can-expand="charts.length > 0 || predictionPlotCharts.length > 0"
        @play="play"
        @stop="stop"
        @expand="isResultsDialogOpen = true"
      />
      <!-- Always there, so the bar showing and hiding never moves what is below it. -->
      <div class="panel-progress-slot">
        <ProgressBar
          v-if="isRunning"
          :mode="store.progress > 0 ? 'determinate' : 'indeterminate'"
          :value="Math.round(store.progress * 100)"
          :show-value="false"
          class="panel-progress"
          aria-label="Simulation progress"
        />
      </div>
      <SimulationStatusLine :status="statusLine" />
      <!-- A row of its own, as the sidebar is too narrow to fit them in the toolbar. -->
      <ProtocolResultsControls />
    </header>

    <!-- Plots and controls each scroll on their own, so a slider and the plot it moves stay in view. -->
    <Splitter layout="vertical" class="panel-split" @resizeend="saveSizes">
      <SplitterPanel ref="figuresPanel" :size="sizes[0]" :min-size="20" class="panel-region panel-figures">
        <template v-if="charts.length || predictionPlotCharts.length">
          <SimulationPlot
            v-for="chart in charts"
            :key="chart.key"
            :zoom-key="`panel:${chart.key}`"
            :title="chart.title"
            :title-parts="chart.titleParts"
            :unit="chart.unit"
            :x="xAxis"
            :series="chart.series"
            :references="chart.references"
            :height="chartHeight"
            sync-key="simulation-panel"
          />
          <section v-if="predictionPlotCharts.length" class="panel-prediction-plots" aria-labelledby="panel-prediction-plots-title">
            <h3 id="panel-prediction-plots-title" class="panel-prediction-plots-title">Prediction plots</h3>
            <FeaturePlot
              v-for="chart in predictionPlotCharts"
              :key="chart.key"
              :title="chart.title"
              :unit="chart.unit"
              :x="chart.x"
              :y-label="chart.yLabel"
              :series="chart.series"
              :height="chartHeight"
            />
          </section>
        </template>
        <p v-else class="panel-empty">{{ figuresHint }}</p>
      </SplitterPanel>
      <SplitterPanel :size="sizes[1]" :min-size="20" class="panel-region">
        <SimulationControls
          v-model:view="controlsView"
          v-model:target-plot-id="targetPlotId"
          :nodes="nodes"
          :scope-node-ids="hasScope ? store.scopeNodeIds : null"
          :keep-current="keepCurrent"
          @change="rerunForSliders"
        />
      </SplitterPanel>
    </Splitter>

    <SimulationResultsDialog
      v-if="hasScope"
      v-model:visible="isResultsDialogOpen"
      :summary="resultsSummary"
      :x="xAxis"
      :charts="charts"
      :prediction-plot-charts="predictionPlotCharts"
      :nodes="nodes"
      :scope-node-ids="store.scopeNodeIds"
      :keep-current="keepCurrent"
      @change="rerunForSliders"
      @play="canPlay && play()"
    />
  </section>
</template>

<script setup>
/**
 * The context sidebar's Simulation tab: runs scoped simulations and plots the chosen variables of one of
 * the simulated instances.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import ProgressBar from 'primevue/progressbar'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import Select from 'primevue/select'

import FeaturePlot from './FeaturePlot.vue'
import ProtocolResultsControls from './ProtocolResultsControls.vue'
import SimulationControls from './SimulationControls.vue'
import SimulationPlot from './SimulationPlot.vue'
import SimulationResultsDialog from './SimulationResultsDialog.vue'
import SimulationStatusLine from './SimulationStatusLine.vue'
import SimulationToolbar from './SimulationToolbar.vue'
import { useSimulation } from '../../composables/useSimulation'
import { useSimulationCharts } from '../../composables/useSimulationCharts'
import { useSelectionAutoRun } from '../../composables/useSelectionAutoRun'
import { useSliderReruns } from '../../composables/useSliderReruns'
import { libopencor } from '../../services/simulation/libopencorLoader'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'
import { FLOW_IDS } from '../../utils/constants'

const props = defineProps({
  // In the instance editor: play runs this instance on its own, or the whole model.
  instanceId: { type: String, default: null },
})

const { nodes, getSelectedNodes } = useVueFlow(FLOW_IDS.MAIN)
const store = useSimulationResultsStore()
const simulationSettingsStore = useSimulationSettingsStore()
const { run, stop, keepCurrent, isStale } = useSimulation()

const isRunning = computed(() => store.status === 'running')
// A run has been asked for, so its scope's instances, plotted variables and sliders can be shown.
const hasScope = computed(() => store.status !== 'idle')
const isSimulatorMissing = computed(() => ['unavailable', 'error'].includes(libopencor.status))
const canRun = computed(() => !isRunning.value && !isSimulatorMissing.value)
const selectedNodeIds = computed(() => getSelectedNodes.value.map((node) => node.id))

const scopeNodes = computed(() =>
  store.scopeNodeIds ? nodes.value.filter((node) => store.scopeNodeIds.includes(node.id)) : nodes.value
)
const scopeSummary = computed(() => {
  const experiments = store.protocolResults?.experiments.length
  const ran = experiments ? `Ran ${experiments} protocol ${experiments === 1 ? 'experiment' : 'experiments'} on` : 'Simulated'
  if (!store.scopeNodeIds) return `${ran} the whole model`
  const count = store.scopeNodeIds.length
  return `${ran} ${count} ${count === 1 ? 'instance' : 'instances'} on their own`
})
const stoppedAt = computed(() => {
  const voi = store.results?.voi
  return voi?.values.length ? `${voi.values.at(-1).toPrecision(4)} ${voi.unit}` : 'the start'
})

// A solve that starts before the plots do, to let the model settle, says so.
const settleNote = computed(() => {
  const { initialPoint, startingPoint } = simulationSettingsStore.simulationSettings
  return initialPoint < startingPoint ? ` from ${initialPoint} s, plotted from ${startingPoint} s` : ''
})
const resultsSummary = computed(() => {
  if (store.status === 'stopped') return `${scopeSummary.value}${settleNote.value}, stopped at ${stoppedAt.value}.`
  if (store.status === 'error') return `${scopeSummary.value}${settleNote.value}, up to ${stoppedAt.value} before the solver failed.`
  return `${scopeSummary.value}${settleNote.value}.`
})
const isResultsDialogOpen = ref(false)

// Plots above the controls at any width; a wider tab gives taller plots.
const SIZES_KEY = 'phlynx.simulation.splitSizes'
const panelEl = ref(null)
const panelWidth = ref(0)
const figuresPanel = ref(null)
const figuresHeight = ref(0)
const controlsView = ref('plots')
const targetPlotId = ref(null)
const sizes = ref(readSizes())
let resizeObserver = null
let figuresObserver = null

// About two fifths of the tab's width, within what keeps a plot readable, and no taller than the plots'
// pane less a chart's title and legend, so one chart is seen whole.
const CHART_CHROME_PX = 30
const chartHeight = computed(() => {
  const byWidth = Math.min(460, Math.max(200, panelWidth.value * 0.42))
  const byPane = figuresHeight.value ? figuresHeight.value - CHART_CHROME_PX : byWidth
  return Math.round(Math.max(160, Math.min(byWidth, byPane)))
})

/**
 * Reads the split sizes this viewer chose last, as percentages.
 *
 * @returns {number[]}
 */
function readSizes() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZES_KEY) ?? 'null')
    // Earlier versions saved a size per layout; only the plots-above-controls one remains.
    const pair = Array.isArray(saved) ? saved : saved?.rows
    if (Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite)) return pair
  } catch {
    // Without storage, the split starts as it does the first time.
  }
  return [55, 45]
}

/**
 * Keeps the split sizes the viewer dragged to.
 *
 * @param {{sizes: number[]}} event
 */
function saveSizes({ sizes: next }) {
  sizes.value = next
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify(next))
  } catch {
    // Without storage, the sizes last for the session.
  }
}

onMounted(() => {
  panelWidth.value = panelEl.value.clientWidth
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0) panelWidth.value = entry.contentRect.width
  })
  resizeObserver.observe(panelEl.value)
  const figuresEl = figuresPanel.value?.$el
  if (figuresEl) {
    figuresObserver = new ResizeObserver(([entry]) => (figuresHeight.value = entry.contentRect.height))
    figuresObserver.observe(figuresEl)
  }
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  figuresObserver?.disconnect()
})

const figuresHint = computed(() => {
  if (!store.results) return 'Plots appear here after a run.'
  return 'Add variables to a plot to see them here.'
})

// Whether play runs the part (the selection, or the edited instance) or the whole model. The sidebar's
// choice lasts for the session; the instance editor's starts on the instance each time.
const editorScopeMode = ref('selection')
const scopeMode = computed({
  get: () => (props.instanceId ? editorScopeMode.value : store.scopeMode),
  set: (mode) => {
    if (mode === scopeMode.value) return
    if (props.instanceId) editorScopeMode.value = mode
    else store.scopeMode = mode
    // Flipping the switch runs at once, as the user asked for that scope. Only the flip: picking instances
    // on the canvas never runs, so highlighting a model doesn't flatten it over and over.
    // A run going is stopped for the new scope's.
    if (!blockedReason.value && libopencor.status !== 'loading') play()
  },
})

// The canvas selection, sorted, as play runs it in Selection mode.
const sortedSelectedIds = computed(() => [...selectedNodeIds.value].sort())
// Why play can't run, if it can't.
const blockedReason = computed(() => {
  if (isSimulatorMissing.value) return libopencor.reason ?? 'The simulator isn’t available.'
  if (!nodes.value.length) return 'Add instances to simulate'
  if (!props.instanceId && scopeMode.value === 'selection' && !selectedNodeIds.value.length) return 'Select instances on the canvas'
  return null
})
const canPlay = computed(() => !isRunning.value && !blockedReason.value && libopencor.status !== 'loading')
// In Selection mode, the results show a selection other than the one on the canvas now.
const isSelectionChanged = computed(
  () =>
    !props.instanceId &&
    scopeMode.value === 'selection' &&
    !!store.results &&
    sortedSelectedIds.value.length > 0 &&
    JSON.stringify(sortedSelectedIds.value) !== JSON.stringify(store.scopeNodeIds ? [...store.scopeNodeIds].sort() : null)
)
// In the instance editor, results of another run than this instance on its own, or the whole model.
const isOtherRun = computed(() => {
  if (!props.instanceId || !store.results) return false
  const expected = scopeMode.value === 'model' ? null : [props.instanceId]
  return JSON.stringify(store.scopeNodeIds) !== JSON.stringify(expected)
})
const isOutdated = computed(() => !!store.results && (isStale.value || isSelectionChanged.value || isOtherRun.value))

/** Simulates the whole model or the canvas selection, as the switch says. */
function play() {
  if (scopeMode.value === 'model') run(null)
  else run(props.instanceId ? [props.instanceId] : sortedSelectedIds.value)
}

// What the status line says: the most pressing thing first, with the full lists a click away.
const statusLine = computed(() => {
  const warnings = store.report.warnings.length ? [{ title: 'Warnings', lines: store.report.warnings }] : []
  if (isSimulatorMissing.value) return { severity: 'error', icon: 'pi-exclamation-circle', text: libopencor.reason ?? 'The simulator isn’t available.', details: [] }
  if (store.status === 'blocked') {
    const count = store.report.errors.length
    return { severity: 'error', icon: 'pi-exclamation-circle', text: `Can’t simulate yet: ${count} ${count === 1 ? 'problem' : 'problems'}`, details: [{ title: 'Problems', lines: store.report.errors }] }
  }
  if (store.status === 'error') {
    const issues = (store.error?.issues ?? []).map((issue) => issue.description)
    return {
      severity: 'error',
      icon: 'pi-exclamation-circle',
      text: store.results ? `${store.error?.message} ${resultsSummary.value}` : store.error?.message ?? 'The simulation failed.',
      details: [...(issues.length ? [{ title: 'Solver messages', lines: issues }] : []), ...warnings],
    }
  }
  // The progress bar shows how far; announcing each percent would flood a screen reader.
  if (isRunning.value) return { severity: 'info', icon: null, text: 'Running…', details: warnings }
  if (libopencor.status === 'loading') return { severity: 'info', icon: 'pi-spin pi-spinner', text: 'Loading the simulator…', details: [] }
  if (isStale.value && store.results) return { severity: 'warn', icon: 'pi-refresh', text: 'The model or settings changed · press play to update', details: warnings }
  if (isSelectionChanged.value) return { severity: 'warn', icon: 'pi-refresh', text: 'The selection changed · press play to update', details: warnings }
  if (isOtherRun.value) return { severity: 'warn', icon: 'pi-refresh', text: 'These results are from another run · press play to update', details: warnings }
  if (store.results) {
    const count = store.report.warnings.length
    const text = count ? `${resultsSummary.value} ${count} ${count === 1 ? 'warning' : 'warnings'}.` : resultsSummary.value
    return { severity: count ? 'warn' : 'info', icon: count ? 'pi-exclamation-triangle' : null, text, details: warnings }
  }
  return { severity: 'info', icon: null, text: 'Press play to simulate the whole model or the selected instances.', details: [] }
})

// The sidebar runs the canvas selection once it is chosen (the instance editor runs its own instance).
if (!props.instanceId) useSelectionAutoRun()

// Slider moves rerun the scope through one shared, lossy queue (see useSliderReruns).
const { rerunForSliders } = useSliderReruns()

const { xAxis, charts, predictionPlotCharts } = useSimulationCharts(scopeNodes)
</script>

<style scoped>
.simulation-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  min-height: 0;
}

.panel-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  /* Room for the play button's shadow, hover growth and out-of-date dot, which the sidebar would crop. */
  padding: 4px 4px 0;
}

.panel-progress-slot {
  height: 3px;
}

.panel-progress {
  height: 3px;
}

.panel-split {
  flex: 1;
  min-height: 0;
  border: none;
  background: transparent;
}

.panel-region {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* A little room on the left too, for slider handles and focus rings the sidebar would crop. */
  padding: 8px 4px 8px 4px;
}

.panel-prediction-plots {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* After the traces, a group of its own. */
.panel-prediction-plots-title {
  margin: 4px 0 0;
  padding-top: 8px;
  border-top: 1px solid var(--p-content-border-color);
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.panel-empty {
  margin: auto 0;
  font-size: 0.8125rem;
  text-align: center;
  color: var(--p-text-muted-color);
}
</style>
