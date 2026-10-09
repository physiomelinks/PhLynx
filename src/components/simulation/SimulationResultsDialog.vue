<template>
  <Dialog
    v-model:visible="visible"
    header="Simulation results"
    maximizable
    modal
    :maximize-button-props="{
      severity: 'secondary',
      text: true,
      rounded: true,
      'aria-label': isMaximized ? 'Restore the results to their size' : 'Maximise the results',
    }"
    :style="{ width: 'min(1100px, 92vw)', height: '85vh' }"
    :content-style="{ display: 'flex', flexDirection: 'column', minHeight: 0 }"
    class="simulation-results-dialog"
    @maximize="isMaximized = true"
    @unmaximize="isMaximized = false"
  >
    <div class="results-toolbar">
      <p class="results-summary">{{ summary }}</p>
      <!-- As the toolbar's protocol button does, switching runs at once. -->
      <SelectButton
        v-if="protocolStore.hasProtocol || protocolStore.source?.parseError"
        :model-value="protocolStore.isProtocolMode"
        :options="RUN_MODES"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        aria-label="What play runs"
        @update:model-value="switchRunMode"
      />
      <ProtocolResultsControls />
      <ToggleButton
        v-model="isEditing"
        on-label="Edit"
        off-label="Edit"
        on-icon="pi pi-sliders-h"
        off-icon="pi pi-sliders-h"
        size="small"
        aria-label="Show what gets plotted and tried out"
      />
      <Button label="CSV" icon="pi pi-download" size="small" outlined aria-label="Download the results as CSV" @click="downloadCsv" />
      <Button
        label="PNG"
        icon="pi pi-image"
        size="small"
        outlined
        aria-label="Download the charts as a PNG image"
        @click="downloadPng"
      />
      <!-- Wrapped, so its reason shows while it's disabled. -->
      <span v-if="protocolStore.hasProtocol" v-tooltip.bottom="exportHint" class="export-button">
        <Button
          label="Export protocol"
          icon="pi pi-file-export"
          size="small"
          outlined
          :disabled="!canExportProtocol"
          aria-label="Export the protocol, with a Python script that runs it and plots its outputs"
          @click="protocolExport.open()"
        />
      </span>
    </div>

    <div class="results-body" :class="{ 'results-body--editing': isEditing }">
      <div class="results-main">
        <div ref="chartsEl" class="results-charts">
          <SimulationPlot
            v-for="chart in charts"
            :key="chart.key"
            :zoom-key="`dialog:${chart.key}`"
            :ref="(plot) => setPlot(chart.key, plot)"
            :title="chart.title"
            :title-parts="chart.titleParts"
            :unit="chart.unit"
            :x="xAxis"
            :series="chart.series"
            :height="chartHeight"
            sync-key="simulation-results-dialog"
          />
          <section v-if="featureCharts.length" class="results-features">
            <h3 class="results-features-title">Features</h3>
            <FeaturePlot
              v-for="chart in featureCharts"
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
          <p class="results-hint">Drag across a chart to zoom in; double-click it to zoom out.</p>
        </div>

      </div>

      <SimulationControls
        v-if="isEditing"
        class="results-edit"
        :nodes="nodes"
        :scope-node-ids="scopeNodeIds"
        :keep-current="keepCurrent"
        @change="emit('change')"
      />
    </div>

    <ProtocolExportDialog v-if="protocolStore.hasProtocol" :exporter="protocolExport" />
  </Dialog>
</template>

<script setup>
/**
 * The plotted results at full size: the Simulation tab's charts with their cursors in step, then a protocol run's
 * feature plots when shown, their values downloadable as CSV and the charts as one PNG, and a protocol exportable
 * with a script that runs it. Beside them, as in the tab, an
 * instance's plotted variables and sliders can be changed.
 */
import { computed, ref } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import SelectButton from 'primevue/selectbutton'
import ToggleButton from 'primevue/togglebutton'

import FeaturePlot from './FeaturePlot.vue'
import ProtocolResultsControls from './ProtocolResultsControls.vue'
import ProtocolExportDialog from './ProtocolExportDialog.vue'
import SimulationControls from './SimulationControls.vue'
import SimulationPlot from './SimulationPlot.vue'
import { useProtocolExport } from '../../composables/useProtocolExport'
import { buildResultsCsv, collectResultColumns, composeChartsImage } from '../../services/simulation/resultsExport'
import { useProtocolStore } from '../../stores/protocolStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { legacyDownload } from '../../utils/save'

const FILE_NAME = 'simulation-results'

const visible = defineModel('visible', { type: Boolean, default: false })
const props = defineProps({
  summary: { type: String, default: '' },
  x: { type: Object, required: true }, // { label, unit, values }
  charts: { type: Array, required: true }, // [{ key, title, unit, series }], as the Simulation tab shows them
  // A protocol run's feature plots, when shown, as FeaturePlot takes them; after the charts, and in the PNG, not the CSV.
  featureCharts: { type: Array, default: () => [] },
  // Every node, whose variables can be plotted or given sliders beside the charts.
  nodes: { type: Array, required: true },
  // The nodes the shown run simulated, or null for all of them.
  scopeNodeIds: { type: Array, default: null },
  keepCurrent: { type: Function, required: true },
})
// A slider moved, so the scope wants running again.
const emit = defineEmits(['change', 'play'])

const protocolStore = useProtocolStore()
const resultsStore = useSimulationResultsStore()
const protocolExport = useProtocolExport()
// The protocol exports once it's valid, and not mid-run, as exporting reads the model with the simulator.
const canExportProtocol = computed(() => resultsStore.status !== 'running' && !protocolStore.validation.errors.length && !!protocolStore.view)
const exportHint = computed(() =>
  resultsStore.status === 'running'
    ? 'Export the protocol once the run finishes'
    : canExportProtocol.value
      ? 'Export the protocol, with a Python script that runs it and plots its outputs'
      : 'Fix the protocol’s errors to export it'
)
const RUN_MODES = [
  { label: 'Time course', value: false },
  { label: 'Protocol', value: true },
]

/**
 * Switches play between the time course and the protocol, and runs it.
 *
 * @param {boolean} isProtocolMode
 */
function switchRunMode(isProtocolMode) {
  protocolStore.isProtocolMode = isProtocolMode
  emit('play')
}

const isEditing = ref(true)
const isMaximized = ref(false)
const chartsEl = ref(null)
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

const xAxis = computed(() => props.x)
// Taller charts when there's room for them.
const chartHeight = computed(() => (isMaximized.value ? 360 : 280))
const columns = computed(() => collectResultColumns(props.x, props.charts))


/** Downloads every plotted series as CSV, at full precision. */
function downloadCsv() {
  legacyDownload(`${FILE_NAME}.csv`, new Blob([buildResultsCsv(columns.value)], { type: 'text/csv' }))
}

/** Downloads the charts, as shown, as one PNG on the dialog's background, the feature plots after them. */
function downloadPng() {
  const snapshots = [...props.charts, ...props.featureCharts].map((chart) => plots.get(chart.key)?.snapshot()).filter(Boolean)
  if (!snapshots.length) return
  const style = getComputedStyle(chartsEl.value.closest('.p-dialog'))
  const image = composeChartsImage(snapshots, { background: style.backgroundColor, text: style.color })
  image.toBlob((blob) => blob && legacyDownload(`${FILE_NAME}.png`, blob), 'image/png')
}
</script>

<style scoped>
.results-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.results-summary {
  flex: 1;
  min-width: 12rem;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.results-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 20px;
  /* The dialog's height, shared by the charts and the controls, each scrolling on its own. */
  flex: 1;
  min-height: 0;
}

.results-body--editing {
  grid-template-columns: minmax(0, 1fr) 320px;
}

.results-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* Beside the charts, as tall as the dialog, scrolling on its own when it needs to. */
.results-edit {
  min-height: 0;
  overflow-y: auto;
  padding-left: 20px;
  border-left: 1px solid var(--p-content-border-color);
}


/* Too narrow for both side by side: the controls go under the charts, each taking half the height. */
@media (max-width: 820px) {
  .results-body--editing {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }

  .results-edit {
    padding-left: 0;
    padding-top: 12px;
    border-left: none;
    border-top: 1px solid var(--p-content-border-color);
  }
}

.results-charts {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  overflow-y: auto;
}

.export-button {
  display: inline-flex;
}

.results-features {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* After the traces, a group of its own. */
.results-features-title {
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid var(--p-content-border-color);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.results-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

</style>
