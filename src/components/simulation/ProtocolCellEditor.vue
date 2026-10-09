<template>
  <form class="cell-editor" @submit.prevent="apply">
    <header class="cell-header">
      <span class="cell-parameter">{{ parameter }}</span>
      <span class="cell-where">Sub-experiment {{ sub + 1 }} · {{ formatNumber(duration) }} s{{ units ? ` · ${units}` : '' }}</span>
    </header>

    <SelectButton v-model="kind" :options="INPUT_KINDS" option-label="label" option-value="value" size="small" :allow-empty="false" class="kind-picker" aria-label="How it varies">
      <template #option="{ option }">
        <svg class="kind-glyph" viewBox="0 0 16 10" aria-hidden="true"><polyline :points="option.glyph" /></svg>
        <span>{{ option.label }}</span>
      </template>
    </SelectButton>

    <div class="preview" :class="{ 'preview--problem': problem }">
      <svg v-if="preview" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <polyline :points="preview.points" :stroke="colour" />
      </svg>
      <span v-if="preview" class="preview-scale preview-scale--high">{{ formatNumber(preview.high) }}</span>
      <span v-if="preview" class="preview-scale preview-scale--low">{{ formatNumber(preview.low) }}</span>
      <span class="preview-time preview-time--start">0 s</span>
      <span class="preview-time preview-time--end">{{ formatNumber(duration) }} s</span>
    </div>

    <div v-if="kind === 'number'" class="cell-fields">
      <label>Value <NumberInput v-model="fields.value" :suffix="valueSuffix" aria-label="Value" autofocus /></label>
    </div>
    <div v-else-if="kind === 'trace'" class="cell-fields cell-fields--trace">
      <Select
        v-if="traceNames.length"
        v-model="traceName"
        :options="traceNames"
        placeholder="A trace in the file…"
        size="small"
        aria-label="A trace in the file"
        @update:model-value="importedTrace = null"
      />
      <label class="csv-button">
        <i class="pi pi-upload" aria-hidden="true"></i>
        Import a CSV of time and value
        <input type="file" accept=".csv,text/csv,text/plain" class="visually-hidden" @change="readCsv" />
      </label>
      <span v-if="importedTrace" class="subtle">{{ importedTrace.t.length }} points from {{ importedTrace.t[0] }} to {{ importedTrace.t.at(-1) }}</span>
    </div>
    <div v-else class="cell-fields">
      <label v-for="(field, position) in FORM_FIELDS[kind]" :key="field.key">
        {{ field.label }}
        <NumberInput
          v-model="fields[field.key]"
          :suffix="field.isTime ? ' s' : field.isValue ? valueSuffix : undefined"
          :aria-label="field.label"
          :autofocus="position === 0"
        />
      </label>
    </div>

    <Message v-if="problem" severity="error" size="small">{{ problem }}</Message>
    <p v-if="canContinue" class="continue-note">
      <Button
        :label="`Start from ${formatNumber(previousEnd)}, where sub-experiment ${sub} ended`"
        icon="pi pi-arrow-right"
        link
        size="small"
        @click="fields[startField] = previousEnd"
      />
    </p>

    <p v-if="canAlign" class="align-note">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
      Circulatory autogen starts this with the warm-up, so it runs {{ formatNumber(preTime) }} s earlier than written.
      <Button label="Start it with the sub-experiment" link size="small" @click="emit('align')" />
    </p>

    <div class="cell-actions">
      <Button label="Cancel" text size="small" severity="secondary" @click="emit('cancel')" />
      <Button type="submit" label="Apply" size="small" :disabled="!canApply" />
    </div>
  </form>
</template>

<script setup>
/**
 * Edits how a protocol's parameter varies over one sub-experiment: a number, a step, a pulse, pacing, a ramp, or a
 * trace from the file or a CSV, drawn as CA would run it as it is typed.
 */
import { computed, reactive, ref } from 'vue'
import Papa from 'papaparse'

import Button from 'primevue/button'
import Message from 'primevue/message'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'

import NumberInput from './NumberInput.vue'
import { INPUT_KINDS } from './protocolKinds'
import { buildShapeFromForm } from '../../services/protocol/protocolModel'
import { findValueRange, interpolateTrace, sampleInput, writePolylinePoints } from '../../services/protocol/protocolPreview'
import { expandShape, normaliseShape } from '../../services/protocol/protocolShapes'

// Each kind's fields: values, in the parameter's units, and times, in seconds.
const FORM_FIELDS = {
  step: [
    { key: 'baseline', label: 'Value before', isValue: true },
    { key: 'level', label: 'Value after', isValue: true },
    { key: 'start', label: 'Step time', min: 0, isTime: true },
  ],
  pulse: [
    { key: 'baseline', label: 'Baseline value', isValue: true },
    { key: 'level', label: 'Pulse value', isValue: true },
    { key: 'start', label: 'Pulse starts', min: 0, isTime: true },
    { key: 'end', label: 'Pulse ends', min: 0, isTime: true },
  ],
  pacing: [
    { key: 'baseline', label: 'Baseline value', isValue: true },
    { key: 'level', label: 'Beat value', isValue: true },
    { key: 'start', label: 'First beat', min: 0, isTime: true },
    { key: 'length', label: 'Beat duration', min: 0, isTime: true },
    { key: 'period', label: 'Beat period', min: 0, isTime: true },
    { key: 'multiplier', label: 'Beats (0: until the end)', min: 0 },
  ],
  ramp: [
    { key: 'from', label: 'Start value', isValue: true },
    { key: 'to', label: 'End value', isValue: true },
  ],
}

const props = defineProps({
  parameter: { type: String, required: true },
  sub: { type: Number, required: true },
  // The cell, from readProtocolInfo.
  cell: { type: Object, required: true },
  // The kind of input to start on, when not the cell's own, as chosen from its segment's menu.
  initialKind: { type: String, default: null },
  // The sub-experiment's length.
  duration: { type: Number, required: true },
  // The traces the file has, by name.
  traces: { type: Object, default: () => ({}) },
  units: { type: String, default: '' },
  colour: { type: String, default: 'currentColor' },
  // The experiment's warm-up, when this input starts with it.
  preTime: { type: Number, default: 0 },
  canAlign: { type: Boolean, default: false },
  // The value the sub-experiment before ended on, when there is one, to carry on from.
  previousEnd: { type: Number, default: null },
})
const emit = defineEmits(['apply', 'align', 'cancel'])

const form = props.cell.form
// A shape of several events has no simpler form, so it is pacing still.
const kind = ref(props.initialKind ?? (props.cell.kind === 'constant' ? 'number' : props.cell.kind === 'trace' ? 'trace' : form?.type ?? 'pacing'))
const own = readLevels(props.cell, props.duration)
// The level to move to, when the input has only one: double it, as CUFLynx does.
const otherLevel = own.end !== own.start ? own.end : own.start * 2 || 1
// Every kind's fields at once, so switching kinds keeps what was typed. A new kind keeps the levels the input has, a
// ramp's ends becoming a step's before and after, and a pulse's timing becoming a beat's.
const fields = reactive({
  value: props.cell.kind === 'constant' ? props.cell.value : own.end,
  baseline: form?.baseline ?? form?.from ?? own.start,
  level: form?.level ?? form?.to ?? otherLevel,
  start: form?.start ?? props.duration / 4,
  end: form?.end ?? (form?.length != null ? form.start + form.length : props.duration / 2),
  length: form?.length ?? (form?.end != null ? form.end - form.start : props.duration / 100),
  period: form?.period ?? props.duration / 10,
  multiplier: form?.multiplier ?? 0,
  from: form?.from ?? form?.baseline ?? own.start,
  to: form?.to ?? form?.level ?? otherLevel,
})
// The field a changing input starts from, which can carry on from the sub-experiment before.
const startField = computed(() => ({ step: 'baseline', pulse: 'baseline', pacing: 'baseline', ramp: 'from' })[kind.value] ?? null)
const canContinue = computed(() => props.previousEnd != null && startField.value && fields[startField.value] !== props.previousEnd)
const traceNames = computed(() => Object.keys(props.traces))
// Values are in the parameter's units, shown after them as times show seconds.
const valueSuffix = computed(() => (props.units && props.units !== 'dimensionless' ? ` ${props.units}` : undefined))
const traceName = ref(props.cell.kind === 'trace' ? props.cell.name : null)
const importedTrace = ref(null)
const csvProblem = ref('')

/**
 * Reads the levels an input starts and ends a sub-experiment on.
 *
 * @param {Object} cell - From readProtocolInfo.
 * @param {number} duration
 * @returns {{start: number, end: number}}
 */
function readLevels(cell, duration) {
  if (cell.kind === 'constant') return { start: cell.value, end: cell.value }
  const form = cell.form
  if (form?.type === 'ramp') return { start: form.from, end: form.to }
  if (form) return { start: form.baseline, end: form.level }
  if (cell.trace?.t?.length) return { start: cell.trace.values[0], end: interpolateTrace(cell.trace, duration) }
  return { start: 0, end: 0 }
}

/**
 * Formats a number shortly.
 *
 * @param {number} value
 * @returns {string}
 */
const formatNumber = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(4))) : '–')

// The edit as it stands: `{ value }`, `{ shape }` or a trace, with CA's reason when it would refuse it.
const draft = computed(() => {
  if (kind.value === 'number') return Number.isFinite(fields.value) ? { value: fields.value } : { problem: 'The value needs a number.' }
  if (kind.value === 'trace') {
    if (importedTrace.value) return { trace: importedTrace.value }
    if (traceName.value && props.traces[traceName.value]) return { traceName: traceName.value, preview: props.traces[traceName.value] }
    return { problem: csvProblem.value || null }
  }
  const late = findLateTime()
  if (late) return { problem: late }
  const shape = buildShapeFromForm({ type: kind.value, ...fields }, props.duration)
  try {
    return { shape, preview: expandShape(normaliseShape(shape, 'input'), props.duration, 'input') }
  } catch (error) {
    // CA's own words, less the name it gives the shape.
    return { problem: error.message.replace(/protocol_shapes\['input'\](\.events\[0\])?/g, 'The input') }
  }
})
const problem = computed(() => draft.value.problem ?? null)

/**
 * Finds a time the input is given that falls after its sub-experiment ends.
 *
 * @returns {string|null} Why it can't be, or null.
 */
function findLateTime() {
  const end = `the sub-experiment's end, at ${formatNumber(props.duration)} s`
  if (kind.value === 'step' && fields.start >= props.duration) return `The step comes at or after ${end}.`
  if (kind.value === 'pulse' && fields.start >= props.duration) return `The pulse starts at or after ${end}.`
  if (kind.value === 'pulse' && fields.end > props.duration) return `The pulse ends after ${end}.`
  if (kind.value === 'pacing' && fields.start >= props.duration) return `The first beat comes at or after ${end}.`
  return null
}
const canApply = computed(() => !draft.value.problem && Object.keys(draft.value).some((key) => ['value', 'shape', 'trace', 'traceName'].includes(key)))

// The input over the sub-experiment, as CA would run it.
const preview = computed(() => {
  const { value, preview: trace, trace: imported } = draft.value
  const cell = value !== undefined ? { kind: 'constant', value } : trace || imported ? { kind: 'trace', trace: trace ?? imported } : null
  const sample = cell && sampleInput(cell, 0, props.duration)
  if (!sample) return null
  const { low, high } = findValueRange([sample])
  return { low, high, points: writePolylinePoints(sample, { from: 0, to: props.duration, low, high, width: 100, height: 40 }) }
})

/**
 * Reads a CSV of times and values, with or without a header row, as a trace.
 *
 * @param {Event} event - The file input's change.
 */
async function readCsv(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const { data } = Papa.parse((await file.text()).trim(), { dynamicTyping: true, skipEmptyLines: true })
  const rows = data.filter((row) => Number.isFinite(row[0]) && Number.isFinite(row[1]))
  const isIncreasing = rows.every((row, i) => i === 0 || row[0] > rows[i - 1][0])
  if (rows.length < 2 || !isIncreasing) {
    importedTrace.value = null
    csvProblem.value = 'The file needs two columns, time and value, with at least two rows and times that only increase.'
    return
  }
  csvProblem.value = ''
  importedTrace.value = { t: rows.map((row) => row[0]), values: rows.map((row) => row[1]) }
  traceName.value = null
}

/** Applies the edit: `{value}`, `{shape}`, `{trace}` or `{traceName}`. */
function apply() {
  if (!canApply.value) return
  const { value, shape, trace, traceName: name } = draft.value
  emit('apply', shape ? { shape } : trace ? { trace } : name ? { traceName: name } : { value })
}
</script>

<style scoped>
.cell-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 34rem;
  max-width: 90vw;
}

.kind-picker {
  display: flex;
}

.kind-picker :deep(.p-togglebutton) {
  flex: 1;
}

.kind-picker :deep(.p-togglebutton) {
  min-width: 0;
  padding: 0.25rem 0.3rem;
}

.kind-picker :deep(.p-togglebutton-content) {
  gap: 4px;
  padding: 0.25rem 0.35rem;
  white-space: nowrap;
}

.kind-glyph {
  flex-shrink: 0;
  width: 16px;
  height: 10px;
}

.kind-glyph polyline {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.cell-header {
  display: flex;
  flex-direction: column;
}

.cell-parameter {
  font-weight: 600;
}

.cell-where {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.preview {
  position: relative;
  height: 5.5rem;
  border-radius: 6px;
  background: var(--p-content-hover-background);
}

.preview--problem {
  opacity: 0.45;
}

.preview svg {
  position: absolute;
  inset: 8px 8px 16px 44px;
  width: calc(100% - 52px);
  height: calc(100% - 24px);
}

.preview polyline {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.preview-scale,
.preview-time {
  position: absolute;
  font-size: 0.6875rem;
  color: var(--p-text-muted-color);
  font-variant-numeric: tabular-nums;
}

.preview-scale {
  left: 6px;
  width: 34px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-scale--high {
  top: 8px;
}

.preview-scale--low {
  bottom: 16px;
}

.preview-time {
  bottom: 1px;
}

.preview-time--start {
  left: 44px;
}

.preview-time--end {
  right: 8px;
}

.cell-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 8px;
}

.cell-fields label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.8125rem;
}

.cell-fields--trace {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.csv-button {
  cursor: pointer;
  color: var(--p-primary-color);
  flex-direction: row !important;
  align-items: center;
}

.subtle {
  color: var(--p-text-muted-color);
  font-size: 0.8125rem;
}

.continue-note {
  margin: 0;
}

.align-note {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.align-note .pi {
  color: var(--p-orange-500);
}

.cell-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
