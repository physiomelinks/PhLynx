<template>
  <!-- Along each straight side, a strip filled with one lipid repeated (BioBilayerStrips); only the short corner arcs
       are dashed. A pattern is drawn once per paint, where dashes round the whole outline are thousands of pieces
       each time. -->
  <g class="bio-bilayer">
    <BioBilayerStrips :strips="sides" :tails="tails" />
    <!-- Each corner's arc is as many units long as it has lipids, whatever its radius, so one dash pattern puts
         both rows of heads and the tails between them on the same radii -->
    <path v-if="tails" class="bio-bilayer__tails" :d="leafletCorners(width, height)" :pathLength="cornerLength" />
    <path class="bio-bilayer__heads" :d="leafletCorners(width, height, HEAD_OFFSET)" :pathLength="cornerLength" />
    <path class="bio-bilayer__heads" :d="leafletCorners(width, height, -HEAD_OFFSET)" :pathLength="cornerLength" />
    <!-- Round the end of each fold, the same way -->
    <g v-for="end in foldEnds" :key="`fold-${end.edge}`" :transform="end.transform">
      <path v-if="tails" class="bio-bilayer__tails" :d="end.d" :pathLength="end.lipids" />
      <path class="bio-bilayer__heads" :d="end.outer" :pathLength="end.lipids" />
      <path class="bio-bilayer__heads" :d="end.inner" :pathLength="end.lipids" />
    </g>
  </g>
</template>

<script setup>
import { computed } from 'vue'
import BioBilayerStrips from './BioBilayerStrips.vue'
import {
  HEAD_OFFSET,
  cornerLipids,
  leafletCorners,
  leafletFoldEnds,
  leafletSides,
} from '../../services/bioView/geometry'

const props = defineProps({
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  /** Whether the tails are drawn across the membrane, as well as the two rows of heads. */
  tails: { type: Boolean, default: true },
  /** The cell's folds, from foldPocket: the bilayer follows the outline in round each. */
  folds: { type: Array, default: () => [] },
})

const sides = computed(() => leafletSides(props.width, props.height, props.folds))
/** Each fold's rounded end, with its two rows of heads. */
const foldEnds = computed(() => {
  const ends = (offset) => leafletFoldEnds(props.width, props.height, props.folds, offset)
  const outer = ends(HEAD_OFFSET)
  const inner = ends(-HEAD_OFFSET)
  return ends(0).map((end, index) => ({ ...end, outer: outer[index].d, inner: inner[index].d }))
})
/** The four corner arcs' length together, in lipids. */
const cornerLength = computed(() => 4 * cornerLipids(props.width, props.height))
</script>

<style scoped>
/* Colours come from whoever draws it: --bilayer-head and --bilayer-tail */
.bio-bilayer__heads {
  fill: none;
  stroke: var(--bilayer-head);
  stroke-width: 4.5;
  stroke-linecap: round;
  /* In lipids (see pathLength): one head each, half a space in from the arc's ends */
  stroke-dasharray: 0 1;
  stroke-dashoffset: 0.5;
}

.bio-bilayer__tails {
  fill: none;
  stroke: var(--bilayer-tail);
  stroke-width: 9;
  stroke-dasharray: 0.2 0.8;
  stroke-dashoffset: 0.6;
}
</style>
