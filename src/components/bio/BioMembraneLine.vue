<template>
  <!-- A membrane drawn by its line skin, inside the band a bilayer takes and round the cell's folds -->
  <g :class="['bio-membrane-line', `bio-membrane-line--${kind}`]" :data-skin="kind" data-testid="bio-membrane-line">
    <template v-if="kind === 'double-membrane'">
      <path v-if="tails" class="bio-membrane-line__core" :d="leaflet(0)" />
      <path class="bio-membrane-line__leaf" :d="leaflet(DOUBLE_OFFSET)" />
      <path class="bio-membrane-line__leaf" :d="leaflet(-DOUBLE_OFFSET)" />
    </template>
    <path v-else-if="kind === 'wall'" class="bio-membrane-line__wall" :d="leaflet(0)" />
    <template v-else>
      <path v-if="tails" class="bio-membrane-line__core" :d="leaflet(0)" />
      <BioBilayer :width="width" :height="height" :folds="folds" :tails="tails" />
    </template>
  </g>
</template>

<script setup>
import { computed } from 'vue'
import BioBilayer from './BioBilayer.vue'
import { HEAD_OFFSET, leafletPath } from '../../services/bioView/geometry'

const props = defineProps({
  /** The line skin's id: 'bilayer', 'double-membrane' or 'wall'; any other is drawn as a bilayer. */
  skin: { type: String, default: 'bilayer' },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  /** The cell's folds, from foldPocket: the line follows the outline in round each. */
  folds: { type: Array, default: () => [] },
  /** Whether what lies between its outer lines is drawn, as well as the lines themselves. */
  tails: { type: Boolean, default: true },
})

/** How far each of a double membrane's two leaves is from the outline: within a bilayer's head groups. */
const DOUBLE_OFFSET = HEAD_OFFSET - 2

const kind = computed(() => (['double-membrane', 'wall'].includes(props.skin) ? props.skin : 'bilayer'))

const leaflet = (offset) => leafletPath(props.width, props.height, offset, props.folds)
</script>

<style scoped>
/* Colours come from whoever draws it: --bilayer-head, --bilayer-tail and --bilayer-core */
.bio-membrane-line__core {
  fill: none;
  stroke: var(--bilayer-core);
  stroke-width: 14;
}

.bio-membrane-line__leaf {
  fill: none;
  stroke: var(--bilayer-head);
  stroke-width: 3;
}

.bio-membrane-line__wall {
  fill: none;
  stroke: var(--bilayer-tail);
  stroke-width: 10;
}
</style>
