<template>
  <div :class="['bio-cell', { 'bio-cell--selected': selected, 'bio-cell--empty': data.empty }]" data-testid="bio-cell">
    <svg class="bio-cell__art" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" overflow="visible">
      <!-- A template's cell with no module in it yet: just where it goes -->
      <path v-if="data.empty" class="bio-cell__outline" :d="leaflet(0)" data-testid="bio-cell-outline" />
      <path v-else class="bio-cell__cytosol" :d="leaflet(-HEAD_OFFSET)" />
      <!-- The lipid bilayer: two rows of head groups with their tails meeting in the middle -->
      <g v-if="!data.empty" class="bio-cell__bilayer" data-testid="bio-bilayer">
        <path class="bio-cell__core" :d="leaflet(0)" />
        <!-- A wide stroke of short dashes draws the tails across the membrane -->
        <path class="bio-cell__tails" :d="leaflet(0)" />
        <path class="bio-cell__heads" :d="leaflet(HEAD_OFFSET)" />
        <path class="bio-cell__heads" :d="leaflet(-HEAD_OFFSET)" />
      </g>
      <!-- A template's process areas, where cards for what goes on in the cell are put -->
      <g
        v-for="zone in data.zones ?? []"
        :key="zone.processId ?? 'process'"
        class="bio-cell__zone"
        data-testid="bio-process-zone"
      >
        <rect :x="zone.rect.x" :y="zone.rect.y" :width="zone.rect.width" :height="zone.rect.height" rx="8" />
        <text v-if="zone.label" :x="zone.rect.x + 8" :y="zone.rect.y + 12">{{ zone.label }}</text>
      </g>
    </svg>
    <!-- A template's names for its facets, just inside each edge -->
    <span
      v-for="label in facetLabels"
      :key="label.facetId"
      :class="['bio-cell__facet', `bio-cell__facet--${label.edge}`]"
      :style="label.style"
      data-testid="bio-facet-label"
    >
      {{ label.label }}
    </span>
    <BioHandles :handles="data.handles ?? []" />
    <span class="bio-cell__label" :style="labelStyle">
      {{ data.name }}
      <small v-if="data.empty" class="bio-cell__hint" data-testid="bio-empty-hint">Drop a module</small>
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
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

/** How far in from the outline a facet's name sits, clear of the bilayer drawn over the edge. */
const FACET_INSET = 14

/** Each facet's name, spread along its edge when an edge has more than one. */
const facetLabels = computed(() => {
  const labels = props.data.facetLabels ?? []
  return labels.map((label) => {
    const along = labels.filter((other) => other.edge === label.edge)
    const share = `${(100 * along.indexOf(label)) / along.length}%`
    const span = `${100 / along.length}%`
    const style = {
      top: { top: `${FACET_INSET}px`, left: share, width: span },
      bottom: { bottom: `${FACET_INSET}px`, left: share, width: span },
      left: { left: `${FACET_INSET}px`, top: share, height: span },
      right: { right: `${FACET_INSET}px`, top: share, height: span },
    }[label.edge]
    return { ...label, style }
  })
})

/** A template cell's name goes just under its process zones, clear of them; any other's as before. */
const labelStyle = computed(() => {
  const zones = props.data.zones ?? []
  if (!zones.length) return undefined
  return { top: `${Math.max(...zones.map(({ rect }) => rect.y + rect.height)) + 6}px`, bottom: 'auto' }
})

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

.bio-cell__outline {
  fill: color-mix(in srgb, var(--p-amber-100) 35%, var(--p-content-background));
  stroke: var(--p-amber-500);
  stroke-width: 2;
  stroke-dasharray: 8 6;
}

.bio-cell--selected .bio-cell__outline {
  stroke: var(--p-primary-color);
}

.bio-cell--empty .bio-cell__label {
  color: var(--p-text-muted-color);
  text-align: center;
}

.bio-cell__hint {
  display: block;
  font-weight: 400;
  font-size: 0.75rem;
}

.bio-cell__zone rect {
  fill: none;
  stroke: var(--p-amber-500);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  opacity: 0.6;
}

.bio-cell__zone text {
  font-size: 10px;
  fill: var(--p-text-muted-color);
}

.bio-cell__facet {
  position: absolute;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 10px;
  line-height: 1;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0.8;
}

.bio-cell__facet--left,
.bio-cell__facet--right {
  writing-mode: vertical-rl;
}

.bio-cell__facet--left {
  transform: rotate(180deg);
}
</style>
