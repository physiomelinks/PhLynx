<template>
  <!-- The minimap, with a button on its corner that shrinks it to a button of its own -->
  <template v-if="settings.showMiniMap">
    <MiniMap v-bind="$attrs" />
    <Panel position="bottom-right" class="minimap-toggle minimap-toggle--hide">
      <button
        type="button"
        class="minimap-toggle-button minimap-hide-button"
        aria-label="Hide minimap"
        title="Hide minimap"
        @click="setShown(false)"
      >
        <i class="pi pi-window-minimize" aria-hidden="true"></i>
      </button>
    </Panel>
  </template>
  <Panel v-else position="bottom-right" class="minimap-toggle minimap-toggle--show">
    <button
      type="button"
      class="vue-flow__controls-button minimap-toggle-button"
      aria-label="Show minimap"
      title="Show minimap"
      @click="setShown(true)"
    >
      <i class="pi pi-map" aria-hidden="true"></i>
    </button>
  </Panel>
</template>

<script setup>
import { Panel } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'

import { useAppSettings } from '../composables/useAppSettings'

// What the minimap is given (its props and class) goes to the minimap, not to the buttons.
defineOptions({ inheritAttrs: false })

const { settings, saveAppSettings } = useAppSettings()

/** Shows or hides the minimap of every view, remembered with the app's settings. */
const setShown = (shown) => saveAppSettings({ showMiniMap: shown })
</script>

<style>
/* Not scoped: Vue Flow's panel draws the root these style. */
.minimap-toggle {
  /* Above the minimap, whose corner the hide button sits on. */
  z-index: 6;
  /* Moves with the minimap, out from under the floating context panel while it is open. */
  transform: translateX(calc(-1 * var(--context-panel-cover, 0px)));
  transition: transform 160ms ease;
}
/* No gap under the drawing, so the minimap is as tall as it is asked to be. */
.vue-flow__minimap svg {
  display: block;
}
/* On the top right corner of the minimap, which is 150px tall unless told otherwise. */
.minimap-toggle--hide {
  margin-bottom: calc(15px + var(--minimap-height, 150px) - 22px);
}
.minimap-toggle--show {
  box-shadow: 0 0 2px 1px rgba(0, 0, 0, 0.08);
}
.minimap-toggle-button {
  border-bottom: none;
  font-size: 12px;
}
.minimap-toggle-button:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}
/* Small and quiet until it is pointed at; dark in either colour scheme, as the minimap is always light. */
.minimap-hide-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: #444;
  font-size: 10px;
  opacity: 0.6;
  cursor: pointer;
}
.minimap-hide-button:hover,
.minimap-hide-button:focus-visible {
  opacity: 1;
  background: rgba(0, 0, 0, 0.08);
}
</style>
