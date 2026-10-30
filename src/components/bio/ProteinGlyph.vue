<template>
  <!-- Drawn with the outside of the cell up; the membrane runs across the middle -->
  <svg class="protein-glyph" :class="`protein-glyph--${kind}`" viewBox="0 0 64 48" :data-glyph="kind">
    <template v-if="kind === 'channel'">
      <rect class="protein-glyph__body" x="6" y="3" width="22" height="42" rx="9" />
      <rect class="protein-glyph__body" x="36" y="3" width="22" height="42" rx="9" />
      <rect class="protein-glyph__pore" x="28" y="3" width="8" height="42" />
    </template>
    <template v-else-if="kind === 'uniporter'">
      <path
        class="protein-glyph__body"
        d="M 8 12 Q 8 3 18 3 L 26 3 L 32 16 L 38 3 L 46 3 Q 56 3 56 12 L 56 36 Q 56 45 46 45 L 18 45 Q 8 45 8 36 Z"
      />
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

    <!-- What it carries: one arrow per species (named in its label), down into the cell or up out of it, both ways until a run says -->
    <g
      v-for="arrow in placedArrows"
      :key="arrow.label"
      class="protein-glyph__arrow"
      :data-species="arrow.label"
      :data-direction="arrow.direction ?? 'both'"
    >
      <line
        :x1="arrow.x"
        :y1="arrow.top + (arrow.direction === 'in' ? 0 : 4)"
        :x2="arrow.x"
        :y2="arrow.bottom - (arrow.direction === 'out' ? 0 : 4)"
      />
      <polygon v-if="arrow.direction !== 'out'" :points="head(arrow.x, arrow.bottom, 1)" />
      <polygon v-if="arrow.direction !== 'in'" :points="head(arrow.x, arrow.top, -1)" />
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
  /** What it carries: [{ label, direction: 'in'|'out'|null }], null when the way isn't known. */
  arrows: { type: Array, default: () => [] },
})

const kind = computed(() => (GLYPHS.includes(props.glyph) ? props.glyph : 'generic'))

/** Where each cartoon has room for arrows: across, and from its outside edge to its inside one. */
const ROOM = {
  channel: { left: 29, right: 35, top: 6, bottom: 42 },
  uniporter: { left: 20, right: 44, top: 18, bottom: 41 },
  pump: { left: 14, right: 40, top: 7, bottom: 41 },
  generic: { left: 18, right: 46, top: 7, bottom: 41 },
}

// Spread evenly across the room; one alone goes down its middle, as through a channel's pore.
const placedArrows = computed(() => {
  const room = ROOM[kind.value] ?? ROOM.generic
  const count = props.arrows.length
  return props.arrows.map((arrow, i) => ({
    ...arrow,
    x: count > 1 ? room.left + ((room.right - room.left) * i) / (count - 1) : (room.left + room.right) / 2,
    top: room.top,
    bottom: room.bottom,
  }))
})

/** An arrowhead with its tip at (x, y), pointing down (1) or up (-1). */
function head(x, y, dir) {
  return `${x - 3.5},${y - dir * 5} ${x + 3.5},${y - dir * 5} ${x},${y}`
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
