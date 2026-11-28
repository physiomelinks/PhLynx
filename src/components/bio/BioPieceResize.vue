<template>
  <!-- One handle that resizes a piece: its frame from its bottom-right corner, or a docked compartment's depth from
       its far edge. Shown while the piece is hovered (see BioFlow). -->
  <NodeResizeControl
    class="bio-piece-resize"
    :node-id="nodeId"
    :position="position"
    variant="handle"
    :min-width="20"
    :min-height="20"
    :keep-aspect-ratio="keepAspect"
    data-testid="bio-piece-resize"
    @resize-start="(event) => report('start', event)"
    @resize="(event) => report('resize', event)"
    @resize-end="(event) => report('end', event)"
  />
</template>

<script setup>
import { inject } from 'vue'
import { NodeResizeControl } from '@vue-flow/node-resizer'

const props = defineProps({
  /** The node it resizes. */
  nodeId: { type: String, required: true },
  /** Where the handle is: a corner or an edge (see NodeResizeControl). */
  position: { type: String, default: 'bottom-right' },
  /** Whether it keeps its shape as it is resized, as an image does. */
  keepAspect: { type: Boolean, default: false },
})

/** The view's `(nodeId, phase, params) => void`, which turns a resize into a change to the pieces. */
const onResize = inject('bioPieceResize', () => {})

function report(phase, { params }) {
  onResize(props.nodeId, phase, params)
}
</script>

<style scoped>
.bio-piece-resize {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--p-primary-color);
  border-radius: 2px;
  background: var(--p-content-background);
}
</style>
