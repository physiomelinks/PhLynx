<template>
  <div
    :class="[
      'bio-protein',
      `bio-protein--label-${labelSide}`,
      { 'bio-protein--selected': selected, 'bio-protein--coupled': data.coupled && !selected, 'bio-protein--unplaced': data.unplaced },
    ]"
    :title="data.unplaced ? `${data.name}: not in a membrane` : data.name"
    data-testid="bio-protein"
  >
    <!-- Turned with its facet, so its outside faces out of the cell -->
    <div class="bio-protein__symbol" :style="{ transform: `rotate(${data.rotation ?? 0}deg)` }">
      <BioSymbol
        :skin="data.skin"
        :rotation="data.rotation ?? 0"
        :arrows="data.arrows ?? []"
        :halo="selected ? 'selected' : data.coupled ? 'coupled' : null"
      />
    </div>
    <BioHandles :handles="data.handles ?? []" />
    <span class="bio-protein__label">
      {{ data.name }}
      <span v-if="species" class="bio-protein__species" data-testid="bio-protein-species">{{ species }}</span>
    </span>
    <BioUncoupledBadge v-if="data.uncoupled" :name="data.name" :inset="!!data.inset" />
  </div>
</template>

<script setup>
import BioHandles from './BioHandles.vue'
import { computed } from 'vue'
import BioSymbol from './BioSymbol.vue'
import BioUncoupledBadge from './BioUncoupledBadge.vue'

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

// The name goes on the cell's side of the protein, clear of the regions outside.
const INWARD = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const labelSide = computed(() => INWARD[props.data.outward] ?? 'bottom')

// What its arrows carry, in the order they show, left to right or top to bottom: a protein turned upside
// down, or a quarter turn back onto a cell's left side, shows them reversed.
const species = computed(() => {
  const labels = (props.data.arrows ?? []).map((arrow) => arrow.label)
  return ([180, -90, 270].includes(props.data.rotation) ? labels.reverse() : labels).join(' · ')
})
</script>

<style scoped>
.bio-protein {
  position: relative;
  width: 100%;
  height: 100%;
}

.bio-protein__symbol {
  position: absolute;
  inset: 0;
}

.bio-protein--unplaced .bio-protein__symbol {
  opacity: 0.55;
}

/* Cut short past the width its slot was spaced for (see PROTEIN_LABEL); the full name is in the title */
.bio-protein__label {
  position: absolute;
  box-sizing: border-box;
  max-width: 168px;
  overflow: hidden;
  text-overflow: ellipsis;
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
