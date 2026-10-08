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
      <ProtocolPicker
        v-if="protocolStore.protocols.length"
        :protocols="protocolStore.protocols"
        :active-location="protocolStore.activeProtocol?.location ?? null"
        :check-name="protocolStore.checkProtocolName"
        :name-protocol="protocolStore.nameProtocol"
        @choose="choose"
        @create="create"
        @duplicate="duplicate"
        @rename="rename"
        @remove="remove"
      />
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
 * The workspace's experiment protocols, to write or edit. The one chosen at the top is the active one, which play
 * runs. Its edits are a draft until Save, which writes it as its obs_data.json; leaving it for another protocol, or
 * closing, with unsaved changes asks first. Adding, copying, renaming and deleting protocols take effect at once.
 */
import { computed, ref, watch } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

import ProtocolEditor from './simulation/ProtocolEditor.vue'
import ProtocolPicker from './simulation/ProtocolPicker.vue'
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

/** Starts the draft afresh from the active protocol's file, or none. */
function loadDraft() {
  const document = protocolStore.source?.document
  draft.value = document == null ? null : JSON.parse(JSON.stringify(document))
  initialSignature.value = JSON.stringify(draft.value)
  past.value = []
  future.value = []
}

watch(
  () => props.modelValue,
  (isOpen) => isOpen && loadDraft()
)

/**
 * Asks before unsaved changes are lost, unless there are none.
 *
 * @param {string} message
 * @returns {Promise<boolean>} Whether to go on.
 */
async function confirmDiscard(message) {
  if (!hasChanges.value) return true
  return confirm({
    header: 'Discard unsaved changes?',
    message,
    severity: 'warning',
    acceptLabel: 'Discard',
    rejectLabel: 'Keep Editing',
  })
}

/**
 * Makes another protocol the active one, to edit and run.
 *
 * @param {string} location
 */
async function choose(location) {
  if (!(await confirmDiscard('You have unsaved changes to this protocol. Switch without saving?'))) return
  protocolStore.chooseProtocol(location)
  loadDraft()
}

/**
 * Adds an empty protocol and edits it.
 *
 * @param {string} name
 */
async function create(name) {
  if (!(await confirmDiscard('You have unsaved changes to this protocol. Make a new one without saving?'))) return
  protocolStore.createProtocol(name)
  loadDraft()
}

/**
 * Copies the active protocol, as saved, and edits the copy.
 *
 * @param {string} name
 */
async function duplicate(name) {
  if (!(await confirmDiscard('The copy is of the protocol as saved. Discard your unsaved changes and copy it?'))) return
  protocolStore.duplicateProtocol(protocolStore.activeProtocol.location, name)
  loadDraft()
}

/**
 * Renames the active protocol, keeping the draft.
 *
 * @param {string} name
 */
function rename(name) {
  protocolStore.renameProtocol(protocolStore.activeProtocol.location, name)
}

/** Deletes the active protocol, once asked, and edits the next. */
async function remove() {
  const { location, name } = protocolStore.activeProtocol
  const shouldDelete = await confirm({
    header: `Delete ${name}?`,
    message: `${name} and its observations will be removed from the workspace.${hasChanges.value ? ' Your unsaved changes go with them.' : ''}`,
    severity: 'warning',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
  })
  if (!shouldDelete) return
  protocolStore.removeProtocol(location)
  loadDraft()
}

/** Saves the protocol and closes. */
function save() {
  protocolStore.saveDocument(draft.value)
  initialSignature.value = JSON.stringify(draft.value)
  emit('update:modelValue', false)
}

/** Closes, asking first when there are unsaved changes. */
async function requestClose() {
  if (!(await confirmDiscard('You have unsaved changes to the protocol. Close without saving?'))) return
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
