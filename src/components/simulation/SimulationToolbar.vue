<template>
  <div class="simulation-toolbar" role="toolbar" aria-label="Simulation">
    <!-- The out-of-date dot sits on a wrapper, since the button crops what overflows it. -->
    <span class="toolbar-run-wrap">
      <Button
        v-if="isRunning"
        rounded
        severity="danger"
        class="toolbar-run toolbar-run--stop"
        aria-label="Stop the simulation"
        v-tooltip.bottom="'Stop'"
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

    <label class="toolbar-scope" v-tooltip.bottom="scopeLabel">
      <!-- As the light/dark switch does, its handle shows the mode. -->
      <ToggleSwitch v-model="isWholeModel" :aria-label="`Simulate the whole model, not ${partName}`">
        <template #handle="{ checked }">
          <i :class="['pi', checked ? 'pi-sitemap' : 'pi-box']" class="scope-icon" aria-hidden="true"></i>
        </template>
      </ToggleSwitch>
      <span class="toolbar-scope-label">{{ scopeLabel }}</span>
    </label>

    <template v-if="protocolStore.hasProtocol || protocolStore.source?.parseError">
      <Button
        icon="pi pi-list-check"
        text
        rounded
        size="small"
        class="toolbar-protocol"
        :severity="protocolStore.isProtocolMode ? 'primary' : 'secondary'"
        :aria-pressed="protocolStore.isProtocolMode"
        :label="protocolStore.isProtocolMode && experimentCount < 2 ? 'Protocol' : undefined"
        aria-label="Run the protocol's experiments"
        v-tooltip.bottom="protocolStore.isProtocolMode ? 'Running the protocol: switch back to the time course' : 'Run the protocol\'s experiments'"
        @click="toggleProtocol"
      />
    </template>

    <span class="toolbar-spacer"></span>
    <Button
      icon="pi pi-clone"
      text
      rounded
      size="small"
      :severity="floatingViewer.visible ? 'primary' : 'secondary'"
      :aria-pressed="floatingViewer.visible"
      aria-label="Float the results over the canvas"
      v-tooltip.bottom="floatingViewer.visible ? 'Close the floating viewer' : 'Float over the canvas'"
      @click="toggleFloatingViewer"
    />
    <Button
      icon="pi pi-window-maximize"
      text
      rounded
      size="small"
      severity="secondary"
      :disabled="!canExpand"
      aria-label="Open the results in a larger view"
      v-tooltip.bottom="'Expand'"
      @click="emit('expand')"
    />
    <Button
      icon="pi pi-pen-to-square"
      text
      rounded
      size="small"
      severity="secondary"
      :disabled="isRunning"
      :aria-label="protocolStore.hasProtocol ? 'Edit the protocol' : 'Create a protocol'"
      v-tooltip.bottom="protocolStore.hasProtocol ? 'Edit the protocol' : 'Create a protocol: experiments that set parameters'"
      @click="openProtocolDialog"
    />
    <Button
      icon="pi pi-cog"
      text
      rounded
      size="small"
      severity="secondary"
      :disabled="isRunning"
      aria-label="Simulation settings"
      v-tooltip.bottom="'Simulation settings'"
      @click="openSimSettings('parameters')"
    />
  </div>
</template>

<script setup>
/**
 * The Simulation tab's controls: play or stop, whether play runs the selection or the whole model, whether it
 * runs the workspace's protocol and which experiment is shown, and buttons for the larger view, the protocol and the
 * simulation settings.
 */
import { computed } from 'vue'

import Button from 'primevue/button'
import ToggleSwitch from 'primevue/toggleswitch'

import { useFloatingViewer } from '../../composables/useFloatingViewer'
import { useProtocolDialog } from '../../composables/useProtocolDialog'
import { useSimSettingsDialog } from '../../composables/useSimSettingsDialog'
import { useProtocolStore } from '../../stores/protocolStore'

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
  canExpand: { type: Boolean, default: false },
})
const emit = defineEmits(['play', 'stop', 'expand'])

const { open: openSimSettings } = useSimSettingsDialog()
const { open: openProtocolDialog } = useProtocolDialog()
const protocolStore = useProtocolStore()

const experimentCount = computed(() => protocolStore.view?.experiments.length ?? 0)

/** Switches play between the protocol and the time course, running at once as switching the scope does. */
function toggleProtocol() {
  protocolStore.isProtocolMode = !protocolStore.isProtocolMode
  if (canPlay.value && !props.isRunning) emit('play')
}

const { state: floatingViewer, toggle: toggleFloatingViewer } = useFloatingViewer()

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
  min-width: 0;
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

.toolbar-protocol {
  flex-shrink: 0;
}


/* Too narrow: the protocol button without its label. */
@container (max-width: 300px) {
  .toolbar-protocol :deep(.p-button-label) {
    display: none;
  }
}

.toolbar-spacer {
  flex: 1;
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
