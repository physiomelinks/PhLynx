<template>
  <!-- A suggested connection: a dashed line (dotted, in the warning colour, when low confidence) that never takes
       the pointer, and a badge to accept or dismiss it whose hover lists the couplings -->
  <svg class="suggested-edge" aria-hidden="true">
    <path :d="path" :class="['suggested-edge__glow', { 'suggested-edge__glow--low': isLow }]" />
    <path :d="path" :class="['suggested-edge__line', { 'suggested-edge__line--low': isLow }]" />
  </svg>
  <div
    :class="['suggested-edge__badge', 'nodrag', 'nopan', { 'suggested-edge__badge--low': isLow }]"
    :style="{ transform: `translate(${labelX}px, ${labelY}px) scale(${badgeScale}) translate(-50%, -50%)` }"
    :data-suggestion="suggestion.key"
    role="group"
    :aria-label="`Suggested connection ${connectionText}`"
  >
    <i v-if="isLow" class="pi pi-exclamation-triangle suggested-edge__why" v-tooltip.top="whyText" data-test="why"></i>
    <span
      class="suggested-edge__label"
      data-test="couplings"
      tabindex="0"
      aria-haspopup="dialog"
      @mouseenter="onEnter"
      @mouseleave="scheduleHide"
      @focus="onEnter"
      @blur="scheduleHide"
      @keydown.escape="hideNow"
    >
      {{ countText }}
    </span>
    <Button
      icon="pi pi-check"
      severity="success"
      size="small"
      rounded
      text
      :aria-label="`Accept ${connectionText}`"
      v-tooltip.top="'Accept'"
      class="suggested-edge__action"
      data-test="accept"
      @mousedown.stop
      @click.stop="$emit('accept', suggestion)"
    />
    <Button
      icon="pi pi-times"
      severity="secondary"
      size="small"
      rounded
      text
      :aria-label="`Dismiss ${connectionText}`"
      v-tooltip.top="'Dismiss'"
      class="suggested-edge__action"
      data-test="dismiss"
      @mousedown.stop
      @click.stop="$emit('dismiss', suggestion)"
    />
  </div>

  <Popover ref="popover">
    <div class="suggestion-detail" @mouseenter="onDetailEnter" @mouseleave="onDetailLeave">
      <div class="suggestion-detail__head">
        <span class="suggestion-detail__nodes">{{ sourceLabel }} → {{ targetLabel }}</span>
        <span :class="['suggestion-detail__confidence', { 'suggestion-detail__confidence--low': isLow }]">
          {{ suggestion.confidence }} confidence
        </span>
      </div>
      <div v-if="isLow && suggestion.why" class="suggestion-detail__why">{{ suggestion.why }}</div>
      <ul class="suggestion-detail__couplings">
        <li v-for="coupling in suggestion.couplings" :key="coupling.key" class="suggestion-detail__coupling">
          <span class="suggestion-detail__end">
            <code>{{ coupling.source.variable }}</code>
            <AnnotationChips
              :annotation="annotationOf(coupling.source)"
              :quantity="placed(coupling, 'source')"
              :confidence="coupling.confidence"
              :why="coupling.why ?? ''"
              is-bound
            />
          </span>
          <span
            class="suggestion-detail__arrow"
            :title="coupling.kind === 'sum' ? 'Adds to the sum' : 'Shares the value'"
          >
            {{ coupling.kind === 'sum' ? '→ Σ' : '→' }}
          </span>
          <span class="suggestion-detail__end">
            <code>{{ coupling.target.variable }}</code>
            <AnnotationChips
              :annotation="annotationOf(coupling.target)"
              :quantity="placed(coupling, 'target')"
              :confidence="coupling.confidence"
              :why="coupling.why ?? ''"
              is-bound
            />
          </span>
          <span v-if="coupling.ambiguous" class="suggestion-detail__ambiguous"
            >ambiguous: Accept all leaves it out</span
          >
        </li>
      </ul>
    </div>
  </Popover>
</template>

<script setup>
import { computed, onBeforeUnmount, provide, ref } from 'vue'
import Button from 'primevue/button'
import Popover from 'primevue/popover'
import AnnotationChips from './AnnotationChips.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  // From suggestCouplings.
  suggestion: { type: Object, required: true },
  // The line's SVG path, in flow coordinates, and where its badge sits.
  path: { type: String, required: true },
  labelX: { type: Number, required: true },
  labelY: { type: Number, required: true },
  // The instances' names, for the detail.
  sourceLabel: { type: String, default: '' },
  targetLabel: { type: String, default: '' },
  // The canvas zoom; the badge is scaled up when zoomed out, so it stays legible.
  zoom: { type: Number, default: 1 },
})

defineEmits(['accept', 'dismiss'])

const isLow = computed(() => props.suggestion.confidence === 'low')
const whyText = computed(() => props.suggestion.why || 'Low confidence: a place was assumed.')
const connectionText = computed(() => `${props.sourceLabel} to ${props.targetLabel}`)
// Never smaller than at zoom 1, nor more than half as big again when zoomed far out.
const badgeScale = computed(() => Math.min(Math.max(1 / (props.zoom || 1), 1), 1.5))
const countText = computed(() => {
  const n = props.suggestion.couplings.length
  return `${n} coupling${n === 1 ? '' : 's'}`
})

/** One end of a coupling as the annotation its port will carry. */
const annotationOf = (quantity) => ({ ...quantity, source: { kind: 'sidecar', mathRef: quantity.mathRef } })

/** One end of a coupling as a located quantity, so its chips show the place the match found. */
function placed(coupling, end) {
  const path = coupling.place?.[`${end}Path`]
  return {
    ...coupling[end],
    locations: [
      {
        key: coupling.place?.key,
        confidence: coupling.confidence,
        ...(path ? { path } : {}),
        ...(coupling.why ? { why: coupling.why } : {}),
      },
    ],
  }
}

const popover = ref(null)
let hideTimer = null
let isPointerInDetail = false
let held = 0

function cancelHide() {
  clearTimeout(hideTimer)
  hideTimer = null
}

function onEnter(event) {
  cancelHide()
  popover.value?.show(event, event.currentTarget)
}

/** Hides the detail shortly after the pointer leaves, so it can be moved onto the detail. */
function scheduleHide() {
  cancelHide()
  if (held) return
  hideTimer = setTimeout(() => popover.value?.hide(), 200)
}

function hideNow() {
  cancelHide()
  popover.value?.hide()
}

function onDetailEnter() {
  isPointerInDetail = true
  cancelHide()
}

function onDetailLeave() {
  isPointerInDetail = false
  scheduleHide()
}

// A coupling's chips open their own detail over this one; this one stays while that is open.
provide('annotationPopoverHost', {
  hold() {
    held += 1
    cancelHide()
  },
  release() {
    held = Math.max(held - 1, 0)
    if (!isPointerInDetail) scheduleHide()
  },
})

onBeforeUnmount(cancelHide)
</script>

<style scoped>
/* Under the nodes and edges, in the zoom pane's stacking context */
.suggested-edge {
  z-index: -1;
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: none;
}

.suggested-edge__glow {
  fill: none;
  stroke: var(--p-primary-color);
  stroke-width: 9;
  stroke-linecap: round;
  opacity: 0.15;
}

.suggested-edge__glow--low {
  stroke: var(--p-orange-500);
}

.suggested-edge__line {
  fill: none;
  stroke: var(--p-primary-color);
  stroke-width: 3;
  stroke-dasharray: 10 7;
  stroke-linecap: round;
}

.suggested-edge__line--low {
  stroke: var(--p-orange-500);
  stroke-dasharray: 1 7;
  stroke-width: 4;
}

.suggested-edge__badge {
  z-index: 1000;
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 1px 2px 1px 10px;
  border: 1.5px dashed var(--p-primary-color);
  border-radius: 999px;
  background: var(--p-content-background);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--p-text-color) 20%, transparent);
  color: var(--p-text-color);
  font-size: 12px;
  white-space: nowrap;
  pointer-events: auto;
  cursor: default;
}

.suggested-edge__badge--low {
  border: 1.5px dotted var(--p-orange-500);
}

.suggested-edge__why {
  margin-right: 4px;
  font-size: 12px;
  color: var(--p-orange-500);
  cursor: help;
}

.suggested-edge__label {
  margin-right: 2px;
  border-radius: 4px;
  color: var(--p-text-muted-color);
  cursor: help;
}

.suggested-edge__label:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.suggested-edge__action.p-button {
  width: 24px;
  height: 24px;
  padding: 0;
}

.suggestion-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 560px;
  font-size: 12px;
}

.suggestion-detail__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.suggestion-detail__nodes {
  font-weight: 600;
}

.suggestion-detail__confidence {
  color: var(--p-text-muted-color);
}

.suggestion-detail__confidence--low {
  color: var(--p-orange-500);
}

.suggestion-detail__why {
  color: var(--p-text-muted-color);
}

.suggestion-detail__couplings {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 6px 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.suggestion-detail__coupling {
  display: contents;
}

.suggestion-detail__end {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.suggestion-detail__end code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}

.suggestion-detail__arrow {
  align-self: center;
  color: var(--p-text-muted-color);
}

.suggestion-detail__ambiguous {
  grid-column: 1 / -1;
  color: var(--p-orange-500);
}
</style>
