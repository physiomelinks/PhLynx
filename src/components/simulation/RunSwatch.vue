<template>
  <!-- A short line in a run's dash, as its lines are drawn. -->
  <svg class="run-swatch" :width="width" height="4" :viewBox="`0 0 ${width} 4`" aria-hidden="true">
    <line x1="0" y1="2" :x2="width" y2="2" :stroke="colour" stroke-width="2" :stroke-dasharray="dashArray" />
  </svg>
</template>

<script setup>
/**
 * A swatch of a run's line: solid for the live run, dashed for a tracked run, scaled down from its dash so a
 * few repeats fit.
 */
import { computed } from 'vue'

const props = defineProps({
  colour: { type: String, required: true },
  // The run's dash, or null for a solid line.
  dash: { type: Array, default: null },
  width: { type: Number, default: 18 },
})

const dashArray = computed(() => (props.dash ? props.dash.map((length) => length / 2).join(' ') : null))
</script>

<style scoped>
.run-swatch {
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
