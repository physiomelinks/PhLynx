<template>
  <!-- Drawn in Vue Flow's zoom pane, so suggestions follow the canvas but are never edges: they stay out of the
       saved workspace, exports and simulation. Only the badges take the pointer. -->
  <div v-if="items.length" class="suggestion-layer">
    <SuggestedEdge
      v-for="item in items"
      :key="item.suggestion.key"
      v-bind="item"
      :zoom="zoom"
      @accept="$emit('accept', $event)"
      @dismiss="$emit('dismiss', $event)"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { getSmoothStepPath, useVueFlow } from '@vue-flow/core'
import SuggestedEdge from './SuggestedEdge.vue'
import { useSuggestionStore } from '../stores/suggestionStore'
import { handlePosition } from '../utils/handles'
import { facingSides, nodeRect, sideAnchor } from '../utils/suggestionGeometry'

defineEmits(['accept', 'dismiss'])

const { findNode, viewport } = useVueFlow()
const suggestionStore = useSuggestionStore()

const zoom = computed(() => viewport?.value?.zoom ?? 1)

const items = computed(() =>
  suggestionStore.suggestions.flatMap((suggestion) => {
    const source = findNode(suggestion.sourceName)
    const target = findNode(suggestion.targetName)
    if (!source || !target || source.hidden || target.hidden) return []
    const sourceRect = nodeRect(source)
    const targetRect = nodeRect(target)
    const { sourceSide, targetSide } = facingSides(sourceRect, targetRect)
    const from = sideAnchor(sourceRect, sourceSide)
    const to = sideAnchor(targetRect, targetSide)
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX: from.x,
      sourceY: from.y,
      sourcePosition: handlePosition(sourceSide),
      targetX: to.x,
      targetY: to.y,
      targetPosition: handlePosition(targetSide),
    })
    return [
      {
        suggestion,
        path,
        labelX,
        labelY,
        sourceLabel: source.data?.name ?? source.id,
        targetLabel: target.data?.name ?? target.id,
      },
    ]
  }),
)
</script>

<style scoped>
.suggestion-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
}
</style>
