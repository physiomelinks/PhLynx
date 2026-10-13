<template>
  <div v-if="isShown" class="protocol-results-controls" @mousedown.stop>
    <Select
      v-if="withPicker && experimentOptions.length > 1"
      :model-value="protocolStore.activeExperiment"
      :options="experimentOptions"
      option-label="label"
      option-value="value"
      size="small"
      class="experiment-select"
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
 * The controls of a protocol run's results, wherever they are shown: which experiment, or all of them at once, and
 * whether the values the protocol set are plotted too.
 */
import { computed } from 'vue'

import Button from 'primevue/button'
import Select from 'primevue/select'
import { nameExperiment } from '@physiomelinks/protocol-kit'

import { ALL_EXPERIMENTS, useProtocolStore } from '../../stores/protocolStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'

const props = defineProps({
  withPicker: { type: Boolean, default: true },
  withInputs: { type: Boolean, default: true },
})

const protocolStore = useProtocolStore()
const resultsStore = useSimulationResultsStore()

// The experiments run, or, before the protocol's first run, those it has.
const experimentCount = computed(
  () => resultsStore.protocolResults?.experiments.length ?? (protocolStore.isProtocolMode ? protocolStore.view?.experiments.length ?? 0 : 0)
)
const hasInputs = computed(() => resultsStore.protocolResults != null && resultsStore.protocolInputs.size > 0)
const isShown = computed(() => (props.withPicker && experimentCount.value > 1) || (props.withInputs && hasInputs.value))
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

</style>
