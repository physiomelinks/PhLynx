<template>
  <!--
    The joint a link draws between the pieces it joins: between two tubes, the vessel's walls going on and narrowing
    to the resistance or valve its module is, with the flow through it; a gap junction, a channel across both cells'
    membranes, as its two connexons; a bridge, the open way through it, walled by what it runs through. Its skin
    may say otherwise: another of these, or a symbol, fitted into the joint and turned with it.
  -->
  <svg
    :class="['bio-joint-symbol', { 'bio-joint-symbol--selected': selected }]"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    overflow="visible"
    data-testid="bio-joint-symbol"
  >
    <g v-if="symbol" :transform="vertical ? `rotate(90 ${width / 2} ${height / 2})` : undefined">
      <BioSymbol
        :skin="symbol.id"
        :x="fit.x"
        :y="fit.y"
        :width="fit.width"
        :height="fit.height"
        preserveAspectRatio="xMidYMid meet"
        data-testid="bio-joint-skin"
      />
    </g>
    <template v-else-if="drawn === 'flow'">
      <path :d="lumen" class="bio-joint-symbol__lumen" :style="tone && { fill: `color-mix(in srgb, var(--p-${tone}-200) 40%, transparent)` }" />
      <path :d="wall(WALL / 2, neck)" class="bio-joint-symbol__wall" />
      <path :d="wall(height - WALL / 2, height - neck)" class="bio-joint-symbol__wall" />
      <!-- A chevron at its neck, pointing the way it flows, as along a conduit's vessel -->
      <path
        :d="`M ${width / 2 - 4} ${height / 2 - 7} L ${width / 2 + 4} ${height / 2} L ${width / 2 - 4} ${height / 2 + 7}`"
        class="bio-joint-symbol__chevron"
        data-testid="bio-joint-chevron"
      />
    </template>
    <line
      v-else-if="drawn !== 'junction'"
      v-bind="openWay"
      :class="[
        'bio-joint-symbol__flow',
        'bio-joint-symbol__open',
        { 'bio-joint-symbol__open--diffusion': drawn === 'diffusion' },
      ]"
    />
    <template v-else>
      <line :x1="0" :y1="height / 2" :x2="width" :y2="height / 2" class="bio-joint-symbol__flow" />
      <rect
        v-for="x in barrels"
        :key="x"
        :x="x"
        :y="(height - BARREL.height) / 2"
        :width="BARREL.width"
        :height="BARREL.height"
        rx="5"
        class="bio-joint-symbol__barrel"
      />
      <line :x1="width / 2 - BARREL.width - 2" :y1="height / 2" :x2="width / 2 + BARREL.width + 2" :y2="height / 2" class="bio-joint-symbol__pore" />
    </template>
  </svg>
</template>

<script setup>
import { computed } from 'vue'
import BioSymbol from './BioSymbol.vue'
import { getSkin } from '../../services/bioView/skinRegistry'

const props = defineProps({
  /** 'flow' between tubes; 'junction', a gap junction between cells; 'bridge' or 'diffusion', an open way. */
  kind: { type: String, required: true },
  /** The skin it is drawn with (see resolveSkin): a built-in joint's id or a symbol's; none, as its kind is. */
  skin: { type: String, default: null },
  /** An open way's direction: down, across a bridge between a cell and one below it. */
  vertical: { type: Boolean, default: false },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  selected: { type: Boolean, default: false },
  /** The colour of the tube it goes on from, for its lumen. */
  tone: { type: String, default: null },
})

/** A tube's wall, as BioRegion draws it, and how far in the joint narrows it. */
const WALL = 6
/** A connexon, one in each cell's membrane. */
const BARREL = { width: 20, height: 60 }


/** The drawing each built-in joint skin is: one of the kinds. */
const DRAWN = Object.freeze({ narrowing: 'flow', 'connexon-pair': 'junction', 'open-way': 'bridge', 'dashed-way': 'diffusion' })

/** A symbol skin, drawn in place of a built-in joint. */
const symbol = computed(() => {
  const skin = getSkin(props.skin)
  return skin?.renderer === 'symbol' ? skin : null
})
const drawn = computed(() => DRAWN[props.skin] ?? props.kind)

/**
 * Where a symbol goes: the whole joint, across its length, so it runs the way the joint does; turned a quarter where
 * the joint runs down. It keeps its own proportions, as big as fits.
 */
const fit = computed(() => {
  const [width, height] = props.vertical ? [props.height, props.width] : [props.width, props.height]
  return { x: (props.width - width) / 2, y: (props.height - height) / 2, width, height }
})

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
.bio-joint-symbol {
  display: block;
  overflow: visible;
}

.bio-joint-symbol__lumen {
  fill: color-mix(in srgb, var(--p-sky-200) 40%, transparent);
}

.bio-joint-symbol__wall {
  fill: none;
  stroke: color-mix(in srgb, var(--p-text-muted-color) 55%, transparent);
  stroke-width: 6;
}

.bio-joint-symbol__flow {
  stroke: var(--p-text-color);
  stroke-width: 2;
}

.bio-joint-symbol__open--diffusion {
  stroke-dasharray: 8 6;
}

.bio-joint-symbol__chevron {
  fill: none;
  stroke: var(--p-text-muted-color);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.45;
}

.bio-joint-symbol__barrel {
  fill: color-mix(in srgb, var(--p-amber-300) 70%, transparent);
  stroke: var(--p-amber-600);
  stroke-width: 1.5;
}

.bio-joint-symbol__pore {
  stroke: var(--p-content-background);
  stroke-width: 4;
}

.bio-joint-symbol--selected .bio-joint-symbol__wall,
.bio-joint-symbol--selected .bio-joint-symbol__barrel,
.bio-joint-symbol--selected .bio-joint-symbol__open {
  stroke: var(--p-primary-color);
}
</style>
