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
        v-if="!x.isSteadyState"
        label="PNG"
        icon="pi pi-image"
        size="small"
        outlined
        aria-label="Download the charts as a PNG image"
        @click="downloadPng"
      />
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
  </Dialog>
</template>

<script setup>
/**
 * The plotted results at full size: the Simulation tab's charts with their cursors in step, their values
 * downloadable as CSV and the charts as one PNG. Beside them, as in the tab, an
 * instance's plotted variables and sliders can be changed.
 */
import { computed, ref } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import ToggleButton from 'primevue/togglebutton'

import SimulationControls from './SimulationControls.vue'
import SimulationPlot from './SimulationPlot.vue'
import { buildResultsCsv, collectResultColumns, composeChartsImage } from '../../services/simulation/resultsExport'
import { legacyDownload } from '../../utils/save'

const FILE_NAME = 'simulation-results'

const visible = defineModel('visible', { type: Boolean, default: false })
const props = defineProps({
  summary: { type: String, default: '' },
  x: { type: Object, required: true }, // { label, unit, values }
  charts: { type: Array, required: true }, // [{ key, title, unit, series }], as the Simulation tab shows them
  // Every node, whose variables can be plotted or given sliders beside the charts.
  nodes: { type: Array, required: true },
  // The nodes the shown run simulated, or null for all of them.
  scopeNodeIds: { type: Array, default: null },
  keepCurrent: { type: Function, required: true },
})
// A slider moved, so the scope wants running again.
const emit = defineEmits(['change'])

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

/** Downloads the charts, as shown, as one PNG on the dialog's background. */
function downloadPng() {
  const snapshots = props.charts.map((chart) => plots.get(chart.key)?.snapshot()).filter(Boolean)
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

.results-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

</style>
