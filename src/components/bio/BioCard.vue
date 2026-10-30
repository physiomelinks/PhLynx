<template>
  <div :class="['bio-card', { 'bio-card--selected': selected }]" :style="categoryStyle" data-testid="bio-card">
    <BioHandles :handles="data.handles ?? []" />
    <span class="bio-card__name">{{ data.name }}</span>
  </div>
</template>

<script setup>
import BioHandles from './BioHandles.vue'
import { computed } from 'vue'
import { useNodeThemeStore } from '../../stores/nodeThemeStore'
import { categoryStyle as themeCategoryStyle } from '../../utils/nodeThemes'

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})


const nodeThemeStore = useNodeThemeStore()
const categoryStyle = computed(() => themeCategoryStyle(nodeThemeStore.activeTheme, props.data.domainType))
</script>

<style scoped>
.bio-card {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid var(--p-content-border-color);
  background: var(--node-fill, var(--p-content-background));
  font-weight: 600;
}

.bio-card--selected {
  outline: 2px solid var(--p-primary-color);
}
</style>

<style>
.p-dark .bio-card {
  background: var(--node-fill-dark, var(--p-content-background));
}
</style>
