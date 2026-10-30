<template>
  <!-- Drawn with the outside of the cell up; the membrane runs across the middle -->
  <svg class="protein-glyph" :class="`protein-glyph--${kind}`" viewBox="0 0 64 48" :data-glyph="kind">
    <template v-if="kind === 'channel'">
      <rect class="protein-glyph__body" x="6" y="3" width="22" height="42" rx="9" />
      <rect class="protein-glyph__body" x="36" y="3" width="22" height="42" rx="9" />
      <rect class="protein-glyph__pore" x="28" y="3" width="8" height="42" />
    </template>
    <template v-else-if="kind === 'uniporter'">
      <path class="protein-glyph__body" d="M 8 12 Q 8 3 18 3 L 26 3 L 32 16 L 38 3 L 46 3 Q 56 3 56 12 L 56 36 Q 56 45 46 45 L 18 45 Q 8 45 8 36 Z" />
    </template>
    <template v-else-if="kind === 'pump'">
      <rect class="protein-glyph__body" x="4" y="3" width="48" height="42" rx="14" />
      <!-- ATP bound at the side, on the cell's half, so it reads as driving the pump, not as its cargo -->
      <circle class="protein-glyph__atp" cx="52" cy="34" r="7.5" />
      <!-- Kept upright, however the cartoon is turned -->
      <text class="protein-glyph__atp-label" x="52" y="36.5" :transform="`rotate(${-rotation} 52 34)`">ATP</text>
    </template>
    <template v-else>
      <rect class="protein-glyph__body" x="6" y="3" width="52" height="42" rx="15" />
    </template>

    <circle v-for="(spot, i) in substrates" :key="`s${i}`" class="protein-glyph__substrate" :cx="spot.x" :cy="spot.y" r="3.5" />
    <g v-for="(arrow, i) in arrows" :key="`a${i}`" class="protein-glyph__arrow">
      <line :x1="arrow.x" :y1="arrow.from" :x2="arrow.x" :y2="arrow.to - Math.sign(arrow.to - arrow.from) * 4" />
      <polygon :points="arrowHead(arrow)" />
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue'
import { GLYPHS } from '../../services/bioView/glyphs'

const props = defineProps({
  glyph: { type: String, default: 'generic' },
  /** How far the cartoon is turned, so its text can stay upright. */
  rotation: { type: Number, default: 0 },
})

const kind = computed(() => (GLYPHS.includes(props.glyph) ? props.glyph : 'generic'))

// Movement across the membrane: down is into the cell.
const ARROWS = {
  channel: [{ x: 32, from: 9, to: 39 }],
  uniporter: [{ x: 32, from: 20, to: 40 }],
  symporter: [
    { x: 22, from: 15, to: 38 },
    { x: 42, from: 15, to: 38 },
  ],
  antiporter: [
    { x: 22, from: 15, to: 38 },
    { x: 42, from: 38, to: 15 },
  ],
  pump: [{ x: 28, from: 9, to: 39 }],
  generic: [],
}

const SUBSTRATES = {
  symporter: [
    { x: 22, y: 10 },
    { x: 42, y: 10 },
  ],
  antiporter: [
    { x: 22, y: 10 },
    { x: 42, y: 43 },
  ],
}

const arrows = computed(() => ARROWS[kind.value])
const substrates = computed(() => SUBSTRATES[kind.value] ?? [])

/** A filled arrowhead at an arrow's end, pointing the way it goes. */
function arrowHead({ x, from, to }) {
  const dir = Math.sign(to - from)
  return `${x - 3.5},${to - dir * 5} ${x + 3.5},${to - dir * 5} ${x},${to}`
}
</script>

<style scoped>
.protein-glyph {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.protein-glyph__body {
  fill: var(--node-fill, var(--p-emerald-500));
  stroke: color-mix(in srgb, var(--node-fill, var(--p-emerald-500)) 60%, black);
  stroke-width: 2;
}

.protein-glyph__pore {
  fill: color-mix(in srgb, var(--node-fill, var(--p-emerald-500)) 25%, white);
}

.protein-glyph__atp {
  fill: var(--p-amber-400);
  stroke: var(--p-amber-700);
  stroke-width: 1.5;
}

.protein-glyph__atp-label {
  font-size: 6px;
  font-weight: 700;
  text-anchor: middle;
  fill: var(--p-amber-900);
}

.protein-glyph__substrate {
  fill: white;
  stroke: color-mix(in srgb, var(--node-fill, var(--p-emerald-500)) 60%, black);
  stroke-width: 1.5;
}

.protein-glyph__arrow line {
  stroke: white;
  stroke-width: 2.5;
  stroke-linecap: round;
}

.protein-glyph__arrow polygon {
  fill: white;
}

/* Through the pale pore, where white would vanish */
.protein-glyph--channel .protein-glyph__arrow line {
  stroke: color-mix(in srgb, var(--node-fill, var(--p-emerald-500)) 60%, black);
}

.protein-glyph--channel .protein-glyph__arrow polygon {
  fill: color-mix(in srgb, var(--node-fill, var(--p-emerald-500)) 60%, black);
}
</style>
