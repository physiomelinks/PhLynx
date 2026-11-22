<template>
  <!-- Straight stretches of bilayer, each a strip filled with one lipid repeated: a pattern is drawn once per paint -->
  <g class="bio-bilayer-strips">
    <defs>
      <pattern
        :id="patternId"
        patternUnits="userSpaceOnUse"
        x="0"
        :y="-STRIP_HALF"
        :width="LIPID_PITCH"
        :height="2 * STRIP_HALF"
      >
        <!-- A tile's own coordinates start at its top left corner: the strip's line runs across its middle -->
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
      v-for="(strip, index) in strips"
      :key="index"
      :transform="strip.transform"
      x="0"
      :y="-STRIP_HALF"
      :width="strip.length"
      :height="2 * STRIP_HALF"
      :fill="`url(#${patternId})`"
    />
  </g>
</template>

<script setup>
import { useId } from 'vue'
import { HEAD_OFFSET, HEAD_RADIUS, LIPID_PITCH, STRIP_HALF, TAIL_HALF } from '../../services/bioView/geometry'

defineProps({
  /** Each stretch: from its start, `transform` turning it to run along +x, `length` long. */
  strips: { type: Array, required: true },
  /** Whether the tails are drawn across the membrane, as well as the two rows of heads. */
  tails: { type: Boolean, default: true },
})

const patternId = `bio-bilayer-strips-${useId()}`
</script>

<style scoped>
/* Colours come from whoever draws it: --bilayer-head and --bilayer-tail */
.bio-bilayer__head {
  fill: var(--bilayer-head);
}

.bio-bilayer__tail {
  fill: var(--bilayer-tail);
}
</style>
