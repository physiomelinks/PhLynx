<template>
  <div class="plot-list">
    <section
      v-for="plot in plots"
      :key="plot.id"
      class="plot-card"
      :class="{ 'plot-card--target': plot.id === targetPlotId }"
      :aria-label="plot.name"
    >
      <header class="plot-card-head">
        <InputText
          v-if="renamingId === plot.id"
          v-model="renameText"
          size="small"
          class="plot-rename"
          :aria-label="`Rename ${plot.name}`"
          autofocus
          @keydown.enter="finishRename(plot)"
          @keydown.esc="renamingId = null"
          @blur="finishRename(plot)"
        />
        <button v-else type="button" class="plot-name" :aria-pressed="plot.id === targetPlotId" @click="targetPlotId = plot.id">
          {{ plot.name }}
          <span class="plot-count">{{ plot.selections.length }}</span>
          <i
            v-if="plot.units.size > 1"
            class="pi pi-exclamation-triangle plot-mixed"
            v-tooltip.top="'This plot mixes units, so it shows as one chart per unit. Move variables to give each unit its own plot.'"
            aria-label="Mixed units"
          ></i>
        </button>
        <Button
          icon="pi pi-plus"
          text
          rounded
          size="small"
          :aria-label="`Add a variable to ${plot.name}`"
          v-tooltip.top="'Add a variable here'"
          @click="addHere(plot)"
        />
        <Button
          icon="pi pi-ellipsis-h"
          text
          rounded
          size="small"
          severity="secondary"
          :aria-label="`More for ${plot.name}`"
          aria-haspopup="true"
          @click="(event) => openMenu(event, plot)"
        />
      </header>

      <!-- Against time unless set otherwise: a phase plot, against another variable of the same run. -->
      <div v-if="choosingXFor === plot.id" class="plot-x">
        <VariablePathPicker
          :index="index"
          :filter="(entry) => entry.plottable"
          placeholder="Plot against…"
          :aria-label="`Choose a variable to plot ${plot.name} against`"
          @pick="(entry) => pickXAxis(plot, entry)"
        />
        <Button icon="pi pi-times" text rounded size="small" severity="secondary" aria-label="Cancel" @click="choosingXFor = null" />
      </div>
      <div v-else-if="plot.xAxis" class="plot-x">
        <span class="plot-x-text" :title="`Plotted against ${plot.xAxis.label}`">
          Against <span class="plot-variable-component">{{ plot.xAxis.componentLabel }}/</span><span class="plot-variable-name">{{ plot.xAxis.variableName }}</span>
        </span>
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          severity="secondary"
          :aria-label="`Plot ${plot.name} against time again`"
          v-tooltip.left="'Plot against time again'"
          @click="emitConfig(setPlotXAxis(plotConfig, plot.id, null))"
        />
      </div>

      <ul v-if="plot.selections.length" class="plot-variables">
        <li v-for="selection in plot.selections" :key="selection.key" class="plot-variable" :class="{ 'plot-variable--elsewhere': !selection.inScope }">
          <span class="plot-swatch" :class="{ 'plot-swatch--none': !selection.colour }" :style="{ background: selection.colour ?? 'transparent' }" aria-hidden="true"></span>
          <span class="plot-variable-text" :title="selection.title">
            <span class="plot-variable-component">{{ selection.componentLabel }}/</span><span class="plot-variable-name">{{ selection.variableName }}</span>
          </span>
          <span class="plot-variable-units">{{ selection.units }}</span>
          <Select
            v-if="plots.length > 1"
            :model-value="plot.id"
            :options="plots"
            option-label="name"
            option-value="id"
            :option-disabled="(option) => !acceptsUnits(plotConfig, option.id, selection.units, selection.key)"
            size="small"
            class="plot-move"
            :aria-label="`Move ${selection.variableName} to another plot`"
            @update:model-value="(id) => emitConfig(assignSelection(plotConfig, selection.key, id))"
          />
          <Button
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="secondary"
            class="remove-button"
            :aria-label="`Stop plotting ${selection.variableName}`"
            v-tooltip.left="'Remove from the plot'"
            @click="emitConfig(removePlotSelection(plotConfig, selection.key))"
          />
        </li>
      </ul>
      <p v-else class="plot-empty">No variables yet. Search above to add one.</p>
    </section>

    <section v-if="unassigned.length" class="plot-card plot-card--unassigned" aria-label="Not on a plot">
      <header class="plot-card-head">
        <span class="plot-name plot-name--static">Not on a plot <span class="plot-count">{{ unassigned.length }}</span></span>
        <Select
          :model-value="null"
          :options="plots"
          option-label="name"
          option-value="id"
          placeholder="Move all to…"
          size="small"
          class="plot-move"
          aria-label="Move every variable not on a plot to a plot"
          @update:model-value="moveUnassigned"
        />
      </header>
      <ul class="plot-variables">
        <li v-for="selection in unassigned" :key="selection.key" class="plot-variable">
          <span class="plot-variable-text">
            <span class="plot-variable-component">{{ selection.componentLabel }}/</span><span class="plot-variable-name">{{ selection.variableName }}</span>
          </span>
          <Button
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="secondary"
            class="remove-button"
            :aria-label="`Stop plotting ${selection.variableName}`"
            v-tooltip.left="'Remove from the plot'"
            @click="emitConfig(removePlotSelection(plotConfig, selection.key))"
          />
        </li>
      </ul>
    </section>

    <Button label="Add plot" icon="pi pi-plus" text size="small" class="plot-add" @click="addNewPlot" />
    <Menu ref="menu" :model="menuItems" popup />
  </div>
</template>

<script setup>
/**
 * The plots and the variables on each, as Simulation Settings arranges them: add, rename, reorder and remove
 * plots, and move or remove their variables. The target plot is where a variable picked next goes.
 */
import { computed, ref } from 'vue'

import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Menu from 'primevue/menu'
import Select from 'primevue/select'

import VariablePathPicker from './VariablePathPicker.vue'
import { useColorScheme } from '../../composables/useColorScheme'
import { useConfirmDialog } from '../../composables/useConfirmDialog'
import {
  acceptsUnits,
  addPlot,
  assignSelection,
  choosePlotForUnits,
  getPlotUnits,
  movePlot,
  removePlot,
  removePlotSelection,
  renamePlot,
  resolveGroups,
  createPlotXAxis,
  setPlotXAxis,
} from '../../services/simulation/plotSelections'
import { SERIES_COLOURS } from '../../services/simulation/seriesSlots'
import { INSPECTION_COMPONENT, isInspectionNodeId, resolvePlotTarget } from '../../services/simulation/variableIndex'
import { useInspectionModuleStore } from '../../stores/inspectionModuleStore'

const targetPlotId = defineModel('targetPlotId', { type: String, default: null })
const props = defineProps({
  plotConfig: { type: Object, default: () => ({}) },
  nodes: { type: Array, default: () => [] },
  // The nodes the last run simulated, or null for all of them.
  scopeNodeIds: { type: Array, default: null },
  // Colour slots by series key, as the charts give them.
  seriesSlots: { type: Map, default: () => new Map() },
  // The variable search's index (see buildVariableIndex), to choose a variable to plot against; without
  // it, plots can't be set against anything but time.
  index: { type: Array, default: null },
})
const emit = defineEmits(['update:plotConfig', 'add-here'])

const { confirm } = useConfirmDialog()
const { isDarkMode } = useColorScheme()
const menu = ref(null)
const menuPlot = ref(null)
const renamingId = ref(null)
const renameText = ref('')
// The plot whose variable to plot against is being chosen.
const choosingXFor = ref(null)
const inspectionStore = useInspectionModuleStore()

const nodesById = computed(() => new Map(props.nodes.map((node) => [node.id, node])))

/**
 * Describes a selection for display: its instance as named now, whether the last run covered it, and the
 * colour of its line.
 *
 * @param {Object} selection
 * @returns {Object}
 */
function describeSelection(selection) {
  const node = nodesById.value.get(selection.nodeId)
  const isInspection = isInspectionNodeId(selection.nodeId)
  const inScope = isInspection || !props.scopeNodeIds || props.scopeNodeIds.includes(selection.nodeId)
  const slot = props.seriesSlots.get(selection.key)
  return {
    ...selection,
    componentLabel: isInspection ? INSPECTION_COMPONENT : node?.data?.name ?? 'missing instance',
    inScope,
    colour: slot === undefined || !inScope ? null : SERIES_COLOURS[isDarkMode.value ? 'dark' : 'light'][slot],
    title: `${isInspection ? INSPECTION_COMPONENT : node?.data?.name}/${selection.variableName}${inScope ? '' : ': not in the last run'}`,
  }
}

/**
 * Describes the variable a plot plots against, with its instance as named now.
 *
 * @param {Object|undefined} xAxis
 * @returns {Object|null}
 */
function describeXAxis(xAxis) {
  if (!xAxis) return null
  const componentLabel = isInspectionNodeId(xAxis.nodeId) ? INSPECTION_COMPONENT : nodesById.value.get(xAxis.nodeId)?.data?.name ?? 'missing instance'
  return { ...xAxis, componentLabel, label: `${componentLabel}/${xAxis.variableName}` }
}

const plots = computed(() =>
  resolveGroups(props.plotConfig).map((group) => ({
    ...group,
    xAxis: describeXAxis(group.xAxis),
    units: getPlotUnits(props.plotConfig, group.id),
    selections: (props.plotConfig?.selections ?? []).filter((selection) => selection.groupId === group.id).map(describeSelection),
  }))
)
const unassigned = computed(() => {
  const ids = new Set(plots.value.map((plot) => plot.id))
  return (props.plotConfig?.selections ?? []).filter((selection) => !ids.has(selection.groupId)).map(describeSelection)
})

/**
 * Passes on a new plot config, unless nothing changed.
 *
 * @param {Object} next
 */
function emitConfig(next) {
  if (next !== props.plotConfig) emit('update:plotConfig', next)
}

/** Adds a plot and makes it the target. */
function addNewPlot() {
  const { plotConfig, id } = addPlot(props.plotConfig)
  emitConfig(plotConfig)
  targetPlotId.value = id
}

/**
 * Makes a plot the target and asks for the search box.
 *
 * @param {Object} plot
 */
function addHere(plot) {
  targetPlotId.value = plot.id
  emit('add-here')
}

/**
 * Starts renaming a plot.
 *
 * @param {Object} plot
 */
function startRename(plot) {
  renameText.value = plot.name
  renamingId.value = plot.id
}

/**
 * Finishes renaming a plot.
 *
 * @param {Object} plot
 */
function finishRename(plot) {
  if (renamingId.value !== plot.id) return
  renamingId.value = null
  emitConfig(renamePlot(props.plotConfig, plot.id, renameText.value))
}

/**
 * Removes a plot and its variables, once confirmed when it has any.
 *
 * @param {Object} plot
 */
async function removeWithConfirm(plot) {
  const count = plot.selections.length
  if (count) {
    const isConfirmed = await confirm({
      header: `Remove ${plot.name}?`,
      message: `${plot.name} and its ${count} ${count === 1 ? 'variable' : 'variables'} will be removed.`,
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      severity: 'warning',
    })
    if (!isConfirmed) return
  }
  emitConfig(removePlot(props.plotConfig, plot.id))
  if (targetPlotId.value === plot.id) targetPlotId.value = null
}

/**
 * Moves every variable not on a plot to a plot.
 *
 * @param {string} id
 */
function moveUnassigned(id) {
  // One unit per plot: a variable in other units goes to a plot in its units, or a new one.
  const config = unassigned.value.reduce((current, selection) => {
    let plotId = choosePlotForUnits(current, selection.units, id, selection.key)
    if (!plotId) {
      const added = addPlot(current)
      current = added.plotConfig
      plotId = added.id
    }
    return assignSelection(current, selection.key, plotId)
  }, props.plotConfig)
  emitConfig(config)
}

const menuItems = computed(() => {
  const plot = menuPlot.value
  if (!plot) return []
  const index = plots.value.findIndex((candidate) => candidate.id === plot.id)
  return [
    { label: 'Rename', icon: 'pi pi-pencil', command: () => startRename(plot) },
    { label: 'Move up', icon: 'pi pi-arrow-up', disabled: index <= 0, command: () => emitConfig(movePlot(props.plotConfig, plot.id, -1)) },
    {
      label: 'Move down',
      icon: 'pi pi-arrow-down',
      disabled: index >= plots.value.length - 1,
      command: () => emitConfig(movePlot(props.plotConfig, plot.id, 1)),
    },
    ...(props.index
      ? [
          { separator: true },
          { label: 'Plot against a variable…', icon: 'pi pi-arrows-h', command: () => (choosingXFor.value = plot.id) },
          {
            label: 'Plot against time',
            icon: 'pi pi-clock',
            disabled: !plot.xAxis,
            command: () => emitConfig(setPlotXAxis(props.plotConfig, plot.id, null)),
          },
        ]
      : []),
    { separator: true },
    { label: 'Remove plot', icon: 'pi pi-trash', disabled: plots.value.length <= 1, command: () => removeWithConfirm(plot) },
  ]
})

/**
 * Plots a plot against a picked variable, as a phase plot does.
 *
 * @param {Object} plot
 * @param {Object} entry - From the variable index.
 */
function pickXAxis(plot, entry) {
  const target = resolvePlotTarget(entry, props.nodes, inspectionStore.modules)
  choosingXFor.value = null
  if (target) emitConfig(setPlotXAxis(props.plotConfig, plot.id, createPlotXAxis(target.node, target.row)))
}

/**
 * Opens a plot's menu.
 *
 * @param {Event} event
 * @param {Object} plot
 */
function openMenu(event, plot) {
  menuPlot.value = plot
  menu.value.toggle(event)
}
</script>

<style scoped>
.plot-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plot-card {
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  padding: 4px 4px 6px 8px;
}

.plot-card--target {
  border-color: var(--p-primary-color);
}

.plot-card-head {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.plot-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-text-color);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.plot-name--static {
  cursor: default;
}

.plot-count {
  padding: 0 6px;
  border-radius: 8px;
  background: var(--p-content-hover-background);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--p-text-muted-color);
}

.plot-mixed {
  color: var(--p-orange-500);
  font-size: 0.75rem;
}

.plot-rename {
  flex: 1;
  min-width: 0;
}

.plot-variables {
  margin: 0;
  padding: 0;
  list-style: none;
}

.plot-variable {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  font-size: 0.8125rem;
}

.plot-variable--elsewhere {
  opacity: 0.6;
}

.plot-swatch {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px var(--p-content-border-color);
}

.plot-swatch--none {
  visibility: hidden;
}

.plot-variable-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.plot-variable-name {
  font-weight: 600;
  color: var(--p-text-color);
}

.plot-variable-component {
  color: var(--p-text-muted-color);
}

.plot-variable-units {
  flex-shrink: 0;
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}

.plot-move {
  flex-shrink: 0;
  width: 6.5rem;
}

/* Removing reads as removing, not as closing: a bin, red as the pointer reaches it. */
.remove-button:hover {
  color: var(--p-red-500);
}

.plot-x {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin: 2px 0 4px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.plot-x > :first-child {
  flex: 1;
  min-width: 0;
}

.plot-x-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.plot-empty {
  margin: 2px 0 2px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.plot-add {
  align-self: flex-start;
}

/* Narrow: the plot to move to goes; the variable's own name and remove button stay. */
@container (max-width: 300px) {
  .plot-move,
  .plot-variable-units {
    display: none;
  }
}
</style>
