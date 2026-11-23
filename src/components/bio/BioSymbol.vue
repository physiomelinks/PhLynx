<template>
  <!-- Drawn with the outside of the cell up; the membrane runs across the middle -->
  <svg
    class="bio-symbol"
    :class="`bio-symbol--${entry.id.replace(':', '-')}`"
    :viewBox="entry.viewBox"
    :data-skin="entry.id"
    :style="paletteStyle"
  >
    <!-- A selected or coupled protein's glow: its shapes again, widened, under it. Drawn, not a CSS filter, which
         Firefox blurs on the CPU on every paint of a pan or zoom. -->
    <g
      v-for="(layer, l) in haloLayers"
      :key="`halo-${l}`"
      class="bio-symbol__halo"
      :style="{ opacity: layer.opacity }"
      data-testid="bio-symbol-halo"
    >
      <template v-for="(element, i) in entry.elements" :key="i">
        <component
          :is="element.type"
          v-if="element.type !== 'text'"
          v-bind="shapeOf(element)"
          :style="haloPaint(element, layer.width)"
          :transform="upright(element)"
        />
      </template>
    </g>
    <template v-for="(element, i) in entry.elements" :key="i">
      <path
        v-if="element.type === 'path'"
        :d="element.d"
        :class="partClass(element)"
        :style="paint(element)"
        :transform="upright(element)"
      />
      <rect
        v-else-if="element.type === 'rect'"
        :x="element.x"
        :y="element.y"
        :width="element.width"
        :height="element.height"
        :rx="element.rx"
        :ry="element.ry"
        :class="partClass(element)"
        :style="paint(element)"
        :transform="upright(element)"
      />
      <circle
        v-else-if="element.type === 'circle'"
        :cx="element.cx"
        :cy="element.cy"
        :r="element.r"
        :class="partClass(element)"
        :style="paint(element)"
        :transform="upright(element)"
      />
      <!-- Kept upright, however the symbol is turned, when it says so -->
      <text
        v-else
        :x="element.x"
        :y="element.y"
        class="bio-symbol__text"
        :style="textStyle(element)"
        :transform="upright(element)"
      >{{ element.text }}</text>
    </template>

    <!-- What it carries: one arrow per species (named in its label), down into the cell or up out of it,
         both ways until a run says -->
    <g
      v-for="arrow in placedArrows"
      :key="arrow.label"
      class="bio-symbol__arrow"
      :style="arrowStyle"
      :data-species="arrow.label"
      :data-direction="arrow.direction ?? 'both'"
    >
      <line
        :x1="arrow.x"
        :y1="arrow.top + (arrow.direction === 'in' ? 0 : 4)"
        :x2="arrow.x"
        :y2="arrow.bottom - (arrow.direction === 'out' ? 0 : 4)"
      />
      <polygon v-if="arrow.direction !== 'out'" :points="head(arrow.x, arrow.bottom, 1)" />
      <polygon v-if="arrow.direction !== 'in'" :points="head(arrow.x, arrow.top, -1)" />
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue'
import { getSkin } from '../../services/bioView/skinRegistry'

const props = defineProps({
  /** The symbol skin's id; any other is drawn as the generic protein. */
  skin: { type: String, default: 'generic' },
  /** How far the symbol is turned, so its text can stay upright. */
  rotation: { type: Number, default: 0 },
  /** What it carries: [{ species, label, direction: 'in'|'out'|null }], null when the way isn't known. */
  arrows: { type: Array, default: () => [] },
  /** A glow round it: 'selected', 'coupled' (softer) or none. */
  halo: { type: String, default: null },
})

const entry = computed(() => {
  const skin = getSkin(props.skin)
  return skin?.renderer === 'symbol' ? skin : getSkin('generic')
})

/** A symbol's own palette, as per-slot variables for light and dark; the stylesheet picks the mode's. */
const paletteStyle = computed(() => {
  const style = {}
  for (const mode of ['light', 'dark']) {
    for (const [slot, colour] of Object.entries(entry.value.palette?.[mode] ?? {})) {
      style[`--symbol-${slot}-${mode}`] = colour
    }
  }
  return style
})

const slotColour = (slot) => (slot === 'none' ? 'none' : `var(--symbol-${slot})`)

/** A shape's fill and stroke, from its colour slots. */
function paint(element) {
  const style = { fill: slotColour(element.fill) }
  if (element.stroke && element.stroke !== 'none') {
    Object.assign(style, { stroke: slotColour(element.stroke), strokeWidth: element.strokeWidth })
  }
  return style
}

const textStyle = (element) => ({
  ...paint(element),
  fontSize: `${element.size}px`,
  fontWeight: element.weight === 'bold' ? 700 : 400,
})

/** Named by fill slot, as a modifier, so a shape painted 'arrow' is never taken for one of the arrows. */
const partClass = (element) =>
  `bio-symbol__part bio-symbol__part--${element.fill === 'none' ? 'line' : element.fill}`

/** How far each layer of a glow reaches past the shapes, and how strong it is: a wide faint one, a close one. */
const HALOS = {
  selected: [
    { width: 3, opacity: 0.28 },
    { width: 1.2, opacity: 0.6 },
  ],
  coupled: [
    { width: 5, opacity: 0.22 },
    { width: 2, opacity: 0.25 },
  ],
}
const haloLayers = computed(() => HALOS[props.halo] ?? [])

/** A shape's geometry, without its paint. */
function shapeOf(element) {
  const keys = { path: ['d'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'] }[element.type]
  return Object.fromEntries((keys ?? []).map((key) => [key, element[key]]))
}

/** A shape's glow: filled as it is, and stroked wider by the glow's reach. */
const haloPaint = (element, reach) => ({
  fill: element.fill === 'none' ? 'none' : 'var(--p-primary-color)',
  stroke: 'var(--p-primary-color)',
  strokeWidth: (element.stroke && element.stroke !== 'none' ? (element.strokeWidth ?? 1) : 0) + 2 * reach,
  strokeLinejoin: 'round',
})

/** Turns a shape back by the symbol's rotation, about its point, so it reads upright. */
const upright = (element) =>
  element.upright ? `rotate(${-props.rotation} ${element.upright.x} ${element.upright.y})` : undefined

const arrowStyle = computed(() => ({ '--symbol-arrow-ink': slotColour(entry.value.arrowRoom.colour) }))

// Spread evenly across the room; one alone goes down its middle, as through a channel's pore.
const placedArrows = computed(() => {
  const room = entry.value.arrowRoom
  const count = props.arrows.length
  return props.arrows.map((arrow, i) => ({
    ...arrow,
    x: count > 1 ? room.left + ((room.right - room.left) * i) / (count - 1) : (room.left + room.right) / 2,
    top: room.top,
    bottom: room.bottom,
  }))
})

/** An arrowhead with its tip at (x, y), pointing down (1) or up (-1). */
function head(x, y, dir) {
  return `${x - 3.5},${y - dir * 5} ${x + 3.5},${y - dir * 5} ${x},${y}`
}
</script>

<style scoped>
/* One symbol palette, whatever the diagram's theme tints the node's card: those tints are pale card
   backgrounds that the white arrows vanish on. A symbol's own palette overrides a slot per mode. */
.bio-symbol {
  --symbol-body: var(--symbol-body-light, var(--p-emerald-500));
  --symbol-outline: var(--symbol-outline-light, color-mix(in srgb, var(--symbol-body) 60%, black));
  --symbol-pore: var(--symbol-pore-light, color-mix(in srgb, var(--symbol-body) 25%, white));
  --symbol-accent: var(--symbol-accent-light, var(--p-amber-400));
  --symbol-accentText: var(--symbol-accentText-light, var(--p-amber-900));
  --symbol-arrow: var(--symbol-arrow-light, white);
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.bio-symbol__text {
  text-anchor: middle;
}

.bio-symbol__arrow line {
  stroke: var(--symbol-arrow-ink);
  stroke-width: 2.5;
  stroke-linecap: round;
}

.bio-symbol__arrow polygon {
  fill: var(--symbol-arrow-ink);
}
</style>

<style>
/* Dark mode: a symbol's dark palette, else its light one, else the same symbol colours */
.p-dark .bio-symbol {
  --symbol-body: var(--symbol-body-dark, var(--symbol-body-light, var(--p-emerald-500)));
  --symbol-outline: var(
    --symbol-outline-dark,
    var(--symbol-outline-light, color-mix(in srgb, var(--symbol-body) 60%, black))
  );
  --symbol-pore: var(--symbol-pore-dark, var(--symbol-pore-light, color-mix(in srgb, var(--symbol-body) 25%, white)));
  --symbol-accent: var(--symbol-accent-dark, var(--symbol-accent-light, var(--p-amber-400)));
  --symbol-accentText: var(--symbol-accentText-dark, var(--symbol-accentText-light, var(--p-amber-900)));
  --symbol-arrow: var(--symbol-arrow-dark, var(--symbol-arrow-light, white));
}
</style>
