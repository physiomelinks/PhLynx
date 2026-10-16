<template>
  <!-- vue-flow's closed arrow, sized in flow units so selecting or widening the line keeps its size -->
  <defs v-if="arrowSize">
    <marker
      :id="markerId"
      class="vue-flow__arrowhead"
      viewBox="-10 -10 20 20"
      refX="0"
      refY="0"
      :markerWidth="arrowSize"
      :markerHeight="arrowSize"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <polyline
        :class="[
          'coupling-edge-arrow',
          { 'coupling-edge-arrow--selected': selected, 'coupling-edge-arrow--conflict': conflicts.length },
        ]"
        :style="customColour && { stroke: customColour, fill: customColour }"
        stroke-linecap="round"
        stroke-linejoin="round"
        points="-5,-4 0,0 -5,4 -5,-4"
      />
    </marker>
  </defs>
  <BaseEdge
    :id="id"
    :path="path[0]"
    :marker-end="arrowSize ? `url(#${markerId})` : undefined"
    :style="lineStyle"
    :class="{ 'coupling-edge--conflict': conflicts.length }"
  />
  <!-- Like an instance's missing-parameter warning: these couplings can't be exported -->
  <EdgeLabelRenderer v-if="conflicts.length">
    <div
      class="coupling-edge-warning nodrag nopan"
      :style="{ transform: `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px)` }"
    >
      <i class="pi pi-exclamation-triangle" v-tooltip.top="conflicts.join(' ')"></i>
    </div>
  </EdgeLabelRenderer>
</template>

<script setup>
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath } from '@vue-flow/core'
import { ARROW_SIZES, EDGE_WIDTHS } from '../utils/constants'
import { resolveEdgeAppearance } from '../utils/edges'
import { couplingConflicts } from '../utils/multiport'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  id: { type: String, required: true },
  source: { type: String, required: true },
  target: { type: String, required: true },
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  sourcePosition: { type: String, required: true },
  targetPosition: { type: String, required: true },
  data: { type: Object, default: () => ({}) },
  style: { type: Object, default: undefined },
  selected: { type: Boolean, default: false },
})

const SELECTED_EXTRA_WIDTH = 2

const appearance = computed(() => resolveEdgeAppearance(props.data?.appearance))

// [path, labelX, labelY, ...]
const path = computed(() => {
  switch (appearance.value.path) {
    case 'bezier':
      return getBezierPath(props)
    case 'straight':
      return getStraightPath(props)
    case 'step':
      return getSmoothStepPath({ ...props, borderRadius: 0 })
    default:
      return getSmoothStepPath(props)
  }
})

const conflicts = computed(() =>
  (props.data?.couplings ?? []).flatMap(({ sourcePort, targetPort }) => couplingConflicts(sourcePort, targetPort))
)

// The selected and conflict colours come from CSS, which an inline colour would beat.
const customColour = computed(() =>
  props.selected || conflicts.value.length ? null : appearance.value.colour
)

const lineStyle = computed(() => ({
  ...props.style,
  strokeWidth: EDGE_WIDTHS[appearance.value.width] + (props.selected ? SELECTED_EXTRA_WIDTH : 0),
  ...(customColour.value && { stroke: customColour.value }),
}))

const arrowSize = computed(() => ARROW_SIZES[appearance.value.arrow])
const markerId = `coupling-edge-arrow-${props.id}`
</script>

<style scoped>
/* On BaseEdge's path, outside this component's scope; it stays orange when selected. */
:global(.vue-flow__edge-path.coupling-edge--conflict),
:global(.vue-flow__edge.selected .vue-flow__edge-path.coupling-edge--conflict) {
  stroke: var(--p-orange-500);
}

/* Matches vue-flow's line */
.coupling-edge-arrow {
  stroke: #b1b1b7;
  fill: #b1b1b7;
  stroke-width: 1;
}

/* Matches the selected line (WorkspaceArea.vue) */
.coupling-edge-arrow--selected {
  stroke: var(--p-primary-color);
  fill: var(--p-primary-color);
}

.coupling-edge-arrow--conflict {
  stroke: var(--p-orange-500);
  fill: var(--p-orange-500);
}

/* A round badge on the edge, so the icon stands off the line and the canvas */
.coupling-edge-warning {
  position: absolute;
  pointer-events: all;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--p-orange-500);
  background: var(--p-content-background);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--p-text-color) 20%, transparent);
  color: var(--p-orange-500);
  cursor: help;
}

/* Blocked off its text line, so the badge centres the glyph; a triangle's weight sits low, so it is
   lifted a pixel to look centred. */
.coupling-edge-warning .pi {
  display: block;
  font-size: 12px;
  line-height: 1;
  transform: translateY(-1px);
}

.coupling-edge-warning:hover {
  background: color-mix(in srgb, var(--p-orange-500) 12%, var(--p-content-background));
}
</style>
