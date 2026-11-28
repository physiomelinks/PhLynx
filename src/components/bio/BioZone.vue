<template>
  <!-- A process zone of the pieces: an area within a compartment for process modules, outlined -->
  <div
    :class="['bio-zone', { 'bio-zone--empty': data.empty, 'bio-zone--selected': selected }]"
    data-testid="bio-process-zone"
    :data-site="data.site ?? undefined"
  >
    <!-- The name it was added with says nothing once a module is in it: shown again while it is selected, or
         while something is dragged, to tell the zones apart. A name someone gave it always shows. -->
    <span
      :class="['bio-zone__label', { 'bio-zone__label--quiet': !data.empty && !data.named && !selected }]"
      data-testid="bio-zone-label"
      >{{ data.name }}</span
    >
    <small v-if="data.empty" class="bio-zone__hint" data-testid="bio-empty-hint">Drop a module</small>
    <BioPieceResize v-if="data.resize && id" :node-id="id" :position="data.resize.position" />
  </div>
</template>

<script setup>
import BioPieceResize from './BioPieceResize.vue'

defineProps({
  /** Its node id, for its resize handle. */
  id: { type: String, default: null },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
</script>

<style scoped>
/* Drawn as a template cell's process area is: a faint dashed outline, named in its corner. */
.bio-zone {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 8px;
  border: 1px dashed color-mix(in srgb, var(--p-amber-500) 60%, transparent);
}

.bio-zone--selected {
  border: 2px solid var(--p-primary-color);
}

.bio-zone__label {
  position: absolute;
  top: 2px;
  left: 8px;
  font-size: 10px;
  line-height: 1.2;
  color: var(--p-text-muted-color);
}

.bio-zone__label--quiet {
  visibility: hidden;
}

:global(.bio-flow-root--dragging) .bio-zone__label--quiet {
  visibility: visible;
}

.bio-zone__hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px;
  color: var(--p-text-muted-color);
  opacity: 0.8;
}
</style>
