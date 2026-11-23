<template>
  <!-- The outer element is the container its width is queried on, so the row inside can change its own gap. -->
  <div class="simulation-toolbar" role="toolbar" aria-label="Simulation">
    <div ref="row" class="toolbar-row">
      <!-- The out-of-date dot sits on a wrapper, since the button crops what overflows it. -->
      <span class="toolbar-run-wrap">
        <Button
          v-if="isRunning"
          text
          rounded
          size="small"
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
          text
          rounded
          size="small"
          :disabled="!canPlay"
          :aria-label="playLabel"
          v-tooltip.bottom="playHint"
          class="toolbar-run"
          @click="emit('play')"
        >
          <i v-if="isLoading" class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <RunIcon v-else class="toolbar-run-icon" aria-hidden="true" />
        </Button>
        <span v-if="isOutdated && !isRunning" class="toolbar-run-dot" aria-hidden="true"></span>
      </span>

      <!-- As the light/dark switch does, its handle shows the mode; the tooltip names it. -->
      <label v-if="hasScopeSwitch" class="toolbar-scope" v-tooltip.bottom="scopeLabel">
        <ToggleSwitch v-model="isWholeModel" :aria-label="`Simulate the whole model, not ${partName}`">
          <template #handle="{ checked }">
            <i :class="['pi', checked ? 'pi-sitemap' : 'pi-box']" class="scope-icon" aria-hidden="true"></i>
          </template>
        </ToggleSwitch>
      </label>

      <RunModeTabs :can-play="canPlay" :is-running="isRunning" @play="emit('play')" />

      <span class="toolbar-spacer"></span>
      <!-- A view's own actions, such as the instance editor's sending its plot to the workspace. -->
      <slot />
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
        v-show="!hidden.has('obsData')"
        icon="pi pi-pen-to-square"
        text
        rounded
        size="small"
        severity="secondary"
        :disabled="isRunning"
        aria-label="Edit protocol"
        v-hint.bottom="protocolStore.hasProtocol ? 'Edit protocol (obs_data)' : 'Edit protocol: add experiments that set parameters (obs_data)'"
        @click="openProtocolDialog"
      />
      <Button
        v-if="hasSettings"
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
      <!-- What a view adds after every other button, such as the simulation page's exports. -->
      <slot name="end" />
    </div>
  </div>
</template>

<script setup>
/**
 * The Simulation tab's controls: play or stop, whether play runs the selection or the whole model, whether it runs
 * the time course, the workspace's protocol or the sweep, any actions the view adds in its default slot, and buttons
 * to track the run, float the results, and open the protocol and the simulation settings.
 */
import { computed, ref, useId, watch } from 'vue'

import Button from 'primevue/button'
import Menu from 'primevue/menu'
import ToggleSwitch from 'primevue/toggleswitch'

import RunIcon from '../icons/RunIcon.vue'
import RunModeTabs from './RunModeTabs.vue'
import { useFloatingViewer } from '../../composables/useFloatingViewer'
import { useOverflowMenu } from '../../composables/useOverflowMenu'
import { useProtocolDialog } from '../../composables/useProtocolDialog'
import { useSimSettingsDialog } from '../../composables/useSimSettingsDialog'
import { useTrackRun } from '../../composables/useTrackRun'
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
  // Whether it offers play the selection in place of the whole model, which the simulation page, with no canvas to
  // select from, doesn't.
  hasScopeSwitch: { type: Boolean, default: true },
  // Whether it offers to float the results over the canvas, which the simulation page, away from the canvas, doesn't.
  hasFloat: { type: Boolean, default: true },
  // Whether it offers the simulation settings, which the simulation page shows beside its charts instead.
  hasSettings: { type: Boolean, default: true },
  // The toolbar is the sidebar's, so floating the results hides the sidebar to give the canvas room.
  isInSidebar: { type: Boolean, default: false },
})
const emit = defineEmits(['play', 'stop'])

const { open: openSimSettings } = useSimSettingsDialog()
const { open: openProtocolDialog } = useProtocolDialog()
const protocolStore = useProtocolStore()
const { state: floatingViewer, toggle: toggleFloatingViewer } = useFloatingViewer()
const { trackBlocker, track } = useTrackRun()
// The tooltip saying why tracking is blocked shows only on hover, so screen readers are told it too.
const trackBlockerId = useId()

// The buttons that go into the more menu when the toolbar is too narrow for them, the least used first. The run
// modes never do, as only they show which is on.
const row = ref(null)
const hideable = computed(() => ['obsData', props.hasSettings && 'settings', props.hasFloat && 'float', 'track'].filter(Boolean))
const { hidden } = useOverflowMenu(row, hideable, () => [])

// The menu's items, for the buttons hidden, in the toolbar's order.
const moreMenu = ref(null)
const moreItems = computed(() => {
  const items = {
    track: { label: 'Track this run', icon: 'pi pi-bookmark', disabled: !!trackBlocker.value, command: track },
    float: {
      label: floatingViewer.visible ? 'Close the floating viewer' : 'Float over the canvas',
      icon: 'pi pi-window-minimize',
      command: () => toggleFloatingViewer({ isCollapsingSidebar: props.isInSidebar }),
    },
    obsData: { label: 'Edit protocol', icon: 'pi pi-pen-to-square', disabled: props.isRunning, command: openProtocolDialog },
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

.scope-icon {
  font-size: 0.7rem;
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

/* A text button as the toolbar's others are; the runner in the primary colour marks it the main action. */
.toolbar-run {
  flex-shrink: 0;
}

.toolbar-run svg {
  width: 14px;
  height: 14px;
}

.toolbar-run .toolbar-run-icon {
  width: 18px;
  height: 18px;
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
