<template>
  <!-- Drawn over its cell's bilayer: only the band is hit, so the cell inside stays the cell's to select -->
  <BioHandles :handles="data.handles ?? []" />
  <svg
    :class="['bio-membrane', { 'bio-membrane--selected': selected, 'bio-membrane--coupled': data.coupled && !selected }]"
    :width="data.width"
    :height="data.height"
    :viewBox="`0 0 ${data.width} ${data.height}`"
    overflow="visible"
    data-testid="bio-membrane"
  >
    <title>{{ data.name }}</title>
    <path class="bio-membrane__band" :d="leafletPath(data.width, data.height)" :stroke-width="BAND_WIDTH" />
    <BioBilayer
      v-if="selected || data.coupled"
      class="bio-membrane__heads"
      :width="data.width"
      :height="data.height"
      :tails="false"
    />
  </svg>
</template>

<script setup>
import { MEMBRANE_BAND_HALF, leafletPath } from '../../services/bioView/geometry'
import BioBilayer from './BioBilayer.vue'
import BioHandles from './BioHandles.vue'

defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

/** How wide the band that selects the membrane is: the same band a drop on the membrane takes. */
const BAND_WIDTH = 2 * MEMBRANE_BAND_HALF
</script>

<style scoped>
.bio-membrane {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.bio-membrane__band {
  fill: none;
  stroke: transparent;
  pointer-events: stroke;
  cursor: pointer;
}

.bio-membrane--coupled .bio-membrane__heads {
  opacity: 0.45;
}

.bio-membrane__heads {
  --bilayer-head: var(--p-primary-color);
  pointer-events: none;
}
</style>
