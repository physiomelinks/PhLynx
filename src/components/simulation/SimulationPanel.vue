<template>
  <section ref="panelEl" class="simulation-panel" @keydown.f9.prevent="canPlay && play()">
    <header class="panel-head">
      <SimulationToolbar
        v-model:scope-mode="scopeMode"
        :part-name="instanceId ? 'this instance' : 'the selection'"
        :part-label="instanceId ? 'This instance' : null"
        :is-running="isRunning"
        :is-loading="isLoading"
        :blocked-reason="blockedReason"
        :selected-count="selectedNodeIds.length"
        :is-outdated="isOutdated"
        :is-in-sidebar="!instanceId"
        :has-float="!instanceId"
        :has-page-link="!instanceId"
        @play="play"
        @stop="stop"
        @open-page="openSimulationPage"
      >
        <slot name="toolbar" />
      </SimulationToolbar>
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
            :x="chart.x ?? xAxis"
            :note="chart.note"
            :series="chart.series"
            :references="chart.references"
            :height="chartHeight"
            :sync-key="chart.x ? null : 'simulation-panel'"
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
          :play-scope-node-ids="playScopeNodeIds"
          :keep-current="keepCurrent"
          :plot-config="plotConfig"
          :plot-node-id="plotConfig ? instanceId : null"
          :is-unit-filtered="isUnitFiltered"
          @change="rerunForSliders"
          @update:plot-config="(next) => emit('update:plotConfig', next)"
        />
      </SplitterPanel>
    </Splitter>
  </section>
</template>

<script setup>
/**
 * The context sidebar's Simulation tab: runs scoped simulations and plots the chosen variables of one of
 * the simulated instances. The instance editor's Plot tab gives it a single plot of its own, of its instance's
 * variables, in place of the workspace's plots, and its `toolbar` slot adds controls to the run's row.
 */
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, toRef } from 'vue'
import { useRouter } from 'vue-router'

import ProgressBar from 'primevue/progressbar'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'

import FeaturePlot from './FeaturePlot.vue'
import ProtocolResultsControls from './ProtocolResultsControls.vue'
import SimulationControls from './SimulationControls.vue'
import SimulationPlot from './SimulationPlot.vue'
import SimulationStatusLine from './SimulationStatusLine.vue'
import SimulationToolbar from './SimulationToolbar.vue'
import { useSimulationCharts } from '../../composables/useSimulationCharts'
import { useSimulationRunner } from '../../composables/useSimulationRunner'
import { useSelectionAutoRun } from '../../composables/useSelectionAutoRun'
import { useSliderReruns } from '../../composables/useSliderReruns'

const props = defineProps({
  // In the instance editor: play runs the whole model, or this instance on its own.
  instanceId: { type: String, default: null },
  // A single plot of the view's own, never saved, shown in place of the workspace's plots.
  plotConfig: { type: Object, default: null },
  // Adding to the view's own plot offers only variables in the units it already shows.
  isUnitFiltered: { type: Boolean, default: false },
})
const emit = defineEmits(['update:plotConfig'])

const router = useRouter()
const {
  nodes,
  store,
  scopeNodes,
  selectedNodeIds,
  isRunning,
  isLoading,
  hasScope,
  isSteadyState,
  blockedReason,
  canPlay,
  isOutdated,
  scopeMode,
  playScopeNodeIds,
  statusLine,
  play,
  stop,
  keepCurrent,
} = useSimulationRunner({ instanceId: toRef(props, 'instanceId') })

// What had the focus when the simulation page opened, to give it back on return, as the page takes it.
let focusBeforePage = null

/** Shows the results on the simulation page. */
function openSimulationPage() {
  focusBeforePage = document.activeElement
  router.push({ name: 'simulation' })
}

onActivated(async () => {
  const element = focusBeforePage
  focusBeforePage = null
  await nextTick()
  if (element?.isConnected) element.focus()
})

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
  if (isSteadyState.value) return 'Add variables to a plot to see their values here.'
  return 'Add variables to a plot to see them here.'
})

// The sidebar runs the canvas selection once it is chosen (the instance editor runs its own instance).
if (!props.instanceId) useSelectionAutoRun()

// Slider moves rerun the scope through one shared, lossy queue (see useSliderReruns).
const { rerunForSliders } = useSliderReruns()

const { xAxis, charts, predictionPlotCharts } = useSimulationCharts(scopeNodes, { plotConfig: toRef(props, 'plotConfig') })

/**
 * Plays, unless current results of the scope play would run are shown or on their way. It doesn't wait for the
 * simulator to load, as a run does; failed results, kept partial, are never current.
 */
function ensureResults() {
  if (blockedReason.value) return
  if (isRunning.value) {
    // A run of another scope, such as the sidebar's selection, is stopped for this one.
    if (JSON.stringify(store.scopeNodeIds) !== JSON.stringify(playScopeNodeIds.value)) play()
    return
  }
  if (!store.results || isOutdated.value || store.status === 'error') play()
}

defineExpose({ ensureResults })
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
