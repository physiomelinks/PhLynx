<template>
  <Dialog
    :visible="visible"
    header="Export the protocol as SED-ML"
    modal
    :style="{ width: 'min(920px, 94vw)' }"
    class="protocol-sedml-dialog"
    @update:visible="(isVisible) => !isVisible && exporter.close()"
  >
    <p class="export-intro">
      A zip with the protocol as SED-ML, the model it runs on, and a Python script that runs it with Myokit and draws its
      plots.
    </p>

    <div v-if="isPreparing" class="export-preparing" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
      <span>Reading the model…</span>
    </div>

    <template v-else-if="prepared">
      <dl v-if="prepared.plan" class="export-summary">
        <dt>Model</dt>
        <dd>{{ scopeLabel }}</dd>
        <dt>Experiments</dt>
        <dd>{{ experimentLabels.join(', ') }}</dd>
        <dt>Solver</dt>
        <dd>{{ solverLabel }}</dd>
      </dl>

      <div v-if="errors.length || warnings.length" class="messages" role="status">
        <Message v-for="message in errors" :key="`error:${message}`" severity="error" size="small">{{ message }}</Message>
        <Message v-for="message in warnings" :key="`warning:${message}`" severity="warn" size="small">{{ message }}</Message>
      </div>

      <template v-if="prepared.plan">
        <section class="export-section" aria-labelledby="sedml-plots-heading">
          <h4 id="sedml-plots-heading">Plots</h4>
          <div class="toggle-row">
            <ToggleSwitch v-model="overlay" input-id="sedml-overlay" />
            <label for="sedml-overlay">Every experiment on the same plots</label>
          </div>
          <div class="toggle-row">
            <ToggleSwitch v-model="includeInputs" input-id="sedml-inputs" :disabled="!prepared.inputs?.size" />
            <label for="sedml-inputs">Plot the values the protocol sets</label>
          </div>
          <ul v-if="previewGroups.length" class="trace-preview" aria-label="What each plot shows">
            <li v-for="group in previewGroups" :key="group.id" class="trace-group">
              <span class="trace-group-name">{{ group.name }}</span>
              <span class="trace-list">{{ group.labels.join(', ') }}</span>
            </li>
          </ul>
          <p v-else class="section-hint">No variables are plotted. Add some to the results' plots first.</p>
          <p class="section-hint">As the results view plots them; change them there.</p>
        </section>

        <section class="export-section" aria-labelledby="sedml-features-heading">
          <h4 id="sedml-features-heading">Features</h4>
          <p class="section-hint">A number from each experiment: a variable reduced over one sub-experiment.</p>
          <div v-if="features.length" class="feature-table">
            <div class="feature-row feature-row--head" aria-hidden="true">
              <span>Name</span>
              <span>Operation</span>
              <span>Variable</span>
              <span>Sub-experiment</span>
              <span></span>
            </div>
            <div v-for="(feature, f) in features" :key="f" class="feature-row" role="group" :aria-label="`Feature ${f + 1}`">
              <InputText v-model="feature.name" size="small" :aria-label="`Feature ${f + 1} name`" />
              <Select
                v-model="feature.operation"
                :options="operationOptions"
                option-label="label"
                option-value="value"
                size="small"
                :aria-label="`Feature ${f + 1} operation`"
              />
              <div class="feature-operand">
                <span v-if="feature.operand" class="operand-name" :title="feature.operand">{{ feature.operand }}</span>
                <VariablePathPicker
                  :index="operandIndex"
                  :placeholder="feature.operand ? 'Change the variable…' : 'Search for a variable…'"
                  :aria-label="`Feature ${f + 1} variable`"
                  @pick="(entry) => (feature.operand = entry.path)"
                />
              </div>
              <Select
                v-model="feature.subexperiment"
                :options="subOptions"
                option-label="label"
                option-value="value"
                size="small"
                :aria-label="`Feature ${f + 1} sub-experiment`"
              />
              <Button
                icon="pi pi-trash"
                text
                rounded
                size="small"
                severity="secondary"
                :aria-label="`Remove feature ${f + 1}`"
                @click="features.splice(f, 1)"
              />
            </div>
          </div>
          <Button label="Add feature" icon="pi pi-plus" text size="small" @click="addFeature" />
        </section>

        <section class="export-section" aria-labelledby="sedml-feature-plots-heading">
          <h4 id="sedml-feature-plots-heading">Feature plots</h4>
          <p class="section-hint">A point per experiment, such as a current against the voltage it was clamped at.</p>
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
                :aria-label="`Feature plot ${p + 1} x feature`"
                class="plot-select"
              />
              <template v-else-if="plot.x.kind === 'input'">
                <Select
                  v-model="plot.x.parameter"
                  :options="parameterNames"
                  size="small"
                  placeholder="Parameter"
                  :aria-label="`Feature plot ${p + 1} x parameter`"
                  class="plot-select"
                />
                <Select
                  v-model="plot.x.subexperiment"
                  :options="subOptions"
                  option-label="label"
                  option-value="value"
                  size="small"
                  :aria-label="`Feature plot ${p + 1} x sub-experiment`"
                />
              </template>
            </div>
            <div class="plot-line">
              <ToggleSwitch
                :model-value="!!plot.series"
                :input-id="`sedml-series-${p}`"
                @update:model-value="(isOn) => (plot.series = isOn ? { parameter: parameterNames[0] ?? null, subexperiment: 0 } : null)"
              />
              <label :for="`sedml-series-${p}`">A line per value of</label>
              <template v-if="plot.series">
                <Select
                  v-model="plot.series.parameter"
                  :options="parameterNames"
                  size="small"
                  placeholder="Parameter"
                  :aria-label="`Feature plot ${p + 1} series parameter`"
                  class="plot-select"
                />
                <Select
                  v-model="plot.series.subexperiment"
                  :options="subOptions"
                  option-label="label"
                  option-value="value"
                  size="small"
                  :aria-label="`Feature plot ${p + 1} series sub-experiment`"
                />
              </template>
            </div>
          </div>
          <Button label="Add feature plot" icon="pi pi-plus" text size="small" :disabled="!features.length" @click="addFeaturePlot" />
          <div v-if="featureErrors.length" class="messages" role="status">
            <Message v-for="error in featureErrors" :key="`${error.path}:${error.message}`" severity="error" size="small">{{ error.message }}</Message>
          </div>
        </section>
      </template>
    </template>

    <template #footer>
      <Button label="Cancel" text severity="secondary" @click="exporter.close()" />
      <Button label="Export ZIP" icon="pi pi-download" :disabled="!canExport" :loading="isExporting" @click="exporter.exportZip()" />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Exports the protocol as SED-ML with a Python script that runs it: the plots as the results view has them, and
 * features (a number per experiment) with plots of them against each other, a protocol input or the experiment.
 */
import { computed } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'

import VariablePathPicker from './VariablePathPicker.vue'
import { countSharedSubexperiments, FEATURE_OPERATIONS } from '../../services/export/protocolSedml'
import { nameExperiment } from '../../services/protocol/protocolModel'
import { SOLVERS, resolveSolverSettings } from '../../services/simulation/sedParameters'
import { useProtocolStore } from '../../stores/protocolStore'

const OPERATION_LABELS = { mean: 'mean', min: 'min', max: 'max', max_minus_min: 'max − min' }
const X_KINDS = [
  { label: 'Feature', value: 'feature' },
  { label: 'Protocol input', value: 'input' },
  { label: 'Experiment', value: 'experiment' },
]

const props = defineProps({
  // From useProtocolSedmlExport.
  exporter: { type: Object, required: true },
})

const { visible, isPreparing, isExporting, prepared, errors, warnings, overlay, includeInputs, features, featurePlots, featureErrors, groups, traces, operands, canExport } =
  props.exporter
const protocolStore = useProtocolStore()

const operationOptions = FEATURE_OPERATIONS.map((value) => ({ label: OPERATION_LABELS[value] ?? value, value }))
const experimentLabels = computed(() => (protocolStore.view?.experiments ?? []).map((experiment, index) => experiment.label ?? nameExperiment(index)))
// The sub-experiments every experiment has, numbered from 1: the ones the export can take a number from.
const subOptions = computed(() =>
  Array.from({ length: countSharedSubexperiments(protocolStore.view) }, (_, s) => ({ label: `Sub-experiment ${s + 1}`, value: s }))
)
const parameterNames = computed(() => (protocolStore.view?.controls ?? []).map(({ parameter }) => parameter))
// Trimmed, as the export reads them.
const featureNames = computed(() => features.value.map(({ name }) => name?.trim()).filter(Boolean))

const scopeLabel = computed(() => {
  const count = prepared.value?.scope?.nodes?.length ?? 0
  const instances = `${count} ${count === 1 ? 'instance' : 'instances'}`
  return prepared.value?.scopeNodeIds ? `The selection: ${instances}` : `The whole model: ${instances}`
})
const solverLabel = computed(() => {
  const settings = prepared.value?.settings ?? {}
  const { solver, timeStep, tolerance, maxSteps } = resolveSolverSettings(settings)
  const details = SOLVERS[solver]?.isFixedStep
    ? [`step ${timeStep}`]
    : [`tolerance ${tolerance}`, `at most ${maxSteps} steps`, ...(timeStep > 0 ? [`largest step ${timeStep}`] : [])]
  return [SOLVERS[solver]?.label ?? solver, ...details, ...(settings.pointInterval ? [`a point every ${settings.pointInterval} ${prepared.value?.voi?.unit ?? ''}`.trim()] : [])].join(' · ')
})

// The variables a feature can reduce, as the variable search lists them.
const operandIndex = computed(() =>
  operands.value.map(({ name, kind, unit }) => {
    const separator = name.indexOf('/')
    return { key: name, path: name, component: name.slice(0, separator), name: name.slice(separator + 1), kind, units: unit, inScope: true }
  })
)

// Each plot's variables, in the order exported, the protocol's inputs first when asked for.
const previewGroups = computed(() => [
  ...(includeInputs.value && prepared.value?.inputs?.size ? [{ id: '__inputs__', name: 'Inputs', labels: [...prepared.value.inputs.keys()] }] : []),
  ...groups.value.map((group) => ({ ...group, labels: traces.value.filter(({ groupId }) => groupId === group.id).map(({ label }) => label) })),
])

/**
 * Gives a feature plot's x of a kind, with the first choices filled in.
 *
 * @param {'feature'|'input'|'experiment'} kind
 * @returns {Object}
 */
function createX(kind) {
  if (kind === 'feature') return { kind, feature: featureNames.value[0] ?? null }
  if (kind === 'input') return { kind, parameter: parameterNames.value[0] ?? null, subexperiment: 0 }
  return { kind }
}

/** Adds a feature, named so it can be told apart. */
function addFeature() {
  const names = new Set(featureNames.value)
  let number = features.value.length + 1
  while (names.has(`feature_${number}`)) number++
  features.value.push({ name: `feature_${number}`, operation: FEATURE_OPERATIONS[0], operand: null, subexperiment: 0 })
}

/** Adds a feature plot of the first feature against the experiments. */
function addFeaturePlot() {
  featurePlots.value.push({ title: '', y: featureNames.value[0] ?? null, x: createX('experiment'), series: null })
}
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

.toggle-row,
.plot-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.8125rem;
}

.trace-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0;
  padding: 0;
  list-style: none;
  font-size: 0.8125rem;
}

.trace-group {
  display: grid;
  grid-template-columns: 10rem minmax(0, 1fr);
  gap: 8px;
}

.trace-group-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-list {
  color: var(--p-text-muted-color);
}

.feature-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}

.feature-row {
  display: grid;
  grid-template-columns: 9rem 7.5rem minmax(0, 1fr) 10rem 2.5rem;
  align-items: start;
  gap: 8px;
}

.feature-row--head {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.feature-operand {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.operand-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 600;
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

/* Too narrow for a feature on one line: each control under the one before. */
@media (max-width: 720px) {
  .feature-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .feature-row--head {
    display: none;
  }
}
</style>
