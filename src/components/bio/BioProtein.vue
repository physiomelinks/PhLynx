<template>
  <div
    :class="['bio-protein', { 'bio-protein--selected': selected, 'bio-protein--unplaced': data.unplaced }]"
    :title="data.unplaced ? `${data.name}: not in a membrane` : data.name"
    data-testid="bio-protein"
  >
    <!-- Turned with its facet, so its outside faces out of the cell -->
    <div class="bio-protein__body" :style="{ transform: `rotate(${data.rotation ?? 0}deg)` }"></div>
    <span class="bio-protein__label">{{ data.name }}</span>
  </div>
</template>

<script setup>
defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
</script>

<style scoped>
.bio-protein {
  position: relative;
  width: 100%;
  height: 100%;
}

.bio-protein__body {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  background: var(--p-emerald-500);
  border: 3px solid var(--p-emerald-700);
}

.bio-protein--selected .bio-protein__body {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 35%, transparent);
}

.bio-protein--unplaced .bio-protein__body {
  opacity: 0.55;
  border-style: dashed;
}

.bio-protein__label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: white;
  pointer-events: none;
}
</style>
