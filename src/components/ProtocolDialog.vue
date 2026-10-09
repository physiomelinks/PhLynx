<template>
  <Dialog
    :visible="modelValue"
    header="Protocol"
    modal
    :draggable="false"
    :dismissableMask="true"
    :style="{ width: '960px', maxHeight: '90vh' }"
    :appendTo="'body'"
    @update:visible="(visible) => !visible && requestClose()"
  >
    <div @keydown="onKeydown">
      <ProtocolEditor :document="draft" :nodes="nodes" :get-global-constant="libraryStore.getGlobalConstant" @update:document="changeDraft" />
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button icon="pi pi-undo" text rounded severity="secondary" :disabled="!past.length" aria-label="Undo" v-tooltip.top="'Undo (⌘Z)'" @click="undo" />
        <Button icon="pi pi-refresh" text rounded severity="secondary" :disabled="!future.length" aria-label="Redo" v-tooltip.top="'Redo (⇧⌘Z)'" @click="redo" />
        <span class="footer-spacer"></span>
        <span v-if="errorCount" class="footer-problems" role="status">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
          {{ errorCount === 1 ? 'A problem stops it running' : `${errorCount} problems stop it running` }}
        </span>
        <Button label="Cancel" severity="secondary" text @click="requestClose" />
        <Button label="Save" severity="primary" :disabled="!hasChanges" @click="save" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
/**
 * The workspace's experiment protocol, to write or edit. Everything is a draft until Save, which writes it as the
 * archive's obs_data.json; a close with unsaved changes asks first.
 */
import { computed, ref, watch } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

import ProtocolEditor from './simulation/ProtocolEditor.vue'
import { readObsDataParts } from '../services/protocol/obsDataDocument'
import { validateProtocolInfo } from '../services/protocol/protocolValidation'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useLibraryStore } from '../stores/libraryStore'
import { useProtocolStore } from '../stores/protocolStore'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  nodes: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])
const { confirm } = useConfirmDialog()
const libraryStore = useLibraryStore()
const protocolStore = useProtocolStore()

// The obs_data document being edited, or null while the workspace has none.
const draft = ref(null)
const initialSignature = ref('null')
const hasChanges = computed(() => JSON.stringify(draft.value) !== initialSignature.value)
// The drafts before and after the one shown, for undo and redo.
const past = ref([])
const future = ref([])
const errorCount = computed(() => {
  const protocolInfo = draft.value ? readObsDataParts(draft.value).protocolInfo : null
  return protocolInfo ? validateProtocolInfo(protocolInfo).errors.length : 0
})

/**
 * Takes an edit of the draft, keeping the one before to undo to.
 *
 * @param {Object} next
 */
function changeDraft(next) {
  past.value = [...past.value.slice(-99), draft.value]
  future.value = []
  draft.value = next
}

/** Goes back to the draft before the last edit. */
function undo() {
  if (!past.value.length) return
  future.value = [draft.value, ...future.value]
  draft.value = past.value.at(-1)
  past.value = past.value.slice(0, -1)
}

/** Goes forward to the draft an undo left. */
function redo() {
  if (!future.value.length) return
  past.value = [...past.value, draft.value]
  draft.value = future.value[0]
  future.value = future.value.slice(1)
}

/**
 * Undoes and redoes from the keyboard, leaving a text field its own undo.
 *
 * @param {KeyboardEvent} event
 */
function onKeydown(event) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
  if (event.target.closest?.('input, textarea')) return
  event.preventDefault()
  if (event.shiftKey) redo()
  else undo()
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) return
    const document = protocolStore.source?.document
    draft.value = document == null ? null : JSON.parse(JSON.stringify(document))
    initialSignature.value = JSON.stringify(draft.value)
    past.value = []
    future.value = []
  }
)

/** Saves the protocol and closes. */
function save() {
  protocolStore.saveDocument(draft.value)
  initialSignature.value = JSON.stringify(draft.value)
  emit('update:modelValue', false)
}

/** Closes, asking first when there are unsaved changes. */
async function requestClose() {
  if (hasChanges.value) {
    const shouldDiscard = await confirm({
      header: 'Discard unsaved changes?',
      message: 'You have unsaved changes to the protocol. Close without saving?',
      severity: 'warning',
      acceptLabel: 'Discard',
      rejectLabel: 'Keep Editing',
    })
    if (!shouldDiscard) return
  }
  emit('update:modelValue', false)
}
</script>

<style scoped>
.dialog-footer {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
}

.footer-spacer {
  flex: 1;
}

.footer-problems {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--p-red-500);
  font-size: 0.8125rem;
}
</style>
