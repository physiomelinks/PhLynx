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
        This instance's ports or variables no longer match <strong>{{ moduleRef }}</strong>.
      </p>

      <div v-if="canUpdate" class="config-option">
        <RadioButton v-model="choice" input-id="module-config-update" value="update" />
        <label for="module-config-update">
          Update {{ moduleRef }}
          <small class="hint-text">{{ updateHint }}</small>
        </label>
      </div>
      <p v-else class="config-message">Its math differs from the other instances', so it needs a config of its own.</p>

      <div class="config-option">
        <RadioButton v-if="canUpdate" v-model="choice" input-id="module-config-new" value="new" />
        <label for="module-config-new">
          Save as new config
          <small class="hint-text">Only this instance moves to it.</small>
        </label>
      </div>
      <div v-if="choice === 'new'" class="name-field">
        <label for="module-config-name">Config name</label>
        <div class="name-row">
          <span class="type-prefix">{{ moduleType }}:</span>
          <SanitisedInput
            v-model="subtype"
            input-id="module-config-name"
            :sanitise="sanitiseName"
            :invalid="!!error"
            placeholder="Config name..."
            autofocus
          />
        </div>
        <small v-if="error" class="error-text">{{ error }}</small>
      </div>
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
import RadioButton from 'primevue/radiobutton'

import SanitisedInput from '../SanitisedInput.vue'
import { sanitiseName } from '../../utils/identifiers'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** The instance's module, `<type>:<subtype>`. */
  moduleRef: { type: String, required: true },
  /** How many other instances use the module. */
  otherCount: { type: Number, default: 0 },
  /** Whether the module can take this instance's config; false when its math differs from the others'. */
  canUpdate: { type: Boolean, default: true },
  /** Prefilled subtype for a new config. */
  initialName: { type: String, default: '' },
  /** Every module ref taken, `<type>:<subtype>`. */
  existingRefs: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel'])

const choice = ref('new')
const subtype = ref('')

const moduleType = computed(() => props.moduleRef.split(':')[0])

const updateHint = computed(() => {
  const count = props.otherCount
  if (count === 0) return 'No other instances use it.'
  return `Also changes the ${count} other instance${count !== 1 ? 's' : ''} using it, keeping their values.`
})

const error = computed(() => {
  if (choice.value !== 'new') return ''
  const cleaned = sanitiseName(subtype.value ?? '')
  if (!cleaned) return 'Config name cannot be empty.'
  if (props.existingRefs.includes(`${moduleType.value}:${cleaned}`))
    return `A ${moduleType.value} config named "${cleaned}" already exists.`
  return ''
})

watch(
  () => props.modelValue,
  (isVisible) => {
    if (!isVisible) return
    subtype.value = props.initialName
    choice.value = props.canUpdate && props.otherCount === 0 ? 'update' : 'new'
  },
  { immediate: true }
)

function handleConfirm() {
  if (error.value) return
  const moduleRef = `${moduleType.value}:${sanitiseName(subtype.value)}`
  emit('confirm', choice.value === 'new' ? { action: 'new', moduleRef } : { action: 'update' })
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

.name-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-left: 1.75rem;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.type-prefix,
.hint-text {
  color: var(--p-text-muted-color);
}

.error-text {
  color: var(--p-red-500, #ef4444);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
