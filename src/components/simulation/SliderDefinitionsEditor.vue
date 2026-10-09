<template>
  <section class="slider-definitions" aria-label="Slider ranges">
    <VariablePathPicker
      :index="index"
      :filter="(entry) => entry.slidable && !definedKeys.has(entry.key)"
      placeholder="Add a slider…"
      aria-label="Add a slider"
      @pick="addDefinition"
    />

    <table v-if="rows.length" class="definitions-table">
      <thead>
        <tr>
          <th scope="col">Parameter</th>
          <th scope="col">Label</th>
          <th scope="col">Min</th>
          <th scope="col">Default</th>
          <th scope="col">Max</th>
          <th scope="col"><span class="visually-hidden">Remove</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.valueKey" :class="{ 'definition--missing': !row.isSlidable }">
          <th scope="row" class="definition-path" :title="row.isSlidable ? `${row.componentLabel}/${row.parameterName}` : 'No longer a parameter'">
            <span class="definition-component">{{ row.componentLabel }}/</span><span class="definition-name">{{ row.parameterName }}</span>
            <span class="definition-units">{{ row.units }}</span>
          </th>
          <td>
            <InlineText
              :model-value="row.label"
              :placeholder="`${row.componentLabel}/${row.parameterName}`"
              :aria-label="`${row.parameterName} label`"
              @update:model-value="(value) => updateDefinition(row, { label: value })"
            />
          </td>
          <td v-for="field in FIELDS" :key="field">
            <InputNumber
              :model-value="row[field]"
              :pt:pcInputText:root="{ 'data-testid': `param-${field}-${row.parameterName}` }"
              :aria-label="`${row.parameterName} ${field}`"
              :min-fraction-digits="0"
              :max-fraction-digits="8"
              size="small"
              fluid
              @update:model-value="(value) => updateDefinition(row, { [field]: value })"
            />
          </td>
          <td>
            <Button
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="secondary"
              class="remove-button"
              :aria-label="`Remove the ${row.parameterName} slider`"
              v-tooltip.left="'Remove the slider'"
              @click="removeRow(row)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="definitions-empty">No sliders yet. Search above for a parameter to give a slider.</p>
  </section>
</template>

<script setup>
/**
 * The ranges of the parameter sliders, as exported for web OpenCOR: each slider's minimum, default and
 * maximum, with the same search across the whole model the Simulation tab uses to add one.
 */
import { computed } from 'vue'

import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'

import InlineText from './InlineText.vue'
import VariablePathPicker from './VariablePathPicker.vue'
import { createSliderDefinition, isSlidableRow, putSlider, removeSlider, sliderValueKey } from '../../services/simulation/parameterSliders'
import { GLOBAL_COMPONENT, buildVariableIndex } from '../../services/simulation/variableIndex'

// A slider moves smoothly across its range, so no step is asked for.
const FIELDS = ['min', 'default', 'max']

const props = defineProps({
  scanConfig: { type: Object, default: () => ({ selections: [] }) },
  nodes: { type: Array, default: () => [] },
  getGlobalConstant: { type: Function, required: true },
})
const emit = defineEmits(['update:scanConfig'])

const index = computed(() => buildVariableIndex(props.nodes))
const nodesById = computed(() => new Map(props.nodes.map((node) => [node.id, node])))
const definitions = computed(() => props.scanConfig?.selections ?? [])
// Sliders by their value: a global constant's is one value however many instances it was added from.
const definedKeys = computed(() => new Set(definitions.value.map((definition) => sliderValueKey(definition))))
const globalsInUse = computed(
  () => new Set(props.nodes.flatMap((node) => (node.data?.variables ?? []).filter((row) => row.type === 'global_constant').map((row) => row.name)))
)

// One row per slider value, the first definition standing for any others sharing it.
const rows = computed(() => {
  const byValue = new Map()
  for (const definition of definitions.value) {
    const valueKey = sliderValueKey(definition)
    if (byValue.has(valueKey)) {
      byValue.get(valueKey).keys.push(definition.key)
      continue
    }
    const isGlobal = definition.type === 'global_constant'
    const node = nodesById.value.get(definition.nodeId)
    const row = node?.data?.variables?.find((candidate) => candidate.name === definition.parameterName)
    byValue.set(valueKey, {
      ...definition,
      valueKey,
      keys: [definition.key],
      // A global constant is still a parameter while any instance uses it.
      isSlidable: isGlobal ? globalsInUse.value.has(definition.parameterName) : isSlidableRow(row),
      componentLabel: isGlobal ? GLOBAL_COMPONENT : node?.data?.name ?? definition.nodeName,
    })
  }
  return [...byValue.values()]
})

/**
 * Adds a slider for a picked parameter, its range around the parameter's value.
 *
 * @param {Object} entry
 */
function addDefinition(entry) {
  const node = nodesById.value.get(entry.nodeId)
  const row = node?.data?.variables?.find((candidate) => candidate.name === entry.rowName)
  if (!node || !row) return
  emit('update:scanConfig', putSlider(props.scanConfig, createSliderDefinition(node, row, props.getGlobalConstant)))
}

/**
 * Changes a slider's range, on every definition sharing its value, keeping their places in the list.
 *
 * @param {Object} row
 * @param {Object} change
 */
function updateDefinition(row, change) {
  const keys = new Set(row.keys)
  const selections = definitions.value.map((definition) => (keys.has(definition.key) ? { ...definition, ...change } : definition))
  emit('update:scanConfig', { ...props.scanConfig, selections })
}

/**
 * Removes a slider, with every definition sharing its value.
 *
 * @param {Object} row
 */
function removeRow(row) {
  emit('update:scanConfig', row.keys.reduce((config, key) => removeSlider(config, key), props.scanConfig))
}
</script>

<style scoped>
.slider-definitions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.definitions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.definitions-table th,
.definitions-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--p-content-border-color);
  text-align: left;
  vertical-align: middle;
}

.definitions-table thead th {
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.definitions-table td {
  width: 7rem;
}

.definition-path {
  font-weight: 400;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 16rem;
}

.definition-component {
  color: var(--p-text-muted-color);
}

.definition-name {
  font-weight: 600;
}

.definition-units {
  margin-left: 6px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.definition--missing .definition-path {
  color: var(--p-orange-600);
}

/* Removing reads as removing, not as closing: a bin, red as the pointer reaches it. */
.remove-button:hover {
  color: var(--p-red-500);
}

.definitions-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
