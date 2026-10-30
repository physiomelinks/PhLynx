<template>
  <div
    :class="['bio-protein', `bio-protein--label-${labelSide}`, { 'bio-protein--selected': selected, 'bio-protein--unplaced': data.unplaced }]"
    :style="categoryStyle"
    :title="data.unplaced ? `${data.name}: not in a membrane` : data.name"
    data-testid="bio-protein"
  >
    <!-- Turned with its facet, so its outside faces out of the cell -->
    <div class="bio-protein__glyph" :style="{ transform: `rotate(${data.rotation ?? 0}deg)` }">
      <ProteinGlyph :glyph="data.glyph" :rotation="data.rotation ?? 0" />
    </div>
    <span class="bio-protein__label">{{ data.name }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import ProteinGlyph from './ProteinGlyph.vue'
import { useNodeThemeStore } from '../../stores/nodeThemeStore'
import { categoryStyle as themeCategoryStyle } from '../../utils/nodeThemes'

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

const nodeThemeStore = useNodeThemeStore()
const categoryStyle = computed(() => themeCategoryStyle(nodeThemeStore.activeTheme, props.data.domainType))

// The name goes on the cell's side of the protein, clear of the regions outside.
const INWARD = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const labelSide = computed(() => INWARD[props.data.outward] ?? 'bottom')
</script>

<style scoped>
.bio-protein {
  position: relative;
  width: 100%;
  height: 100%;
}

.bio-protein__glyph {
  position: absolute;
  inset: 0;
}

.bio-protein--selected .bio-protein__glyph {
  filter: drop-shadow(0 0 3px var(--p-primary-color)) drop-shadow(0 0 1px var(--p-primary-color));
}

.bio-protein--unplaced .bio-protein__glyph {
  opacity: 0.55;
}

.bio-protein__label {
  position: absolute;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-color);
  pointer-events: none;
}

.bio-protein--label-bottom .bio-protein__label {
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
}

.bio-protein--label-top .bio-protein__label {
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
}

.bio-protein--label-right .bio-protein__label {
  left: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}

.bio-protein--label-left .bio-protein__label {
  right: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}
</style>
