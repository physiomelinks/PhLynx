<template>
  <!-- A connection end's chip, tinted by its side: the accent for the source or this instance, neutral otherwise -->
  <Chip :label="label" :class="['node-side-chip', `node-side-chip--${side}`]" />
</template>

<script setup>
import Chip from 'primevue/chip'

defineProps({
  label: { type: String, required: true },
  side: { type: String, default: 'source', validator: (side) => ['source', 'target'].includes(side) },
})
</script>

<style scoped>
.node-side-chip--source {
  --side-colour: var(--p-primary-color);
}
.node-side-chip--target {
  --side-colour: var(--p-text-muted-color);
}
.node-side-chip {
  background: color-mix(in srgb, var(--side-colour) 15%, transparent);
  color: var(--side-colour);
  border: 1px solid color-mix(in srgb, var(--side-colour) 30%, transparent);
}
</style>
