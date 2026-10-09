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
          The script plots each feature against the experiments. Here, plot one against another feature or a protocol
          input too, such as a current's peak against the voltage it was clamped at: a point per experiment.
        </p>
        <p v-if="!featureGroups.length" class="section-hint">
          The protocol records no features. To plot them here, add prediction_items with an operation to its obs_data
          file, by hand or in CUFLynx.
        </p>
        <div v-for="(plot, p) in featurePlots" :key="p" class="feature-plot" role="group" :aria-label="`Feature plot ${p + 1}`">
          <div class="plot-line">
            <InputText v-model="plot.title" size="small" placeholder="Title" :aria-label="`Feature plot ${p + 1} title`" class="plot-title" />
            <Button
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="secondary"
              :aria-label="`Remove feature plot ${p + 1}`"
              @click="featurePlots.splice(p, 1)"
            />
          </div>
          <div class="plot-line">
            <span class="axis-label">y</span>
            <Select
              v-model="plot.y"
              :options="featureNames"
              size="small"
              placeholder="Feature"
              :invalid="isInvalid(p, 'y')"
              :aria-label="`Feature plot ${p + 1} y`"
              class="plot-select"
            />
          </div>
          <div class="plot-line">
            <span class="axis-label">x</span>
            <SelectButton
              :model-value="plot.x.kind"
              :options="X_KINDS"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              size="small"
              :aria-label="`Feature plot ${p + 1} x`"
              @update:model-value="(kind) => (plot.x = createX(kind))"
            />
            <Select
              v-if="plot.x.kind === 'feature'"
              v-model="plot.x.feature"
              :options="featureNames"
              size="small"
              placeholder="Feature"
              :invalid="isInvalid(p, 'x.feature')"
              :aria-label="`Feature plot ${p + 1} x feature`"
              class="plot-select"
            />
            <template v-else-if="plot.x.kind === 'input'">
              <Select
                v-model="plot.x.input"
                :options="inputNames"
                size="small"
                placeholder="Input"
                :invalid="isInvalid(p, 'x.input', 'x')"
                :aria-label="`Feature plot ${p + 1} x input`"
                class="plot-select"
              />
              <Select
                v-model="plot.x.subexperiment"
                :options="subOptions"
                option-label="label"
                option-value="value"
                size="small"
                :invalid="isInvalid(p, 'x.subexperiment', 'x')"
                :aria-label="`Feature plot ${p + 1} x sub-experiment`"
              />
            </template>
          </div>
          <div class="plot-line">
            <ToggleSwitch
              :model-value="!!plot.series"
              :input-id="`export-series-${p}`"
              @update:model-value="(isOn) => (plot.series = isOn ? { input: inputNames[0] ?? null, subexperiment: 0 } : null)"
            />
            <label :for="`export-series-${p}`">A line per value of</label>
            <template v-if="plot.series">
              <Select
                v-model="plot.series.input"
                :options="inputNames"
                size="small"
                placeholder="Input"
                :invalid="isInvalid(p, 'series.input', 'series')"
                :aria-label="`Feature plot ${p + 1} series input`"
                class="plot-select"
              />
              <Select
                v-model="plot.series.subexperiment"
                :options="subOptions"
                option-label="label"
                option-value="value"
                size="small"
                :invalid="isInvalid(p, 'series.subexperiment', 'series')"
                :aria-label="`Feature plot ${p + 1} series sub-experiment`"
              />
            </template>
          </div>
          <Message v-for="error in errorsAt(p)" :key="`${error.path}:${error.message}`" severity="error" size="small">{{ error.message }}</Message>
        </div>
        <Button label="Add feature plot" icon="pi pi-plus" text size="small" :disabled="!featureGroups.length" @click="addFeaturePlot" />
        <div v-if="otherErrors.length" class="messages" role="status">
          <Message v-for="error in otherErrors" :key="`${error.path}:${error.message}`" severity="error" size="small">{{ error.message }}</Message>
        </div>
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
 * know before running it, and plots of the obs_data's features against each other, a protocol input or the experiment.
 * The outputs themselves are the obs_data's prediction_items, written by hand or in CUFLynx.
 */
import { computed } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'
import { nameExperiment } from '@physiomelinks/protocol-kit'

import { useProtocolStore } from '../../stores/protocolStore'

const X_KINDS = [
  { label: 'Feature', value: 'feature' },
  { label: 'Protocol input', value: 'input' },
  { label: 'Experiment', value: 'experiment' },
]

const props = defineProps({
  // From useProtocolExport.
  exporter: { type: Object, required: true },
})

const { visible, isPreparing, isExporting, prepared, errors, warnings, featurePlots, plotErrors, featureGroups, solverInfo, files, canExport } =
  props.exporter
const protocolStore = useProtocolStore()

const experimentLabels = computed(() => (protocolStore.view?.experiments ?? []).map((experiment, index) => experiment.label ?? nameExperiment(index)))
const featureNames = computed(() => featureGroups.value.map(({ name }) => name))
const inputNames = computed(() => (protocolStore.view?.controls ?? []).map(({ parameter }) => parameter))
// Up to the most any experiment has, numbered from 1.
const subOptions = computed(() => {
  const count = Math.max(0, ...(protocolStore.view?.experiments ?? []).map(({ subs }) => subs.length))
  return Array.from({ length: count }, (_, s) => ({ label: `Sub-experiment ${s + 1}`, value: s }))
})

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

/**
 * Gives a feature plot's x of a kind, with the first choices filled in.
 *
 * @param {'feature'|'input'|'experiment'} kind
 * @returns {Object}
 */
function createX(kind) {
  if (kind === 'feature') return { kind, feature: featureNames.value[1] ?? featureNames.value[0] ?? null }
  if (kind === 'input') return { kind, input: inputNames.value[0] ?? null, subexperiment: 0 }
  return { kind }
}

/**
 * Adds a feature plot of the first feature against the next, else against the first protocol input, else against the
 * experiments, which features.png already plots.
 */
function addFeaturePlot() {
  const kind = featureNames.value.length > 1 ? 'feature' : inputNames.value.length ? 'input' : 'experiment'
  featurePlots.value.push({ title: '', y: featureNames.value[0] ?? null, x: createX(kind), series: null })
}

/**
 * Lists a feature plot's problems, to show in its row.
 *
 * @param {number} p - Its place.
 * @returns {Array<{path: string, message: string}>}
 */
const errorsAt = (p) => plotErrors.value.filter(({ path }) => path.startsWith(`featurePlots[${p}].`) || path === `featurePlots[${p}]`)

// The problems of no plot shown, as of one removed meanwhile.
const otherErrors = computed(() => plotErrors.value.filter(({ path }) => !featurePlots.value.some((_, p) => errorsAt(p).some((error) => error.path === path))))

/**
 * Whether one of a feature plot's fields has a problem.
 *
 * @param {number} p - Its place.
 * @param {...string} fields - Paths within the plot, such as `x.input`.
 * @returns {boolean}
 */
const isInvalid = (p, ...fields) => plotErrors.value.some(({ path }) => fields.some((field) => path === `featurePlots[${p}].${field}`))
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

.plot-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.8125rem;
}

.feature-plot {
  padding: 8px 0;
  border-bottom: 1px dashed var(--p-content-border-color);
}

.plot-title {
  flex: 1;
  min-width: 10rem;
}

.plot-select {
  min-width: 10rem;
}

.axis-label {
  width: 1rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}
</style>
