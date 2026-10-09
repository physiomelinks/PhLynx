<template>
  <section class="protocol-editor">
    <div v-if="!protocolInfo" class="protocol-empty">
      <i class="pi pi-sliders-h empty-icon" aria-hidden="true"></i>
      <h3>Run the model as experiments</h3>
      <p>
        A protocol is a set of experiments. Each runs the model through sub-experiments in turn, setting parameters to
        numbers, steps, pulses, pacing, ramps or recorded traces.
      </p>
      <Button label="Create a protocol" icon="pi pi-plus" @click="emitDocument(ensureProtocol(document))" />
    </div>

    <div v-else class="protocol-layout">
      <nav class="experiment-rail" aria-label="Experiments">
        <h4 class="rail-heading">Experiments</h4>
        <ul class="rail-list">
          <li v-for="(item, index) in view.experiments" :key="index" class="rail-entry" :class="{ 'rail-entry--active': index === current }">
            <button type="button" class="rail-item" :aria-label="nameOf(item, index)" :aria-pressed="index === current" @click="selected = index">
              <span class="swatch" :style="{ background: colourOf(item, index) }" aria-hidden="true"></span>
              <span class="rail-text">
                <span class="rail-name">{{ nameOf(item, index) }}</span>
                <span class="rail-meta">{{ formatNumber(item.duration) }} s in {{ countLabel(item.subs.length) }}</span>
              </span>
            </button>
            <Button
              icon="pi pi-ellipsis-h"
              text
              rounded
              size="small"
              severity="secondary"
              class="rail-more"
              :aria-label="`More for ${nameOf(item, index)}`"
              @click="(event) => openExperimentMenu(event, index)"
            />
          </li>
        </ul>
        <Button label="Add experiment" icon="pi pi-plus" text size="small" class="rail-add" v-tooltip.bottom="'A new experiment, each parameter at its value in the model. Duplicate one from its menu.'" @click="addFreshExperiment" />
        <Menu ref="experimentMenu" :model="experimentMenuItems" popup />
      </nav>

      <div class="experiment-main">
        <InputText
          :key="`name-${current}`"
          :model-value="experiment.label ?? ''"
          :placeholder="nameExperiment(current)"
          size="small"
          class="experiment-name"
          v-tooltip.bottom="'Rename the experiment'"
          aria-label="Experiment name"
          @change="(event) => edit(setTiming, { experiment: current, label: event.target.value })"
        />

        <div v-if="validation.errors.length || validation.warnings.length" class="messages" role="status">
          <Message v-for="message in validation.errors" :key="message" severity="error" size="small">{{ message }}</Message>
          <Message v-for="message in validation.warnings" :key="message" severity="warn" size="small">{{ message }}</Message>
        </div>

        <div class="timeline-scroll">
          <div class="timeline" :style="{ gridTemplateColumns: columns }">
            <div class="column-head warm-up-head" :class="{ 'warm-up-head--none': !(experiment.preTime > 0) }">
              <span class="column-title" v-tooltip.bottom="'Run first, unplotted, to let the model settle'">Warm-up</span>
              <InlineNumber
                :model-value="experiment.preTime"
                :min="0"
                suffix=" s"
                aria-label="Warm-up"
                @update:model-value="(value) => edit(setTiming, { experiment: current, preTime: value })"
              />
            </div>
            <div v-for="(sub, s) in experiment.subs" :key="`head-${s}`" class="column-head">
              <span class="column-title" :title="`Sub-experiment ${s + 1}`">{{ s + 1 }}</span>
              <InlineNumber
                :model-value="sub.duration"
                :min="0"
                is-min-excluded
                suffix=" s"
                :aria-label="`Sub-experiment ${s + 1} length`"
                @update:model-value="(value) => edit(setTiming, { experiment: current, sub: s, duration: value })"
              />
              <span class="column-spacer"></span>
              <!-- Always there, so a heading is as tall with one sub-experiment as with several; hidden for the last. -->
              <Button
                icon="pi pi-times"
                text
                rounded
                size="small"
                severity="secondary"
                class="column-remove"
                :class="{ 'column-remove--none': experiment.subs.length < 2 }"
                :disabled="experiment.subs.length < 2"
                :aria-hidden="experiment.subs.length < 2"
                :aria-label="`Remove sub-experiment ${s + 1}`"
                @click="removeSub(s)"
              />
            </div>
            <div class="column-add">
              <Button icon="pi pi-plus" text rounded size="small" aria-label="Add a sub-experiment" v-tooltip.bottom="'Add a sub-experiment'" @click="edit(addSubExperiment, current)" />
            </div>

            <template v-for="lane in lanes" :key="lane.parameter">
              <!-- The lane's name, above it across the whole timeline, so the lane keeps the width. -->
              <div class="lane-label" :title="lane.parameter">
                <span class="lane-path"><span class="lane-component">{{ lane.component }}/</span>{{ lane.name }}</span>
                <span class="lane-units">{{ lane.units }}</span>
                <span v-if="lane.range" class="lane-range">{{ lane.range }}</span>
              </div>
              <div class="lane-cell lane-cell--warm-up" aria-hidden="true">
                <svg v-if="lane.warmUp" class="lane-plot" viewBox="0 0 100 40" preserveAspectRatio="none">
                  <polyline :points="lane.warmUp" :stroke="colour" />
                </svg>
              </div>
              <div
                v-for="cell in lane.cells"
                :key="cell.sub"
                class="lane-cell"
                :class="{
                  'lane-cell--early': cell.isEarly,
                  'lane-cell--clash': cell.isClash,
                  'lane-cell--error': cell.error,
                  'lane-cell--open': isEditing(lane.parameter, cell.sub),
                }"
              >
                <button
                  type="button"
                  class="lane-hit"
                  :aria-label="`Change how ${lane.parameter} varies in sub-experiment ${cell.sub + 1}`"
                  :title="cell.note ?? `${cell.description}. Click to edit.`"
                  @click="(event) => openCell(event.currentTarget.parentElement, lane.parameter, cell.cell, cell.sub)"
                ></button>
                <svg v-if="cell.points" class="lane-plot" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                  <polyline :points="cell.points" :stroke="colour" />
                </svg>
                <button
                  type="button"
                  class="kind-chip"
                  aria-haspopup="menu"
                  :aria-label="`How ${lane.parameter} varies in sub-experiment ${cell.sub + 1}: ${cell.kind.label}`"
                  :title="cell.note ?? cell.description"
                  @click="(event) => openKindMenu(event, lane.parameter, cell)"
                >
                  <i v-if="cell.note" class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                  <svg class="kind-glyph" viewBox="0 0 16 10" aria-hidden="true"><polyline :points="cell.kind.glyph" /></svg>
                  <span>{{ cell.caption }}</span>
                  <i class="pi pi-chevron-down kind-caret" aria-hidden="true"></i>
                </button>
              </div>
              <div class="lane-end">
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  :aria-label="`Stop setting ${lane.parameter}`"
                  v-tooltip.left="'Stop setting it'"
                  @click="confirmRemovingParameter(lane.parameter)"
                />
              </div>
            </template>
          </div>
        </div>

        <!-- As Add slider and Add plot are: the search shows when asked for, and tucks away after a pick. -->
        <div v-if="isAddingParameter" ref="parameterPickerEl" class="add-parameter">
          <VariablePathPicker
            :index="index"
            :filter="(entry) => entry.slidable && !setParameters.has(entry.path)"
            placeholder="Search for a parameter to set…"
            aria-label="Add a parameter for the protocol to set"
            @pick="addPicked"
          />
          <Button
            icon="pi pi-times"
            text
            rounded
            size="small"
            severity="secondary"
            aria-label="Close the parameter search"
            @click="isAddingParameter = false"
          />
        </div>
        <Button v-else label="Add parameter to set" icon="pi pi-plus" text size="small" class="add-parameter-button" @click="startAddingParameter" />
        <p v-if="!lanes.length" class="lanes-empty">Add a parameter for the experiments to set, such as a stimulus current or a conductance.</p>

      </div>
    </div>

    <Menu ref="kindMenu" :model="kindMenuItems" popup>
      <template #item="{ item, props: itemProps }">
        <a v-bind="itemProps.action" class="kind-item" :class="{ 'kind-item--current': item.isCurrent }">
          <svg class="kind-glyph" viewBox="0 0 16 10" aria-hidden="true"><polyline :points="item.glyph" /></svg>
          <span>{{ item.label }}</span>
          <i v-if="item.isCurrent" class="pi pi-check kind-check" aria-hidden="true"></i>
        </a>
      </template>
    </Menu>

    <Popover ref="cellPopover" @hide="editing = null">
      <ProtocolCellEditor
        v-if="editing"
        :key="editing.key"
        :parameter="editing.parameter"
        :sub="editing.sub"
        :cell="editing.cell"
        :initial-kind="editing.kind"
        :duration="editing.duration"
        :traces="protocolInfo?.protocol_traces ?? {}"
        :units="editing.units"
        :colour="colour"
        :pre-time="experiment?.preTime ?? 0"
        :can-align="!!editing && isEarly(editing.cell, editing.sub)"
        :previous-end="editing.previousEnd"
        @apply="applyCell"
        @align="alignCell"
        @cancel="cellPopover.hide()"
      />
    </Popover>
  </section>
</template>

<script setup>
/**
 * Edits a protocol as circulatory autogen and CUFLynx write it, in an obs_data document. Its experiments are listed
 * beside a timeline of the one shown: a column for the warm-up and for each sub-experiment, as wide as it is long,
 * and a lane for each parameter drawing how it varies. A segment opens the editor of how it varies there.
 */
import { computed, nextTick, ref } from 'vue'

import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Menu from 'primevue/menu'
import Message from 'primevue/message'
import Popover from 'primevue/popover'

import InlineNumber from './InlineNumber.vue'
import ProtocolCellEditor from './ProtocolCellEditor.vue'
import { INPUT_KINDS, findInputKind } from './protocolKinds'
import VariablePathPicker from './VariablePathPicker.vue'
import { useConfirmDialog } from '../../composables/useConfirmDialog'
import { readObsDataParts } from '../../services/protocol/obsDataDocument'
import { findCircAutogenLimits } from '../../services/protocol/protocolCompatibility'
import {
  addEmptyExperiment,
  addExperiment,
  addParameter,
  addSubExperiment,
  alignWithWarmUp,
  ensureProtocol,
  findEndValue,
  findObservationsAt,
  moveExperiment,
  removeExperiment,
  removeParameter,
  removeSubExperiment,
  setInput,
  setTiming,
  setValue,
} from '../../services/protocol/protocolEditing'
import { changesDuringWarmUp, nameExperiment, readProtocolInfo } from '../../services/protocol/protocolModel'
import { findValueRange, sampleInput, writePolylinePoints } from '../../services/protocol/protocolPreview'
import { validateProtocolInfo } from '../../services/protocol/protocolValidation'
import { resolveExperimentColour } from '../../services/simulation/seriesSlots'
import { buildVariableIndex } from '../../services/simulation/variableIndex'

const BOX = { width: 100, height: 40, inset: 2 }

const props = defineProps({
  // The obs_data document, or null when the workspace has none.
  document: { type: [Object, Array], default: null },
  nodes: { type: Array, default: () => [] },
  getGlobalConstant: { type: Function, required: true },
})
const emit = defineEmits(['update:document'])
const { confirm } = useConfirmDialog()

const selected = ref(0)
const index = computed(() => buildVariableIndex(props.nodes))
const unitsByPath = computed(() => new Map(index.value.map((entry) => [entry.path, entry.units])))
const protocolInfo = computed(() => (props.document ? readObsDataParts(props.document).protocolInfo : null))
const validation = computed(() => {
  if (!protocolInfo.value) return { errors: [], warnings: [] }
  const checked = validateProtocolInfo(protocolInfo.value)
  // What CUFLynx couldn't run, though PhLynx can.
  return checked.protocolInfo ? { ...checked, warnings: [...checked.warnings, ...findCircAutogenLimits(readProtocolInfo(checked.protocolInfo))] } : checked
})
// Shown as written while it has errors CA would refuse, so it stays editable.
const view = computed(() => readProtocolInfo(validation.value.protocolInfo ?? withDefaults(protocolInfo.value)))
// The experiment shown, kept within the experiments while an edit adding or removing one comes back.
const current = computed(() => Math.min(selected.value, view.value.experiments.length - 1))
const experiment = computed(() => view.value.experiments[current.value])
const colour = computed(() => colourOf(experiment.value, current.value))
const setParameters = computed(() => new Set(view.value.controls.map(({ parameter }) => parameter)))

// The warm-up, then each sub-experiment as wide as it is long, then the column to add one; lanes are named above.
const columns = computed(() => {
  // Shares of the space left, made to sum to 10: factors summing to less than 1 would leave some of it unused.
  const total = experiment.value.duration || 1
  const subs = experiment.value.subs.map(({ duration }) => `minmax(6rem, ${((10 * Math.max(duration, 0)) / total).toFixed(4)}fr)`)
  return ['7.5rem', ...subs, '2.5rem'].join(' ')
})

// The sub-experiments of the experiment shown in which more than one input changes over time, which CUFLynx can't run.
const clashingSubs = computed(
  () =>
    new Set(
      experiment.value.subs.map((_, s) => s).filter((s) => view.value.controls.filter(({ cells }) => cells[current.value][s].kind !== 'constant').length > 1)
    )
)

// Each parameter's lane: its input in the warm-up and in each sub-experiment, on one scale.
const lanes = computed(() =>
  view.value.controls.map(({ parameter, cells }) => {
    const { preTime, subs } = experiment.value
    const row = cells[current.value]
    // CA starts a first sub-experiment's input with the warm-up, so the warm-up shows its start.
    const windows = subs.map(({ duration }, s) => (s === 0 ? [preTime, preTime + duration] : [0, duration]))
    const samples = row.map((cell, s) => sampleInput(cell, ...windows[s]))
    const warmUp = preTime > 0 ? sampleInput(row[0], 0, preTime) : null
    const { low, high } = findValueRange([warmUp, ...samples])
    const draw = (sample, [from, to]) => sample && writePolylinePoints(sample, { from, to, low, high, ...BOX })
    const values = [warmUp, ...samples].flatMap((sample) => sample?.values ?? [])
    const [least, most] = values.length ? [Math.min(...values), Math.max(...values)] : []
    const separator = parameter.indexOf('/')
    return {
      parameter,
      component: parameter.slice(0, separator),
      name: parameter.slice(separator + 1),
      units: unitsByPath.value.get(parameter) ?? '',
      warmUp: warmUp && draw(warmUp, [0, preTime]),
      // The values it takes in this experiment, as its lane's scale.
      range: values.length ? (least === most ? formatNumber(least) : `${formatNumber(least)} to ${formatNumber(most)}`) : '',
      cells: row.map((cell, s) => {
        const early = isEarly(cell, s)
        const clash = clashingSubs.value.has(s) && cell.kind !== 'constant'
        return {
          sub: s,
          cell,
          points: draw(samples[s], windows[s]),
          caption: captionOf(cell),
          kind: findInputKind(cell),
          description: describeCell(cell),
          isEarly: early,
          isClash: clash,
          error: cell.error ?? null,
          // What's wrong with it, if anything, first what CA refuses.
          note: cell.error
            ? `Circulatory autogen refuses this: ${cell.error}`
            : clash
              ? "CUFLynx can't run this: it follows only one input changing over time in each sub-experiment."
              : early
                ? 'Starts with the warm-up, as circulatory autogen runs it.'
                : null,
        }
      }),
    }
  })
)

/**
 * Fills in what readProtocolInfo needs of a protocol CA would refuse, so it can still be shown.
 *
 * @param {Object} info
 * @returns {Object}
 */
function withDefaults(info) {
  const simTimes = Array.isArray(info.sim_times) ? info.sim_times.map((subs) => (Array.isArray(subs) && subs.length ? subs : [1])) : [[1]]
  const rows = (matrix) => simTimes.map((subs, e) => subs.map((_, s) => matrix?.[e]?.[s] ?? 0))
  return {
    ...info,
    sim_times: simTimes,
    pre_times: simTimes.map((_, e) => info.pre_times?.[e] ?? 0),
    params_to_change: Object.fromEntries(Object.entries(info.params_to_change ?? {}).map(([parameter, matrix]) => [parameter, rows(matrix)])),
    // Kept, so a shape CA would refuse affects only its own segment (see readProtocolInfo).
    protocol_shapes: info.protocol_shapes ?? {},
    protocol_traces: info.protocol_traces ?? {},
  }
}

/**
 * Formats a number shortly, for captions.
 *
 * @param {number} value
 * @returns {string}
 */
const formatNumber = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(4))) : '–')

/**
 * Counts an experiment's sub-experiments, shortly.
 *
 * @param {number} count
 * @returns {string}
 */
const countLabel = (count) => `${count} ${count === 1 ? 'part' : 'parts'}`

/**
 * Names an experiment, as its label or its place.
 *
 * @param {{label: string|null}} item
 * @param {number} position
 * @returns {string}
 */
const nameOf = (item, position) => item.label ?? nameExperiment(position)

/**
 * Colours an experiment as its file does, or by its place.
 *
 * @param {{colour: string|null}} item
 * @param {number} position
 * @returns {string}
 */
function colourOf(item, position) {
  return resolveExperimentColour(item?.colour, position)
}

/**
 * Captions a segment: its number, or its kind of input with its levels.
 *
 * @param {Object} cell
 * @returns {string}
 */
function captionOf(cell) {
  const form = cell.form
  if (cell.kind === 'constant') return formatNumber(cell.value)
  if (cell.kind === 'trace') return 'Trace'
  if (!form) return 'Pacing'
  if (form.type === 'step') return `Step ${formatNumber(form.baseline)}→${formatNumber(form.level)}`
  if (form.type === 'ramp') return `Ramp ${formatNumber(form.from)}→${formatNumber(form.to)}`
  return `${form.type === 'pulse' ? 'Pulse' : 'Pacing'} ${formatNumber(form.level)}`
}

/**
 * Describes an input in full, for its tooltip.
 *
 * @param {Object} cell
 * @returns {string}
 */
function describeCell(cell) {
  const form = cell.form
  if (cell.kind === 'constant') return String(cell.value)
  if (cell.kind === 'trace') return cell.trace ? `A trace of ${cell.trace.t.length} points` : `The trace ${cell.name}, which the file lacks`
  if (!form) return `Pacing of several events (${cell.name})`
  if (form.type === 'ramp') return `A ramp from ${form.from} to ${form.to}`
  if (form.type === 'step') return `A step from ${form.baseline} to ${form.level} at ${form.start} s`
  if (form.type === 'pulse') return `A pulse of ${form.level} from ${form.start} s to ${form.end} s, else ${form.baseline}`
  return `Pacing at ${form.level} for ${form.length} s every ${form.period} s, else ${form.baseline}`
}

/**
 * Whether an input starts with the warm-up, as CA runs a first sub-experiment's, so it runs earlier than written.
 *
 * @param {Object} cell
 * @param {number} sub
 * @returns {boolean}
 */
function isEarly(cell, sub) {
  if (sub !== 0 || !(experiment.value.preTime > 0)) return false
  try {
    return changesDuringWarmUp(cell, experiment.value.preTime, experiment.value.subs[0].duration)
  } catch {
    return false
  }
}

/** Passes an edited document on. */
const emitDocument = (document) => emit('update:document', document)

/**
 * Applies an edit to the document.
 *
 * @param {Function} change - From protocolEditing.
 * @param {...*} args
 */
const edit = (change, ...args) => emitDocument(change(props.document, ...args))

/** Adds a copy of the experiment shown, and shows it. */
function addExperimentCopy() {
  edit(addExperiment, current.value)
  selected.value = view.value.experiments.length
}

/** Adds an experiment afresh, each parameter at its value in the model, and shows it. */
function addFreshExperiment() {
  const values = new Map(view.value.controls.map(({ parameter }) => [parameter, findModelValue(parameter)]))
  // As long as the experiment shown starts, so its time scale suits the model.
  edit(addEmptyExperiment, { duration: experiment.value.subs[0].duration, values })
  selected.value = view.value.experiments.length
}

/**
 * Finds a parameter's value in the model, as its node or global constant has it.
 *
 * @param {string} parameter - `instance/variable`.
 * @returns {number|undefined}
 */
function findModelValue(parameter) {
  const entry = index.value.find((candidate) => candidate.path === parameter)
  const row = entry && props.nodes.find((node) => node.id === entry.nodeId)?.data?.variables?.find((candidate) => candidate.name === entry.rowName)
  const raw = row?.type === 'global_constant' ? props.getGlobalConstant(row.name)?.value : row?.value
  return Number.isFinite(Number(raw)) && String(raw ?? '').trim() !== '' ? Number(raw) : undefined
}

const experimentMenu = ref(null)
const menuExperiment = ref(0)
const experimentMenuItems = computed(() => [
  { label: 'Duplicate', icon: 'pi pi-copy', command: () => ((selected.value = menuExperiment.value), addExperimentCopy()) },
  { label: 'Move up', icon: 'pi pi-arrow-up', disabled: menuExperiment.value === 0, command: () => moveExperimentBy(menuExperiment.value, -1) },
  {
    label: 'Move down',
    icon: 'pi pi-arrow-down',
    disabled: menuExperiment.value === view.value.experiments.length - 1,
    command: () => moveExperimentBy(menuExperiment.value, 1),
  },
  { separator: true },
  { label: 'Delete', icon: 'pi pi-trash', disabled: view.value.experiments.length < 2, command: () => removeExperimentAt(menuExperiment.value) },
])

/**
 * Opens an experiment's menu.
 *
 * @param {MouseEvent} event
 * @param {number} position
 */
function openExperimentMenu(event, position) {
  menuExperiment.value = position
  experimentMenu.value.toggle(event)
}

/**
 * Moves an experiment one place, still showing it.
 *
 * @param {number} position
 * @param {number} step - -1 or 1.
 */
function moveExperimentBy(position, step) {
  edit(moveExperiment, position, position + step)
  selected.value = position + step
}

/**
 * Asks before removing something observations refer to.
 *
 * @param {string[]} observations
 * @param {string} what
 * @returns {Promise<boolean>}
 */
async function confirmRemoving(observations, what) {
  if (!observations.length) return true
  return confirm({
    header: `Remove ${what}?`,
    message: `${observations.length === 1 ? 'An observation refers' : `${observations.length} observations refer`} to it (${observations.join(', ')}), and would be removed with it.`,
    severity: 'warning',
    acceptLabel: 'Remove',
    rejectLabel: 'Keep',
  })
}

/**
 * Removes an experiment, once confirmed when observations refer to it.
 *
 * @param {number} position
 */
async function removeExperimentAt(position) {
  if (!(await confirmRemoving(findObservationsAt(props.document, position), nameOf(view.value.experiments[position], position)))) return
  edit(removeExperiment, position)
}

/**
 * Removes a sub-experiment of the experiment shown, once confirmed when observations refer to it.
 *
 * @param {number} sub
 */
async function removeSub(sub) {
  if (!(await confirmRemoving(findObservationsAt(props.document, current.value, sub), `sub-experiment ${sub + 1}`))) return
  edit(removeSubExperiment, current.value, sub)
}

/**
 * Stops setting a parameter, once confirmed, as it goes from every experiment.
 *
 * @param {string} parameter
 */
async function confirmRemovingParameter(parameter) {
  const isConfirmed = await confirm({
    header: `Stop setting ${parameter}?`,
    message: 'The protocol stops setting it in every experiment. Undo brings it back.',
    severity: 'warning',
    acceptLabel: 'Stop setting it',
    rejectLabel: 'Keep',
  })
  if (isConfirmed) edit(removeParameter, parameter)
}

const parameterPickerEl = ref(null)
// The parameter search opens from its button, never on its own.
const isAddingParameter = ref(false)

/** Shows the parameter search and puts the cursor in it. */
async function startAddingParameter() {
  isAddingParameter.value = true
  await nextTick()
  parameterPickerEl.value?.querySelector('input')?.focus()
}

/**
 * Has the protocol set a picked parameter, from its value in the model, and tucks the search away.
 *
 * @param {Object} entry - From the variable index.
 */
function addPicked(entry) {
  isAddingParameter.value = false
  edit(addParameter, entry.path, findModelValue(entry.path) ?? 0)
}

const cellPopover = ref(null)
// The segment being edited: `{ key, parameter, cell, sub, duration, units }`.
const editing = ref(null)
let editCount = 0

/**
 * Whether a segment's editor is open.
 *
 * @param {string} parameter
 * @param {number} sub
 * @returns {boolean}
 */
const isEditing = (parameter, sub) => editing.value?.parameter === parameter && editing.value?.sub === sub

/**
 * Finds the value a parameter ended the sub-experiment before on, as CA runs it, to carry on from.
 *
 * @param {string} parameter
 * @param {number} sub
 * @returns {number|null} Null for the first sub-experiment.
 */
function findPreviousEnd(parameter, sub) {
  if (sub === 0) return null
  const { preTime, subs } = experiment.value
  // The first sub-experiment's clock starts with the warm-up.
  const end = (sub - 1 === 0 ? preTime : 0) + subs[sub - 1].duration
  return findEndValue(protocolInfo.value, protocolInfo.value.params_to_change[parameter][current.value][sub - 1], end)
}

const kindMenu = ref(null)
// The segment whose kind is being chosen: `{ anchor, parameter, cell, sub, kind }`.
const choosing = ref(null)
const kindMenuItems = computed(() =>
  INPUT_KINDS.map((kind) => ({
    ...kind,
    isCurrent: choosing.value?.kind === kind.value,
    command: () => {
      const { anchor, parameter, cell, sub } = choosing.value
      openCell(anchor, parameter, cell, sub, kind.value)
    },
  }))
)

/**
 * Opens the menu of kinds of input for a segment, below its chip.
 *
 * @param {MouseEvent} event
 * @param {string} parameter
 * @param {Object} segment - From the lane: `{ cell, sub, kind }`.
 */
function openKindMenu(event, parameter, { cell, sub, kind }) {
  choosing.value = { anchor: event.currentTarget.parentElement, parameter, cell, sub, kind: kind.value }
  kindMenu.value.toggle(event)
}

/**
 * Opens the editor of how a parameter varies in a sub-experiment, below its segment.
 *
 * @param {HTMLElement} anchor - The segment.
 * @param {string} parameter
 * @param {Object} cell
 * @param {number} sub
 * @param {string} [kind] - The kind of input to start the editor on, when not the cell's own.
 */
function openCell(anchor, parameter, cell, sub, kind = null) {
  const units = unitsByPath.value.get(parameter) ?? ''
  editing.value = { key: ++editCount, parameter, cell, sub, kind, duration: experiment.value.subs[sub].duration, units, previousEnd: findPreviousEnd(parameter, sub) }
  // Once the click is over, or it closes the popover again.
  setTimeout(() => cellPopover.value?.show({ currentTarget: anchor }, anchor), 0)
}

/**
 * Applies the segment editor's change: a number, a shape, a trace, or a trace the file has.
 *
 * @param {{value?: number, shape?: Object, trace?: Object, traceName?: string}} change
 */
function applyCell({ value, shape, trace, traceName }) {
  const { parameter, sub } = editing.value
  const where = { parameter, experiment: current.value, sub }
  if (shape || trace) edit(setInput, { ...where, shape, trace })
  else edit(setValue, { ...where, value: traceName ?? value })
  cellPopover.value.hide()
}

/** Starts the edited input with its sub-experiment rather than with the warm-up. */
function alignCell() {
  const { parameter, cell } = editing.value
  edit(alignWithWarmUp, { parameter, experiment: current.value, ...(cell.kind === 'shape' ? { shape: cell.shape } : { trace: cell.trace }) })
  cellPopover.value.hide()
}
</script>

<style scoped>
.protocol-editor {
  --lane-height: 3.25rem;
  --hatch: color-mix(in srgb, var(--p-text-muted-color) 14%, transparent);
}

.protocol-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 34rem;
  margin: 24px auto;
  text-align: center;
  color: var(--p-text-muted-color);
}

.protocol-empty h3 {
  margin: 0;
  color: var(--p-text-color);
}

.protocol-empty p {
  margin: 0 0 6px;
  line-height: 1.5;
}

.empty-icon {
  font-size: 1.75rem;
  color: var(--p-primary-color);
}

.protocol-layout {
  display: grid;
  grid-template-columns: 13rem minmax(0, 1fr);
  gap: 18px;
  min-height: 22rem;
}

.experiment-rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 14px;
  border-right: 1px solid var(--p-content-border-color);
}

.rail-heading {
  margin: 0 0 4px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
}

.rail-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rail-entry {
  display: flex;
  align-items: center;
  border-radius: 8px;
}

.rail-entry:hover {
  background: var(--p-content-hover-background);
}

.rail-entry--active {
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}

.rail-item {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.swatch {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.rail-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.rail-name {
  overflow: hidden;
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-meta {
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-more {
  opacity: 0;
}

.rail-entry:hover .rail-more,
.rail-entry--active .rail-more,
.rail-more:focus-visible {
  opacity: 1;
}

.rail-add {
  align-self: flex-start;
}

.experiment-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.experiment-name {
  align-self: flex-start;
  min-width: 14rem;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  font-size: 0.95rem;
  font-weight: 600;
}

.experiment-name:hover,
.experiment-name:focus {
  border-color: var(--p-inputtext-border-color);
}

.timeline-scroll {
  overflow-x: auto;
}

.timeline {
  display: grid;
  width: 100%;
  column-gap: 2px;
  row-gap: 4px;
  font-size: 0.8125rem;
}

.column-head {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px 4px 4px 8px;
  border-radius: 8px 8px 0 0;
  background: var(--p-content-hover-background);
}

.column-spacer {
  flex: 1;
}

.warm-up-head {
  background: repeating-linear-gradient(135deg, var(--hatch) 0 6px, transparent 6px 12px);
}

.warm-up-head--none {
  opacity: 0.7;
}

.column-title {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.column-remove {
  opacity: 0;
}

.column-head:hover .column-remove,
.column-remove:focus-visible {
  opacity: 1;
}

.column-remove--none {
  visibility: hidden;
}

.column-add {
  display: flex;
  align-items: center;
  justify-content: center;
}

.lane-label {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  /* Close to its own lane below, apart from the lane above. */
  margin: 10px 0 -3px 2px;
}

.lane-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lane-component {
  color: var(--p-text-muted-color);
}

.lane-units {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.lane-end {
  display: flex;
  align-items: center;
  justify-content: center;
}

.lane-cell {
  position: relative;
  height: var(--lane-height);
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: color-mix(in srgb, var(--p-content-hover-background) 60%, transparent);
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
}

.lane-cell:hover,
.lane-cell--open {
  border-color: color-mix(in srgb, var(--p-primary-color) 60%, transparent);
}

.lane-cell--warm-up {
  cursor: default;
  background: repeating-linear-gradient(135deg, var(--hatch) 0 6px, transparent 6px 12px);
}

.lane-cell--early,
.lane-cell--clash {
  border-color: var(--p-orange-400);
  border-style: dashed;
}

.lane-cell--error {
  border-color: var(--p-red-500);
  border-style: solid;
}

.lane-range {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--p-text-muted-color);
}

.lane-range::before {
  content: '· ';
}

.lane-plot {
  pointer-events: none;
  position: absolute;
  top: 20px;
  right: 2px;
  bottom: 6px;
  left: 2px;
  width: calc(100% - 4px);
  height: calc(100% - 26px);
}



.lane-plot polyline {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.lane-hit {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.lane-hit:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
  border-radius: 6px;
}

.kind-chip {
  position: absolute;
  top: 3px;
  left: 4px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 8px);
  padding: 1px 5px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 999px;
  background: var(--p-content-background);
  color: inherit;
  font: inherit;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
}

.kind-chip:hover,
.kind-chip:focus-visible {
  border-color: var(--p-primary-color);
}

.kind-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.kind-chip .pi-exclamation-triangle {
  font-size: 0.7rem;
  color: var(--p-orange-500);
}

.kind-caret {
  font-size: 0.55rem;
  color: var(--p-text-muted-color);
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

.kind-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kind-item--current {
  font-weight: 600;
}

.kind-check {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--p-primary-color);
}

.add-parameter {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 28rem;
}

.add-parameter > :first-child {
  flex: 1;
  min-width: 0;
}

.add-parameter-button {
  align-self: flex-start;
}

.lanes-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
