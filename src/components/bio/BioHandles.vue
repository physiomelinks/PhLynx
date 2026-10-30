<template>
  <!-- Where the selection's couplings meet the node, each at its own point -->
  <Handle
    v-for="handle in handles"
    :id="handle.id"
    :key="handle.id"
    type="source"
    :position="Position.Top"
    :connectable="false"
    class="bio-handle"
    :style="{ left: `${handle.x}px`, top: `${handle.y}px` }"
  />
</template>

<script setup>
import { Handle, Position } from '@vue-flow/core'

defineProps({
  /** [{ id, x, y }], in the node's own coordinates. */
  handles: { type: Array, default: () => [] },
})
</script>

<style scoped>
.bio-handle {
  width: 7px;
  height: 7px;
  min-width: 0;
  min-height: 0;
  border: none;
  background: var(--p-primary-color);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
</style>
