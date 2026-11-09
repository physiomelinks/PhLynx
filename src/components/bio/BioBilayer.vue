<template>
  <!-- Along each straight side, a strip filled with one lipid repeated; only the short corner arcs are dashed. A
       pattern is drawn once per paint, where dashes round the whole outline are thousands of pieces each time. -->
  <g class="bio-bilayer">
    <defs>
      <pattern
        :id="patternId"
        patternUnits="userSpaceOnUse"
        x="0"
        :y="-STRIP_HALF"
        :width="LIPID_PITCH"
        :height="2 * STRIP_HALF"
      >
        <!-- A tile's own coordinates start at its top left corner: the outline runs across its middle -->
        <rect
          v-if="tails"
          class="bio-bilayer__tail"
          :x="LIPID_PITCH / 2 - 0.5"
          :y="STRIP_HALF - TAIL_HALF"
          width="1"
          :height="2 * TAIL_HALF"
        />
        <circle class="bio-bilayer__head" :cx="LIPID_PITCH / 2" :cy="STRIP_HALF - HEAD_OFFSET" :r="HEAD_RADIUS" />
        <circle class="bio-bilayer__head" :cx="LIPID_PITCH / 2" :cy="STRIP_HALF + HEAD_OFFSET" :r="HEAD_RADIUS" />
      </pattern>
    </defs>
    <rect
      v-for="side in sides"
      :key="side.edge"
      :transform="side.transform"
      x="0"
      :y="-STRIP_HALF"
      :width="side.length"
      :height="2 * STRIP_HALF"
      :fill="`url(#${patternId})`"
    />
    <path v-if="tails" class="bio-bilayer__tails" :d="leafletCorners(width, height)" />
    <path class="bio-bilayer__heads" :d="leafletCorners(width, height, HEAD_OFFSET)" />
    <path class="bio-bilayer__heads" :d="leafletCorners(width, height, -HEAD_OFFSET)" />
  </g>
</template>

<script setup>
import { computed, useId } from 'vue'
import { HEAD_OFFSET, LIPID_PITCH, leafletCorners, leafletSides } from '../../services/bioView/geometry'

const props = defineProps({
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  /** Whether the tails are drawn across the membrane, as well as the two rows of heads. */
  tails: { type: Boolean, default: true },
})

/** A head group's radius; the tails reach across the membrane between the rows of heads. */
const HEAD_RADIUS = 2.25
const TAIL_HALF = 4.5
/** Half the strip's width: room for both rows of heads. */
const STRIP_HALF = HEAD_OFFSET + HEAD_RADIUS + 1

const patternId = `bio-bilayer-${useId()}`
const sides = computed(() => leafletSides(props.width, props.height))
</script>

<style scoped>
/* Colours come from whoever draws it: --bilayer-head and --bilayer-tail */
.bio-bilayer__head {
  fill: var(--bilayer-head);
}

.bio-bilayer__tail {
  fill: var(--bilayer-tail);
}

.bio-bilayer__heads {
  fill: none;
  stroke: var(--bilayer-head);
  stroke-width: 4.5;
  stroke-linecap: round;
  stroke-dasharray: 0 5;
}

.bio-bilayer__tails {
  fill: none;
  stroke: var(--bilayer-tail);
  stroke-width: 9;
  stroke-dasharray: 1 4;
}
</style>
