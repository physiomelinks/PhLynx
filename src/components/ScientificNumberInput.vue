<template>
  <div class="scientific-number-input" :class="{ 'scientific-number-input--fluid': fluid }">
    <InputGroup v-if="suffix">
      <InputText
        :id="inputId || undefined"
        v-bind="fieldAttrs"
        :model-value="text"
        :size="size"
        :invalid="isInvalid"
        @update:model-value="onInput"
        @blur="onBlur"
      />
      <InputGroupAddon>{{ suffix }}</InputGroupAddon>
    </InputGroup>
    <InputText
      v-else
      :id="inputId || undefined"
      v-bind="fieldAttrs"
      :model-value="text"
      :size="size"
      :invalid="isInvalid"
      :fluid="fluid"
      @update:model-value="onInput"
      @blur="onBlur"
    />
    <small v-if="message" :id="messageId" class="scientific-number-input__message" role="alert">{{ message }}</small>
  </div>
</template>

<script setup>
/**
 * A number field that takes decimal or scientific notation (0.001, 1e-20), for values too small or too
 * large to type digit by digit. It emits the number as it is typed, null while it is blank or not a
 * number, and on leaving the field writes the number back in its shortest form.
 */
import { computed, ref, watch } from 'vue'

import InputGroup from 'primevue/inputgroup'
import InputGroupAddon from 'primevue/inputgroupaddon'
import InputText from 'primevue/inputtext'

import { formatScientificNumber, parseScientificNumber } from '../utils/scientificNumber'

const props = defineProps({
  modelValue: { type: Number, default: null },
  inputId: { type: String, default: '' },
  testId: { type: String, default: '' },
  // Shown after the field, e.g. 's'.
  suffix: { type: String, default: '' },
  // The smallest value allowed; below it the field shows as invalid.
  min: { type: Number, default: null },
  size: { type: String, default: undefined },
  fluid: { type: Boolean, default: false },
  placeholder: { type: String, default: 'e.g. 1e-7' },
})

const emit = defineEmits(['update:modelValue'])

const text = ref(formatScientificNumber(props.modelValue))
const parsed = computed(() => parseScientificNumber(text.value))

const message = computed(() => {
  if (parsed.value === undefined) return 'Enter a number, such as 0.001 or 1e-20.'
  if (props.min !== null && parsed.value !== null && parsed.value < props.min) return `Enter ${props.min} or more.`
  return ''
})
const isInvalid = computed(() => !!message.value)
const messageId = computed(() => (props.inputId ? `${props.inputId}-message` : undefined))

const fieldAttrs = computed(() => ({
  placeholder: props.placeholder,
  autocomplete: 'off',
  spellcheck: false,
  'data-testid': props.testId || undefined,
  'aria-describedby': message.value ? messageId.value : undefined,
}))

/** Emits the typed number, or null while there is none. */
function onInput(value) {
  text.value = value ?? ''
  emit('update:modelValue', parsed.value ?? null)
}

/** Writes a number back in its shortest form, leaving text that isn't one for the user to correct. */
function onBlur() {
  if (parsed.value !== undefined) text.value = formatScientificNumber(parsed.value)
}

// A value set from outside (a reset, a loaded project) replaces the text, but the text typed for the
// value it already holds stays as typed.
watch(
  () => props.modelValue,
  (value) => {
    const typed = parsed.value ?? null
    if (value === typed || (value == null && typed == null)) return
    text.value = formatScientificNumber(value)
  }
)
</script>

<style scoped>
.scientific-number-input {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.scientific-number-input--fluid {
  width: 100%;
}

.scientific-number-input__message {
  color: var(--p-red-500);
}
</style>
