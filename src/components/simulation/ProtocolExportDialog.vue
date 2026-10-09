<template>
  <Dialog
    :visible="visible"
    header="Export the protocol"
    modal
    :style="{ width: 'min(820px, 94vw)' }"
    class="protocol-export-dialog"
    @update:visible="(isVisible) => !isVisible && exporter.close()"
  >
    <p class="export-intro">
      A zip with a Python script that runs the protocol with libcuflynx (circulatory_autogen) and plots the outputs its
      obs_data records, with the model it runs on.
    </p>

    <div v-if="isPreparing" class="export-preparing" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
      <span>Reading the model…</span>
    </div>

    <template v-else-if="prepared">
      <dl v-if="prepared.cellml" class="export-summary">
        <dt>Model</dt>
        <dd>{{ scopeLabel }}</dd>
        <dt>Experiments</dt>
        <dd>{{ experimentLabels.join(', ') }}</dd>
        <dt>Solver</dt>
        <dd>{{ solverLabel }}</dd>
        <dt>Files</dt>
        <dd class="export-files">{{ files.join(', ') }}</dd>
      </dl>

      <div v-if="errors.length || warnings.length" class="messages" role="status">
        <Message v-for="message in errors" :key="`error:${message}`" severity="error" size="small">{{ message }}</Message>
        <Message v-for="message in warnings" :key="`warning:${message}`" severity="warn" size="small">{{ message }}</Message>
      </div>

      <section v-if="prepared.cellml" class="export-section" aria-labelledby="export-feature-plots-heading">
        <h4 id="export-feature-plots-heading">Feature plots</h4>
        <p class="section-hint">
          The script plots each feature against the experiments, and draws the protocol's own feature plots, as PhLynx
          shows them after a run. Add or change them under Outputs in the protocol editor (Edit the protocol).
        </p>
        <ul v-if="predictionPlots.length" class="feature-plots">
          <li v-for="(plot, p) in predictionPlots" :key="p" class="feature-plot">
            <span class="plot-name">{{ plot.name || '(unnamed)' }}</span>
            <span class="plot-pairing">{{ [plot.pairing, plot.series].filter(Boolean).join(', ') }}</span>
            <!-- Why, among the warnings above, which the bundle's README lists too. -->
            <span v-if="plot.errors.length" class="plot-skipped">skipped, as the warning above says</span>
          </li>
        </ul>
        <p v-else class="section-hint">The protocol has no feature plots of its own.</p>
      </section>
    </template>

    <template #footer>
      <Button label="Cancel" text severity="secondary" @click="exporter.close()" />
      <Button label="Export ZIP" icon="pi pi-download" :disabled="!canExport" :loading="isExporting" @click="exporter.exportZip()" />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Exports the protocol with a Python script that runs it and plots its outputs: a summary of what it holds, what to
 * know before running it, and the feature plots it draws. The outputs and feature plots themselves are the obs_data's
 * prediction_items and prediction_plots, edited under Outputs in the protocol editor.
 */
import { computed } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import { nameExperiment } from '@physiomelinks/protocol-kit'

import { useProtocolStore } from '../../stores/protocolStore'

const props = defineProps({
  // From useProtocolExport.
  exporter: { type: Object, required: true },
})

const { visible, isPreparing, isExporting, prepared, errors, warnings, predictionPlots, solverInfo, files, canExport } = props.exporter
const protocolStore = useProtocolStore()

const experimentLabels = computed(() => (protocolStore.view?.experiments ?? []).map((experiment, index) => experiment.label ?? nameExperiment(index)))

const scopeLabel = computed(() => {
  const count = prepared.value?.scope?.nodes?.length ?? 0
  const instances = `${count} ${count === 1 ? 'instance' : 'instances'}`
  return prepared.value?.scopeNodeIds ? `The selection: ${instances}` : `The whole model: ${instances}`
})
const solverLabel = computed(() => {
  const { MaximumStep, rtol, atol } = solverInfo.value
  const unit = prepared.value?.voi?.unit ?? ''
  return [
    'CVODE',
    ...(rtol != null ? [`tolerances ${rtol} (relative), ${atol} (absolute)`] : []),
    ...(MaximumStep != null ? [`largest step ${MaximumStep}`] : []),
    ...(prepared.value?.settings?.pointInterval ? [`a point every ${prepared.value.settings.pointInterval} ${unit}`.trim()] : []),
  ].join(' · ')
})
</script>

<style scoped>
.export-intro,
.section-hint {
  margin: 0 0 8px;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.export-preparing {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  color: var(--p-text-muted-color);
}

.export-summary {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 12px;
  margin: 0 0 12px;
  font-size: 0.8125rem;
}

.export-summary dt {
  color: var(--p-text-muted-color);
}

.export-summary dd {
  margin: 0;
}

.export-files {
  overflow-wrap: anywhere;
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.export-section {
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid var(--p-content-border-color);
}

.export-section h4 {
  margin: 0 0 8px;
  font-size: 0.875rem;
}

.feature-plots {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.8125rem;
}

.feature-plot {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--p-content-border-color);
}

.plot-name {
  font-weight: 600;
}

.plot-pairing {
  color: var(--p-text-muted-color);
}

.plot-skipped {
  color: var(--p-orange-600, #c2410c);
}
</style>
