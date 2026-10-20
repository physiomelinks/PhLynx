<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="text.header"
    :style="{ width: '400px', maxWidth: '95vw' }"
    @mousedown.stop
    @wheel.stop
  >
    <form class="new-supermodule-form" @submit.prevent="handleConfirm">
      <label for="new-supermodule-name">Name</label>
      <InputText
        id="new-supermodule-name"
        v-model="name"
        autofocus
        :invalid="!!problem"
        aria-describedby="new-supermodule-hint"
      />
      <small id="new-supermodule-hint" :class="['new-supermodule-hint', { 'new-supermodule-hint--error': problem }]">
        <template v-if="problem">{{ problem }}</template>
        <template v-else-if="cleaned !== name.trim()">Will be named <strong>{{ cleaned }}</strong>.</template>
        <template v-else>{{ text.hint }}</template>
      </small>
    </form>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" text @click="closeDialog" />
        <Button :label="text.confirm" :disabled="!!problem" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Asks for a super-module's name: a new, empty one's and its super instance's ('new'), the one a selection is nested into
 * and its super instance's ('nest'), or a new name for one ('rename'). Emits `confirm` with the name, which the rules for
 * names inside super-modules accept and nothing on the canvas (but a super-module renamed) or among the other
 * super-modules has (see useSupermodules).
 */
import { computed, ref, watch } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'

import { useSupermodules } from '../../composables/useSupermodules'
import { sanitiseName } from '../../utils/identifiers'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  mode: {
    type: String,
    default: 'new',
    validator: (value) => ['new', 'nest', 'rename'].includes(value),
  },
  // The super-module renamed, in 'rename' mode.
  smId: {
    type: String,
    default: null,
  },
  // The name offered, in 'rename' mode.
  initialName: {
    type: String,
    default: '',
  },
})

const TEXT = {
  new: { header: 'New Empty Super-module', confirm: 'Create', hint: 'Makes a super-module and one super instance of it, both with this name.' },
  nest: { header: 'Nest Selection', confirm: 'Nest', hint: 'Moves the selection into a new super-module, with one super instance of it in its place, both with this name.' },
  rename: { header: 'Rename Super-module', confirm: 'Rename', hint: 'Its super instances keep their own names.' },
}
const text = computed(() => TEXT[props.mode])

const emit = defineEmits(['update:modelValue', 'confirm'])

const { superInstanceNameProblem, supermoduleNameProblem } = useSupermodules()

const name = ref('')
const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

// The name as it will be kept: sanitised as every node name is.
const cleaned = computed(() => sanitiseName(name.value))
const problem = computed(() => {
  if (!cleaned.value) return 'A name is needed.'
  if (props.mode === 'rename') return supermoduleNameProblem(cleaned.value, { except: props.smId })
  return superInstanceNameProblem(cleaned.value) ?? supermoduleNameProblem(cleaned.value)
})

/** @returns {string} `supermodule`, else the first of `supermodule_2`, `supermodule_3`, … nothing has. */
function freeDefaultName() {
  let candidate = 'supermodule'
  for (let n = 2; superInstanceNameProblem(candidate) || supermoduleNameProblem(candidate); n++) candidate = `supermodule_${n}`
  return candidate
}

function closeDialog() {
  emit('update:modelValue', false)
}

function handleConfirm() {
  if (problem.value) return
  emit('confirm', cleaned.value)
  closeDialog()
}

// Each opening offers a name nothing has.
watch(
  () => props.modelValue,
  (isVisible) => {
    if (isVisible) name.value = props.mode === 'rename' ? props.initialName : freeDefaultName()
  },
  { immediate: true }
)
</script>

<style scoped>
.new-supermodule-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.new-supermodule-hint {
  color: var(--p-text-muted-color);
}

.new-supermodule-hint--error {
  color: var(--p-red-500);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
