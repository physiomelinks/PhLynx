<template>
  <Dialog
    :visible="modelValue"
    :header="header"
    modal
    :draggable="false"
    :style="{ width: '440px' }"
    :appendTo="'body'"
    @update:visible="(visible) => !visible && handleCancel()"
    @mousedown.stop
    @wheel.stop
  >
    <form class="save-as-form" @submit.prevent="handleConfirm">
      <p class="save-as-message">{{ message }}</p>
      <label for="component-save-as-name">Component name</label>
      <SanitisedInput
        v-model="componentName"
        input-id="component-save-as-name"
        :sanitise="sanitiseName"
        :invalid="!!error"
        placeholder="Component name..."
        autofocus
      />
      <small v-if="error" class="error-text">{{ error }}</small>
      <small v-if="file" class="file-text">Saved in {{ file }}</small>
    </form>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" text @click="handleCancel" />
        <Button label="Save" :disabled="!!error" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

import SanitisedInput from '../SanitisedInput.vue'
import { sanitiseName } from '../../utils/identifiers'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  header: { type: String, default: 'Save As New Component' },
  message: { type: String, default: '' },
  /** Prefilled name. */
  initialName: { type: String, default: '' },
  /** The file the component is saved in, shown for context. */
  file: { type: String, default: '' },
  /** (name) => why the name can't be used, or '' when it can. */
  isTaken: { type: Function, default: () => '' },
})

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel'])

const componentName = ref('')

const error = computed(() => {
  const cleaned = sanitiseName(componentName.value ?? '')
  if (!cleaned) return 'Component name cannot be empty.'
  return props.isTaken(cleaned)
})

watch(
  () => props.modelValue,
  (isVisible) => {
    if (isVisible) componentName.value = props.initialName
  },
  { immediate: true }
)

function handleConfirm() {
  if (error.value) return
  emit('confirm', sanitiseName(componentName.value))
  emit('update:modelValue', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:modelValue', false)
}
</script>

<style scoped>
.save-as-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.save-as-message {
  margin: 0 0 0.5rem;
  color: var(--p-text-muted-color);
}

.error-text {
  color: var(--p-red-500, #ef4444);
}

.file-text {
  color: var(--p-text-muted-color);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
