<template>
  <div v-if="isShown" class="protocol-results-controls" @mousedown.stop>
    <Select
      v-if="hasProtocolPicker"
      :model-value="protocolStore.activeProtocol?.location"
      :options="protocolStore.protocols"
      option-label="name"
      option-value="location"
      size="small"
      class="protocol-select"
      aria-label="Protocol to run"
      :disabled="resultsStore.status === 'running'"
      v-tooltip.bottom="'Protocol to run'"
      @update:model-value="runProtocol"
    >
      <!-- The protocol button's icon, to tell it from the experiment beside it. -->
      <template #value="{ value }">
        <span class="protocol-value">
          <i class="pi pi-list-check" aria-hidden="true"></i>
          <span class="protocol-name">{{ protocolStore.protocols.find(({ location }) => location === value)?.name }}</span>
        </span>
      </template>
    </Select>
    <Select
      v-if="withPicker && experimentOptions.length > 1"
      :model-value="protocolStore.activeExperiment"
      :options="experimentOptions"
      option-label="label"
      option-value="value"
      size="small"
      class="experiment-select"
      :class="{ 'experiment-select--shared': hasProtocolPicker }"
      aria-label="Experiment to show"
      @update:model-value="showExperiment"
    />
    <Button
      v-if="withInputs && hasInputs"
      icon="pi pi-sliders-h"
      label="Inputs"
      class="inputs-button"
      text
      size="small"
      :severity="protocolStore.isShowingInputs ? 'primary' : 'secondary'"
      :aria-pressed="protocolStore.isShowingInputs"
      aria-label="Show the values the protocol set"
      v-tooltip.bottom="protocolStore.isShowingInputs ? 'Hide the values the protocol set' : 'Show the values the protocol set, after the results'"
      @click="protocolStore.isShowingInputs = !protocolStore.isShowingInputs"
    />
  </div>
</template>

<script setup>
/**
 * The controls of a protocol run's results, wherever they are shown: which of the workspace's protocols runs, which
 * experiment is shown, or all of them at once, and whether the values the protocol set are plotted too. Choosing
 * another protocol asks for it to run at once, as switching to the protocol does.
 */
import { computed } from 'vue'

import Button from 'primevue/button'
import Select from 'primevue/select'

import { nameExperiment } from '../../services/protocol/protocolModel'
import { ALL_EXPERIMENTS, useProtocolStore } from '../../stores/protocolStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'

const props = defineProps({
  withProtocols: { type: Boolean, default: true },
  withPicker: { type: Boolean, default: true },
  withInputs: { type: Boolean, default: true },
})

const emit = defineEmits(['play'])

const protocolStore = useProtocolStore()
const resultsStore = useSimulationResultsStore()

// The protocol to run is chosen here once there are several, while play runs one.
const hasProtocolPicker = computed(() => props.withProtocols && protocolStore.isProtocolMode && protocolStore.protocols.length > 1)

// The experiments run, or, before the protocol's first run, those it has.
const experimentCount = computed(
  () => resultsStore.protocolResults?.experiments.length ?? (protocolStore.isProtocolMode ? protocolStore.view?.experiments.length ?? 0 : 0)
)
const hasInputs = computed(() => resultsStore.protocolResults != null && resultsStore.protocolInputs.size > 0)
const isShown = computed(() => hasProtocolPicker.value || (props.withPicker && experimentCount.value > 1) || (props.withInputs && hasInputs.value))
const experimentOptions = computed(() => {
  const experiments = Array.from({ length: experimentCount.value }, (_, index) => ({
    label: protocolStore.view?.experiments[index]?.label ?? nameExperiment(index),
    value: index,
  }))
  // Every experiment at once, to compare them on the same charts.
  return experiments.length > 1 ? [{ label: 'All experiments', value: ALL_EXPERIMENTS }, ...experiments] : experiments
})

/**
 * Shows another experiment's results, or all of them.
 *
 * @param {number} index
 */
function showExperiment(index) {
  protocolStore.setActiveExperiment(index)
  resultsStore.showExperiment(index)
}

/**
 * Makes another protocol the active one, and asks for it to run.
 *
 * @param {string} location
 */
function runProtocol(location) {
  if (location === protocolStore.activeProtocol?.location) return
  protocolStore.chooseProtocol(location)
  emit('play')
}
</script>

<style scoped>
.protocol-results-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.inputs-button {
  flex-shrink: 0;
}

.experiment-select {
  flex: 0 1 14rem;
  min-width: 6rem;
}

/* Beside the protocol, the two share the row evenly. */
.protocol-select,
.experiment-select--shared {
  flex: 1 1 auto;
  min-width: 6rem;
  max-width: 13rem;
}

.protocol-value {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.protocol-value .pi {
  flex-shrink: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.protocol-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

</style>
