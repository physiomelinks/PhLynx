<template>
  <Dialog
    :visible="modelValue"
    header="Simulation Settings"
    modal
    :draggable="false"
    :dismissableMask="true"
    :style="{ width: '840px', height: '90vh' }"
    :appendTo="'body'"
    @update:visible="
      (visible) => {
        if (!visible) requestClose()
      }
    "
  >
    <Tabs v-model:value="activeTab" class="sim-settings-tabs">
      <TabList>
        <Tab value="plots">Plots</Tab>
        <Tab value="sliders">Sliders &amp; sweep</Tab>
        <Tab value="solver">Solver</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="plots" class="dialog-content">
          <section class="block">
            <div class="block-header">
              <h4>Plots</h4>
              <span class="subtle">Each plot shows variables in one unit, as in web OpenCOR.</span>
            </div>
            <!-- Opened by a plot's + or Add plot, for that plot; it stays open to add several. -->
            <div v-if="isAddingToPlot" ref="plotsSearchEl" class="plots-search">
              <VariablePathPicker
                :index="variableIndex"
                :filter="(entry) => entry.plottable"
                :describe="describePlotted"
                :placeholder="`Add a variable to ${plotNames.get(targetPlotId) ?? 'a new plot'}…`"
                aria-label="Add a variable to plot"
                @pick="plotEntry"
              />
              <Button
                icon="pi pi-times"
                text
                rounded
                size="small"
                severity="secondary"
                aria-label="Close the variable search"
                @click="isAddingToPlot = false"
              />
            </div>
            <p v-if="plotNote" class="plots-note" role="status">{{ plotNote }}</p>
            <p v-if="!plotOptions.length" class="plots-note">No plots yet.</p>
            <PlotListEditor
              v-model:target-plot-id="targetPlotId"
              v-model:plot-config="draftPlotConfig"
              :nodes="nodes"
              :index="variableIndex"
              class="plots-list"
              @add-here="focusPlotPicker"
            />
          </section>
        </TabPanel>
        <TabPanel value="sliders" class="dialog-content">
          <section class="block">
            <div class="block-header">
              <h4>Sliders</h4>
              <span class="subtle">Parameters to try out, with the ranges their sliders cover.</span>
            </div>
            <SliderDefinitionsEditor
              v-model:scan-config="draftScanConfig"
              :nodes="nodes"
              :get-global-constant="libraryStore.getGlobalConstant"
            />
          </section>
          <section class="block">
            <div class="block-header">
              <h4>Sweep</h4>
            </div>
            <SweepEditor v-model:sweep="localSimulationSettings.sweep" :nodes="nodes" />
          </section>
        </TabPanel>
        <TabPanel value="solver" class="dialog-content">
          <section class="block">
            <div class="block-header">
              <h4>Time course</h4>
              <span class="subtle">In seconds.</span>
            </div>
            <div class="settings-grid">
              <div class="field">
                <label for="sim-initial-point">Simulation starts at</label>
                <InputNumber
                  v-model="localSimulationSettings.initialPoint"
                  input-id="sim-initial-point"
                  :pt:pcInputText:root="{ 'data-testid': 'sim-initial-point' }"
                  suffix=" s"
                  :minFractionDigits="0"
                  :maxFractionDigits="8"
                  fluid
                />
                <small class="subtle">Where the solver starts, from the initial values.</small>
              </div>
              <div class="field">
                <label for="sim-starting-point">Plots start at</label>
                <InputNumber
                  v-model="localSimulationSettings.startingPoint"
                  input-id="sim-starting-point"
                  :pt:pcInputText:root="{ 'data-testid': 'sim-starting-point' }"
                  suffix=" s"
                  :minFractionDigits="0"
                  :maxFractionDigits="8"
                  fluid
                />
                <small class="subtle">Results before this are solved but not kept, so a model can settle first.</small>
              </div>
              <div class="field">
                <label for="sim-ending-point">Ends at</label>
                <InputNumber
                  v-model="localSimulationSettings.endingPoint"
                  input-id="sim-ending-point"
                  :pt:pcInputText:root="{ 'data-testid': 'sim-ending-point' }"
                  suffix=" s"
                  :minFractionDigits="0"
                  :maxFractionDigits="8"
                  fluid
                />
              </div>
              <div class="field">
                <label for="sim-point-interval">Point interval</label>
                <InputNumber
                  v-model="localSimulationSettings.pointInterval"
                  input-id="sim-point-interval"
                  :pt:pcInputText:root="{ 'data-testid': 'sim-point-interval' }"
                  suffix=" s"
                  :min="0"
                  :minFractionDigits="0"
                  :maxFractionDigits="8"
                  fluid
                />
                <small class="subtle">Time between the points kept.</small>
              </div>
            </div>
            <Message v-if="isSettling" severity="secondary" size="small" class="time-note">
              The model is solved from {{ localSimulationSettings.initialPoint }} s and plotted from {{ localSimulationSettings.startingPoint }} s.
              Web OpenCOR doesn’t support a later plot start, so an export may not match.
            </Message>
          </section>
          <section class="block">
            <div class="block-header">
              <h4>Solver</h4>
              <span class="subtle">How the model is solved, in PhLynx and in exports to web OpenCOR.</span>
            </div>
            <div class="settings-grid">
              <div class="field">
                <label id="sim-solver-label">Solver</label>
                <Select
                  :model-value="localSimulationSettings.solver"
                  aria-labelledby="sim-solver-label"
                  :options="solverOptions"
                  optionLabel="label"
                  optionValue="value"
                  data-testid="sim-solver"
                  fluid
                  @update:model-value="changeSolver"
                />
              </div>
              <template v-if="isFixedStepSolver">
                <div class="field">
                  <label for="sim-time-step">Time Step</label>
                  <InputNumber
                    v-model="localSimulationSettings.timeStep"
                    input-id="sim-time-step"
                    :pt:pcInputText:root="{ 'data-testid': 'sim-time-step' }"
                    suffix=" s"
                    :min="0"
                    :minFractionDigits="0"
                    :maxFractionDigits="12"
                    fluid
                  />
                </div>
              </template>
              <template v-else>
                <div class="field">
                  <label for="sim-tolerance">Tolerance</label>
                  <InputNumber
                    v-model="localSimulationSettings.tolerance"
                    input-id="sim-tolerance"
                    :pt:pcInputText:root="{ 'data-testid': 'sim-tolerance' }"
                    :min="0"
                    :minFractionDigits="0"
                    :maxFractionDigits="12"
                    fluid
                  />
                  <small class="subtle">Relative and absolute.</small>
                </div>
                <div class="field">
                  <label for="sim-max-steps">Maximum Steps</label>
                  <InputNumber
                    v-model="localSimulationSettings.maxSteps"
                    input-id="sim-max-steps"
                    :pt:pcInputText:root="{ 'data-testid': 'sim-max-steps' }"
                    :min="1"
                    :max="MAX_SOLVER_STEPS"
                    :useGrouping="false"
                    fluid
                  />
                  <small class="subtle">Between two output points.</small>
                </div>
                <div class="field">
                  <label for="sim-maximum-step">Maximum Step</label>
                  <InputNumber
                    v-model="localSimulationSettings.timeStep"
                    input-id="sim-maximum-step"
                    :pt:pcInputText:root="{ 'data-testid': 'sim-maximum-step' }"
                    suffix=" s"
                    :min="0"
                    :minFractionDigits="0"
                    :maxFractionDigits="12"
                    fluid
                  />
                  <small class="subtle">0 for no limit.</small>
                </div>
              </template>
            </div>
          </section>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <template #footer>
      <div class="dialog-footer">
        <!-- In the footer, so it shows on every tab. -->
        <Message v-if="solverProblem" severity="error" size="small" class="solver-problem" data-testid="sim-solver-problem">
          {{ solverProblem }} Change it under
          <a v-if="activeTab !== 'solver'" href="#" class="solver-link" @click.prevent="activeTab = 'solver'">Solver</a>
          <template v-else>Solver</template>
          to save.
        </Message>
        <Button label="Cancel" severity="secondary" text @click="requestClose" />
        <Button label="Save" severity="primary" :disabled="!!solverProblem" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Simulation Settings, in tabs: the plots, then the sliders and sweep, which the Simulation tab also edits,
 * then the time course and solver. Everything here is a draft until Save, which a close with unsaved changes
 * asks about.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import Message from 'primevue/message'
import Select from 'primevue/select'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'

import PlotListEditor from './simulation/PlotListEditor.vue'
import SliderDefinitionsEditor from './simulation/SliderDefinitionsEditor.vue'
import SweepEditor from './simulation/SweepEditor.vue'
import VariablePathPicker from './simulation/VariablePathPicker.vue'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { plotVariable, resolveGroups } from '../services/simulation/plotSelections'
import { MAX_SOLVER_STEPS, SOLVERS, findSolverSettingsProblem } from '../services/simulation/sedParameters'
import { buildVariableIndex, indexKeyOf, resolvePlotTarget } from '../services/simulation/variableIndex'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useLibraryStore } from '../stores/libraryStore'
import { cloneSimulationSettings, useSimulationSettingsStore } from '../stores/simulationSettingsStore'

const props = defineProps({
  modelValue: Boolean,
  // The section to open on: 'plots', 'sliders' or 'sweep', or 'time' or 'parameters' (the solver).
  section: { type: String, default: null },
  nodes: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['update:modelValue'])
const { confirm } = useConfirmDialog()
const libraryStore = useLibraryStore()
const simulationSettingsStore = useSimulationSettingsStore()
const inspectionStore = useInspectionModuleStore()
const { simulationSettings, plotConfig, parameterScanConfig } = storeToRefs(simulationSettingsStore)

const solverOptions = Object.entries(SOLVERS).map(([value, { label }]) => ({ label, value }))

// The drafts Save writes back.
const localSimulationSettings = ref({})
const draftPlotConfig = ref({})
const draftScanConfig = ref({ selections: [] })
// The tab each section is on.
const SECTION_TABS = { plots: 'plots', sliders: 'sliders', sweep: 'sliders', time: 'solver', parameters: 'solver' }
const activeTab = ref('plots')
const initialDraftSignature = ref('')
const bypassCloseGuard = ref(false)

const variableIndex = computed(() => buildVariableIndex(props.nodes, { inspectionModules: inspectionStore.modules }))
const plotOptions = computed(() => resolveGroups(draftPlotConfig.value))
const targetPlotId = ref(null)
watch(plotOptions, (plots) => {
  if (!plots.some((plot) => plot.id === targetPlotId.value)) targetPlotId.value = plots[0]?.id ?? null
})

const plotNames = computed(() => new Map(plotOptions.value.map((plot) => [plot.id, plot.name])))
const plottedGroups = computed(() => new Map((draftPlotConfig.value?.selections ?? []).map((selection) => [indexKeyOf(selection), selection.groupId])))

/**
 * Notes the plot a variable is already on.
 *
 * @param {Object} entry
 * @returns {string|null}
 */
function describePlotted(entry) {
  return plottedGroups.value.has(entry.key) ? `On ${plotNames.value.get(plottedGroups.value.get(entry.key)) ?? 'no plot'}` : null
}

// Says where a picked variable went when that wasn't the target plot.
const plotNote = ref('')
const plotsSearchEl = ref(null)

// The plots' search shows when a plot's add button asks for it.
const isAddingToPlot = ref(false)

/** Shows the plots' search box and puts the cursor in it, for a plot's add button. */
async function focusPlotPicker() {
  isAddingToPlot.value = true
  await nextTick()
  plotsSearchEl.value?.querySelector('input')?.focus()
}

/**
 * Plots a picked variable on the target plot, or one in its units (see plotVariable).
 *
 * @param {Object} entry
 */
function plotEntry(entry) {
  const target = resolvePlotTarget(entry, props.nodes, inspectionStore.modules)
  if (!target) return
  const { node, row } = target
  const result = plotVariable(draftPlotConfig.value, node, row, targetPlotId.value)
  draftPlotConfig.value = result.plotConfig
  plotNote.value =
    result.plotId === targetPlotId.value
      ? ''
      : `${entry.name} (${row.units || 'no units'}) went on ${resolveGroups(result.plotConfig).find((plot) => plot.id === result.plotId)?.name}: a plot shows one unit.`
}

/**
 * Gets everything Save would write.
 *
 * @returns {{simulationSettings: Object, plotConfig: Object, parameterScanConfig: Object}}
 */
function createDraftPayload() {
  return {
    simulationSettings: JSON.parse(JSON.stringify(localSimulationSettings.value)),
    plotConfig: draftPlotConfig.value,
    parameterScanConfig: draftScanConfig.value,
  }
}

const hasUnsavedChanges = computed(() => props.modelValue && JSON.stringify(createDraftPayload()) !== initialDraftSignature.value)

/** Copies the store into the drafts, as the dialog opens. */
function initialiseDialog() {
  localSimulationSettings.value = cloneSimulationSettings(simulationSettings.value)
  draftPlotConfig.value = JSON.parse(JSON.stringify(plotConfig.value ?? {}))
  draftScanConfig.value = JSON.parse(JSON.stringify(parameterScanConfig.value?.selections ? parameterScanConfig.value : { selections: [] }))
  plotNote.value = ''
  isAddingToPlot.value = false
  initialDraftSignature.value = JSON.stringify(createDraftPayload())
  bypassCloseGuard.value = false
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) return
    initialiseDialog()
    // The section asked for, such as the solver from the Simulation tab's cog.
    activeTab.value = SECTION_TABS[props.section] ?? 'plots'
  }
)

// The solver starts before the plots do, to let the model settle; web OpenCOR doesn't support it.
const isSettling = computed(() => {
  const { initialPoint, startingPoint } = localSimulationSettings.value
  return Number.isFinite(initialPoint) && Number.isFinite(startingPoint) && initialPoint < startingPoint
})

// Settings the simulator would refuse can't be saved, so they never reach a run or an export.
const solverProblem = computed(() => findSolverSettingsProblem(localSimulationSettings.value))

const isFixedStepSolver = computed(() => !!SOLVERS[localSimulationSettings.value.solver]?.isFixedStep)

/**
 * Changes the solver. The time step means a fixed-step solver's step but CVODE's maximum step, so moving
 * between the two starts it afresh: a tenth of the point interval, or no limit.
 *
 * @param {string} solver
 */
function changeSolver(solver) {
  const settings = localSimulationSettings.value
  if (!!SOLVERS[solver]?.isFixedStep !== isFixedStepSolver.value) {
    settings.timeStep = SOLVERS[solver]?.isFixedStep && settings.pointInterval > 0 ? settings.pointInterval / 10 : 0
  }
  settings.solver = solver
}

/** Saves the drafts and closes. */
function handleConfirm() {
  simulationSettingsStore.loadState(createDraftPayload())
  bypassCloseGuard.value = true
  emit('update:modelValue', false)
}

/** Closes, asking first when there are unsaved changes. */
async function requestClose() {
  if (bypassCloseGuard.value || !hasUnsavedChanges.value) {
    emit('update:modelValue', false)
    return
  }

  const shouldDiscard = await confirm({
    header: 'Discard unsaved changes?',
    message: 'You have unsaved simulation settings changes. Close without saving?',
    severity: 'warning',
    acceptLabel: 'Discard',
    rejectLabel: 'Keep Editing',
  })

  if (!shouldDiscard) return

  emit('update:modelValue', false)
}
</script>

<style scoped>
.dialog-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* The tabs stay put while a tab's contents scroll. */
.sim-settings-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.sim-settings-tabs :deep(.p-tabpanels) {
  flex: 1;
  overflow-y: auto;
  padding-left: 0;
  padding-right: 0;
}

.block {
  border: 1px solid var(--p-content-border-color, var(--p-surface-200, #ebeef5));
  border-radius: 8px;
  padding: 14px;
  background: var(--p-content-background, var(--p-surface-0, #ffffff));
  color: var(--p-text-color, inherit);
}

.block-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.block-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--p-text-color, inherit);
}
.subtle {
  font-size: 12px;
  color: var(--p-text-muted-color, #909399);
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-muted-color, #606266);
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
.solver-problem {
  margin-right: auto;
}

.solver-link {
  color: inherit;
  font-weight: 600;
}


.time-note {
  margin-top: 12px;
}

.plots-search {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.plots-search > :first-child {
  flex: 1;
  min-width: 0;
}

.plots-note {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.plots-list {
  container-type: inline-size;
}
</style>
