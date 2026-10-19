<template>
  <section class="simulation-controls" aria-label="What gets plotted and tried out">
    <SimulationSettingsSection v-if="hasSettings" />
    <SelectButton
      v-model="view"
      :options="views"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      size="small"
      class="controls-views"
      aria-label="Show"
    >
      <template #option="{ option }">
        <!-- Named "Plots (3)" for a screen reader, the count shown as a badge. -->
        <span class="controls-view-label" aria-hidden="true">{{ option.name }}</span>
        <span class="controls-view-count" aria-hidden="true">{{ option.count }}</span>
        <span class="visually-hidden">{{ option.label }}</span>
      </template>
    </SelectButton>

    <template v-if="view === 'plots'">
      <div class="controls-search">
        <VariablePathPicker
          ref="plotPicker"
          :index="index"
          :filter="isAddable"
          :describe="describePlottable"
          :placeholder="addPlaceholder"
          :empty-message="addEmptyMessage"
          aria-label="Add a variable to plot"
          @pick="plotEntry"
        />
        <Select
          v-if="!isSinglePlot"
          v-model="targetPlotId"
          :options="plotOptions"
          option-label="name"
          option-value="id"
          size="small"
          class="controls-target"
          aria-label="Plot to add to"
        />
      </div>
      <p v-if="plotNote" class="controls-note" role="status">{{ plotNote }}</p>
      <PlotListEditor
        v-model:target-plot-id="targetPlotId"
        :plot-config="shownPlotConfig"
        :is-single-plot="isSinglePlot"
        :is-plottable="isPlottable"
        :resolve-entry="resolveEntry"
        :nodes="nodes"
        :index="index"
        :scope-node-ids="scopeNodeIds"
        :series-slots="resultsStore.getSeriesSlots()"
        @update:plot-config="setPlotConfig"
        @add-here="focusPicker"
      />
    </template>

    <SweepEditor
      v-else-if="view === 'sweep'"
      :sweep="settingsStore.simulationSettings.sweep ?? null"
      :nodes="nodes"
      :play-scope-node-ids="playScopeNodeIds"
      @update:sweep="setSweep"
    />

    <RunList v-else-if="view === 'runs'" />

    <SliderList
      v-else
      with-picker
      :nodes="nodes"
      :scope-node-ids="scopeNodeIds"
      :keep-current="keepCurrent"
      @change="emit('change')"
    />
  </section>
</template>

<script setup>
/**
 * What gets plotted and tried out, across the whole model: plots and the variables on them, parameter
 * sliders or a parameter sweep, each added from one search over every `instance/variable` path, or the runs
 * kept to compare. Given a plot config of its own, it edits that single plot rather than the workspace's plots.
 */
import { computed, ref, watch } from 'vue'

import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'

import PlotListEditor from './PlotListEditor.vue'
import RunList from './RunList.vue'
import SimulationSettingsSection from './SimulationSettingsSection.vue'
import SliderList from './SliderList.vue'
import SweepEditor from './SweepEditor.vue'
import VariablePathPicker from './VariablePathPicker.vue'
import { sliderValueKey } from '../../services/simulation/parameterSliders'
import { addPlotSelection, getPlotUnits, plotVariable, resolveGroups } from '../../services/simulation/plotSelections'
import { buildVariableIndex, indexKeyOf, resolvePlotTarget } from '../../services/simulation/variableIndex'
import { useInspectionModuleStore } from '../../stores/inspectionModuleStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'

const props = defineProps({
  // Every node in the workspace: any of them can be plotted or given a slider.
  nodes: { type: Array, default: () => [] },
  // The nodes the last run simulated, or null for all of them.
  scopeNodeIds: { type: Array, default: null },
  // The nodes play simulates next, or null for all of them: what the sweep can vary.
  playScopeNodeIds: { type: Array, default: null },
  // Makes a change that keeps the shown results true (see useSimulation).
  keepCurrent: { type: Function, default: (change) => change() },
  // A view's own single plot, edited in place of the workspace's plots, or null for the workspace's.
  plotConfig: { type: Object, default: null },
  // The one instance whose variables can be plotted, or null for any.
  plotNodeId: { type: String, default: null },
  // Adding to the view's own plot offers only variables in the units it already shows.
  isUnitFiltered: { type: Boolean, default: false },
  // The time course and solver settings, in a section at the top.
  hasSettings: { type: Boolean, default: false },
})
// `change`: a slider moved, so the scope wants running again.
const emit = defineEmits(['change', 'update:plotConfig'])

const resultsStore = useSimulationResultsStore()
const inspectionStore = useInspectionModuleStore()
const settingsStore = useSimulationSettingsStore()

// Given by the panel, so they last when its layout changes; local otherwise.
const view = defineModel('view', { type: String, default: 'plots' })
const targetPlotId = defineModel('targetPlotId', { type: String, default: null })
const plotPicker = ref(null)

const index = computed(() =>
  buildVariableIndex(props.nodes, {
    scopeNodeIds: props.scopeNodeIds,
    mapping: resultsStore.mapping,
    inspectionModules: inspectionStore.modules,
    inspectionOutputs: resultsStore.results ? resultsStore.inspectionOutputs : null,
  })
)
const isSinglePlot = computed(() => !!props.plotConfig)
const shownPlotConfig = computed(() => props.plotConfig ?? settingsStore.plotConfig)
const plotOptions = computed(() => resolveGroups(shownPlotConfig.value))
const plottedCount = computed(() => shownPlotConfig.value?.selections?.length ?? 0)
const sliderDefinitions = computed(() => settingsStore.parameterScanConfig?.selections ?? [])
const sliderKeys = computed(() => new Set(sliderDefinitions.value.map((definition) => sliderValueKey(definition))))
/**
 * Describes a view for the switch: its name and how many it holds.
 *
 * @param {string} name
 * @param {number} count
 * @param {string} value
 * @returns {{label: string, name: string, count: number, value: string}}
 */
function describeView(name, count, value) {
  return { label: `${name} (${count})`, name, count, value }
}

const views = computed(() => [
  describeView('Plots', plottedCount.value, 'plots'),
  describeView('Sliders', sliderKeys.value.size, 'sliders'),
  // The swept parameter, and the one its curves vary.
  describeView('Sweep', settingsStore.simulationSettings.sweep ? (settingsStore.simulationSettings.sweep.family ? 2 : 1) : 0, 'sweep'),
  describeView('Runs', resultsStore.trackedRuns.length, 'runs'),
])

// The target is the plot chosen last, or the first while that one is gone.
watch(
  plotOptions,
  (plots) => {
    if (!plots.some((plot) => plot.id === targetPlotId.value)) targetPlotId.value = plots[0]?.id ?? null
  },
  { immediate: true }
)

const plotNames = computed(() => new Map(plotOptions.value.map((plot) => [plot.id, plot.name])))
const plottedGroups = computed(() => new Map((shownPlotConfig.value?.selections ?? []).map((selection) => [indexKeyOf(selection), selection.groupId])))

/**
 * Sets the plots shown: the view's own, or the workspace's.
 *
 * @param {Object} plotConfig
 */
function setPlotConfig(plotConfig) {
  if (isSinglePlot.value) emit('update:plotConfig', plotConfig)
  else settingsStore.setPlotConfig(plotConfig)
}

/**
 * Checks whether the search offers an entry to plot.
 *
 * @param {Object} entry
 * @returns {boolean}
 */
function isPlottable(entry) {
  return entry.plottable && (!props.plotNodeId || entry.nodeId === props.plotNodeId || !!findOwnGlobalRow(entry))
}

/**
 * Finds the plot's instance's own row for a global constant's entry, which names only the first instance using it.
 *
 * @param {Object} entry
 * @returns {{node: Object, row: Object}|null}
 */
function findOwnGlobalRow(entry) {
  if (!props.plotNodeId || entry.kind !== 'global_constant') return null
  const node = props.nodes.find((candidate) => candidate.id === props.plotNodeId)
  const row = node?.data?.variables?.find((candidate) => candidate.type === 'global_constant' && candidate.name === entry.rowName)
  return row ? { node, row } : null
}

// The units the view's own plot shows, when adding to it offers only those; empty offers any.
const filteredUnits = computed(() => {
  if (!props.isUnitFiltered || !isSinglePlot.value) return new Set()
  return getPlotUnits(props.plotConfig, plotOptions.value[0]?.id)
})
const filteredUnitsLabel = computed(() => [...filteredUnits.value].map((units) => units || 'no units').join(' or '))
const addPlaceholder = computed(() => (filteredUnits.value.size ? `Add a variable in ${filteredUnitsLabel.value}…` : 'Add a variable…'))
const addEmptyMessage = computed(() => (filteredUnits.value.size ? `No variable in ${filteredUnitsLabel.value} matches.` : 'No variable matches.'))

/**
 * Checks whether the search offers an entry to add: a plottable one, in the plot's units while it is filtered
 * by them. Plotting against a variable stays open to any units.
 *
 * @param {Object} entry
 * @returns {boolean}
 */
function isAddable(entry) {
  return isPlottable(entry) && (!filteredUnits.value.size || filteredUnits.value.has(entry.units || ''))
}

/**
 * Notes where a variable is plotted and what it is the same as.
 *
 * @param {Object} entry
 * @returns {string|null}
 */
function describePlottable(entry) {
  const notes = []
  if (plottedGroups.value.has(entry.key)) notes.push(`On ${plotNames.value.get(plottedGroups.value.get(entry.key)) ?? 'no plot'}`)
  if (!entry.inScope) notes.push('Not in the last run')
  if (entry.equivalents.length) notes.push(`≡ ${entry.equivalents.join(', ')}`)
  return notes.length ? notes.join(' · ') : null
}

/**
 * Finds the node and row an index entry names.
 *
 * @param {Object} entry
 * @returns {{node: Object, row: Object}|null}
 */
function resolveEntry(entry) {
  return findOwnGlobalRow(entry) ?? resolvePlotTarget(entry, props.nodes, inspectionStore.modules)
}

// Says where a picked variable went when that wasn't the target plot.
const plotNote = ref('')
let plotNoteTimer = null

/**
 * Shows a note for a few seconds.
 *
 * @param {string} text
 */
function showPlotNote(text) {
  plotNote.value = text
  clearTimeout(plotNoteTimer)
  plotNoteTimer = setTimeout(() => (plotNote.value = ''), 6000)
}

/**
 * Plots a picked variable on the target plot, moving it there if it is on another. A plot holds one unit,
 * so a variable in other units goes to a plot in its units, or a new one; a single plot takes every unit.
 *
 * @param {Object} entry
 */
function plotEntry(entry) {
  const found = resolveEntry(entry)
  if (!found) return
  if (isSinglePlot.value) {
    setPlotConfig(addPlotSelection(props.plotConfig, found.node, found.row, plotOptions.value[0].id))
    return
  }
  const { plotConfig, plotId } = plotVariable(settingsStore.plotConfig, found.node, found.row, targetPlotId.value)
  settingsStore.setPlotConfig(plotConfig)
  if (plotId !== targetPlotId.value) {
    const name = resolveGroups(plotConfig).find((plot) => plot.id === plotId)?.name
    showPlotNote(`${entry.name} (${found.row.units || 'no units'}) went on ${name}: a plot shows one unit.`)
  }
}

/**
 * Sets the sweep, or stops sweeping with null.
 *
 * @param {Object|null} sweep
 */
function setSweep(sweep) {
  settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, sweep })
}

/** Puts the cursor in the search box, for a plot's add button. */
function focusPicker() {
  plotPicker.value?.$el?.querySelector('input')?.focus()
}
</script>

<style scoped>
.simulation-controls {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* Across the controls, the four views sharing it, so none of them wraps or is cut off as the controls narrow. */
.controls-views {
  display: flex;
  width: 100%;
}

.controls-views :deep(.p-togglebutton) {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  padding-inline: 4px;
}

.controls-views :deep(.p-togglebutton-content) {
  gap: 4px;
  min-width: 0;
  padding-inline: 6px;
  white-space: nowrap;
}

.controls-view-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.controls-view-count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--p-content-hover-background);
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.controls-search {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.controls-search > :first-child {
  flex: 1;
  min-width: 0;
}

.controls-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.controls-target {
  flex-shrink: 0;
  width: 7.5rem;
}

/* Narrow: the plot to add to goes under the search box, and each view's count sits in its corner, taking no width. */
@container (max-width: 300px) {
  .controls-view-count {
    position: absolute;
    top: 1px;
    right: 1px;
    padding: 0 3px;
    font-size: 0.5625rem;
    line-height: 0.75rem;
  }

  .controls-search {
    flex-direction: column;
  }

  .controls-target {
    width: 100%;
  }
}
</style>
