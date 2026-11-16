<template>
  <Dialog
    :visible="modelValue"
    header="Save Parameter Set"
    modal
    :draggable="false"
    :style="{ width: '460px' }"
    :appendTo="'body'"
    @update:visible="(visible) => !visible && handleCancel()"
    @mousedown.stop
    @wheel.stop
  >
    <form class="set-form" @submit.prevent="handleConfirm">
      <p class="set-message">
        This instance's values come from <strong>{{ paramRef }}</strong
        >, {{ setDescription }}.
      </p>

      <div class="set-option">
        <RadioButton v-model="choice" input-id="parameter-set-update" value="update" />
        <label for="parameter-set-update">
          Update {{ paramRef }}
          <small class="hint-text">{{ updateHint }}</small>
        </label>
      </div>
      <ul v-if="choice === 'update' && changes.length" class="change-list" aria-label="Other instances' changes">
        <li v-for="change in changes" :key="`${change.nodeId}.${change.name}`">
          {{ change.nodeName }}.{{ change.name }}: {{ change.from || '(blank)' }} → {{ change.to || '(blank)' }}
        </li>
      </ul>

      <div class="set-option">
        <RadioButton v-model="choice" input-id="parameter-set-new" value="new" />
        <label for="parameter-set-new">
          Create new parameter set
          <small class="hint-text">
            Saved as {{ newRef }}, this instance's own; later edits update it without asking while no other
            instance uses it.
          </small>
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
  /** The set the instance's values come from. */
  paramRef: { type: String, required: true },
  /** Whether this instance made the set, which other instances now use too. */
  isOwn: { type: Boolean, default: false },
  /** The instance that made the set, or '' for an imported set or this instance's own. */
  ownerName: { type: String, default: '' },
  /** The ref a new set of the instance's own would take. */
  newRef: { type: String, required: true },
  /** How many other instances use the set. */
  otherCount: { type: Number, default: 0 },
  /** The values an update changes on the other instances: `{nodeId, nodeName, name, from, to}`. */
  changes: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel'])

const choice = ref('new')

const setDescription = computed(() => {
  if (props.isOwn) return "this instance's own parameter set, which other instances use too"
  return props.ownerName ? `the parameter set ${props.ownerName} made` : 'an imported parameter set'
})

const updateHint = computed(() => {
  const files = props.ownerName || props.isOwn ? '' : ' Your files are not changed; exports write the updated set.'
  const count = props.otherCount
  if (count === 0) return `No other instances use it.${files}`
  const instances = `the ${count} other instance${count !== 1 ? 's' : ''} using it`
  if (!props.changes.length) return `Also tags ${instances}, whose values already match.${files}`
  const values = props.changes.length
  return `Also changes ${values} value${values !== 1 ? 's' : ''} on ${instances}, listed below.${files}`
})

watch(
  () => props.modelValue,
  (isVisible) => {
    if (isVisible) choice.value = props.changes.length ? 'new' : 'update'
  },
  { immediate: true }
)

function handleConfirm() {
  emit('confirm', { action: choice.value })
  emit('update:modelValue', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:modelValue', false)
}
</script>

<style scoped>
.set-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.set-message {
  margin: 0;
  color: var(--p-text-muted-color);
}

.set-option {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.set-option label {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.hint-text {
  color: var(--p-text-muted-color);
}

.change-list {
  margin: 0;
  padding-left: 3rem;
  max-height: 10rem;
  overflow-y: auto;
  font-size: 0.85rem;
  font-family: var(--p-font-family-mono, monospace);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
