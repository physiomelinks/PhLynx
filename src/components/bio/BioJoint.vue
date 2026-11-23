<template>
  <!-- A module in a link's joint, drawn as the joint itself, named below it -->
  <div :class="['bio-joint', { 'bio-joint--selected': selected }]" data-testid="bio-joint">
    <BioHandles :handles="data.handles ?? []" />
    <BioJointGlyph :kind="data.joint" :width="data.width" :height="data.height" :tone="data.tone" :vertical="!!data.vertical" :selected="selected" />
    <span class="bio-joint__name"><BioPieceName :id="id" :name="data.name" /></span>
  </div>
</template>

<script setup>
import BioHandles from './BioHandles.vue'
import BioJointGlyph from './BioJointGlyph.vue'
import BioPieceName from './BioPieceName.vue'

defineProps({
  id: { type: String, default: null },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
</script>

<style scoped>
.bio-joint {
  position: relative;
  width: 100%;
  height: 100%;
}

/* Below the joint, clear of the tubes or cells either side */
.bio-joint__name {
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--p-content-background) 85%, transparent);
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.bio-joint--selected .bio-joint__name {
  color: var(--p-primary-color);
}
</style>
