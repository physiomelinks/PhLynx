<template>
  <section class="settings-section" aria-label="Simulation settings">
    <button
      type="button"
      class="settings-toggle"
      :aria-expanded="isOpen"
      aria-controls="sim-settings-body"
      data-testid="sim-settings-toggle"
      @click="toggle"
    >
      <i :class="isOpen ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" aria-hidden="true"></i>
      <span class="settings-title">Simulation settings</span>
      <span v-if="!isOpen" class="settings-summary">{{ summary }}</span>
    </button>

    <div v-if="isOpen" id="sim-settings-body" class="settings-body">
      <div class="settings-grid">
        <div class="field">
          <label for="side-initial-point">Starts at</label>
          <InputNumber
            v-model="draft.initialPoint"
            input-id="side-initial-point"
            :pt:pcInputText:root="{ 'data-testid': 'side-initial-point' }"
            suffix=" s"
            :minFractionDigits="0"
            :maxFractionDigits="8"
            size="small"
            fluid
            @update:model-value="commit"
          />
        </div>
        <div class="field">
          <label for="side-starting-point">Plots start at</label>
          <InputNumber
            v-model="draft.startingPoint"
            input-id="side-starting-point"
            :pt:pcInputText:root="{ 'data-testid': 'side-starting-point' }"
            suffix=" s"
            :minFractionDigits="0"
            :maxFractionDigits="8"
            size="small"
            fluid
            @update:model-value="commit"
          />
        </div>
        <div class="field">
          <label for="side-ending-point">Ends at</label>
          <InputNumber
            v-model="draft.endingPoint"
            input-id="side-ending-point"
            :pt:pcInputText:root="{ 'data-testid': 'side-ending-point' }"
            suffix=" s"
            :minFractionDigits="0"
            :maxFractionDigits="8"
            size="small"
            fluid
            @update:model-value="commit"
          />
        </div>
        <div class="field">
          <label for="side-point-interval">Point interval</label>
          <InputNumber
            v-model="draft.pointInterval"
            input-id="side-point-interval"
            :pt:pcInputText:root="{ 'data-testid': 'side-point-interval' }"
            suffix=" s"
            :min="0"
            :minFractionDigits="0"
            :maxFractionDigits="8"
            size="small"
            fluid
            @update:model-value="commit"
          />
        </div>
        <div class="field">
          <label id="side-solver-label">Solver</label>
          <Select
            :model-value="draft.solver"
            aria-labelledby="side-solver-label"
            :options="solverOptions"
            option-label="label"
            option-value="value"
            data-testid="side-solver"
            size="small"
            fluid
            @update:model-value="changeSolver"
          />
        </div>
        <div v-if="isFixedStepSolver" class="field">
          <label for="side-time-step">Time step</label>
          <InputNumber
            v-model="draft.timeStep"
            input-id="side-time-step"
            :pt:pcInputText:root="{ 'data-testid': 'side-time-step' }"
            suffix=" s"
            :min="0"
            :minFractionDigits="0"
            :maxFractionDigits="12"
            size="small"
            fluid
            @update:model-value="commit"
          />
        </div>
        <template v-else>
          <div class="field">
            <label for="side-tolerance">Tolerance</label>
            <InputNumber
              v-model="draft.tolerance"
              input-id="side-tolerance"
              :pt:pcInputText:root="{ 'data-testid': 'side-tolerance' }"
              :min="0"
              :minFractionDigits="0"
              :maxFractionDigits="12"
              size="small"
              fluid
              @update:model-value="commit"
            />
          </div>
          <div class="field">
            <label for="side-max-steps">Maximum steps</label>
            <InputNumber
              v-model="draft.maxSteps"
              input-id="side-max-steps"
              :pt:pcInputText:root="{ 'data-testid': 'side-max-steps' }"
              :min="1"
              :max="MAX_SOLVER_STEPS"
              :useGrouping="false"
              size="small"
              fluid
              @update:model-value="commit"
            />
          </div>
          <div class="field">
            <label for="side-maximum-step">Maximum step</label>
            <InputNumber
              v-model="draft.timeStep"
              input-id="side-maximum-step"
              :pt:pcInputText:root="{ 'data-testid': 'side-maximum-step' }"
              suffix=" s"
              :min="0"
              :minFractionDigits="0"
              :maxFractionDigits="12"
              size="small"
              fluid
              @update:model-value="commit"
            />
          </div>
        </template>
      </div>
      <p v-if="problem" class="settings-problem" role="alert">{{ problem }}</p>
    </div>
  </section>
</template>

<script setup>
/**
 * The time course and solver settings, in a section that folds away, so they are at hand beside what gets plotted.
 * A change that the simulator would accept is saved as it is made; one it would refuse stays in the fields, with
 * why, until it is put right. The settings dialog sets the same values.
 */
import { computed, ref, watch } from 'vue'

import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'

import { MAX_SOLVER_STEPS, SOLVERS, findSolverSettingsProblem } from '../../services/simulation/sedParameters'
import { cloneSimulationSettings, useSimulationSettingsStore } from '../../stores/simulationSettingsStore'

const STORAGE_KEY = 'phlynx.simulationSettingsSection.open'

const settingsStore = useSimulationSettingsStore()
const solverOptions = Object.entries(SOLVERS).map(([value, { label }]) => ({ label, value }))

/**
 * Reads whether the section was left open, closed when it can't be told.
 *
 * @returns {boolean}
 */
function readIsOpen() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

const isOpen = ref(readIsOpen())
const draft = ref(cloneSimulationSettings(settingsStore.simulationSettings))

// The store changes elsewhere too: the dialog saves, a project loads.
watch(
  () => settingsStore.simulationSettings,
  (settings) => {
    if (JSON.stringify(settings) !== JSON.stringify(draft.value)) draft.value = cloneSimulationSettings(settings)
  }
)

const isFixedStepSolver = computed(() => !!SOLVERS[draft.value.solver]?.isFixedStep)
const problem = computed(() => findSolverSettingsProblem(draft.value))
const summary = computed(() => {
  const { initialPoint, endingPoint, solver } = draft.value
  return `${initialPoint ?? 0}–${endingPoint ?? '?'} s · ${SOLVERS[solver]?.label ?? solver}`
})

/** Opens or folds the section, remembering which for next time. */
function toggle() {
  isOpen.value = !isOpen.value
  try {
    localStorage.setItem(STORAGE_KEY, String(isOpen.value))
  } catch {
    // Not remembered; the section still works.
  }
}

/** Saves the fields to the settings, unless the simulator would refuse them. */
function commit() {
  if (problem.value) return
  // The sweep and other settings that these fields don't touch are kept as the store has them.
  settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, ...JSON.parse(JSON.stringify(draft.value)), sweep: settingsStore.simulationSettings.sweep })
}

/**
 * Changes the solver. The time step means a fixed-step solver's step but CVODE's maximum step, so moving
 * between the two starts it afresh: a tenth of the point interval, or no limit.
 *
 * @param {string} solver
 */
function changeSolver(solver) {
  const settings = draft.value
  if (!!SOLVERS[solver]?.isFixedStep !== isFixedStepSolver.value) {
    settings.timeStep = SOLVERS[solver]?.isFixedStep && settings.pointInterval > 0 ? settings.pointInterval / 10 : 0
  }
  settings.solver = solver
  commit()
}
</script>

<style scoped>
.settings-section {
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  min-width: 0;
}

.settings-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--p-text-color);
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.settings-toggle i {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.settings-title {
  font-weight: 600;
  flex-shrink: 0;
}

.settings-summary {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.settings-body {
  padding: 0 8px 8px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.field label {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.settings-problem {
  margin: 8px 0 0;
  font-size: 0.75rem;
  color: var(--p-red-500);
}

/* Narrow: one field to a row. */
@container (max-width: 300px) {
  .settings-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
