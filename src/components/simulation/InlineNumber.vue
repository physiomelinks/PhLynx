<template>
  <NumberInput
    v-if="isEditing"
    ref="inputEl"
    v-model="draft"
    :suffix="suffix"
    class="inline-number-input"
    :aria-label="ariaLabel"
    @keydown="onKeydown"
    @blur="commit"
  />
  <button
    v-else
    type="button"
    class="inline-number"
    :aria-label="`Edit ${ariaLabel.toLowerCase()}, ${formatted}`"
    :title="`${formatted}. Click to edit.`"
    @click="startEditing"
    @keydown.enter.prevent="startEditing"
  >
    {{ formatted }}
  </button>
</template>

<script setup>
/**
 * A number shown as text, edited in place: click it (or press Enter on it), then Enter or a click away keeps the new
 * value and Escape leaves it.
 */
import { computed, nextTick, ref } from 'vue'

import NumberInput from './NumberInput.vue'

const props = defineProps({
  modelValue: { type: Number, default: null },
  ariaLabel: { type: String, required: true },
  suffix: { type: String, default: '' },
  min: { type: Number, default: undefined },
  // Whether the value must be above `min`, not just at it, as a length must be above 0.
  isMinExcluded: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const isEditing = ref(false)
const draft = ref(null)
const inputEl = ref(null)
const formatted = computed(() => `${Number.isFinite(props.modelValue) ? Number(props.modelValue.toPrecision(6)) : '–'}${props.suffix}`)

/** Shows the field, with the cursor in it. */
async function startEditing() {
  draft.value = props.modelValue
  isEditing.value = true
  await nextTick()
  inputEl.value?.select()
}

/**
 * Keeps the value on Enter, and leaves it on Escape.
 *
 * @param {KeyboardEvent} event
 */
function onKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }
}

/** Keeps the value typed, unless it isn't one the field allows, and shows it as text again. */
function commit() {
  if (!isEditing.value) return
  isEditing.value = false
  const value = draft.value
  if (value == null || !Number.isFinite(value)) return
  if (props.min != null && (props.isMinExcluded ? value <= props.min : value < props.min)) return
  if (value !== props.modelValue) emit('update:modelValue', value)
}

/** Leaves the value as it was. */
function cancel() {
  isEditing.value = false
}
</script>

<style scoped>
.inline-number {
  /* As tall as the field it turns into, so the heading keeps its height while one is edited. */
  box-sizing: border-box;
  height: 1.75rem;
  min-width: 0;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: left;
  white-space: nowrap;
  cursor: text;
}

.inline-number:hover {
  border-color: var(--p-content-border-color);
  background: var(--p-content-background);
}

.inline-number:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.inline-number-input {
  width: 6.5rem;
  height: 1.75rem;
}

.inline-number-input :deep(input) {
  box-sizing: border-box;
  height: 1.75rem;
  padding-top: 0;
  padding-bottom: 0;
  padding-right: 1.75rem;
}
</style>
