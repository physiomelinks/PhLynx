<template>
  <div
    :class="[
      'bio-region',
      `bio-region--tone-${tone}`,
      edge && `bio-region--edge-${edge}`,
      { 'bio-region--selected': selected },
    ]"
    data-testid="bio-region"
  >
    <BioHandles :handles="data.handles ?? []" />
    <span class="bio-region__label">{{ data.name }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import BioHandles from './BioHandles.vue'
import { partOf } from '../../services/bioView/geometry'
import { EPITHELIAL_SHAPE, facetById } from '../../services/bioView/shape'

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

/** The colour of a region against each of the epithelial cell's facets, or of a region against none. */
const TONES = { apical: 'sky', basolateral: 'rose', lateral: 'teal' }
const DEFAULT_TONE = 'sky'

/** The edge of the cell the region lies against: a left one with no side given, as layout puts it. */
const edge = computed(() => {
  if (!props.data.side) return null
  return facetById(EPITHELIAL_SHAPE, partOf(props.data.side, props.data.at ?? undefined))?.edge ?? null
})
const tone = computed(() => TONES[props.data.side] ?? DEFAULT_TONE)
</script>

<style scoped>
.bio-region {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  background: color-mix(in srgb, var(--p-sky-200) 40%, transparent);
  border: 2px solid transparent;
}

.bio-region--tone-rose {
  background: color-mix(in srgb, var(--p-rose-200) 40%, transparent);
}

.bio-region--tone-teal {
  background: color-mix(in srgb, var(--p-teal-200) 45%, transparent);
}

.bio-region--tone-amber {
  background: color-mix(in srgb, var(--p-amber-200) 40%, transparent);
}

.bio-region--tone-violet {
  background: color-mix(in srgb, var(--p-violet-200) 40%, transparent);
}

.bio-region--tone-lime {
  background: color-mix(in srgb, var(--p-lime-200) 40%, transparent);
}

.bio-region--tone-slate {
  background: color-mix(in srgb, var(--p-slate-200) 40%, transparent);
}

/* Its top runs under the cells, so its name goes at the bottom, clear of their corners */
.bio-region--edge-bottom .bio-region__label {
  position: absolute;
  left: 0;
  bottom: 0;
}

/* Narrow, down a cell's side, so its name runs down it, on the outer side away from the cell */
.bio-region--edge-left .bio-region__label,
.bio-region--edge-right .bio-region__label {
  writing-mode: vertical-rl;
  padding: 12px 8px;
}

.bio-region--edge-right .bio-region__label {
  position: absolute;
  top: 0;
  right: 0;
}

.bio-region--selected {
  border-color: var(--p-primary-color);
}

.bio-region__label {
  display: block;
  padding: 8px 12px;
  font-weight: 600;
  color: var(--p-text-muted-color);
}
</style>
