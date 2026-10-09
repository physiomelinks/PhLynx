<template>
  <InputText
    v-if="isEditing"
    ref="inputEl"
    v-model="draft"
    size="small"
    class="inline-text-input"
    :aria-label="ariaLabel"
    :placeholder="placeholder"
    @keydown="onKeydown"
    @blur="commit"
  />
  <button
    v-else
    type="button"
    class="inline-text"
    :class="{ 'inline-text--placeholder': !modelValue }"
    :aria-label="`Edit ${ariaLabel.toLowerCase()}, ${displayed}`"
    :title="`${displayed}. Click to edit.`"
    @click="startEditing"
    @keydown.enter.prevent="startEditing"
  >
    {{ displayed }}
  </button>
</template>

<script setup>
/**
 * A text label shown as text, edited in place: click it (or press Enter on it), then Enter or a click away
 * keeps the new value and Escape leaves it. The same click-to-edit style as protocol-kit's InlineNumber,
 * for a plain string instead of a number.
 */
import { computed, nextTick, ref } from 'vue'

import InputText from 'primevue/inputtext'

const props = defineProps({
  modelValue: { type: String, default: null },
  ariaLabel: { type: String, required: true },
  // Shown, and used as the edited value's own placeholder, when modelValue is empty.
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const isEditing = ref(false)
const draft = ref('')
const inputEl = ref(null)
const displayed = computed(() => props.modelValue || props.placeholder)

/** Shows the field, with the cursor in it. */
async function startEditing() {
  draft.value = props.modelValue ?? ''
  isEditing.value = true
  await nextTick()
  inputEl.value?.$el?.select()
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

/** Keeps the value typed, unless it's blank, and shows it as text again. */
function commit() {
  if (!isEditing.value) return
  isEditing.value = false
  const value = draft.value.trim() || null
  if (value !== props.modelValue) emit('update:modelValue', value)
}

/** Leaves the value as it was. */
function cancel() {
  isEditing.value = false
}
</script>

<style scoped>
.inline-text {
  box-sizing: border-box;
  height: 1.75rem;
  min-width: 0;
  max-width: 100%;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: text;
}

.inline-text--placeholder {
  color: var(--p-text-muted-color, #64748b);
}

.inline-text:hover {
  border-color: var(--p-content-border-color, #e2e8f0);
  background: var(--p-content-background, #ffffff);
}

.inline-text:focus-visible {
  outline: 2px solid var(--p-primary-color, #10b981);
  outline-offset: 1px;
}

.inline-text-input {
  width: 100%;
  height: 1.75rem;
}

.inline-text-input :deep(input) {
  box-sizing: border-box;
  height: 1.75rem;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
