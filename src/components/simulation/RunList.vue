<template>
  <section class="run-list" aria-label="Tracked runs">
    <div class="run-actions">
      <Button
        label="Remove all"
        icon="pi pi-trash"
        text
        size="small"
        severity="secondary"
        :disabled="!store.trackedRuns.length"
        aria-label="Stop tracking every run"
        @click="store.removeAllTrackedRuns()"
      />
    </div>

    <ul class="run-items">
      <li class="run-item" :class="{ 'run-item--hidden': !store.isLiveRunVisible }">
        <RunSwatch colour="currentColor" />
        <div class="run-text">
          <span class="run-name">Live run</span>
          <span class="run-detail" :title="liveDetail">{{ liveDetail }}</span>
        </div>
        <Button
          :icon="store.isLiveRunVisible ? 'pi pi-eye' : 'pi pi-eye-slash'"
          text
          rounded
          size="small"
          severity="secondary"
          :disabled="!store.trackedRuns.length"
          :aria-label="store.isLiveRunVisible ? 'Hide the live run' : 'Show the live run'"
          :aria-pressed="!store.isLiveRunVisible"
          @click="store.isLiveRunVisible = !store.isLiveRunVisible"
        />
      </li>
      <li v-for="run in store.trackedRuns" :key="run.id" class="run-item" :class="{ 'run-item--hidden': !run.isVisible }">
        <RunSwatch colour="currentColor" :dash="runDash(run.number)" />
        <div class="run-text">
          <InlineText
            class="run-name run-name--editable"
            :model-value="run.name"
            :placeholder="runName(run.number)"
            aria-label="Run name"
            @update:model-value="store.renameTrackedRun(run.id, $event)"
          />
          <span class="run-detail" :title="describe(run.inputs)">{{ describe(run.inputs) }}</span>
        </div>
        <Button
          :icon="run.isVisible ? 'pi pi-eye' : 'pi pi-eye-slash'"
          text
          rounded
          size="small"
          severity="secondary"
          :aria-label="`${run.isVisible ? 'Hide' : 'Show'} ${runName(run.number, run.name)}`"
          :aria-pressed="!run.isVisible"
          @click="store.toggleTrackedRun(run.id)"
        />
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          severity="secondary"
          :aria-label="`Stop tracking ${runName(run.number, run.name)}`"
          @click="store.removeTrackedRun(run.id)"
        />
      </li>
    </ul>

    <p v-if="!store.trackedRuns.length" class="run-empty">
      Track a run from the toolbar to keep its lines on the charts, dashed, while you try other slider values. Up to {{ MAX_TRACKED_RUNS }} runs can be tracked.
    </p>
  </section>
</template>

<script setup>
/**
 * The tracked runs, as web OpenCOR lists them: name, show, hide or stop tracking each run tracked from the
 * toolbar, or hide the live run to compare tracked runs alone. Each run says the slider values it tried out.
 */
import { computed } from 'vue'

import Button from 'primevue/button'

import InlineText from './InlineText.vue'
import RunSwatch from './RunSwatch.vue'
import { useTrackRun } from '../../composables/useTrackRun'
import { formatPlotValue as formatValue, MAX_TRACKED_RUNS, runDash, runName } from '../../services/simulation/trackedRuns'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'

const store = useSimulationResultsStore()
const { liveInputs } = useTrackRun()
/**
 * Says what slider values a run tried out.
 *
 * @param {Array<{label: string, value: number, units: string}>} inputs
 * @returns {string}
 */
const describe = (inputs) =>
  inputs.length ? inputs.map(({ label, value, units }) => `${label} = ${formatValue(value)}${units ? ` ${units}` : ''}`).join('; ') : 'The model’s values'

const liveDetail = computed(() => (store.results ? describe(liveInputs.value) : 'Not run yet'))
</script>

<style scoped>
.run-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.run-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.run-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.run-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 2px 0 2px 4px;
  color: var(--p-text-color);
}

.run-item--hidden .run-text,
.run-item--hidden .run-swatch {
  opacity: 0.5;
}

.run-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.run-name {
  font-size: 0.85rem;
}

/* Its text in line with the live run's, the edit box's padding outside it. */
.run-name--editable {
  align-self: flex-start;
  height: 1.5rem;
  margin-left: -7px;
}

.run-detail {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-empty {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}
</style>
