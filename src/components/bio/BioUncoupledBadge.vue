<template>
  <!-- Placed, but no coupling joins it to anything: drawn as the dashed amber line of an uncoupled edge is -->
  <span
    :class="['bio-uncoupled-badge', { 'bio-uncoupled-badge--inset': inset }]"
    :title="`${name}: nothing couples it yet. Give its math ports its neighbours can couple to.`"
    data-testid="bio-uncoupled"
  >
    <i class="pi pi-link" aria-hidden="true"></i>
  </span>
</template>

<script setup>
defineProps({
  name: { type: String, default: 'This module' },
  /** Kept within what it is on, its top-left corner, not over the edge of it. */
  inset: { type: Boolean, default: false },
})
</script>

<style scoped>
.bio-uncoupled-badge {
  position: absolute;
  top: -8px;
  left: -8px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px dashed var(--p-amber-500);
  background: var(--p-content-background);
  color: var(--p-amber-500);
  font-size: 9px;
  cursor: help;
}

.bio-uncoupled-badge--inset {
  top: 0;
  left: 0;
}
</style>
