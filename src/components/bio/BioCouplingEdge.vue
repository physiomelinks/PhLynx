<template>
  <!-- A selected instance's coupling, straight from the face it's on; hover it to read what it couples -->
  <BaseEdge :id="id" :path="path[0]" class="bio-coupling-edge" />
  <path class="bio-coupling-edge__hover" :d="path[0]">
    <title>{{ (data?.names ?? []).join('\n') }}</title>
  </path>
</template>

<script setup>
import { computed } from 'vue'
import { BaseEdge, getStraightPath } from '@vue-flow/core'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  id: { type: String, required: true },
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  data: { type: Object, default: () => ({}) },
})

const path = computed(() => getStraightPath(props))
</script>

<style scoped>
:global(.vue-flow__edge-path.bio-coupling-edge) {
  stroke: var(--p-primary-color);
  stroke-width: 2.5;
}

/* Wide and invisible, so the line is easy to hover */
.bio-coupling-edge__hover {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
  pointer-events: stroke;
}
</style>
