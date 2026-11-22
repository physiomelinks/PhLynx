<template>
  <!--
    The joint a link draws between the pieces it joins: between two tubes, the vessel's walls going on and narrowing
    to the resistance or valve its module is, with the flow through it; a gap junction, a channel across both cells'
    membranes, as its two connexons; a bridge, the open way through it, walled by what it runs through.
  -->
  <svg
    :class="['bio-joint-glyph', { 'bio-joint-glyph--empty': empty, 'bio-joint-glyph--selected': selected }]"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    overflow="visible"
    data-testid="bio-joint-glyph"
  >
    <defs>
      <marker :id="markerId" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" class="bio-joint-glyph__head" />
      </marker>
    </defs>
    <template v-if="kind === 'flow'">
      <path :d="lumen" class="bio-joint-glyph__lumen" :style="tone && { fill: `color-mix(in srgb, var(--p-${tone}-200) 40%, transparent)` }" />
      <path :d="wall(WALL / 2, neck)" class="bio-joint-glyph__wall" />
      <path :d="wall(height - WALL / 2, height - neck)" class="bio-joint-glyph__wall" />
      <line :x1="4" :y1="height / 2" :x2="width - 4" :y2="height / 2" class="bio-joint-glyph__flow" :marker-end="`url(#${markerId})`" />
    </template>
    <line
      v-else-if="kind !== 'junction'"
      v-bind="openWay"
      :class="[
        'bio-joint-glyph__flow',
        'bio-joint-glyph__open',
        { 'bio-joint-glyph__open--diffusion': kind === 'diffusion' },
      ]"
    />
    <template v-else>
      <line :x1="0" :y1="height / 2" :x2="width" :y2="height / 2" class="bio-joint-glyph__flow" />
      <rect
        v-for="x in barrels"
        :key="x"
        :x="x"
        :y="(height - BARREL.height) / 2"
        :width="BARREL.width"
        :height="BARREL.height"
        rx="5"
        class="bio-joint-glyph__barrel"
      />
      <line :x1="width / 2 - BARREL.width - 2" :y1="height / 2" :x2="width / 2 + BARREL.width + 2" :y2="height / 2" class="bio-joint-glyph__pore" />
    </template>
  </svg>
</template>

<script setup>
import { computed, useId } from 'vue'

const props = defineProps({
  /** 'flow' between tubes; 'junction', a gap junction between cells; 'bridge' or 'diffusion', an open way. */
  kind: { type: String, required: true },
  /** An open way's direction: down, across a bridge between a cell and one below it. */
  vertical: { type: Boolean, default: false },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  /** With no module in it yet: drawn faint, as a place to drop one. */
  empty: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  /** The colour of the tube it goes on from, for its lumen. */
  tone: { type: String, default: null },
})

/** A tube's wall, as BioRegion draws it, and how far in the joint narrows it. */
const WALL = 6
/** A connexon, one in each cell's membrane. */
const BARREL = { width: 20, height: 60 }

const markerId = `bio-joint-head-${useId()}`

/** How far in from the top (and up from the bottom) the walls come at the joint's narrowest. */
const neck = computed(() => Math.max(WALL, props.height * 0.3))

/** A wall from one tube's end to the other's, along `edge` and in to `inner` at the middle. */
function wall(edge, inner) {
  const w = props.width
  return `M 0 ${edge} C ${w * 0.3} ${edge} ${w * 0.35} ${inner} ${w / 2} ${inner} C ${w * 0.65} ${inner} ${w * 0.7} ${edge} ${w} ${edge}`
}

/** The lumen between the two walls, so the joint is filled as the tubes are. */
const lumen = computed(() => {
  const w = props.width
  const h = props.height
  const n = neck.value
  return (
    `M 0 ${WALL} C ${w * 0.3} ${WALL} ${w * 0.35} ${n} ${w / 2} ${n} C ${w * 0.65} ${n} ${w * 0.7} ${WALL} ${w} ${WALL} ` +
    `L ${w} ${h - WALL} C ${w * 0.7} ${h - WALL} ${w * 0.65} ${h - n} ${w / 2} ${h - n} C ${w * 0.35} ${h - n} ${w * 0.3} ${h - WALL} 0 ${h - WALL} Z`
  )
})

/** An open way's line: along the middle, across or down. */
const openWay = computed(() =>
  props.vertical
    ? { x1: props.width / 2, y1: 0, x2: props.width / 2, y2: props.height }
    : { x1: 0, y1: props.height / 2, x2: props.width, y2: props.height / 2 },
)

/** The two connexons, either side of the middle, where the cells' membranes are. */
const barrels = computed(() => [props.width / 2 - BARREL.width - 1, props.width / 2 + 1])
</script>

<style scoped>
.bio-joint-glyph {
  display: block;
  overflow: visible;
}

.bio-joint-glyph__lumen {
  fill: color-mix(in srgb, var(--p-sky-200) 40%, transparent);
}

.bio-joint-glyph__wall {
  fill: none;
  stroke: color-mix(in srgb, var(--p-text-muted-color) 55%, transparent);
  stroke-width: 6;
}

.bio-joint-glyph__flow {
  stroke: var(--p-text-color);
  stroke-width: 2;
}

.bio-joint-glyph__open--diffusion {
  stroke-dasharray: 8 6;
}

.bio-joint-glyph__head {
  fill: var(--p-text-color);
}

.bio-joint-glyph__barrel {
  fill: color-mix(in srgb, var(--p-amber-300) 70%, transparent);
  stroke: var(--p-amber-600);
  stroke-width: 1.5;
}

.bio-joint-glyph__pore {
  stroke: var(--p-content-background);
  stroke-width: 4;
}

.bio-joint-glyph--empty .bio-joint-glyph__barrel {
  fill: transparent;
  stroke: var(--p-text-muted-color);
  stroke-dasharray: 4 3;
}

.bio-joint-glyph--empty .bio-joint-glyph__flow {
  stroke: var(--p-text-muted-color);
  stroke-dasharray: 4 4;
}

.bio-joint-glyph--empty .bio-joint-glyph__head {
  fill: var(--p-text-muted-color);
}

.bio-joint-glyph--selected .bio-joint-glyph__wall,
.bio-joint-glyph--selected .bio-joint-glyph__barrel,
.bio-joint-glyph--selected .bio-joint-glyph__open {
  stroke: var(--p-primary-color);
}
</style>
