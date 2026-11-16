<template>
  <div :class="['bio-card', { 'bio-card--selected': selected, 'bio-card--inside': data.inside }]" :style="categoryStyle" data-testid="bio-card">
    <BioHandles :handles="data.handles ?? []" />
    <!-- A process's cartoon, when it has one, beside its name -->
    <ProteinGlyph v-if="data.glyph" class="bio-card__glyph" :glyph="data.glyph" data-testid="bio-card-glyph" />
    <span class="bio-card__name">{{ data.name }}</span>
    <BioUncoupledBadge v-if="data.uncoupled" :name="data.name" />
  </div>
</template>

<script setup>
import BioHandles from './BioHandles.vue'
import ProteinGlyph from './ProteinGlyph.vue'
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

.bio-card__glyph {
  flex: none;
  width: 64px;
  height: 48px;
}

/* A process in a cell: tinted by the cell behind it, so it reads as part of the cell */
.bio-card--inside {
  border-color: color-mix(in srgb, var(--p-amber-500) 55%, transparent);
  background: color-mix(in srgb, var(--node-fill, var(--p-content-background)) 40%, transparent);
  box-shadow: none;
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
