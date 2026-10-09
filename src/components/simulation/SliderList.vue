<template>
  <section class="slider-list" aria-label="Parameter sliders">
    <p v-if="protocolStore.areSlidersOff" class="slider-hint" role="note">Sliders are off while the protocol runs. Switch to the time course to use them.</p>
    <div v-for="slider in sliders" :key="slider.valueKey" class="slider-row">
      <div class="slider-head">
        <span class="slider-label" :title="`${slider.componentLabel}/${slider.parameterName}`">
          <template v-if="slider.label"><span class="slider-name">{{ slider.label }}</span></template>
          <template v-else><span class="slider-component">{{ slider.componentLabel }}/</span><span class="slider-name">{{ slider.parameterName }}</span></template>
        </span>
        <span class="slider-value" :class="{ 'slider-value--changed': slider.isChanged && !protocolStore.areSlidersOff }">
          {{ formatValue(slider.value) }} {{ slider.units }}
        </span>
        <Button
          icon="pi pi-ellipsis-h"
          text
          rounded
          size="small"
          severity="secondary"
          :aria-label="`More for ${slider.parameterName}`"
          aria-haspopup="true"
          @click="(event) => openMenu(event, slider)"
        />
      </div>
      <Slider
        v-if="slider.hasRange"
        :model-value="toPosition(slider)"
        :min="0"
        :max="POSITIONS"
        :step="slider.positionStep"
        :aria-label="`${slider.parameterName} value`"
        :aria-valuetext="`${formatValue(slider.value)} ${slider.units}`"
        :disabled="protocolStore.areSlidersOff"
        :tabindex="protocolStore.areSlidersOff ? -1 : 0"
        :pt="{ handle: { 'aria-disabled': protocolStore.areSlidersOff } }"
        class="slider-control"
        @update:model-value="(position) => setValue(slider, fromPosition(slider, position))"
      />
      <p v-else class="slider-hint">Set a range to slide it.</p>
    </div>

    <p v-if="!withPicker && !sliders.length && !elsewhere.length && !missing.length" class="slider-hint">No sliders yet.</p>

    <details v-if="elsewhere.length" class="slider-elsewhere">
      <summary>Not in this run ({{ elsewhere.length }})</summary>
      <ul>
        <li v-for="definition in elsewhere" :key="definition.key">
          <span>{{ definition.componentLabel }}/{{ definition.parameterName }}</span>
          <Button
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="secondary"
            class="remove-button"
            :aria-label="`Remove the ${definition.parameterName} slider`"
            @click="removeDefinitions([definition])"
          />
        </li>
      </ul>
    </details>

    <div v-for="definition in missing" :key="definition.key" class="slider-missing" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
      <span>{{ definition.nodeName }}/{{ definition.parameterName }} is no longer a parameter.</span>
      <Button label="Remove" text size="small" @click="removeDefinitions([definition])" />
    </div>

    <!-- Last, as Add plot is. The search shows when asked for, and tucks away after a pick. -->
    <div v-if="withPicker && isAdding" ref="pickerEl" class="slider-picker">
      <VariablePathPicker
        :index="index"
      :filter="(entry) => entry.slidable && !sliderKeys.has(entry.key)"
      :describe="describeSlidable"
        placeholder="Add a slider…"
        aria-label="Add a slider"
        @pick="addSlider"
      />
      <Button
        icon="pi pi-times"
        text
        rounded
        size="small"
        severity="secondary"
        aria-label="Close the slider search"
        @click="isAdding = false"
      />
    </div>
    <Button
      v-else-if="withPicker"
      label="Add slider"
      icon="pi pi-plus"
      text
      size="small"
      class="slider-add-button"
      @click="startAdding"
    />

    <Menu ref="menu" :model="menuItems" popup />
    <Popover ref="rangePopover">
      <div v-if="rangeSlider" class="slider-range">
        <label :for="`${rangeId}-min`">Minimum</label>
        <InputNumber
          :input-id="`${rangeId}-min`"
          :model-value="rangeSlider.min"
          :max-fraction-digits="6"
          size="small"
          fluid
          @update:model-value="(min) => updateRange(rangeSlider, { min })"
        />
        <label :for="`${rangeId}-max`">Maximum</label>
        <InputNumber
          :input-id="`${rangeId}-max`"
          :model-value="rangeSlider.max"
          :max-fraction-digits="6"
          size="small"
          fluid
          @update:model-value="(max) => updateRange(rangeSlider, { max })"
        />
      </div>
    </Popover>
  </section>
</template>

<script setup>
/**
 * The parameter sliders of the whole model. A slider's value is tried out in runs without changing the
 * model until it is applied; moving one asks for runs as it moves. Sliders of instances the last run left
 * out are listed apart. While the protocol runs, the sliders are off and keep their values for the time
 * course; adding, removing and changing ranges still work, as they run nothing.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Menu from 'primevue/menu'
import Popover from 'primevue/popover'
import Slider from 'primevue/slider'

import { useNodeDataHistory } from '../../composables/useNodeDataHistory'
import VariablePathPicker from './VariablePathPicker.vue'
import {
  createSliderDefinition,
  isSlidableRow,
  pickDefaultValue,
  putSlider,
  removeSlider,
  sliderValueKey,
} from '../../services/simulation/parameterSliders'
import { GLOBAL_COMPONENT, buildVariableIndex } from '../../services/simulation/variableIndex'
import { useLibraryStore } from '../../stores/libraryStore'
import { useProtocolStore } from '../../stores/protocolStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'
import { FLOW_IDS } from '../../utils/constants'

// The slider moves over whole positions across the range, since its fractional steps are unreliable.
const POSITIONS = 1000

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  // The nodes the last run simulated, or null for all of them.
  scopeNodeIds: { type: Array, default: null },
  // Makes a change that keeps the shown results true (see useSimulation).
  keepCurrent: { type: Function, default: (change) => change() },
  // With a search to add sliders for constants and global constants across the model.
  withPicker: { type: Boolean, default: false },
})
const emit = defineEmits(['change'])

const libraryStore = useLibraryStore()
const protocolStore = useProtocolStore()
const resultsStore = useSimulationResultsStore()
const settingsStore = useSimulationSettingsStore()
const { updateNodeData } = useVueFlow(FLOW_IDS.MAIN)
const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)
const rangeId = useId()

const definitions = computed(() => settingsStore.parameterScanConfig?.selections ?? [])
const nodesById = computed(() => new Map(props.nodes.map((node) => [node.id, node])))
// The global constants the run's instances use: a global's slider counts for the run when any of them does.
const globalsInScope = computed(() => {
  if (!props.scopeNodeIds) return null
  const names = props.nodes
    .filter((node) => props.scopeNodeIds.includes(node.id))
    .flatMap((node) => (node.data.variables ?? []).filter((row) => row.type === 'global_constant').map((row) => row.name))
  return new Set(names)
})

/**
 * Checks whether a slider's value reaches the last run.
 *
 * @param {Object} definition
 * @returns {boolean}
 */
function inScope(definition) {
  if (!props.scopeNodeIds) return true
  if (definition.type === 'global_constant') return globalsInScope.value.has(definition.parameterName)
  return props.scopeNodeIds.includes(definition.nodeId)
}

// Each definition with its row, or none when the row is gone or can no longer slide.
const resolved = computed(() =>
  definitions.value.map((definition) => {
    const node = nodesById.value.get(definition.nodeId)
    const row = node?.data?.variables?.find((candidate) => candidate.name === definition.parameterName)
    const isGlobal = definition.type === 'global_constant'
    return {
      definition,
      node,
      row: isSlidableRow(row) ? row : null,
      componentLabel: isGlobal ? GLOBAL_COMPONENT : node?.data?.name ?? definition.nodeName,
    }
  })
)

// One slider per value: sliders on one global constant from several instances share theirs.
const sliders = computed(() => {
  const byValue = new Map()
  for (const { definition, node, row, componentLabel } of resolved.value) {
    if (!row) continue
    const valueKey = sliderValueKey(definition)
    const entry = byValue.get(valueKey)
    if (entry) {
      entry.definitions.push(definition)
      entry.inScope ||= inScope(definition)
      continue
    }
    const hasRange = Number.isFinite(definition.min) && Number.isFinite(definition.max) && definition.max > definition.min
    const override = resultsStore.sliderValues.get(valueKey)
    byValue.set(valueKey, {
      ...definition,
      definitions: [definition],
      node,
      componentLabel,
      valueKey,
      hasRange,
      inScope: inScope(definition),
      positionStep: definition.step && hasRange ? Math.max(1, Math.round((definition.step / (definition.max - definition.min)) * POSITIONS)) : 1,
      // Unchanged, a slider shows the model's value as runs use it.
      value: override ?? pickDefaultValue(row, libraryStore.getGlobalConstant),
      isChanged: override !== undefined,
    })
  }
  return [...byValue.values()].filter((slider) => slider.inScope)
})
const elsewhere = computed(() => {
  const shown = new Set(sliders.value.flatMap((slider) => slider.definitions.map((definition) => definition.key)))
  return resolved.value
    .filter(({ definition, row }) => row && !shown.has(definition.key))
    .map(({ definition, componentLabel }) => ({ ...definition, componentLabel }))
})
const missing = computed(() => resolved.value.filter(({ row }) => !row).map(({ definition }) => definition))

// What can be given a slider: constants and global constants, which libOpenCOR can change between runs.
// A computed constant comes from the constants in its equation, which are what to slide.
const pickerEl = ref(null)
// The search opens from the Add slider button, never on its own.
const isAdding = ref(false)

/** Shows the slider search and puts the cursor in it. */
async function startAdding() {
  isAdding.value = true
  await nextTick()
  pickerEl.value?.querySelector('input')?.focus()
}

const index = computed(() => (props.withPicker ? buildVariableIndex(props.nodes, { scopeNodeIds: props.scopeNodeIds, mapping: resultsStore.mapping }) : []))
const sliderKeys = computed(() => new Set(definitions.value.map((definition) => sliderValueKey(definition))))

/**
 * Notes whether a constant was in the last run, and what the model makes the same as it.
 *
 * @param {Object} entry
 * @returns {string|null}
 */
function describeSlidable(entry) {
  const notes = []
  if (!entry.inScope) notes.push('Not in the last run')
  if (entry.equivalents.length) notes.push(`≡ ${entry.equivalents.join(', ')}`)
  return notes.length ? notes.join(' · ') : null
}

/**
 * Adds a slider for a picked constant, starting at the model's value unless it joins a global constant's
 * shared slider.
 *
 * @param {Object} entry
 */
function addSlider(entry) {
  const node = nodesById.value.get(entry.nodeId)
  const row = node?.data?.variables?.find((candidate) => candidate.name === entry.rowName)
  if (!node || !row) return
  const definition = createSliderDefinition(node, row, libraryStore.getGlobalConstant)
  const valueKey = sliderValueKey(definition)
  if (!definitions.value.some((other) => sliderValueKey(other) === valueKey)) resultsStore.setSliderValue(valueKey, null)
  settingsStore.setParameterScanConfig(putSlider(settingsStore.parameterScanConfig, definition))
  isAdding.value = false
}

let rerunFrame = null
onBeforeUnmount(() => {
  // A run still waited for is asked for now, so a slider moved just before leaving still counts.
  if (rerunFrame && !protocolStore.areSlidersOff) emit('change')
  cancelAnimationFrame(rerunFrame)
})

/**
 * Asks for a run once per frame while sliders move; the panel runs as often as the simulator keeps up. None while
 * the sliders are off, as their values don't reach the protocol's runs.
 */
function scheduleRerun() {
  if (rerunFrame || protocolStore.areSlidersOff) return
  rerunFrame = requestAnimationFrame(() => {
    rerunFrame = null
    emit('change')
  })
}

/**
 * Gets a slider's position for its value.
 *
 * @param {Object} slider
 * @returns {number}
 */
const toPosition = (slider) => Math.round(((slider.value - slider.min) / (slider.max - slider.min)) * POSITIONS)

/**
 * Gets the value at a slider position, rounded to its step when it has one, and to 6 significant figures.
 *
 * @param {Object} slider
 * @param {number} position
 * @returns {number}
 */
function fromPosition(slider, position) {
  const value = slider.min + (position / POSITIONS) * (slider.max - slider.min)
  const stepped = slider.step ? slider.min + Math.round((value - slider.min) / slider.step) * slider.step : value
  return Number(stepped.toPrecision(6))
}

/**
 * Formats a slider value compactly.
 *
 * @param {number|null} value
 * @returns {string}
 */
const formatValue = (value) => (Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '–')

/**
 * Sets a slider's value, or puts it back to the model's with null, and asks for a run.
 *
 * @param {Object} slider
 * @param {number|null} value
 */
function setValue(slider, value) {
  // The handle still takes keys when disabled.
  if (protocolStore.areSlidersOff || (value !== null && value === slider.value)) return
  resultsStore.setSliderValue(slider.valueKey, value)
  scheduleRerun()
}

/**
 * Removes slider definitions, and their value from runs once no slider shares it.
 *
 * @param {Array<Object>} removed
 */
function removeDefinitions(removed) {
  const keys = new Set(removed.map((definition) => definition.key))
  const remaining = definitions.value.filter((definition) => !keys.has(definition.key))
  let wasApplied = false
  for (const definition of removed) {
    const valueKey = sliderValueKey(definition)
    if (remaining.some((other) => sliderValueKey(other) === valueKey)) continue
    wasApplied ||= resultsStore.sliderValues.has(valueKey) && inScope(definition)
    resultsStore.setSliderValue(valueKey, null)
  }
  settingsStore.setParameterScanConfig(removed.reduce((config, definition) => removeSlider(config, definition.key), settingsStore.parameterScanConfig))
  if (wasApplied) scheduleRerun()
}

/**
 * Changes a slider's range, on every definition sharing its value.
 *
 * @param {Object} slider
 * @param {{min?: number, max?: number}} range
 */
function updateRange(slider, range) {
  const config = slider.definitions.reduce(
    (current, definition) => putSlider(current, { ...definitions.value.find((candidate) => candidate.key === definition.key), ...range }),
    settingsStore.parameterScanConfig
  )
  settingsStore.setParameterScanConfig(config)
  Object.assign(rangeSlider.value, range)
}

/**
 * Writes a slider's value into the model as one undoable edit, so it becomes the model's value. The
 * slider's exported default follows it.
 *
 * @param {Object} slider
 */
function applyToModel(slider) {
  if (protocolStore.areSlidersOff) return
  const value = String(slider.value)
  props.keepCurrent(() => {
    if (slider.type === 'global_constant') {
      const shared = libraryStore.getGlobalConstant(slider.parameterName)
      recordEdit({
        type: 'apply-slider',
        nodeIds: [],
        keys: [],
        apply: () => libraryStore.assignGlobalConstant(slider.parameterName, value, shared?.units ?? slider.units, shared?.data_reference ?? null, true),
      })
    } else {
      const variables = slider.node.data.variables.map((row) => (row.name === slider.parameterName ? { ...row, value } : row))
      recordEdit({
        type: 'apply-slider',
        nodeIds: [slider.node.id],
        keys: ['variables'],
        apply: () => updateNodeData(slider.node.id, { variables }),
      })
    }
    const config = slider.definitions.reduce(
      (current, definition) => putSlider(current, { ...definitions.value.find((candidate) => candidate.key === definition.key), default: slider.value }),
      settingsStore.parameterScanConfig
    )
    settingsStore.setParameterScanConfig(config)
    resultsStore.setSliderValue(slider.valueKey, null)
  })
}

const menu = ref(null)
const menuSlider = ref(null)
const rangePopover = ref(null)
const rangeSlider = ref(null)
// The menu button last opened, which the range editor opens beside.
let menuAnchor = null

const menuItems = computed(() => {
  const slider = menuSlider.value
  if (!slider) return []
  return [
    { label: 'Back to the model’s value', icon: 'pi pi-undo', disabled: !slider.isChanged || protocolStore.areSlidersOff, command: () => setValue(slider, null) },
    { label: 'Apply this value to the model', icon: 'pi pi-check', disabled: !slider.isChanged || protocolStore.areSlidersOff, command: () => applyToModel(slider) },
    { label: 'Edit range…', icon: 'pi pi-arrows-h', command: () => openRange(slider) },
    { separator: true },
    { label: 'Remove slider', icon: 'pi pi-trash', command: () => removeDefinitions(slider.definitions) },
  ]
})

/**
 * Opens a slider's menu.
 *
 * @param {Event} event
 * @param {Object} slider
 */
function openMenu(event, slider) {
  menuSlider.value = slider
  menuAnchor = event.currentTarget
  menu.value.toggle(event)
}

/**
 * Opens the range editor beside the slider's menu button.
 *
 * @param {Object} slider
 */
function openRange(slider) {
  rangeSlider.value = { ...slider }
  // Once the menu's click is over, which would otherwise count as a click outside the editor and close it.
  setTimeout(() => rangePopover.value?.show({ currentTarget: menuAnchor }, menuAnchor), 0)
}
</script>

<style scoped>
.slider-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.slider-picker {
  display: flex;
  align-items: center;
  gap: 4px;
}

.slider-picker > :first-child {
  flex: 1;
  min-width: 0;
}

.slider-add-button {
  align-self: flex-start;
}

.slider-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 0.8125rem;
}

.slider-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.slider-name {
  font-weight: 600;
  color: var(--p-text-color);
}

.slider-component {
  color: var(--p-text-muted-color);
}

.slider-value {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: var(--p-text-muted-color);
}

.slider-value--changed {
  color: var(--p-primary-color);
  font-weight: 600;
}

.slider-control {
  /* Room for the handle at either end, which would otherwise be cropped by the sidebar's edge. */
  margin: 0 16px 4px;
}

.slider-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.slider-elsewhere {
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.slider-elsewhere summary {
  cursor: pointer;
}

.slider-elsewhere ul {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.slider-elsewhere li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

/* Removing reads as removing, not as closing: a bin, red as the pointer reaches it. */
.remove-button:hover {
  color: var(--p-red-500);
}

.slider-missing {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  color: var(--p-orange-600);
}

.slider-range {
  display: grid;
  grid-template-columns: auto 8rem;
  align-items: center;
  gap: 6px 10px;
  font-size: 0.8125rem;
}

.slider-range :deep(.p-inputnumber-input) {
  width: 100%;
  min-width: 0;
}
</style>
