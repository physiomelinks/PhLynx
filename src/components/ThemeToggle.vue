<template>
  <div class="theme-toggle" v-tooltip.bottom="isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'">
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

const { isDarkMode, toggleDarkMode } = useColorScheme()
</script>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
}
</style>
