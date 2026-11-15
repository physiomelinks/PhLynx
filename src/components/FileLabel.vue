<template>
  <span class="file-label" :title="described.title">
    <span class="file-label__name">{{ name ?? described.name }}</span>
    <span v-if="described.namespace" class="file-label__namespace">{{ described.namespace }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'

import { describeFileKey } from '../utils/namespaces'

/**
 * A library file's name, with its namespace as a small tag; the whole key shows on hover.
 */
const props = defineProps({
  fileKey: { type: String, default: '' },
  /** Shown instead of the file name, such as a group's spaced label. */
  name: { type: String, default: null },
})

const described = computed(() => describeFileKey(props.fileKey))
</script>

<style scoped>
.file-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  min-width: 0;
  max-width: 100%;
}

.file-label__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.file-label__namespace {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 0.45em;
  border-radius: 999px;
  font-size: 0.8em;
  line-height: 1.5;
  color: var(--p-text-muted-color);
  background: color-mix(in srgb, var(--p-text-muted-color) 14%, transparent);
}
</style>
