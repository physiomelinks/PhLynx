<template>
  <!-- A module in a link's joint, drawn as the joint itself, named below it -->
  <div
    :class="['bio-joint', { 'bio-joint--selected': selected, 'bio-joint--broken': data.broken }]"
    data-testid="bio-joint"
  >
    <BioHandles :handles="data.handles ?? []" />
    <BioBrokenBadge v-if="data.broken" :name="data.name" />
    <!-- A conduit's module is its vessel, along its tube's whole way -->
    <BioConduit v-if="data.joint === 'conduit'" :points="data.points" :tone="data.tone" :selected="selected" />
    <BioJointSymbol v-else :kind="data.joint" :skin="data.jointSkin" :width="data.width" :height="data.height" :tone="data.tone" :vertical="!!data.vertical" :selected="selected" />
    <span :class="['bio-joint__name', { 'bio-joint__name--beside': data.beside }]"><BioPieceName :id="id" :name="data.name" /></span>
  </div>
</template>

<script setup>
import BioBrokenBadge from './BioBrokenBadge.vue'
import BioConduit from './BioConduit.vue'
import BioHandles from './BioHandles.vue'
import BioJointSymbol from './BioJointSymbol.vue'
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

/* Beside a conduit running down, clear of its vessel */
.bio-joint__name.bio-joint__name--beside {
  top: 50%;
  left: calc(50% + 40px);
  transform: translateY(-50%);
}

.bio-joint--broken .bio-joint__name {
  color: var(--p-orange-500);
}

.bio-joint--selected .bio-joint__name {
  color: var(--p-primary-color);
}
</style>
