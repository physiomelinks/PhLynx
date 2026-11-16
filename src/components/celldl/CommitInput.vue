<template>
  <InputText
    ref="inputRef"
    v-model="draft"
    size="small"
    :class="['commit-input', { 'commit-input--number': numeric }]"
    :invalid="!!problem || invalid"
    :disabled="disabled"
    :placeholder="placeholder"
    :title="problem || title"
    :aria-label="ariaLabel"
    @focus="isFocused = true"
    @blur="onBlur"
    @keydown.enter.prevent="commit"
    @keydown.esc="revert"
  />
</template>

<script setup>
/**
 * A text field that commits on Enter or blur, not as it is typed, and keeps its draft while focused, so a value
 * arriving meanwhile (e.g. the diagram's element list after another edit) doesn't overwrite it.
 */
import { computed, ref, watch } from 'vue'

import InputText from 'primevue/inputtext'

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** Says what's wrong with a draft, or '' for one that can be committed. */
  validate: { type: Function, default: () => '' },
  numeric: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  invalid: { type: Boolean, default: false },
  title: { type: String, default: '' },
  ariaLabel: { type: String, default: undefined },
})

const emit = defineEmits(['commit'])

const inputRef = ref(null)
const draft = ref(props.modelValue)
const isFocused = ref(false)

// The draft last committed, so Enter then blur commits it once, even if the value shown stays as it was.
let committed = null

watch(
  () => props.modelValue,
  (value) => {
    committed = null
    if (!isFocused.value) draft.value = value
  }
)

const problem = computed(() => (draft.value === props.modelValue ? '' : props.validate(draft.value.trim())))

/** Commits a changed, valid draft. */
function commit() {
  const value = draft.value.trim()
  if (value === props.modelValue || value === committed || props.validate(value)) return
  committed = value
  emit('commit', value)
}

function onBlur() {
  isFocused.value = false
  commit()
  // An invalid draft gives way to the value it would have replaced.
  if (props.validate(draft.value.trim())) draft.value = props.modelValue
  // A committed one gives way to what the commit made of it, which may come a moment later, e.g. from the diagram,
  // or never, e.g. a value typed the same as its default, which shows blank.
  else if (draft.value.trim() === committed) setTimeout(followCommit, COMMIT_SETTLE_MS)
}

const COMMIT_SETTLE_MS = 400

function followCommit() {
  if (!isFocused.value && committed !== null && draft.value.trim() === committed) draft.value = props.modelValue
}

/** Escape drops the draft, and stays in the field rather than closing the editor. */
function revert(event) {
  if (draft.value === props.modelValue) return
  event.stopPropagation()
  draft.value = props.modelValue
}

defineExpose({ commit })
</script>

<style scoped>
.commit-input {
  width: 100%;
  min-width: 0;
}

/* A blank field's placeholder is the default it uses, so it reads as greyed, not as a value. */
.commit-input::placeholder {
  color: var(--p-text-muted-color);
  font-style: italic;
  opacity: 0.75;
}

.commit-input--number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
