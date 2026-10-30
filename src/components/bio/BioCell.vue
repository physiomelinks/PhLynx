<template>
  <div :class="['bio-cell', { 'bio-cell--selected': selected }]" data-testid="bio-cell">
    <svg class="bio-cell__art" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" overflow="visible">
      <path class="bio-cell__cytosol" :d="outline" />
      <path class="bio-cell__membrane" :d="outline" />
    </svg>
    <span class="bio-cell__label">{{ data.name }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { roundedRectPath } from '../../services/bioView/geometry'

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
})

const outline = computed(() => roundedRectPath({ x: 0, y: 0, width: props.width, height: props.height }))
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

.bio-cell__membrane {
  fill: none;
  stroke: var(--p-amber-700);
  stroke-width: 8;
}

.bio-cell--selected .bio-cell__membrane {
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
</style>
