<template>
  <div class="steady-state-setup">
    <p class="setup-intro">
      How this module runs at steady state: its cycle's states replaced by one flux, <code>v = κ/Φ·{…}</code>. Switch
      an instance to it with <strong>Kinetics</strong> above. These settings are the module's, so every instance of it
      at steady state uses them.
    </p>

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
      <label for="ss-states">Cycle states</label>
      <MultiSelect
        inputId="ss-states"
        :modelValue="effective?.cycleStates ?? []"
        :options="stateNames"
        display="chip"
        filter
        size="small"
        @update:modelValue="(value) => update('cycleStates', value)"
      />
      <small>States whose amounts sum to a constant: the transporter or enzyme's forms.</small>
    </div>

    <div class="setup-field">
      <label for="ss-fast">Fast reactions</label>
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
      <small>Rate constants of steps at rapid equilibrium, usually binding and release.</small>
    </div>

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
      <label for="ss-solutes">Held species</label>
      <MultiSelect
        inputId="ss-solutes"
        :modelValue="effective?.solutes ?? suggestedSolutes"
        :options="heldOptions"
        display="chip"
        filter
        size="small"
        @update:modelValue="(value) => update('solutes', value)"
      />
      <small>The species the cycle moves, held constant while it is at steady state.</small>
    </div>

    <div class="setup-row">
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

    <div class="setup-actions">
      <Button label="Use suggested" icon="pi pi-refresh" size="small" text :disabled="spec === null" @click="emit('reset')" />
      <Button
        label="Create reduced module"
        icon="pi pi-plus"
        size="small"
        outlined
        :disabled="!canCreate"
        v-tooltip.top="'Adds this steady state to the module library as a module of its own, whose equations can be edited'"
        @click="emit('create')"
      />
      <i v-if="isPending" class="pi pi-spin pi-spinner" aria-label="Deriving"></i>
    </div>

    <Message v-if="checkMessage" :severity="checkMessage.severity" size="small" :closable="false">
      {{ checkMessage.text }}
    </Message>

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
.steady-state-setup {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  overflow-y: auto;
}

.setup-intro {
  margin: 0;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}

.setup-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.setup-field label {
  font-weight: 600;
  font-size: 0.875rem;
}

.setup-field small {
  color: var(--p-text-muted-color);
}

.setup-row {
  display: flex;
  gap: 0.75rem;
}

.setup-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.setup-summary {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 0.75rem;
  margin: 0;
  font-size: 0.875rem;
}

.setup-summary dt {
  font-weight: 600;
}

.setup-summary dd {
  margin: 0;
  word-break: break-word;
}
</style>
