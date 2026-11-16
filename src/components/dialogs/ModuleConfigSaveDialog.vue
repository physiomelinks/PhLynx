<template>
  <Dialog
    :visible="modelValue"
    header="Save Module Config"
    modal
    :draggable="false"
    :style="{ width: '440px' }"
    :appendTo="'body'"
    @update:visible="(visible) => !visible && handleCancel()"
    @mousedown.stop
    @wheel.stop
  >
    <form class="config-form" @submit.prevent="handleConfirm">
      <p class="config-message">
        This instance's ports or variables no longer match <strong>{{ matchRef || moduleRef }}</strong>.
      </p>

      <div v-if="canUpdate" class="config-option">
        <RadioButton v-model="choice" input-id="module-config-update" value="update" />
        <label for="module-config-update">
          Overwrite {{ moduleRef }}
          <small class="hint-text">{{ updateHint }}</small>
        </label>
      </div>
      <p v-else class="config-message">Its math differs from {{ moduleRef }}'s, so it needs a config of its own.</p>

      <div class="config-option">
        <RadioButton v-if="canUpdate" v-model="choice" input-id="module-config-new" value="new" />
        <label for="module-config-new">
          Create new config
          <small class="hint-text">Only this instance moves to it, as {{ newRef }}.</small>
        </label>
      </div>
    </form>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" text @click="handleCancel" />
        <Button label="Save" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import RadioButton from 'primevue/radiobutton'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** The instance's module, `<type>:<subtype>`. */
  moduleRef: { type: String, required: true },
  /** The module the instance no longer matches, when not moduleRef (math saved as a new component). */
  matchRef: { type: String, default: '' },
  /** How many other instances use the module. */
  otherCount: { type: Number, default: 0 },
  /** Whether the module can take this instance's config; false when its math differs from the others'. */
  canUpdate: { type: Boolean, default: true },
  /** The ref a new config takes, `<type>:<instance name>` (see configOwnership's newConfigRef). */
  newRef: { type: String, required: true },
})

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel'])

const choice = ref('new')

const updateHint = computed(() => {
  const count = props.otherCount
  if (count === 0) return 'No other instances use it; instances added from it later take the change.'
  return `Also changes the ${count} other instance${count !== 1 ? 's' : ''} using it, keeping their values.`
})

watch(
  () => props.modelValue,
  (isVisible) => {
    if (isVisible) choice.value = 'new'
  },
  { immediate: true }
)

function handleConfirm() {
  emit('confirm', choice.value === 'new' ? { action: 'new', moduleRef: props.newRef } : { action: 'update' })
  emit('update:modelValue', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:modelValue', false)
}
</script>

<style scoped>
.config-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.config-message {
  margin: 0;
  color: var(--p-text-muted-color);
}

.config-option {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.config-option label {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.hint-text {
  color: var(--p-text-muted-color);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
