<template>
  <div :class="['bio-card', { 'bio-card--selected': selected }]" :style="categoryStyle" data-testid="bio-card">
    <BioHandles :handles="data.handles ?? []" />
    <!-- A process's symbol, when it has one, beside its name -->
    <BioSymbol v-if="data.skin" class="bio-card__symbol" :skin="data.skin" data-testid="bio-card-symbol" />
    <span class="bio-card__name">{{ data.name }}</span>
    <BioUncoupledBadge v-if="data.uncoupled" :name="data.name" />
  </div>
</template>

<script setup>
import BioHandles from './BioHandles.vue'
import BioSymbol from './BioSymbol.vue'
import BioUncoupledBadge from './BioUncoupledBadge.vue'
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
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  border: 1px solid var(--p-content-border-color);
  background: var(--node-fill, var(--p-content-background));
  font-weight: 600;
}

.bio-card__symbol {
  flex: none;
  width: 64px;
  height: 48px;
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
