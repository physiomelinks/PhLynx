<template>
  <!-- A gap junction between cells apart: drawn as the orange warning of a coupling that can't be exported -->
  <span
    class="bio-broken-badge"
    v-tooltip.top="
      `${name} is broken: its cells are too far apart. A gap junction needs the two cells' membranes to touch, so ` +
      'move them together.'
    "
    data-testid="bio-broken"
  >
    <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
  </span>
</template>

<script setup>
defineProps({
  name: { type: String, default: 'This gap junction' },
})
</script>

<style scoped>
.bio-broken-badge {
  position: absolute;
  top: -8px;
  left: -8px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--p-orange-500);
  background: var(--p-content-background);
  color: var(--p-orange-500);
  font-size: 10px;
  pointer-events: auto;
  cursor: help;
}

/* A triangle's weight sits low, so it is lifted a pixel to look centred */
.bio-broken-badge .pi {
  display: block;
  font-size: 10px;
  line-height: 1;
  transform: translateY(-1px);
}
</style>
