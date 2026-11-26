<template>
  <!--
    A conduit: a vessel along a tube's whole way, from the edge of one compartment to the other's and round its bends,
    seen from the side: its walls, lined within, a rim at its near end and its open far end.
  -->
  <svg
    :class="['bio-conduit', { 'bio-conduit--selected': selected }]"
    width="1"
    height="1"
    overflow="visible"
    data-testid="bio-conduit"
  >
    <template v-if="vessel">
      <!-- Its walls are the edges of a wide stroke, its lumen a narrower one over it; its lining likewise -->
      <path :d="vessel.body" class="bio-conduit__wall" :stroke-width="2 * radius + WALL" />
      <path :d="vessel.body" class="bio-conduit__lumen" :style="lumenStyle" :stroke-width="2 * radius - WALL" />
      <path :d="vessel.body" class="bio-conduit__lining" :stroke-width="2 * lining + 1.5" />
      <path :d="vessel.body" class="bio-conduit__lumen" :style="lumenStyle" :stroke-width="2 * lining - 1.5" />
      <g :transform="vessel.near">
        <path :d="`M 0 ${-radius} A ${end} ${radius} 0 0 0 0 ${radius} Z`" class="bio-conduit__cap" :style="capStyle" />
      </g>
      <g :transform="vessel.far">
        <ellipse cx="0" cy="0" :rx="end" :ry="radius" class="bio-conduit__opening" :style="openingStyle" />
      </g>
    </template>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** Its way, as the tube's: right-angle stretches from one compartment's edge to the other's, in this node's frame. */
  points: { type: Array, required: true },
  /** The colour of the compartment it flows from, for its lumen. */
  tone: { type: String, default: null },
  selected: { type: Boolean, default: false },
})

/** A vessel's wall, as a tube compartment's is drawn (see BioRegion), and its radius to the middle of its walls. */
const WALL = 6
const radius = 28
/** How far in from its walls its lining runs. */
const lining = radius - WALL / 2 - 3
/** Its ends' ellipses, the round of the vessel seen a little from the side. */
const end = Math.round(radius * 0.38)

const lumenStyle = computed(
  () => props.tone && { stroke: `color-mix(in srgb, var(--p-${props.tone}-200) 45%, var(--p-content-background))` },
)
const capStyle = computed(
  () => props.tone && { fill: `color-mix(in srgb, var(--p-${props.tone}-200) 45%, var(--p-content-background))` },
)
const openingStyle = computed(
  () => props.tone && { fill: `color-mix(in srgb, var(--p-${props.tone}-300) 60%, var(--p-content-background))` },
)

/** A point moved `by` from `from` toward `toward`, at most halfway. */
function toward(from, to, by) {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
  const k = Math.min(by, length / 2) / length
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }
}

/** A way with its ends drawn in, by `start` at its first and `finish` at its last. */
function drawnIn(points, start, finish) {
  const all = [...points]
  all[0] = toward(points[0], points[1], start)
  all[all.length - 1] = toward(points.at(-1), points.at(-2), finish)
  return all
}

const pathOf = (points) => points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
const angleOf = (from, to) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI

/**
 * Its body along its way, drawn in at each end so the near end's rim and the far end's opening reach the compartments'
 * edges and no further; and each end's frame, turned along the stretch it is on.
 */
const vessel = computed(() => {
  const points = props.points.filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y)
  if (points.length < 2) return null
  const inset = end + WALL / 2
  const body = drawnIn(points, inset, inset)
  const [near, far] = [body[0], body.at(-1)]
  return {
    body: pathOf(body),
    near: `translate(${near.x} ${near.y}) rotate(${angleOf(points[0], points[1])})`,
    far: `translate(${far.x} ${far.y}) rotate(${angleOf(points.at(-2), points.at(-1))})`,
  }
})
</script>

<style scoped>
.bio-conduit {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
}

/* Round at its bends, as a vessel turns */
.bio-conduit path {
  stroke-linejoin: round;
}

.bio-conduit__wall,
.bio-conduit__lumen,
.bio-conduit__lining {
  fill: none;
}

.bio-conduit__wall {
  stroke: color-mix(in srgb, var(--p-text-muted-color) 55%, transparent);
}

.bio-conduit__lumen {
  stroke: color-mix(in srgb, var(--p-sky-200) 45%, var(--p-content-background));
}

/* A vessel's endothelium, lining its walls */
.bio-conduit__lining {
  stroke: color-mix(in srgb, var(--p-rose-400) 55%, var(--p-content-background));
  stroke-dasharray: 6 3;
}

.bio-conduit__cap,
.bio-conduit__opening {
  stroke: color-mix(in srgb, var(--p-text-muted-color) 55%, transparent);
  stroke-width: 2.5;
}

.bio-conduit__cap {
  fill: color-mix(in srgb, var(--p-sky-200) 45%, var(--p-content-background));
}

.bio-conduit__opening {
  fill: color-mix(in srgb, var(--p-sky-300) 60%, var(--p-content-background));
}

.bio-conduit--selected .bio-conduit__wall,
.bio-conduit--selected .bio-conduit__cap,
.bio-conduit--selected .bio-conduit__opening {
  stroke: var(--p-primary-color);
}
</style>
