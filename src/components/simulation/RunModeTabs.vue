<template>
  <!-- Styled as the controls' view strip is. A mode not set up yet stays in place, marked disabled with why. -->
  <div class="run-mode-tabs" role="group" aria-label="What play runs">
    <button
      v-for="mode in modes"
      :key="mode.value"
      type="button"
      class="run-mode-tab"
      :class="{ 'run-mode-tab--on': mode.value === current, [`run-mode-tab--${mode.value}`]: true }"
      :data-testid="mode.testId"
      :aria-label="mode.label"
      :aria-pressed="mode.value === current"
      :aria-disabled="mode.disabledReason ? 'true' : undefined"
      :aria-describedby="mode.disabledReason ? `${hintId}-${mode.value}` : undefined"
      v-tooltip.bottom="mode.hint"
      @click="select(mode)"
    >
      <SweepIcon v-if="mode.value === 'sweep'" class="run-mode-icon" />
      <i v-else :class="['pi', mode.icon, 'run-mode-icon']" aria-hidden="true"></i>
      <span v-if="mode.disabledReason" :id="`${hintId}-${mode.value}`" class="visually-hidden">{{ mode.disabledReason }}</span>
    </button>
  </div>
</template>

<script setup>
/**
 * What play runs: the time course, the workspace's protocol or the sweep, one at a time. A mode that isn't set up yet
 * shows disabled, with what to do in its tooltip. Choosing a mode runs it at once.
 */
import { computed, useId, watch } from 'vue'

import SweepIcon from '../icons/SweepIcon.vue'
import { findSweepProblem, sweepLabel } from '../../services/simulation/sweep'
import { useProtocolStore } from '../../stores/protocolStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'

const props = defineProps({
  // Whether play can run now, so choosing a mode runs it.
  canPlay: { type: Boolean, default: true },
  isRunning: { type: Boolean, default: false },
})
const emit = defineEmits(['play'])

const protocolStore = useProtocolStore()
const resultsStore = useSimulationResultsStore()
const settingsStore = useSimulationSettingsStore()
const hintId = useId()

const sweep = computed(() => settingsStore.simulationSettings.sweep ?? null)
// With the sweep removed, from whichever view, play runs once again, and a later sweep starts off.
watch(sweep, (value) => {
  if (!value) resultsStore.isSweepMode = false
})

const hasProtocol = computed(() => !!(protocolStore.hasProtocol || protocolStore.source?.parseError))
const current = computed(() => (protocolStore.isProtocolMode ? 'protocol' : resultsStore.isSweepMode ? 'sweep' : 'run'))

const sweepHint = computed(() => {
  const problem = findSweepProblem(sweep.value)
  return `Sweep ${sweepLabel(sweep.value)}${problem ? `. ${problem}` : ''}`
})

const modes = computed(() => {
  const protocolReason = hasProtocol.value ? null : 'No protocol yet: add one with Edit protocol'
  const sweepReason = sweep.value ? null : 'No sweep yet: set one up in the Sweep tab'
  return [
    { value: 'run', icon: 'pi-chart-line', label: 'Time course', hint: 'Time course', testId: 'sim-run-mode', disabledReason: null },
    {
      value: 'protocol',
      icon: 'pi-list-check',
      label: 'Protocol',
      hint: protocolReason ?? 'Run the protocol’s experiments',
      testId: 'sim-protocol-mode',
      disabledReason: protocolReason,
    },
    { value: 'sweep', label: 'Sweep', hint: sweepReason ?? sweepHint.value, testId: 'sim-sweep-mode', disabledReason: sweepReason },
  ]
})

/**
 * Switches play to a mode, one at a time, and runs it.
 *
 * @param {{value: string, disabledReason: string|null}} mode
 */
function select(mode) {
  if (mode.disabledReason || mode.value === current.value) return
  protocolStore.isProtocolMode = mode.value === 'protocol'
  resultsStore.isSweepMode = mode.value === 'sweep'
  if (props.canPlay && !props.isRunning) emit('play')
}
</script>

<style scoped>
.run-mode-tabs {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 2px;
  border-radius: var(--p-togglebutton-border-radius, 6px);
  background: var(--p-togglebutton-background, var(--p-content-hover-background));
}

.run-mode-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--p-togglebutton-content-border-radius, 4px);
  background: transparent;
  color: var(--p-togglebutton-icon-color, var(--p-text-muted-color));
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.run-mode-tab:hover:not([aria-disabled='true']):not(.run-mode-tab--on) {
  color: var(--p-togglebutton-icon-hover-color, var(--p-text-color));
}

.run-mode-tab:focus-visible {
  outline: var(--p-togglebutton-focus-ring-width, 1px) var(--p-togglebutton-focus-ring-style, solid)
    var(--p-togglebutton-focus-ring-color, var(--p-primary-color));
  outline-offset: var(--p-togglebutton-focus-ring-offset, 2px);
}

.run-mode-tab--on {
  background: var(--p-togglebutton-content-checked-background, var(--p-content-background));
  box-shadow: var(--p-togglebutton-content-checked-shadow, 0 1px 2px rgba(0, 0, 0, 0.1));
  color: var(--p-primary-color);
}

.run-mode-tab[aria-disabled='true'] {
  color: var(--p-togglebutton-icon-disabled-color, var(--p-text-muted-color));
  opacity: 0.45;
  cursor: default;
}

.run-mode-icon {
  width: 15px;
  height: 15px;
  font-size: 15px;
}

/* On, the sweep's curves take a colour each, as its runs do on the charts. */
.run-mode-tab--sweep.run-mode-tab--on :deep(.sweep-curve--1) {
  stroke: var(--p-red-500);
}

.run-mode-tab--sweep.run-mode-tab--on :deep(.sweep-curve--2) {
  stroke: var(--p-amber-500);
}

.run-mode-tab--sweep.run-mode-tab--on :deep(.sweep-curve--3) {
  stroke: var(--p-emerald-500);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
