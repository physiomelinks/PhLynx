<template>
  <!-- How many connections the annotations suggest, with Accept all and Dismiss all, and a way back for dismissed ones -->
  <Panel v-if="count || dismissedCount" position="bottom-center" class="suggestion-panel nodrag nopan">
    <i class="pi pi-sparkles suggestion-panel__icon" aria-hidden="true"></i>
    <span v-if="count" class="suggestion-panel__text" data-test="count">
      {{ count }} suggested connection{{ count === 1 ? '' : 's' }}
      <span v-if="lowCount" class="suggestion-panel__low" v-tooltip.top="lowTooltip"
        >({{ lowCount }} low confidence)</span
      >
    </span>
    <Button
      v-if="count"
      label="Accept all"
      icon="pi pi-check"
      size="small"
      data-test="accept-all"
      v-tooltip.top="
        ambiguousCount ? `Leaves out ${ambiguousCount} ambiguous coupling${ambiguousCount === 1 ? '' : 's'}` : null
      "
      @click="$emit('accept-all')"
    />
    <Button
      v-if="count"
      label="Dismiss all"
      icon="pi pi-times"
      size="small"
      severity="secondary"
      text
      data-test="dismiss-all"
      @click="$emit('dismiss-all')"
    />
    <Button
      v-if="dismissedCount"
      :label="`Show ${dismissedCount} dismissed`"
      icon="pi pi-replay"
      size="small"
      severity="secondary"
      text
      data-test="restore-dismissed"
      @click="$emit('restore-dismissed')"
    />
  </Panel>
</template>

<script setup>
import { computed } from 'vue'
import { Panel } from '@vue-flow/core'
import Button from 'primevue/button'
import { useSuggestionStore } from '../stores/suggestionStore'

defineEmits(['accept-all', 'dismiss-all', 'restore-dismissed'])

const suggestionStore = useSuggestionStore()

const count = computed(() => suggestionStore.suggestions.length)
const dismissedCount = computed(() => suggestionStore.dismissed.length)
const lowCount = computed(() => suggestionStore.suggestions.filter((s) => s.confidence === 'low').length)
const ambiguousCount = computed(
  () => suggestionStore.suggestions.flatMap((s) => s.couplings).filter((coupling) => coupling.ambiguous).length,
)
const lowTooltip = 'Dotted: a place was assumed. Hover a suggestion’s badge to see why.'
</script>

<style scoped>
.suggestion-panel {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 999px;
  background: var(--p-content-background);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--p-text-color) 15%, transparent);
  color: var(--p-text-color);
  font-size: 13px;
}

.suggestion-panel__icon {
  color: var(--p-primary-color);
}

.suggestion-panel__low {
  color: var(--p-orange-500);
  cursor: help;
}
</style>
