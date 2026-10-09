<template>
  <span class="number-input" :class="{ 'number-input--invalid': isInvalid }">
    <InputText
      ref="inputEl"
      v-model="text"
      size="small"
      inputmode="decimal"
      :aria-label="ariaLabel"
      :aria-invalid="isInvalid"
      :autofocus="autofocus"
      fluid
      @blur="(event) => ((text = format(modelValue)), emit('blur', event))"
      @keydown="(event) => emit('keydown', event)"
    />
    <span v-if="suffix" class="number-suffix" aria-hidden="true">{{ suffix.trim() }}</span>
  </span>
</template>

<script setup>
/**
 * A number field that takes any number as typed, 1e-9 and 2.5E+6 too, as small parameter values need; a value is
 * passed on once it reads as a number, and the field shows the value again when left.
 */
import { ref, watch } from 'vue'

import InputText from 'primevue/inputtext'

const props = defineProps({
  modelValue: { type: Number, default: null },
  ariaLabel: { type: String, default: undefined },
  // Shown after the number, such as its units.
  suffix: { type: String, default: '' },
  autofocus: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'keydown', 'blur'])

/**
 * Writes a number as the field shows it: in full, without float noise.
 *
 * @param {number|null} value
 * @returns {string}
 */
const format = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '')

const text = ref(format(props.modelValue))
const isInvalid = ref(false)
const inputEl = ref(null)

watch(text, (typed) => {
  const value = typed.trim() === '' ? NaN : Number(typed.trim())
  isInvalid.value = !Number.isFinite(value)
  if (!isInvalid.value && value !== props.modelValue) emit('update:modelValue', value)
})
watch(
  () => props.modelValue,
  (value) => {
    if (Number(text.value) !== value) text.value = format(value)
  }
)

defineExpose({
  /** Puts the cursor in the field, its number selected. */
  select: () => inputEl.value?.$el?.select(),
})
</script>

<style scoped>
.number-input {
  position: relative;
  display: block;
  min-width: 0;
}

.number-input :deep(input) {
  padding-right: 3.5rem;
  font-variant-numeric: tabular-nums;
}

.number-suffix {
  position: absolute;
  top: 50%;
  right: 8px;
  max-width: 3.25rem;
  overflow: hidden;
  transform: translateY(-50%);
  color: var(--p-text-muted-color);
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.number-input--invalid :deep(input) {
  border-color: var(--p-red-500);
}
</style>
