<template>
  <Dialog
    :visible="modelValue"
    header="Edit obs_data"
    modal
    :draggable="false"
    :dismissableMask="true"
    :style="{ width: '960px', maxHeight: '90vh' }"
    :appendTo="'body'"
    @update:visible="(visible) => !visible && requestClose()"
  >
    <div @keydown="onKeydown">
      <ObsDataEditor
        :document="draft"
        :variables="variables"
        preset="phlynx"
        :get-value="findValue"
        :confirm="confirm"
        :palette="SERIES_COLOURS.light"
        :warn="findIgnoredSettings"
        :dt="simulationSettingsStore.simulationSettings.pointInterval"
        :show-data-items="settings.showDataItems"
        @update:document="changeDraft"
      />
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button icon="pi pi-undo" text rounded severity="secondary" :disabled="!past.length" aria-label="Undo" v-tooltip.top="'Undo (⌘Z)'" @click="undo" />
        <Button icon="pi pi-refresh" text rounded severity="secondary" :disabled="!future.length" aria-label="Redo" v-tooltip.top="'Redo (⇧⌘Z)'" @click="redo" />
        <span class="footer-count">{{ dataItemCount }} data item(s)</span>
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
 * The workspace's obs_data, to write or edit as CUFLynx's "Edit obs_data" does: its protocol_info, prediction_items and
 * prediction_plots, and its data_items listed read-only. Everything is a draft until Save, which writes it as the
 * archive's obs_data.json; a close with unsaved changes asks first.
 */
import { computed, ref, watch } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { isRowDataItem, listDataItems, readObsDataParts, validateProtocolInfo } from '@physiomelinks/protocol-kit'
import { ObsDataEditor } from '@physiomelinks/protocol-kit/editor'

import { useAppSettings } from '../composables/useAppSettings'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { SERIES_COLOURS } from '../services/simulation/seriesSlots'
import { buildVariableIndex } from '../services/simulation/variableIndex'
import { useLibraryStore } from '../stores/libraryStore'
import { findIgnoredSettings, useProtocolStore } from '../stores/protocolStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  nodes: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])
const { confirm } = useConfirmDialog()
// Data items are listed, not edited: their calibration fields belong to CUFLynx, and the user can hide them.
const { settings } = useAppSettings()
const libraryStore = useLibraryStore()
const protocolStore = useProtocolStore()
// Its point interval is the dt a run records at, which a prediction item's range must take a sample of.
const simulationSettingsStore = useSimulationSettingsStore()

// The model's variables as the editor lists them, each under the name a protocol gives it. The label is that name too,
// so the picker shows and searches what it always has.
const variableIndex = computed(() => buildVariableIndex(props.nodes))
const variables = computed(() =>
  variableIndex.value.map((entry) => ({ name: entry.path, label: entry.path, unit: entry.units, kind: entry.kind, value: findRow(entry)?.value }))
)

// The obs_data document being edited, or null while the workspace has none.
const draft = ref(null)
const initialSignature = ref('null')
const hasChanges = computed(() => JSON.stringify(draft.value) !== initialSignature.value)
// The drafts before and after the one shown, for undo and redo.
const past = ref([])
const future = ref([])
// The data items listed as rows, as CUFLynx counts them; the kit notes those kept as they are.
const dataItemCount = computed(() => (draft.value ? listDataItems(draft.value).filter((row) => isRowDataItem(row)).length : 0))
const errorCount = computed(() => {
  const protocolInfo = draft.value ? readObsDataParts(draft.value).protocolInfo : null
  return protocolInfo ? validateProtocolInfo(protocolInfo).errors.length : 0
})

/**
 * Finds the node's row an index entry stands for.
 *
 * @param {Object} entry - Of buildVariableIndex.
 * @returns {Object|undefined}
 */
function findRow(entry) {
  return props.nodes.find((node) => node.id === entry.nodeId)?.data?.variables?.find((row) => row.name === entry.rowName)
}

/**
 * Reads a variable's value in the model: a global constant's from the library, as a node's own copy may be out of date.
 *
 * @param {string} name - `instance/variable`, as the editor names it.
 * @returns {*}
 */
function findValue(name) {
  const entry = variableIndex.value.find((candidate) => candidate.path === name)
  const row = entry && findRow(entry)
  return row?.type === 'global_constant' ? libraryStore.getGlobalConstant(row.name)?.value : row?.value
}

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

/** Saves the obs_data and closes. */
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
      message: 'You have unsaved changes to the obs_data. Close without saving?',
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

.footer-count {
  color: var(--p-text-muted-color);
  font-size: 0.8125rem;
}

.footer-problems {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--p-red-500);
  font-size: 0.8125rem;
}
</style>
