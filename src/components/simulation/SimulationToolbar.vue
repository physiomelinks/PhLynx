<template>
  <!-- The outer element is the container its width is queried on, so the row inside can change its own gap. -->
  <div class="simulation-toolbar" role="toolbar" aria-label="Simulation">
    <div ref="row" class="toolbar-row">
      <!-- The out-of-date dot sits on a wrapper, since the button crops what overflows it. -->
      <span class="toolbar-run-wrap">
        <Button
          v-if="isRunning"
          rounded
          severity="danger"
          class="toolbar-run toolbar-run--stop"
          aria-label="Stop the simulation"
          v-hint.bottom="'Stop'"
          @click="emit('stop')"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
        </Button>
        <Button
          v-else
          rounded
          :disabled="!canPlay"
          :aria-label="playLabel"
          v-tooltip.bottom="playHint"
          class="toolbar-run"
          @click="emit('play')"
        >
          <i v-if="isLoading" class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <!-- Solid, and nudged right, so the triangle looks centred in the circle. -->
          <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.6v8.8c0 .5.6.8 1 .5l6.6-4.4c.4-.3.4-.8 0-1.1L6.5 3c-.4-.2-1 0-1 .6z" fill="currentColor" /></svg>
        </Button>
        <span v-if="isOutdated && !isRunning" class="toolbar-run-dot" aria-hidden="true"></span>
      </span>

      <label v-if="hasScopeSwitch" class="toolbar-scope" v-tooltip.bottom="scopeLabel">
        <!-- As the light/dark switch does, its handle shows the mode. -->
        <ToggleSwitch v-model="isWholeModel" :aria-label="`Simulate the whole model, not ${partName}`">
          <template #handle="{ checked }">
            <i :class="['pi', checked ? 'pi-sitemap' : 'pi-box']" class="scope-icon" aria-hidden="true"></i>
          </template>
        </ToggleSwitch>
        <span class="toolbar-scope-label">{{ scopeLabel }}</span>
      </label>

      <!-- A view's own controls for the run, such as the instance editor's Auto-update. -->
      <slot />

      <template v-if="hasProtocolButton">
        <Button
          v-show="!hidden.has('protocol')"
          icon="pi pi-list-check"
          text
          rounded
          size="small"
          class="toolbar-protocol"
          :severity="protocolStore.isProtocolMode ? 'primary' : 'secondary'"
          :aria-pressed="protocolStore.isProtocolMode"
          :label="protocolStore.isProtocolMode && experimentCount < 2 ? 'Protocol' : undefined"
          aria-label="Run the protocol's experiments"
          v-hint.bottom="protocolStore.isProtocolMode ? 'Running the protocol: switch back to the time course' : 'Run the protocol\'s experiments'"
          @click="toggleProtocol"
        />
      </template>

      <!-- Plays the sweep set in the Sweep view rather than one run, as the protocol button plays the protocol. -->
      <Button
        v-if="sweep"
        v-show="!hidden.has('sweep')"
        icon="pi pi-chart-line"
        text
        rounded
        size="small"
        class="toolbar-sweep"
        data-testid="sim-sweep-mode"
        :severity="resultsStore.isSweepMode ? 'primary' : 'secondary'"
        :aria-pressed="resultsStore.isSweepMode"
        :label="resultsStore.isSweepMode ? 'Sweep' : undefined"
        aria-label="Run the sweep"
        v-tooltip.bottom="sweepHint"
        @click="toggleSweep"
      />

      <span class="toolbar-spacer"></span>
      <!-- A span carries the tooltip, as a disabled button shows none. -->
      <span v-show="!hidden.has('track')" class="toolbar-track" v-tooltip.bottom="trackBlocker ?? 'Track this run: keep its lines on the charts'">
        <Button
          icon="pi pi-bookmark"
          text
          rounded
          size="small"
          severity="secondary"
          :disabled="!!trackBlocker"
          aria-label="Track this run"
          :aria-describedby="trackBlocker ? trackBlockerId : undefined"
          @click="track"
        />
        <span v-if="trackBlocker" :id="trackBlockerId" class="visually-hidden">{{ trackBlocker }}</span>
      </span>
      <Button
        v-if="hasFloat"
        v-show="!hidden.has('float')"
        icon="pi pi-window-minimize"
        text
        rounded
        size="small"
        :severity="floatingViewer.visible ? 'primary' : 'secondary'"
        :aria-pressed="floatingViewer.visible"
        aria-label="Float the results over the canvas"
        v-hint.bottom="floatingViewer.visible ? 'Close the floating viewer' : 'Float over the canvas'"
        @click="toggleFloatingViewer({ isCollapsingSidebar: isInSidebar })"
      />
      <Button
        v-if="hasPageLink"
        v-show="!hidden.has('page')"
        icon="pi pi-external-link"
        text
        rounded
        size="small"
        severity="secondary"
        aria-label="Open the simulation page"
        v-hint.bottom="'Open the simulation page'"
        @click="emit('open-page')"
      />
      <Button
        v-show="!hidden.has('obsData')"
        icon="pi pi-pen-to-square"
        text
        rounded
        size="small"
        severity="secondary"
        :disabled="isRunning"
        aria-label="Edit obs_data"
        v-hint.bottom="protocolStore.hasProtocol ? 'Edit obs_data' : 'Edit obs_data: add a protocol of experiments that set parameters'"
        @click="openProtocolDialog"
      />
      <Button
        v-show="!hidden.has('settings')"
        icon="pi pi-cog"
        text
        rounded
        size="small"
        severity="secondary"
        :disabled="isRunning"
        aria-label="Simulation settings"
        v-hint.bottom="'Simulation settings'"
        @click="openSimSettings('parameters')"
      />
      <!-- Too narrow for them all: those that don't fit, in a menu. -->
      <Button
        v-if="hidden.size"
        icon="pi pi-ellipsis-v"
        text
        rounded
        size="small"
        severity="secondary"
        class="toolbar-more"
        aria-label="More simulation actions"
        aria-haspopup="true"
        v-hint.bottom="'More'"
        @click="(event) => moreMenu.toggle(event)"
      />
      <Menu ref="moreMenu" :model="moreItems" popup />
    </div>
  </div>
</template>

<script setup>
/**
 * The Simulation tab's controls: play or stop, whether play runs the selection or the whole model, any controls
 * the view adds in its default slot, whether it runs the workspace's protocol or the sweep, and buttons to track the
 * run, float the results or open them on the simulation page, and open the protocol and the simulation settings.
 */
import { computed, ref, useId, watch } from 'vue'

import Button from 'primevue/button'
import Menu from 'primevue/menu'
import ToggleSwitch from 'primevue/toggleswitch'

import { useFloatingViewer } from '../../composables/useFloatingViewer'
import { useOverflowMenu } from '../../composables/useOverflowMenu'
import { useProtocolDialog } from '../../composables/useProtocolDialog'
import { useSimSettingsDialog } from '../../composables/useSimSettingsDialog'
import { useTrackRun } from '../../composables/useTrackRun'
import { findSweepProblem, sweepLabel } from '../../services/simulation/sweep'
import { useProtocolStore } from '../../stores/protocolStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'

const scopeMode = defineModel('scopeMode', { type: String, default: 'model' })
const props = defineProps({
  isRunning: { type: Boolean, default: false },
  // The simulator is still loading.
  isLoading: { type: Boolean, default: false },
  // Why play can't run, if it can't.
  blockedReason: { type: String, default: null },
  selectedCount: { type: Number, default: 0 },
  // What play runs when it isn't the whole model: the canvas selection, or the instance being edited.
  partName: { type: String, default: 'the selection' },
  // How the switch labels it; by default the selection with its count.
  partLabel: { type: String, default: null },
  // The shown results are out of date, so play would update them.
  isOutdated: { type: Boolean, default: false },
  // Whether it offers play the selection in place of the whole model, which the simulation page, with no canvas to
  // select from, doesn't.
  hasScopeSwitch: { type: Boolean, default: true },
  // Whether it offers to float the results over the canvas, which the simulation page, away from the canvas, doesn't.
  hasFloat: { type: Boolean, default: true },
  // Whether it offers to open the simulation page, which the page itself and a modal editor don't.
  hasPageLink: { type: Boolean, default: false },
  // The toolbar is the sidebar's, so floating the results hides the sidebar to give the canvas room.
  isInSidebar: { type: Boolean, default: false },
})
const emit = defineEmits(['play', 'stop', 'open-page'])

const { open: openSimSettings } = useSimSettingsDialog()
const { open: openProtocolDialog } = useProtocolDialog()
const protocolStore = useProtocolStore()
const resultsStore = useSimulationResultsStore()
const settingsStore = useSimulationSettingsStore()

const experimentCount = computed(() => protocolStore.view?.experiments.length ?? 0)

/** Switches play between the protocol and the time course, running at once as switching the scope does. */
function toggleProtocol() {
  protocolStore.isProtocolMode = !protocolStore.isProtocolMode
  // One mode at a time: the protocol runs the model as it is, with nothing swept.
  if (protocolStore.isProtocolMode) resultsStore.isSweepMode = false
  if (canPlay.value && !props.isRunning) emit('play')
}

const sweep = computed(() => settingsStore.simulationSettings.sweep ?? null)
// With the sweep removed, from whichever view, play runs once again, and a later sweep starts off.
watch(sweep, (current) => {
  if (!current) resultsStore.isSweepMode = false
})
const sweepHint = computed(() => {
  const problem = findSweepProblem(sweep.value)
  if (resultsStore.isSweepMode) return `Sweeping ${sweepLabel(sweep.value)}: switch back to one run${problem ? `. ${problem}` : ''}`
  return problem ? `Run the sweep. ${problem}` : `Run the sweep of ${sweepLabel(sweep.value)}`
})

/** Switches play between the sweep and one run, running at once as switching the protocol does. */
function toggleSweep() {
  resultsStore.isSweepMode = !resultsStore.isSweepMode
  if (resultsStore.isSweepMode) protocolStore.isProtocolMode = false
  if (canPlay.value && !props.isRunning) emit('play')
}

const { state: floatingViewer, toggle: toggleFloatingViewer } = useFloatingViewer()
const { trackBlocker, track } = useTrackRun()
// The tooltip saying why tracking is blocked shows only on hover, so screen readers are told it too.
const trackBlockerId = useId()

const hasProtocolButton = computed(() => !!(protocolStore.hasProtocol || protocolStore.source?.parseError))

// The buttons that go into the more menu when the toolbar is too narrow for them, the least used first. The modes go
// last, as only their buttons show which is on.
const row = ref(null)
const hideable = computed(() =>
  [
    props.hasPageLink && 'page',
    'obsData',
    'settings',
    props.hasFloat && 'float',
    'track',
    sweep.value && 'sweep',
    hasProtocolButton.value && 'protocol',
  ].filter(Boolean),
)
const { hidden } = useOverflowMenu(row, hideable, () => [
  // The mode buttons show a label while on.
  protocolStore.isProtocolMode,
  resultsStore.isSweepMode,
  experimentCount.value,
])

// The menu's items, for the buttons hidden, in the toolbar's order.
const moreMenu = ref(null)
const moreItems = computed(() => {
  const items = {
    protocol: {
      label: protocolStore.isProtocolMode ? 'Back to the time course' : 'Run the protocol\'s experiments',
      icon: 'pi pi-list-check',
      command: toggleProtocol,
    },
    sweep: { label: resultsStore.isSweepMode ? 'Back to one run' : 'Run the sweep', icon: 'pi pi-chart-line', command: toggleSweep },
    track: { label: 'Track this run', icon: 'pi pi-bookmark', disabled: !!trackBlocker.value, command: track },
    float: {
      label: floatingViewer.visible ? 'Close the floating viewer' : 'Float over the canvas',
      icon: 'pi pi-window-minimize',
      command: () => toggleFloatingViewer({ isCollapsingSidebar: props.isInSidebar }),
    },
    page: { label: 'Open the simulation page', icon: 'pi pi-external-link', command: () => emit('open-page') },
    obsData: { label: 'Edit obs_data', icon: 'pi pi-pen-to-square', disabled: props.isRunning, command: openProtocolDialog },
    settings: { label: 'Simulation settings', icon: 'pi pi-cog', disabled: props.isRunning, command: () => openSimSettings('parameters') },
  }
  return Object.keys(items).filter((id) => hidden.value.has(id)).map((id) => items[id])
})
// Its button gone, the menu closes too.
watch(
  () => hidden.value.size,
  (size) => {
    if (!size) moreMenu.value?.hide()
  },
)

const isWholeModel = computed({
  get: () => scopeMode.value === 'model',
  set: (value) => (scopeMode.value = value ? 'model' : 'selection'),
})
const scopeLabel = computed(() => (isWholeModel.value ? 'Whole model' : props.partLabel ?? `Selection (${props.selectedCount})`))
const canPlay = computed(() => !props.blockedReason && !props.isLoading)
const playLabel = computed(() => {
  if (isWholeModel.value) return 'Simulate the whole model'
  return props.partLabel ? `Simulate ${props.partName}` : `Simulate ${props.partName} (${props.selectedCount})`
})
const playHint = computed(() => props.blockedReason ?? (props.isLoading ? 'Loading the simulator…' : `${playLabel.value} (F9)`))
</script>

<style scoped>
.simulation-toolbar {
  container-type: inline-size;
  min-width: 0;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  /* As tall as it has always been, whatever the size of the controls in it. */
  min-height: 34px;
}

.toolbar-scope {
  display: flex;
  align-items: center;
  gap: 6px;
  /* Never narrower than the switch: squeezed further, the switch would spill under the buttons after it. */
  min-width: var(--p-toggleswitch-width, 2.5rem);
  font-size: 0.8125rem;
  color: var(--p-text-color);
  cursor: pointer;
}

.toolbar-scope :deep(.p-toggleswitch) {
  flex-shrink: 0;
}

.toolbar-scope-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Too narrow for the label: the switch alone, its scope in the tooltip. */
@container (max-width: 220px) {
  .toolbar-scope-label {
    display: none;
  }
}

.scope-icon {
  font-size: 0.7rem;
}

.toolbar-protocol,
.toolbar-sweep {
  flex-shrink: 0;
}


/* Too narrow: the protocol and sweep buttons without their labels. */
@container (max-width: 300px) {
  .toolbar-protocol :deep(.p-button-label),
  .toolbar-sweep :deep(.p-button-label) {
    display: none;
  }
}

.toolbar-spacer {
  flex: 1;
}

/* Every button keeps its full circle: squeezed, their hover backgrounds would run together. */
.toolbar-row > :deep(.p-button) {
  flex-shrink: 0;
}

/* Narrower: smaller buttons, closer together. */
@container (max-width: 380px) {
  .toolbar-row {
    gap: 4px;
  }

  .toolbar-row :deep(.p-button-icon-only.p-button-sm) {
    width: 1.75rem;
    height: 1.75rem;
  }
}

.toolbar-track {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* A filled circle a little larger than the other buttons, as the toolbar's main action. */
.toolbar-run {
  position: relative;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  padding: 0;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--p-text-color) 25%, transparent);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.toolbar-run:not(:disabled):hover {
  transform: scale(1.06);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--p-primary-color) 40%, transparent);
}

.toolbar-run:not(:disabled):active {
  transform: scale(0.97);
}

.toolbar-run svg {
  width: 16px;
  height: 16px;
}

.toolbar-run--stop:not(:disabled):hover {
  box-shadow: 0 2px 6px color-mix(in srgb, var(--p-red-500) 40%, transparent);
}

/* Out-of-date results: a dot on play says it would update them. */
.toolbar-run-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.toolbar-run-dot {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--p-orange-500);
  box-shadow: 0 0 0 2px var(--p-content-background);
  pointer-events: none;
}
</style>
