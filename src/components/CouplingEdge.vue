<template>
  <!-- vue-flow's closed arrow, in the line's colour when it is selected or warns -->
  <defs v-if="ownMarker">
    <marker
      :id="markerId"
      class="vue-flow__arrowhead"
      viewBox="-10 -10 20 20"
      refX="0"
      refY="0"
      markerWidth="12.5"
      markerHeight="12.5"
      markerUnits="strokeWidth"
      orient="auto-start-reverse"
    >
      <polyline
        :class="['coupling-edge-arrow', { 'coupling-edge-arrow--conflict': conflicts.length }]"
        stroke-linecap="round"
        stroke-linejoin="round"
        points="-5,-4 0,0 -5,4 -5,-4"
      />
    </marker>
  </defs>
  <BaseEdge
    :id="id"
    :path="path[0]"
    :marker-end="ownMarker ? `url(#${markerId})` : markerEnd"
    :style="style"
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
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useVueFlow } from '@vue-flow/core'
import { couplingConflicts, sharedSumConflicts } from '../utils/multiport'

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
  markerEnd: { type: String, default: undefined },
  style: { type: Object, default: undefined },
  selected: { type: Boolean, default: false },
})


// [path, labelX, labelY, ...], drawn as the default smoothstep edge is.
const path = computed(() => getSmoothStepPath(props))

const { edges, findNode } = useVueFlow()

// A variable summed through two ports of one node shows on every edge into those ports.
const sharedSums = computed(() => {
  const ends = [props.source, props.target]
  const touching = edges.value.filter((edge) => ends.includes(edge.source) || ends.includes(edge.target))
  return sharedSumConflicts(touching, (id) => findNode(id)?.data?.name ?? id).get(props.id) ?? []
})

const conflicts = computed(() => [
  ...(props.data?.couplings ?? []).flatMap(({ sourcePort, targetPort }) => couplingConflicts(sourcePort, targetPort)),
  ...sharedSums.value,
])

const ownMarker = computed(() => props.selected || conflicts.value.length > 0)
const markerId = `coupling-edge-arrow-${props.id}`
</script>

<style scoped>
/* On BaseEdge's path, outside this component's scope; it stays orange when selected. */
:global(.vue-flow__edge-path.coupling-edge--conflict),
:global(.vue-flow__edge.selected .vue-flow__edge-path.coupling-edge--conflict) {
  stroke: var(--p-orange-500);
}

/* Matches the selected line (WorkspaceArea.vue) */
.coupling-edge-arrow {
  stroke: var(--p-primary-color);
  fill: var(--p-primary-color);
  stroke-width: 1;
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
