<template>
  <section class="sweep-editor" aria-label="Parameter sweep">
    <div v-if="sweep" class="sweep-card" data-testid="sim-sweep-parameter">
      <div class="sweep-head">
        <span class="sweep-label" :title="label">
          <span class="sweep-component">{{ sweep.nodeName }}/</span><span class="sweep-name">{{ sweep.parameterName }}</span>
        </span>
        <span v-if="sweep.units" class="sweep-units">{{ sweep.units }}</span>
        <InfoTip :text="ABOUT" data-testid="sim-sweep-about" />
        <Button
          icon="pi pi-ellipsis-h"
          text
          rounded
          size="small"
          severity="secondary"
          :aria-label="`More for the ${sweep.parameterName} sweep`"
          aria-haspopup="true"
          @click="(event) => menu.toggle(event)"
        />
      </div>
      <div class="sweep-range">
        <div class="sweep-field">
          <label :for="`${id}-from`">From</label>
          <InputNumber
            :model-value="sweep.from"
            :input-id="`${id}-from`"
            :pt:pcInputText:root="{ 'data-testid': 'sim-sweep-from' }"
            :minFractionDigits="0"
            :maxFractionDigits="8"
            size="small"
            fluid
            @update:model-value="(from) => update({ from })"
          />
        </div>
        <div class="sweep-field">
          <label :for="`${id}-to`">To</label>
          <InputNumber
            :model-value="sweep.to"
            :input-id="`${id}-to`"
            :pt:pcInputText:root="{ 'data-testid': 'sim-sweep-to' }"
            :minFractionDigits="0"
            :maxFractionDigits="8"
            size="small"
            fluid
            @update:model-value="(to) => update({ to })"
          />
        </div>
        <div class="sweep-field">
          <label :for="`${id}-points`">Points</label>
          <InputNumber
            :model-value="sweep.points"
            :input-id="`${id}-points`"
            :pt:pcInputText:root="{ 'data-testid': 'sim-sweep-points' }"
            :min="2"
            :max="MAX_SWEEP_POINTS"
            :useGrouping="false"
            size="small"
            fluid
            @update:model-value="(points) => update({ points })"
          />
        </div>
      </div>
      <div v-if="sweep.family" class="sweep-family" data-testid="sim-sweep-family">
        <div class="sweep-head">
          <span class="sweep-label" :title="familyLabel">
            <span class="sweep-hint-inline">A curve for each value of </span><span class="sweep-component">{{ sweep.family.nodeName }}/</span
            ><span class="sweep-name">{{ sweep.family.parameterName }}</span>
          </span>
          <span v-if="sweep.family.units" class="sweep-units">{{ sweep.family.units }}</span>
          <Button
            icon="pi pi-ellipsis-h"
            text
            rounded
            size="small"
            severity="secondary"
            :aria-label="`More for the ${sweep.family.parameterName} curves`"
            aria-haspopup="true"
            @click="(event) => familyMenu.toggle(event)"
          />
        </div>
        <div class="sweep-field">
          <label :for="`${id}-family-values`">Values <span class="sweep-hint-inline">separated by commas</span></label>
          <InputText
            v-model="familyText"
            :id="`${id}-family-values`"
            data-testid="sim-sweep-family-values"
            :invalid="!!familyError"
            size="small"
            fluid
            @change="commitFamilyValues"
            @keydown.enter="commitFamilyValues"
          />
          <small v-if="familyError" class="sweep-error" role="alert">{{ familyError }}</small>
        </div>
      </div>
      <!-- Without ODEs, each value is solved once: there is no time course to read. -->
      <div v-if="!isSteadyState" class="sweep-field">
        <span class="sweep-field-label">
          <label :id="`${id}-readout`">Reading</label>
          <InfoTip v-if="hasHiddenTransient" :text="transientNote" data-testid="sim-sweep-transient" />
        </span>
        <SelectButton
          :model-value="readout"
          :options="READOUTS"
          option-label="label"
          option-value="id"
          :allow-empty="false"
          size="small"
          :aria-labelledby="`${id}-readout`"
          data-testid="sim-sweep-readout"
          @update:model-value="(value) => update({ readout: value })"
        >
          <template #option="{ option }"><span :title="option.description">{{ option.label }}</span></template>
        </SelectButton>
      </div>
      <p v-if="cost" class="sweep-hint" data-testid="sim-sweep-cost">{{ cost }}</p>
      <Message v-if="problem" severity="warn" size="small">{{ problem }}</Message>
      <Message v-else-if="isLong" severity="warn" size="small" data-testid="sim-sweep-long">
        That’s a lot of time courses: fewer points, or a larger point interval, make the sweep quicker.
      </Message>
    </div>

    <!-- Last, as Add slider is. The search shows when asked for, and tucks away after a pick. -->
    <div v-if="isAdding" ref="pickerEl" class="sweep-picker">
      <VariablePathPicker
        :index="index"
        :filter="(entry) => isSweepableEntry(entry, { unsupplied, ignored, variables: lastRunVariables, sweep })"
        :describe="describeSweepable"
        :placeholder="pickingFor === 'family' ? 'Vary a parameter across curves…' : sweep ? 'Sweep another parameter…' : 'Sweep a parameter…'"
        :aria-label="pickingFor === 'family' ? 'Choose a parameter for the curves' : 'Choose a parameter to sweep'"
        @pick="sweepEntry"
      />
      <Button
        icon="pi pi-times"
        text
        rounded
        size="small"
        severity="secondary"
        aria-label="Close the sweep search"
        @click="isAdding = false"
      />
    </div>
    <!-- The editor has no title of its own: the tab or the dialog names it, so what it does is told beside its button. -->
    <div v-else-if="!sweep" class="sweep-add">
      <Button label="Sweep a parameter" icon="pi pi-plus" text size="small" @click="startAdding" />
      <InfoTip :text="ABOUT" data-testid="sim-sweep-about" />
    </div>

    <Menu ref="menu" :model="menuItems" popup />
    <Menu ref="familyMenu" :model="familyMenuItems" popup />
  </section>
</template>

<script setup>
/**
 * The parameter sweep: one at a time, added from a search over the parameters a run can vary, with the
 * range it is solved over, what it reads from each time course, and perhaps a second parameter, a curve for each of
 * its values. Used by the Simulation tab, which saves each change, and by Simulation Settings,
 * which keeps it as a draft.
 */
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Menu from 'primevue/menu'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import SelectButton from 'primevue/selectbutton'

import InfoTip from './InfoTip.vue'
import VariablePathPicker from './VariablePathPicker.vue'
import { resolveBoundaryValues } from '../../services/export/boundaryValues'
import { resolveScope } from '../../services/simulation/scopedModel'
import {
  createFamily,
  createSweep,
  familyValues,
  findBoundarySweepProblem,
  findSweepProblem,
  isSweepableEntry,
  MAX_SWEEP_POINTS,
  scopeHasOde,
  sweepLabel,
  sweepReadout,
} from '../../services/simulation/sweep'
import { READOUTS } from '../../services/simulation/sweepReadouts'
import { buildVariableIndex } from '../../services/simulation/variableIndex'
import { useLibraryStore } from '../../stores/libraryStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'
import { FLOW_IDS } from '../../utils/constants'

const props = defineProps({
  // Every node in the workspace: any of their parameters can be swept.
  nodes: { type: Array, default: () => [] },
  // The nodes play simulates next, or null for all of them. A boundary condition connected only from outside them
  // uses its own value there, so it can be swept. Left out where the scope isn't known, as in Simulation Settings,
  // the editor goes by the whole model, but leaves the run to say if a connection supplies a boundary condition.
  playScopeNodeIds: { type: Array, default: undefined },
})
// The sweep, or null for none (see services/simulation/sweep.js).
const sweep = defineModel('sweep', { type: Object, default: null })

const libraryStore = useLibraryStore()
const resultsStore = useSimulationResultsStore()
const { edges } = useVueFlow(FLOW_IDS.MAIN)
const id = useId()

const label = computed(() => (sweep.value ? sweepLabel(sweep.value) : ''))
const familyLabel = computed(() => (sweep.value?.family ? sweepLabel(sweep.value.family) : ''))
// How many curves the family draws: one for a sweep without one.
const curveCount = computed(() => (sweep.value?.family ? Math.max(1, familyValues(sweep.value.family).length) : 1))
const settingsStore = useSimulationSettingsStore()

// What the header's info says: what a sweep does, how its reading works, and what an export makes of it.
const ABOUT =
  'Run the model at each value of one parameter, and plot against it: solved once each, or with differential ' +
  'equations, a time course each, read between the plots’ Start and End. Play runs it with the toolbar’s Sweep on. ' +
  'To step from a holding value and read the peak, use a protocol. Web OpenCOR can’t run sweeps, so an export solves ' +
  'or simulates the model once, at the parameter’s own value.'

const pickerEl = ref(null)
// The search opens from the Sweep a parameter button or a menu, never on its own.
const isAdding = ref(false)
// What a pick sets: the swept parameter, or the one its curves vary.
const pickingFor = ref('sweep')

// The instances play simulates next. With none selected, play can't run, so the editor goes by the whole model's.
const scopeIds = computed(() => (props.playScopeNodeIds?.length ? props.playScopeNodeIds : null))
const isLastRunThisScope = computed(() => JSON.stringify(resultsStore.scopeNodeIds ?? null) === JSON.stringify(scopeIds.value))
const isBoundarySweep = computed(() => [sweep.value, sweep.value?.family].some((target) => target?.type === 'boundary_condition'))
// The scope's nodes and the edges inside it: only what the picker or a boundary condition's sweep needs.
const scope = computed(() => (isAdding.value || isBoundarySweep.value ? resolveScope(scopeIds.value, props.nodes, edges.value) : null))
// The boundary conditions nothing connected in the scope supplies, whose own values a sweep can vary. For the whole
// model, this also leaves out what export ignores.
const boundaryValues = computed(() => (scope.value ? resolveBoundaryValues(scope.value.nodes, scope.value.internalEdges) : null))
const unsupplied = computed(() => boundaryValues.value?.unsupplied ?? new Set())
const ignored = computed(() => boundaryValues.value?.ignored ?? new Map())

// What stops the sweep from running: as the run would say, including a boundary condition the scope supplies.
const problem = computed(() => {
  if (!sweep.value) return null
  const found = findSweepProblem(sweep.value)
  if (found || !scope.value || props.playScopeNodeIds === undefined) return found
  return findBoundarySweepProblem(sweep.value, { nodes: scope.value.nodes, status: boundaryValues.value.status })
})

const readout = computed(() => sweepReadout(sweep.value))
const readoutLabel = computed(() => READOUTS.find(({ id }) => id === readout.value).label.toLowerCase())
// Without ODEs, each value is solved once rather than run as a time course: as the scope's math says, so an edit
// shows at once; while that isn't known, as the last run found, when it ran the scope play runs next; else with ODEs.
const isSteadyState = computed(() => {
  const nodes = props.nodes.filter((node) => !scopeIds.value || scopeIds.value.includes(node.id))
  const hasOde = scopeHasOde(nodes, libraryStore.getMathAnalysis)
  if (hasOde !== null) return !hasOde
  return !!(isLastRunThisScope.value && resultsStore.results?.isSteadyState)
})
// Past this many time courses, the sweep says it will be slow.
const LONG_SWEEP_RUNS = 200
const isLong = computed(() => !isSteadyState.value && Number.isInteger(sweep.value?.points) && sweep.value.points * curveCount.value > LONG_SWEEP_RUNS)

// How many solves or time courses the sweep runs, and about how long they take, going by the last run's.
const cost = computed(() => {
  const points = sweep.value?.points
  if (!Number.isInteger(points) || points < 2) return null
  const total = points * curveCount.value
  const count = curveCount.value > 1 ? `${points} × ${curveCount.value} = ${total}` : String(total)
  const runs = `${count} ${isSteadyState.value ? 'solves' : 'time courses'}`
  const results = resultsStore.results
  const solves = results?.isSweep ? results.voi.values.length * (results.family?.values.length ?? 1) : 1
  const perSolveMs = results && !results.isStopped && solves ? results.elapsedMs / solves : null
  if (!perSolveMs || results.isSteadyState !== isSteadyState.value) return `${runs}.`
  const seconds = (perSolveMs * total) / 1000
  return `${runs}, ${seconds < 1 ? 'under a second' : `about ${seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`}`}.`
})

// A time course that starts before the plots do, to settle, can't be read in its first moments, where a peak may be.
const hasHiddenTransient = computed(() => {
  const { initialPoint, startingPoint } = settingsStore.simulationSettings
  return !isSteadyState.value && readout.value !== 'end' && initialPoint < startingPoint
})
const transientNote = computed(
  () =>
    `Each time course starts at the initial time, before the plots’ Start, so a ${readoutLabel.value} in the first ` +
    'moments isn’t read. To read the peak after a step from a holding value, use a protocol.'
)

// The last run's variables, with their kinds, for the picker, when it ran the scope play runs next: another scope may
// supply a value through a connection this one cuts.
const lastRunVariables = computed(() => (isLastRunThisScope.value ? resultsStore.results?.variables : null))
// Given the last run's mapping, so the picker can leave out what that run computed (see isSweepableEntry).
const index = computed(() =>
  isAdding.value ? buildVariableIndex(props.nodes, { scopeNodeIds: resultsStore.scopeNodeIds, mapping: resultsStore.mapping }) : []
)

/**
 * Notes whether a parameter was in the last run, and what the model makes the same as it.
 *
 * @param {Object} entry
 * @returns {string|null}
 */
function describeSweepable(entry) {
  const notes = []
  if (!entry.inScope) notes.push('Not in the last run')
  if (entry.equivalents.length) notes.push(`≡ ${entry.equivalents.join(', ')}`)
  return notes.length ? notes.join(' · ') : null
}

/**
 * Shows the search and puts the cursor in it.
 *
 * @param {'sweep'|'family'} [target] - What the pick sets.
 */
async function startAdding(target = 'sweep') {
  pickingFor.value = target
  isAdding.value = true
  await nextTick()
  pickerEl.value?.querySelector('input')?.focus()
}

/**
 * Sweeps a picked parameter, over a range around its value, keeping the sweep's reading and curves; or varies it
 * across the curves, from its own value.
 *
 * @param {Object} entry - From the variable index.
 */
function sweepEntry(entry) {
  const node = props.nodes.find((candidate) => candidate.id === entry.nodeId)
  const row = node?.data?.variables?.find((candidate) => candidate.name === entry.rowName)
  if (!node || !row) return
  if (pickingFor.value === 'family') update({ family: createFamily(node, row, libraryStore.getGlobalConstant) })
  else {
    const { readout: kept, family } = sweep.value ?? {}
    sweep.value = { ...createSweep(node, row, libraryStore.getGlobalConstant), ...(kept && { readout: kept }), ...(family && { family }) }
  }
  isAdding.value = false
}

// The curves' values as typed, until they read as numbers.
const familyText = ref('')
const familyError = ref(null)
// Watched by content, as each save copies the values: a change elsewhere in the sweep keeps what is being typed.
watch(
  () => (sweep.value?.family?.values ?? []).join(', '),
  (text) => {
    familyText.value = text
    familyError.value = null
  },
  { immediate: true }
)

/** Reads the typed values as the curves', or says which isn't a number, keeping the curves as they were. */
function commitFamilyValues() {
  const tokens = familyText.value.split(/[\s,;]+/).filter(Boolean)
  const bad = tokens.find((token) => !Number.isFinite(Number(token)))
  if (bad) {
    familyError.value = `${bad} isn’t a number.`
    return
  }
  familyError.value = null
  const values = tokens.map(Number)
  if (values.join() !== (sweep.value.family.values ?? []).join()) update({ family: { ...sweep.value.family, values } })
}

/**
 * Changes the sweep's range, its reading, or its curves.
 *
 * @param {{from?: number, to?: number, points?: number, readout?: string, family?: Object}} patch
 */
function update(patch) {
  sweep.value = { ...sweep.value, ...patch }
}

const menu = ref(null)
const menuItems = computed(() => [
  { label: 'Change parameter…', icon: 'pi pi-search', command: () => startAdding('sweep') },
  ...(sweep.value?.family ? [] : [{ label: 'Add a curve for each value of…', icon: 'pi pi-clone', command: () => startAdding('family') }]),
  { separator: true },
  {
    label: 'Stop sweeping',
    icon: 'pi pi-trash',
    command: () => {
      sweep.value = null
      isAdding.value = false
    },
  },
])

const familyMenu = ref(null)
const familyMenuItems = [
  { label: 'Change parameter…', icon: 'pi pi-search', command: () => startAdding('family') },
  { separator: true },
  {
    label: 'Draw one curve',
    icon: 'pi pi-trash',
    command: () => {
      const { family: _family, ...rest } = sweep.value
      sweep.value = rest
    },
  },
]
</script>

<style scoped>
.sweep-editor {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sweep-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.sweep-field-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sweep-hint-inline {
  font-weight: 400;
}

.sweep-family {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 8px;
  border-left: 2px solid var(--p-content-border-color);
}

.sweep-error {
  font-size: 0.75rem;
  color: var(--p-red-500);
}

.sweep-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sweep-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 0.8125rem;
}

.sweep-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sweep-name {
  font-weight: 600;
  color: var(--p-text-color);
}

.sweep-component,
.sweep-units {
  color: var(--p-text-muted-color);
}

.sweep-units {
  flex-shrink: 0;
}

.sweep-range {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.sweep-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.sweep-field label,
.sweep-field-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.sweep-picker {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sweep-picker > :first-child {
  flex: 1;
  min-width: 0;
}

.sweep-add {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
}

/* Narrow: the range's fields stack. */
@container (max-width: 300px) {
  .sweep-range {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
