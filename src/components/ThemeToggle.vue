<template>
  <div
    :class="['theme-toggle', { 'theme-toggle--floating': floating }]"
    v-tooltip.bottom="isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
  >
    <ToggleSwitch :model-value="isDarkMode" @change="toggleDarkMode" aria-label="Toggle Theme">
      <template #handle="{ checked }">
        <i :class="['pi', checked ? 'pi-moon' : 'pi-sun']" style="font-size: 0.75rem"></i>
      </template>
    </ToggleSwitch>
  </div>
</template>

<script setup>
import ToggleSwitch from 'primevue/toggleswitch'

import { useColorScheme } from '../composables/useColorScheme'

/**
 * Light/dark mode switch.
 *
 * @prop {boolean} floating - Pin to the top-right of the view, aligned with the workspace header.
 */
defineProps({
  floating: { type: Boolean, default: false },
})

const { isDarkMode, toggleDarkMode } = useColorScheme()
</script>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
}

/* Mirrors the .app-header box in WorkspaceArea so the switch sits in the same spot. */
.theme-toggle--floating {
  position: absolute;
  top: 0;
  right: var(--view-header-padding-x);
  height: var(--view-header-height);
  border-bottom: 1px solid transparent;
  box-sizing: border-box;
  z-index: 100;
}
</style>
