<template>
  <div class="steady-state-setup">
    <div class="setup-head">
      <span class="setup-title">How this module runs at steady state</span>
      <InfoTip :text="ABOUT" label="About the steady state" />
      <span class="setup-head__spacer"></span>
      <i v-if="isPending" class="pi pi-spin pi-spinner" aria-label="Deriving"></i>
      <Button label="Use suggested" icon="pi pi-refresh" size="small" text :disabled="spec === null" @click="emit('reset')" />
    </div>

    <div v-if="suggestions.length > 1" class="setup-field">
      <label for="ss-cycle">Cycle</label>
      <Select
        inputId="ss-cycle"
        :modelValue="cycleIndex"
        :options="cycleOptions"
        optionLabel="label"
        optionValue="value"
        size="small"
        @update:modelValue="chooseCycle"
      />
    </div>

    <div class="setup-field">
      <label for="ss-states">
        Cycle states
        <InfoTip text="States whose amounts sum to a constant: the transporter's or enzyme's forms." />
      </label>
      <MultiSelect
        inputId="ss-states"
        :modelValue="effective?.cycleStates ?? []"
        :options="stateNames"
        display="chip"
        filter
        size="small"
        @update:modelValue="(value) => update('cycleStates', value)"
      />
    </div>

    <div class="setup-field">
      <label for="ss-fast">
        Fast reactions
        <InfoTip text="Rate constants of steps at rapid equilibrium, usually binding and release." />
      </label>
      <MultiSelect
        inputId="ss-fast"
        :modelValue="effective?.fast ?? []"
        :options="parameterNames"
        display="chip"
        filter
        size="small"
        placeholder="None"
        @update:modelValue="(value) => update('fast', value)"
      />
    </div>

    <div class="setup-field">
      <label for="ss-solutes">
        Held species
        <InfoTip text="The species the cycle moves, held constant while it is at steady state." />
      </label>
      <MultiSelect
        inputId="ss-solutes"
        :modelValue="effective?.solutes ?? suggestedSolutes"
        :options="heldOptions"
        display="chip"
        filter
        size="small"
        @update:modelValue="(value) => update('solutes', value)"
      />
    </div>

    <div class="setup-row">
      <div class="setup-field">
        <label for="ss-flux">Flux</label>
        <Select
          inputId="ss-flux"
          :modelValue="typeof effective?.flux === 'string' ? effective.flux : null"
          :options="variableNames"
          filter
          size="small"
          @update:modelValue="(value) => update('flux', value)"
        />
      </div>
      <div class="setup-field">
        <label for="ss-bracket">Bracket</label>
        <Select
          inputId="ss-bracket"
          :modelValue="effective?.bracket ?? 'auto'"
          :options="BRACKETS"
          optionLabel="label"
          optionValue="value"
          size="small"
          @update:modelValue="(value) => update('bracket', value === 'auto' ? undefined : value)"
        />
      </div>
      <div class="setup-field">
        <label for="ss-label">Label</label>
        <InputText
          id="ss-label"
          :modelValue="effective?.label ?? ''"
          size="small"
          placeholder="e.g. GLUT2"
          @change="(event) => update('label', event.target.value.trim() || undefined)"
        />
      </div>
    </div>

    <div class="setup-status">
      <Message v-if="checkMessage" :severity="checkMessage.severity" size="small" variant="simple" :closable="false">
        {{ checkMessage.text }}
      </Message>
      <span class="setup-head__spacer"></span>
      <Button
        label="Create reduced module"
        icon="pi pi-plus"
        size="small"
        outlined
        :disabled="!canCreate"
        v-tooltip.top="'Adds this steady state to the module library as a module of its own, whose equations can be edited'"
        @click="emit('create')"
      />
    </div>

    <dl v-if="common" class="setup-summary">
      <dt>Form</dt>
      <dd>{{ common.bracket }}{{ common.concentrations ? ', in concentrations' : '' }}</dd>
      <template v-if="common.z !== null">
        <dt>Net charge z</dt>
        <dd>{{ common.z }}{{ common.potential ? ` (membrane potential ${common.potential})` : '' }}</dd>
      </template>
      <dt>Lumped parameters</dt>
      <dd>{{ common.lumped.join(', ') }}</dd>
    </dl>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'

import InfoTip from '../simulation/InfoTip.vue'

const props = defineProps({
  /** The user's spec, or null for the first cycle found. */
  spec: { type: Object, default: null },
  /** The latest analysis from useSteadyState. */
  analysis: { type: Object, default: null },
  isPending: { type: Boolean, default: false },
  /** The module's parameter rows. */
  rows: { type: Array, default: () => [] },
  /** Whether a module can be created from the steady state now. */
  canCreate: { type: Boolean, default: false },
})
const emit = defineEmits(['update:spec', 'reset', 'create'])

const ABOUT =
  'The cycle’s states are replaced by one flux, v = κ/Φ·{…}. Switch an instance to it with Kinetics above. These ' +
  'settings are the module’s, so every instance of it at steady state uses them.'

const BRACKETS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'difference', label: 'Difference' },
  { value: 'ratio', label: 'Ratio' },
]

const suggestions = computed(() => props.analysis?.suggestions ?? [])
const effective = computed(() => props.spec ?? props.analysis?.spec ?? null)
const common = computed(() => props.analysis?.common ?? null)

const stateNames = computed(() => props.rows.filter((row) => row.stateRole === 'state').map((row) => row.name))
const parameterNames = computed(() =>
  props.rows.filter((row) => row.type !== 'variable').map((row) => row.name)
)
const variableNames = computed(() => props.rows.map((row) => row.name))
const heldOptions = computed(() => [...stateNames.value, ...parameterNames.value])

const suggestedSolutes = computed(() => {
  const states = effective.value?.cycleStates ?? []
  return suggestions.value.find((s) => s.spec.cycleStates.every((q) => states.includes(q)))?.solutes ?? []
})

const cycleOptions = computed(() =>
  suggestions.value.map((s, i) => ({ value: i, label: `${s.spec.cycleStates.length} states: ${s.spec.cycleStates.join(', ')}` }))
)
const cycleIndex = computed(() => {
  const states = effective.value?.cycleStates ?? []
  const index = suggestions.value.findIndex((s) => s.spec.cycleStates.length === states.length && s.spec.cycleStates.every((q) => states.includes(q)))
  return index < 0 ? null : index
})

function chooseCycle(index) {
  const chosen = suggestions.value[index]
  if (chosen) emit('update:spec', { ...chosen.spec })
}

function update(field, value) {
  const next = { ...(effective.value ?? { cycleStates: [], flux: '' }), [field]: value }
  if (value === undefined || (Array.isArray(value) && value.length === 0 && field !== 'cycleStates')) delete next[field]
  emit('update:spec', next)
}

const checkMessage = computed(() => {
  const error = props.analysis?.verifyError
  if (error === null || error === undefined) return null
  return error < 1e-4
    ? { severity: 'success', text: 'Checked numerically against the full cycle.' }
    : { severity: 'warn', text: `Differs from a numeric solve of the full cycle by up to ${(error * 100).toPrecision(2)}%.` }
})
</script>

<style scoped>
/* Scrolls within the tab, so a short screen reaches every field */
.steady-state-setup {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 100%;
  min-height: 0;
  padding: 0.5rem 0.75rem;
  overflow-y: auto;
}

.setup-head,
.setup-status {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.setup-status :deep(.p-message) {
  min-width: 0;
}

.setup-status :deep(.p-button) {
  flex: none;
  white-space: nowrap;
}

.setup-title {
  font-weight: 600;
  font-size: 0.875rem;
}

.setup-head__spacer {
  flex: 1;
}

.setup-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.setup-field label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 600;
  font-size: 0.8125rem;
}

.setup-row {
  display: flex;
  gap: 0.5rem;
}

.setup-summary {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.125rem 0.75rem;
  margin: 0;
  font-size: 0.8125rem;
}

.setup-summary dt {
  font-weight: 600;
}

.setup-summary dd {
  margin: 0;
  word-break: break-word;
}
</style>
