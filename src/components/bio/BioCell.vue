<template>
  <div :class="['bio-cell', { 'bio-cell--selected': selected }]" data-testid="bio-cell">
    <svg class="bio-cell__art" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" overflow="visible">
      <path class="bio-cell__cytosol" :d="leaflet(-HEAD_OFFSET)" />
      <!-- The lipid bilayer: two rows of head groups with their tails meeting in the middle -->
      <g class="bio-cell__bilayer" data-testid="bio-bilayer">
        <path class="bio-cell__core" :d="leaflet(0)" />
        <!-- A wide stroke of short dashes draws the tails across the membrane -->
        <path class="bio-cell__tails" :d="leaflet(0)" />
        <path class="bio-cell__heads" :d="leaflet(HEAD_OFFSET)" />
        <path class="bio-cell__heads" :d="leaflet(-HEAD_OFFSET)" />
      </g>
    </svg>
    <BioHandles :handles="data.handles ?? []" />
    <span class="bio-cell__label">{{ data.name }}</span>
  </div>
</template>

<script setup>
import BioHandles from './BioHandles.vue'
import { CELL_RADIUS, roundedRectPath } from '../../services/bioView/geometry'

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
})


/** How far each leaflet's head groups sit out from (or in from) the cell's outline. */
const HEAD_OFFSET = 7

/** The cell's outline grown by an offset, outward when positive. */
function leaflet(offset) {
  const rect = { x: -offset, y: -offset, width: props.width + 2 * offset, height: props.height + 2 * offset }
  return roundedRectPath(rect, CELL_RADIUS + offset)
}
</script>

<style scoped>
.bio-cell {
  position: relative;
  width: 100%;
  height: 100%;
}

.bio-cell__art {
  position: absolute;
  inset: 0;
}

.bio-cell__cytosol {
  fill: color-mix(in srgb, var(--p-amber-200) 45%, var(--p-content-background));
}

.bio-cell__core {
  fill: none;
  stroke: color-mix(in srgb, var(--p-amber-200) 70%, var(--p-content-background));
  stroke-width: 14;
}

.bio-cell__tails {
  fill: none;
  stroke: var(--p-amber-600);
  stroke-width: 9;
  stroke-dasharray: 1 4;
}

.bio-cell__heads {
  fill: none;
  stroke: var(--p-amber-700);
  stroke-width: 4.5;
  stroke-linecap: round;
  stroke-dasharray: 0 5;
}

.bio-cell--selected .bio-cell__heads {
  stroke: var(--p-primary-color);
}

.bio-cell__label {
  position: absolute;
  left: 50%;
  bottom: 30%;
  transform: translateX(-50%);
  font-weight: 600;
  color: var(--p-amber-900);
}

.p-dark .bio-cell__label {
  color: var(--p-amber-200);
}
</style>
