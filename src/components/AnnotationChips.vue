<template>
  <!-- An annotated port's meaning as read-only chips; hovering or clicking shows the full annotation -->
  <span
    v-bind="$attrs"
    :class="['annotation-chips', { 'annotation-chips--muted': muted, 'annotation-chips--wrap': limit === Infinity }]"
    role="button"
    tabindex="0"
    aria-haspopup="dialog"
    :aria-expanded="isOpen"
    :aria-label="ariaLabel"
    @mouseenter="onEnter"
    @mouseleave="scheduleHide"
    @mousedown.stop
    @click.stop="togglePinned"
    @keydown.enter.prevent.stop="togglePinned"
    @keydown.space.prevent.stop="togglePinned"
  >
    <span class="annotation-chips__shown">
      <Chip
        v-for="chip in shownChips"
        :key="`${chip.kind}:${chip.text}`"
        :label="chip.text"
        :data-kind="chip.kind"
        :class="['annotation-chip', `annotation-chip--${chip.kind}`, { 'annotation-chip--low': chip.kind === 'location' && isLow }]"
      />
    </span>
    <!-- Never clipped, so the rest stays in reach -->
    <Chip
      v-if="hiddenCount"
      :label="`+${hiddenCount}`"
      data-kind="more"
      :class="['annotation-chip', 'annotation-chip--more', { 'annotation-chip--low': isLow }]"
    />
  </span>

  <Popover ref="popover" @hide="close">
    <div class="annotation-detail" @mouseenter="cancelHide" @mouseleave="scheduleHide">
      <div class="annotation-detail__head">
        <span :class="['annotation-detail__variable', { 'annotation-detail__variable--none': !hasVariable }]">
          {{ variableName }}
        </span>
        <span v-if="role" class="annotation-detail__role" :title="ROLE_DESCRIPTIONS[role]">{{ role }}</span>
      </div>
      <div class="annotation-detail__chips">
        <Chip
          v-for="chip in chips"
          :key="`${chip.kind}:${chip.text}`"
          :label="chip.text"
          :data-kind="chip.kind"
          :class="['annotation-chip', `annotation-chip--${chip.kind}`]"
        />
      </div>
      <dl class="annotation-detail__list">
        <template v-if="property">
          <dt>Property</dt>
          <dd><TermLine :term="termDetail(property)" /></dd>
        </template>
        <template v-if="species.length">
          <dt>Species</dt>
          <dd v-for="term in species" :key="term"><TermLine :term="termDetail(term)" /></dd>
        </template>
        <dt>Location</dt>
        <dd>
          <TermLine v-if="locationTerm" :term="termDetail(locationTerm)" />
          <div v-if="isSelfLocation" :class="{ 'annotation-detail__muted': locationTerm }">{{ selfText }}</div>
          <span v-else-if="!location">Stored with the copy, as the instance has no ApiCoord</span>
        </dd>
        <dt>Place</dt>
        <dd v-if="!places.length" class="annotation-detail__muted">
          {{ isBound ? 'Not resolved from this ApiCoord' : 'The instance is not bound to an ApiCoord' }}
        </dd>
        <dd v-for="(place, i) in places" :key="i" :data-place="i">
          <span>{{ place.text }}</span>
          <span v-if="place.confidence === 'low'" class="annotation-detail__low">low confidence</span>
          <div v-if="place.path" class="annotation-detail__path" data-test="path">{{ place.path }}</div>
          <div v-if="place.why" class="annotation-detail__why">{{ place.why }}</div>
        </dd>
        <template v-if="confidence || why">
          <dt>Match</dt>
          <dd>
            <span v-if="confidence">{{ confidence }} confidence</span>
            <div v-if="why" class="annotation-detail__why">{{ why }}</div>
          </dd>
        </template>
        <dt>Subject</dt>
        <dd class="annotation-detail__code">{{ subjectText(annotation.subject) }}</dd>
        <template v-if="copiedFrom">
          <dt>Copied from</dt>
          <dd data-test="copied-from">
            {{ copiedFrom.instance ?? 'another instance' }}
            <div class="annotation-detail__code">{{ subjectText(copiedFrom.subject) }}</div>
          </dd>
        </template>
        <template v-else-if="annotation.source?.mathRef">
          <dt>Sidecar</dt>
          <dd class="annotation-detail__code">{{ annotation.source.mathRef }}</dd>
        </template>
      </dl>
    </div>
  </Popover>
</template>

<script setup>
import { computed, defineComponent, h, inject, onBeforeUnmount, ref } from 'vue'
import Chip from 'primevue/chip'
import Popover from 'primevue/popover'
import {
  ROLE_DESCRIPTIONS,
  annotationChips,
  resolvedPlaces,
  subjectText,
  termDetail,
} from '../services/annotations/display'

// Two roots (the chips and their detail): attributes go on the chips.
defineOptions({ inheritAttrs: false })

const props = defineProps({
  // port.annotation, or a sidecar entry for a variable without a port.
  annotation: { type: Object, required: true },
  // The located quantity (quantityOfPort); its property, species and places win over the annotation's copy.
  quantity: { type: Object, default: null },
  // Chips shown before a "+N" chip; Infinity shows them all, wrapping.
  limit: { type: Number, default: Infinity },
  // Greyed, e.g. for an annotated variable that has no port yet.
  muted: { type: Boolean, default: false },
  // The variable shown in the detail; defaults to the annotation's.
  variable: { type: String, default: '' },
  // A match's confidence and reason, when the caller has one.
  confidence: { type: String, default: '' },
  why: { type: String, default: '' },
  // Whether the node is bound to an ApiCoord, for the detail's wording when no place resolved.
  isBound: { type: Boolean, default: false },
})

/** One term as label, CURIE and a link to its IRI. */
const TermLine = defineComponent({
  props: { term: { type: Object, required: true } },
  setup(lineProps) {
    return () => {
      const { label, curie, iri } = lineProps.term
      const link = iri.startsWith('http')
        ? h('a', { href: iri, target: '_blank', rel: 'noopener noreferrer', class: 'annotation-detail__iri' }, curie)
        : h('span', { class: 'annotation-detail__iri' }, curie)
      return h('span', [label !== curie ? h('span', `${label} `) : null, link])
    }
  },
})

const property = computed(() => props.quantity?.property ?? props.annotation.property ?? null)
const species = computed(() => props.quantity?.species ?? props.annotation.species ?? [])
const location = computed(() => props.quantity?.location ?? props.annotation.location ?? null)
const role = computed(() => props.quantity?.role ?? props.annotation.role ?? '')

const chips = computed(() =>
  annotationChips({
    property: property.value,
    species: species.value,
    location: location.value,
    absoluteLocation: props.annotation.absoluteLocation,
  })
)
const shownChips = computed(() => chips.value.slice(0, props.limit))
const hiddenCount = computed(() => Math.max(chips.value.length - props.limit, 0))

const places = computed(() =>
  resolvedPlaces(props.quantity ?? (props.annotation.absoluteLocation ? { locations: [props.annotation.absoluteLocation] } : null))
)
const isLow = computed(() => props.confidence === 'low' || (places.value.length && places.value.every((p) => p.confidence === 'low')))

const isSelfLocation = computed(() => !!location.value?.startsWith('self'))
const locationTerm = computed(() => {
  if (!location.value || location.value === 'self') return null
  return location.value.startsWith('self+') ? location.value.slice(5) : location.value
})
const selfText = computed(() =>
  location.value === 'self' ? 'This instance’s own place, from its ApiCoord' : 'Of this instance’s own place'
)

const hasVariable = computed(() => !!(props.variable || props.annotation.variable))
const variableName = computed(
  () =>
    props.variable ||
    props.annotation.variable ||
    (props.annotation.source?.kind === 'copied' ? 'No variable chosen yet' : subjectText(props.annotation.subject))
)
const copiedFrom = computed(() =>
  props.annotation.source?.kind === 'copied' ? (props.annotation.source.copiedFrom ?? {}) : null
)
const ariaLabel = computed(
  () => `Annotation of ${variableName.value}: ${chips.value.map((chip) => chip.text).join(', ')}`
)

const popover = ref(null)
const pinned = ref(false)
const isOpen = ref(false)
let hideTimer = null

// A popover these chips sit in (e.g. a suggestion's detail) stays open while this detail is open.
const host = inject('annotationPopoverHost', null)

function cancelHide() {
  clearTimeout(hideTimer)
  hideTimer = null
}

function open(event) {
  popover.value?.show(event, event.currentTarget)
  if (isOpen.value) return
  isOpen.value = true
  host?.hold()
}

/** Also runs when the Popover closes itself, on Escape or a click elsewhere. */
function close() {
  pinned.value = false
  popover.value?.hide()
  if (!isOpen.value) return
  isOpen.value = false
  host?.release()
}

function onEnter(event) {
  cancelHide()
  open(event)
}

/** Hides the hover detail shortly after the pointer leaves, unless a click pinned it. */
function scheduleHide() {
  if (pinned.value) return
  cancelHide()
  hideTimer = setTimeout(() => {
    if (!pinned.value) close()
  }, 150)
}

/** A click keeps the detail open until clicked again or elsewhere. */
function togglePinned(event) {
  cancelHide()
  if (pinned.value) return close()
  pinned.value = true
  open(event)
}

onBeforeUnmount(() => {
  cancelHide()
  if (isOpen.value) host?.release()
})
</script>

<style scoped>
.annotation-chips {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  cursor: help;
  border-radius: 4px;
}

.annotation-chips__shown {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.annotation-chips--wrap,
.annotation-chips--wrap .annotation-chips__shown {
  flex-wrap: wrap;
}

.annotation-chips:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.annotation-chip.p-chip {
  --chip-color: var(--p-text-muted-color);
  flex: none;
  gap: 0;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  color: var(--p-text-color);
  background-color: color-mix(in srgb, var(--chip-color) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--chip-color) 40%, transparent);
}

/* Chips shrink to an ellipsis rather than being cut off; a species, usually short, keeps its width */
.annotation-chips__shown .annotation-chip.p-chip {
  flex: 0 1 auto;
  min-width: 3em;
}

.annotation-chips__shown .annotation-chip--species.p-chip {
  flex-shrink: 0;
  min-width: 0;
}

.annotation-chips__shown .annotation-chip :deep(.p-chip-label) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.annotation-chip--species.p-chip {
  --chip-color: var(--p-green-500);
}

.annotation-chip--property.p-chip {
  --chip-color: var(--p-sky-500);
}

.annotation-chip--location.p-chip {
  --chip-color: var(--p-amber-500);
}

/* A place found only by assumption */
.annotation-chip--low.p-chip {
  border-style: dashed;
  border-color: var(--p-orange-500);
}

.annotation-chips--muted {
  opacity: 0.55;
}

.annotation-chips--muted .annotation-chip.p-chip {
  --chip-color: var(--p-text-muted-color);
}

.annotation-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 360px;
  font-size: 12px;
}

.annotation-detail__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.annotation-detail__variable {
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.annotation-detail__variable--none {
  font-family: inherit;
  font-weight: normal;
  font-style: italic;
  color: var(--p-text-muted-color);
}

.annotation-detail__role {
  color: var(--p-text-muted-color);
  text-transform: capitalize;
}

.annotation-detail__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.annotation-detail__list {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 10px;
  margin: 0;
}

.annotation-detail__list dt {
  grid-column: 1;
  color: var(--p-text-muted-color);
}

.annotation-detail__list dd {
  grid-column: 2;
  margin: 0;
  overflow-wrap: anywhere;
}

/* TermLine renders the IRIs, outside this template's scope */
.annotation-detail :deep(.annotation-detail__iri),
.annotation-detail__code,
.annotation-detail__path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.annotation-detail :deep(.annotation-detail__iri) {
  color: var(--p-primary-color);
}

.annotation-detail :deep(a.annotation-detail__iri) {
  text-decoration: none;
}

.annotation-detail :deep(a.annotation-detail__iri:hover) {
  text-decoration: underline;
}

.annotation-detail__low {
  margin-left: 6px;
  color: var(--p-orange-500);
}

.annotation-detail__why,
.annotation-detail__muted {
  color: var(--p-text-muted-color);
}
</style>
