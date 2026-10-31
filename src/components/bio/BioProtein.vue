<template>
  <div
    :class="[
      'bio-protein',
      `bio-protein--label-${labelSide}`,
      { 'bio-protein--selected': selected, 'bio-protein--unplaced': data.unplaced },
    ]"
    :style="categoryStyle"
    :title="data.unplaced ? `${data.name}: not in a membrane` : data.name"
    data-testid="bio-protein"
  >
    <!-- Turned with its facet, so its outside faces out of the cell -->
    <div class="bio-protein__glyph" :style="{ transform: `rotate(${data.rotation ?? 0}deg)` }">
      <ProteinGlyph :glyph="data.glyph" :rotation="data.rotation ?? 0" :arrows="data.arrows ?? []" />
    </div>
    <BioHandles :handles="data.handles ?? []" />
    <span class="bio-protein__label">
      {{ data.name }}
      <span v-if="species" class="bio-protein__species" data-testid="bio-protein-species">{{ species }}</span>
    </span>
    <!-- Moved from where its annotations put it -->
    <span
      v-if="movedFrom"
      class="bio-protein__moved"
      :title="`The annotations put it on the ${movedFrom} membrane`"
      data-testid="bio-protein-moved"
    >
      <i class="pi pi-arrow-right-arrow-left"></i>
    </span>
  </div>
</template>

<script setup>
import BioHandles from './BioHandles.vue'
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

// What its arrows carry, in the order they show, left to right or top to bottom: a protein turned upside
// down, or a quarter turn back onto a cell's left side, shows them reversed.
const species = computed(() => {
  const labels = (props.data.arrows ?? []).map((arrow) => arrow.label)
  return ([180, -90, 270].includes(props.data.rotation) ? labels.reverse() : labels).join(' · ')
})

const movedFrom = computed(() => {
  const { annotatedFacet, facet, unplaced } = props.data
  return annotatedFacet && (unplaced || facet !== annotatedFacet) ? annotatedFacet : null
})
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
  /* Readable over a selected protein's coupling lines */
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--p-content-background) 70%, transparent);
}

.bio-protein__species {
  display: block;
  font-size: 10px;
  font-weight: 500;
  color: var(--p-text-muted-color);
  text-align: center;
}

.bio-protein__moved {
  position: absolute;
  top: -8px;
  right: -8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--p-orange-500);
  background: var(--p-content-background);
  color: var(--p-orange-500);
  cursor: help;
}

.bio-protein__moved .pi {
  font-size: 9px;
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
