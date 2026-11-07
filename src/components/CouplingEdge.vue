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
  <!-- Like an instance's missing-parameter warning: these couplings can't be exported, as their ports or units don't pair -->
  <EdgeLabelRenderer v-if="conflicts.length">
    <div
      class="coupling-edge-warning nodrag nopan"
      :style="{ transform: `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px)` }"
    >
      <i class="pi pi-exclamation-triangle" v-tooltip.top="conflicts.join(' ')"></i>
    </div>
  </EdgeLabelRenderer>
  <!-- draw.io-style handles: drag a segment's midpoint to move the segment across -->
  <EdgeLabelRenderer v-if="handles.length">
    <div
      v-for="handle in handles"
      :key="handle.index"
      :class="['edge-route-handle', `edge-route-handle--${handle.axis}`, 'nodrag', 'nopan']"
      :style="{ transform: `translate(${handle.x}px, ${handle.y}px) scale(${1 / viewport.zoom}) translate(-50%, -50%)` }"
      :data-testid="`edge-route-handle-${handle.index}`"
      @pointerdown="startDrag($event, handle)"
      @contextmenu.prevent
    ></div>
  </EdgeLabelRenderer>
</template>

<script setup>
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { couplingConflicts } from '../utils/multiport'
import { couplingUnitConflicts } from '../utils/couplingUnits'
import { fullPolyline, getEdgeWaypoints, midpointAlong, roundedPath, translateWaypoints } from '../utils/edgeRoute'
import { useEdgeDragOffsets } from '../composables/useEdgeDragOffsets'
import { useEdgeRouteEditing } from '../composables/useEdgeRouteEditing'

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

const { findNode, viewport } = useVueFlow()
const { route: draftRoute, handles, startDrag } = useEdgeRouteEditing(props)
const { edgeDragOffsets } = useEdgeDragOffsets()

// [path, labelX, labelY]: the route being dragged, else through the user's waypoints (carried along
// while both nodes are dragged together), else drawn as the default smoothstep edge is.
const path = computed(() => {
  let points = draftRoute.value
  if (!points) {
    const waypoints = getEdgeWaypoints(props)
    if (!waypoints) return getSmoothStepPath(props)
    const offset = edgeDragOffsets.value.get(props.id)
    points = fullPolyline(props, offset ? translateWaypoints(waypoints, offset.x, offset.y) : waypoints)
  }
  const label = midpointAlong(points)
  return [roundedPath(points), label.x, label.y]
})
const libraryStore = useLibraryStore()

// One resolveUnits cache per set of definitions.
const unitsCache = computed(() => (libraryStore.unitDefinitions, new Map()))

// A pair the ports already reject isn't checked for units too.
const conflicts = computed(() => {
  const sourceRows = findNode(props.source)?.data?.variables
  const targetRows = findNode(props.target)?.data?.variables
  return (props.data?.couplings ?? []).flatMap(({ sourcePort, targetPort }) => {
    const portConflicts = couplingConflicts(sourcePort, targetPort)
    return portConflicts.length
      ? portConflicts
      : couplingUnitConflicts(sourcePort, targetPort, sourceRows, targetRows, libraryStore.unitDefinitions, unitsCache.value)
  })
})

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

/* A segment handle, like draw.io's: a small square on the selected line, kept the same size at any zoom */
.edge-route-handle {
  position: absolute;
  pointer-events: all;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 2px solid var(--p-primary-color);
  background: var(--p-content-background);
  transform-origin: 0 0;
}

.edge-route-handle--x {
  cursor: ew-resize;
}

.edge-route-handle--y {
  cursor: ns-resize;
}

.edge-route-handle:hover {
  background: var(--p-primary-color);
}

.coupling-edge-warning:hover {
  background: color-mix(in srgb, var(--p-orange-500) 12%, var(--p-content-background));
}
</style>
