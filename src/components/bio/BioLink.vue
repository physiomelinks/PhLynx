<template>
  <!-- A tube: a line from one of its compartments to the other, and room along it for its module -->
  <div
    :class="['bio-link', `bio-link--${data.flow}`, { 'bio-link--empty': data.empty, 'bio-link--selected': selected }]"
    data-testid="bio-link"
  >
    <!-- One that joins its pieces is the joint between them; with a module in it, the module draws it (BioJoint) -->
    <template v-if="data.joint">
      <!-- A bridge between two cells apart: an open channel of cytoplasm across the gap, walled by membrane, its
           lumen running on over each cell's own membrane, so it opens into both -->
      <svg
        v-if="channel"
        class="bio-link__line"
        :width="data.width"
        :height="data.height"
        overflow="visible"
        data-testid="bio-bridge"
      >
        <rect class="bio-link__lumen" v-bind="channel.lumen" />
        <line v-for="(wall, index) in channel.walls" :key="index" class="bio-link__core" v-bind="wall.line" />
        <BioBilayerStrips :strips="channel.walls" />
      </svg>
      <div
        v-if="data.empty"
        :class="['bio-link__joint', { 'bio-link__joint--placed': channel }]"
        :style="channel ? zoneStyle : undefined"
      >
        <BioJointGlyph
          :kind="data.joint"
          :width="channel ? data.zone.width : data.width"
          :height="channel ? data.zone.height : data.height"
          :tone="data.tone"
          :vertical="!!channel?.vertical"
          empty
        />
        <span class="bio-link__joint-name"
          >{{ data.name }} <small data-testid="bio-empty-hint">· Drop a module</small></span
        >
      </div>
    </template>
    <svg v-else class="bio-link__line" :width="data.width" :height="data.height" overflow="visible">
      <defs>
        <marker
          :id="markerId"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" class="bio-link__head" />
        </marker>
      </defs>
      <!-- A junction or bridge is drawn doubled, as the paired membranes of the two cells it joins -->
      <template v-if="data.flow === 'junction' || data.flow === 'bridge'">
        <polyline v-for="side in [-3, 3]" :key="side" :points="offsetPoints(side)" class="bio-link__stroke" />
      </template>
      <polyline
        v-else
        :points="offsetPoints(0)"
        class="bio-link__stroke"
        :marker-end="data.flow === 'flow' ? `url(#${markerId})` : undefined"
      />
    </svg>
    <!-- Its module's room, a drop target while empty; the module on it is drawn over it as a card -->
    <div v-if="data.empty && !data.joint" class="bio-link__zone" :style="zoneStyle">
      <span class="bio-link__label">{{ data.name }}</span>
      <small class="bio-link__hint" data-testid="bio-empty-hint">Drop a module</small>
    </div>
  </div>
</template>

<script setup>
import { computed, useId } from 'vue'
import BioBilayerStrips from './BioBilayerStrips.vue'
import BioJointGlyph from './BioJointGlyph.vue'
import { MEMBRANE_BAND_HALF } from '../../services/bioView/geometry'

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

const markerId = `bio-link-head-${useId()}`

const zoneStyle = computed(() => {
  const { x, y, width, height } = props.data.zone
  return { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }
})

/**
 * A bridge's channel, where it has one: its lumen, from one cell's membrane to the other's and on over each, and its
 * two walls, each a strip of bilayer (see BioBilayerStrips) with the membrane's core under it.
 */
const channel = computed(() => {
  const bridge = props.data.channel
  if (!bridge) return null
  const { from, to, half, vertical } = bridge
  const over = MEMBRANE_BAND_HALF
  const length = vertical ? to.y - from.y : to.x - from.x
  const lumen = vertical
    ? { x: from.x - half, y: from.y - over, width: 2 * half, height: length + 2 * over }
    : { x: from.x - over, y: from.y - half, width: length + 2 * over, height: 2 * half }
  const walls = [-half, half].map((side) => {
    const start = vertical ? { x: from.x + side, y: from.y } : { x: from.x, y: from.y + side }
    const end = vertical ? { x: start.x, y: to.y } : { x: to.x, y: start.y }
    return {
      transform: `translate(${start.x} ${start.y})${vertical ? ' rotate(90)' : ''}`,
      length,
      line: { x1: start.x, y1: start.y, x2: end.x, y2: end.y },
    }
  })
  return { lumen, walls, vertical }
})

/**
 * Its way, from one space through its module's room (where that is beside the way) to the other; a tube's, the
 * right-angle path it is given.
 */
const points = computed(() => {
  if (props.data.joint) return []
  if (props.data.points) return props.data.points
  return [props.data.from, ...(props.data.via ? [props.data.via] : []), props.data.to]
})

/** Its way moved sideways by `by`, each stretch square to itself, as SVG points. */
function offsetPoints(by) {
  const all = points.value
  return all
    .map((point, i) => {
      const [a, b] = i < all.length - 1 ? [point, all[i + 1]] : [all[i - 1], point]
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
      return `${point.x + (-(b.y - a.y) / length) * by},${point.y + ((b.x - a.x) / length) * by}`
    })
    .join(' ')
}
</script>

<style scoped>
.bio-link {
  position: relative;
  width: 100%;
  height: 100%;
  /* A bridge's walls, as a cell's membrane is drawn (see BioCell) */
  --bilayer-head: var(--p-amber-700);
  --bilayer-tail: var(--p-amber-600);
  --bilayer-core: color-mix(in srgb, var(--p-amber-200) 70%, var(--p-content-background));
}

/* A bridge's lumen: the cells' cytoplasm, opaque, so it opens the membrane of each where it meets it */
.bio-link__lumen {
  fill: color-mix(in srgb, var(--p-amber-200) 45%, var(--p-content-background));
}

.bio-link__core {
  stroke: var(--bilayer-core);
  stroke-width: 14;
}

.bio-link__joint.bio-link__joint--placed {
  position: absolute;
}

.bio-link__line {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
}

.bio-link__stroke {
  fill: none;
  stroke: var(--p-text-muted-color);
  stroke-width: 3;
}

.bio-link--diffusion .bio-link__stroke {
  stroke-dasharray: 8 6;
}

.bio-link__head {
  fill: var(--p-text-muted-color);
}

.bio-link__zone {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 2px dashed color-mix(in srgb, var(--p-text-muted-color) 45%, transparent);
  border-radius: 8px;
  background: var(--p-content-background);
  pointer-events: auto;
  text-align: center;
}

.bio-link--selected .bio-link__zone {
  border: 2px solid var(--p-primary-color);
}

.bio-link--selected .bio-link__stroke {
  stroke: var(--p-primary-color);
}

.bio-link--selected .bio-link__head {
  fill: var(--p-primary-color);
}

.bio-link__joint {
  position: relative;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.bio-link__joint-name {
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--p-content-background) 85%, transparent);
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.bio-link__label {
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.bio-link__hint {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}
</style>
