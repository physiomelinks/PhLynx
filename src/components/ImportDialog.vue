<template>
  <Dialog
    :visible="modelValue"
    :header="config.title || 'Import File'"
    :style="{ width: '500px' }"
    modal
    :dismissableMask="!isBusy"
    :closable="!isBusy"
    :draggable="false"
    @update:visible="
      (visible) => {
        if (!visible) closeDialog()
      }
    "
  >
    <div
      class="dialog-content"
      :class="{ 'is-drag-active': isDraggingOverForm }"
      @dragenter.prevent="handleFormDragEnter"
      @dragover.prevent
      @dragleave.prevent="handleFormDragLeave"
      @drop.prevent="handleFormDrop"
    >
      <form class="import-form" :class="{ 'is-loading-content': isBusy }">
        <div class="form-header" v-if="requiredFieldsCount > 0">
          <span class="required-asterisk">*</span> Indicates required field
        </div>

        <TransitionGroup name="field-pop" tag="div" class="fields-list">
        <div v-for="field in displayFields" :key="field.key" class="field-container">
          <div class="form-item" :class="{ 'is-info': field.limit }">
            <label class="field-label">
              <span>{{ field.label }}</span>
              <span v-if="field?.required ?? true" class="required-asterisk">*</span>
            </label>

            <div class="upload-row">
              <div
                class="file-input-box"
                :class="{ 'is-valid': isFieldReady(field.key) }"
                @dragenter.prevent="handleFieldDragEnter(field.key)"
                @dragover.prevent
                @dragleave.prevent="handleFieldDragLeave(field.key)"
                @drop.stop.prevent="(event) => handleFieldDrop(event, field)"
              >
                <div class="file-names-area" @click.stop>
                  <span
                    v-if="!formState[field.key]?.files || formState[field.key]?.files.size === 0"
                    class="empty-text"
                  >
                    No file(s) selected
                  </span>
                  <template v-else>
                    <TransitionGroup name="tag-pop" tag="span" class="tags-row">
                    <Tag
                      v-for="[filename, fileData] in [...formState[field.key].files].slice(
                        0,
                        isFieldExpanded(field.key) ? formState[field.key].files.size : MAX_VISIBLE_TAGS
                      )"
                      :key="filename"
                      :severity="fileData.isValid ? 'success' : 'warn'"
                      class="file-tag"
                    >
                      <span class="tag-content">
                        <i v-if="fileData.isValid" class="pi pi-check tag-icon" />
                        <i v-else class="pi pi-exclamation-triangle tag-icon" />
                        <span>{{ filename }}</span>
                        <i
                          class="pi pi-times tag-remove-icon"
                          role="button"
                          tabindex="0"
                          :aria-label="`Remove ${filename}`"
                          @click.stop="removeFile(field.key, filename)"
                          @keydown.enter.stop="removeFile(field.key, filename)"
                        />
                      </span>
                    </Tag>
                    </TransitionGroup>

                    <Button
                      v-if="formState[field.key].files.size > MAX_VISIBLE_TAGS"
                      class="overflow-tag"
                      text
                      size="small"
                      severity="secondary"
                      @click.stop="toggleExpandedField(field.key)"
                    >
                      {{
                        isFieldExpanded(field.key)
                          ? 'Show less'
                          : `+${formState[field.key].files.size - MAX_VISIBLE_TAGS} more`
                      }}
                    </Button>
                  </template>
                </div>

                <div class="upload-trigger">
                  <input
                    :ref="(el) => setFileInputRef(el, field.key)"
                    type="file"
                    :multiple="!(field?.limit === 1)"
                    :accept="field.accept"
                    class="hidden-file-input"
                    @change="(event) => handleFileChange(event, field)"
                  />
                  <Button
                    :severity="isFieldReady(field.key) ? 'success' : 'primary'"
                    outlined
                    class="browse-button"
                    @click="triggerFileInput(field.key)"
                  >
                    <i class="pi" :class="isFieldReady(field.key) ? 'pi-check' : 'pi-upload'" />
                    Select
                  </Button>
                </div>
              </div>
            </div>

            <div v-if="field.limit" class="field-hint">
              <i class="pi pi-info-circle" />
              Up to {{ field.limit }} file{{ field.limit === 1 ? '' : 's' }} allowed
            </div>
          </div>
        </div>

        <div v-if="isInstanceArrayImport && !importReadiness?.resourcesAreLoaded" class="folder-import-row">
          <div class="folder-import-info">
            <i class="pi pi-folder" />
            <span v-if="folderStatus === 'connected'">
              Auto-loading from <strong>{{ folderName }}</strong>
            </span>
            <span v-else-if="folderStatus === 'needs-permission'"> Folder access needs to be re-confirmed. </span>
            <span v-else-if="supportsFolderAccess">
              Connect a folder to auto-load required files, or drag & drop / select several files at once below.
            </span>
            <span v-else> Drag & drop a folder or file(s) and we'll sort them automatically. </span>
          </div>
          <div class="folder-import-actions">
            <Button
              v-if="supportsFolderAccess && folderStatus === 'disconnected'"
              label="Connect Folder"
              size="small"
              text
              icon="pi pi-folder-open"
              @click="handleConnectFolder"
            />
            <Button
              v-if="folderStatus === 'needs-permission'"
              label="Reconnect"
              size="small"
              text
              severity="warn"
              icon="pi pi-refresh"
              @click="handleReconnectFolder"
            />
            <Button
              v-if="folderStatus === 'connected'"
              label="Disconnect"
              size="small"
              text
              severity="secondary"
              icon="pi pi-times"
              @click="handleForgetFolder"
            />
            <ProgressSpinner v-if="isScanningFolder" style="width: 18px; height: 18px" strokeWidth="6" />
          </div>
        </div>
        </TransitionGroup>

        <div v-if="importReadiness && formState[IMPORT_KEYS.INSTANCE_ARRAY]?.readiness" class="validation-status">
          <Message v-if="importReadiness.resourcesAreLoaded" severity="success" :closable="false">
            <div class="message-title">All Required Resources Available</div>
            <div class="message-content">All necessary components and configurations are available.</div>
          </Message>

          <Message v-else severity="warn" :closable="false">
            <div class="message-title">Additional Files Required</div>
            <div class="message-content">
              <div>Please provide the following files to complete the import:</div>
              <ul class="missing-resources">
                <li v-if="importReadiness.missingResources?.math.size > 0" class="config-note">
                  <strong>CellML Component File</strong>
                  <div class="component-type-list">
                    Required components: {{ [...importReadiness.missingResources.math].join(', ') }}
                  </div>
                </li>
                <li v-if="importReadiness.missingResources?.modules.size > 0" class="config-note">
                  <strong>Module Configurations</strong> for module_types:module_subtypes:
                  {{ [...importReadiness.missingResources.modules].join(',') }} and possibly CellML components.
                </li>
              </ul>
              <div v-if="importReadiness.missingResources?.modules.size > 0" class="config-note">
                <strong>NOTE:</strong> CellML Component File(s) may be required after providing the configurations.
              </div>
            </div>
          </Message>
        </div>
      </form>

      <Transition name="overlay-fade">
        <div v-if="isBusy" class="loading-overlay">
          <ProgressSpinner />
          <span class="loading-text">{{ loadingText }}</span>
        </div>
      </Transition>

      <Transition name="overlay-fade">
        <div v-if="isDraggingOverForm" class="drop-overlay">
          <i class="pi pi-cloud-upload drop-overlay-icon" />
          <span>Drop a folder or file(s)</span>
        </div>
      </Transition>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" severity="secondary" text :disabled="isBusy" @click="closeDialog" />
        <Button
          label="Import"
          severity="primary"
          :disabled="!isFormValid || isBusy || !importReadiness?.resourcesAreLoaded"
          :loading="isLoading"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch, toRaw } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Tag from 'primevue/tag'

import { useLibraryStore } from '../stores/libraryStore'
import { useGtm } from '../composables/useGtm'
import { useFolderImport } from '../composables/useFolderImport'
import { useFileDrop } from '../composables/useFileDrop'
import { notify } from '../utils/notify'
import { IMPORT_KEYS, MAX_VISIBLE_TAGS } from '../utils/constants'
import { createDynamicFields, checkResourcesAreLoaded, getImportConfig } from '../utils/import'
import {
  buildBatchSummary,
  escapeHtml,
  parseForRole,
  planBatchEntries,
  providesMissingModule,
  requiredCellMLFilenames,
} from '../utils/importBatch'
import { normaliseConfig, parseMathRef } from '../utils/config'

const props = defineProps({
  modelValue: Boolean,
  config: {
    type: Object,
    required: true,
    default: () => ({ title: '', fields: [] }),
  },
})

const emit = defineEmits(['update:modelValue', 'confirm'])
const { trackEvent } = useGtm()
const libraryStore = useLibraryStore()

// --- State Management ---
const formState = reactive({})
const fileInputRefs = ref({})
const dynamicFields = ref([])
const importReadiness = ref(null)
const isLoading = ref(false)
const loadingText = ref('Loading...')
const expandedFields = ref(new Set())
const stagedFiles = ref({
  mathFiles: [], // { filename: string, payload: object }
  configFiles: [], // { filename: string, payload: object }
})

// Counts batches in flight so the dialog stays locked until every queued batch has finished.
const pendingBatchCount = ref(0)
const isProcessing = computed(() => pendingBatchCount.value > 0)
const isBusy = computed(() => isLoading.value || isProcessing.value)
let lastSummary = null
// Bumped on every form reset, so slow background work can tell the form it read has gone.
let formGeneration = 0

// --- Folder-based auto-import ---
const {
  supportsFolderAccess,
  folderStatus, // 'disconnected' | 'connected' | 'needs-permission'
  folderName,
  restoreFolder,
  pickFolder,
  reconnectFolder,
  forgetFolder,
  scanFolder,
} = useFolderImport()

let importQueue = Promise.resolve()
function withImportLock(taskFn) {
  const run = importQueue.then(taskFn, taskFn)
  importQueue = run.catch(() => {})
  return run
}

/**
 * Runs a task with the dialog locked and the loading overlay showing `text`.
 * @param {string} text - Overlay message.
 * @param {Function} taskFn - Async task to run.
 */
async function withBusy(text, taskFn) {
  pendingBatchCount.value += 1
  loadingText.value = text
  try {
    return await taskFn()
  } finally {
    pendingBatchCount.value -= 1
  }
}

const isScanningFolder = ref(false)
const foldersAttemptedFilenames = ref(new Set())
let isAutoFillQueued = false

// --- Drag-and-drop ---
const { filesFromDataTransfer } = useFileDrop()
const isDraggingOverForm = ref(false)
let formDragCounter = 0
const fieldsDraggedOver = ref(new Set())
const fieldDragCounters = new Map() // fieldKey -> counter

function handleFormDragEnter() {
  if (isBusy.value) return
  formDragCounter += 1
  isDraggingOverForm.value = true
}

function handleFormDragLeave() {
  if (isBusy.value) return
  formDragCounter = Math.max(0, formDragCounter - 1)
  if (formDragCounter === 0) {
    isDraggingOverForm.value = false
  }
}

function handleFieldDragEnter(fieldKey) {
  if (isBusy.value) return
  const count = (fieldDragCounters.get(fieldKey) || 0) + 1
  fieldDragCounters.set(fieldKey, count)
  fieldsDraggedOver.value.add(fieldKey)
}

function handleFieldDragLeave(fieldKey) {
  if (isBusy.value) return
  const count = Math.max(0, (fieldDragCounters.get(fieldKey) || 0) - 1)
  fieldDragCounters.set(fieldKey, count)
  if (count === 0) {
    fieldsDraggedOver.value.delete(fieldKey)
  }
}

function resetAllDragState() {
  formDragCounter = 0
  isDraggingOverForm.value = false
  fieldDragCounters.clear()
  fieldsDraggedOver.value = new Set()
}

const blockOutsideDrop = (e) => {
  if (!e.target.closest?.('.dialog-content')) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'none'
  }
}

onMounted(() => {
  restoreFolder()
})

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('dragend', resetAllDragState)
      window.addEventListener('dragover', blockOutsideDrop)
      window.addEventListener('drop', blockOutsideDrop)
    } else {
      window.removeEventListener('dragend', resetAllDragState)
      window.removeEventListener('dragover', blockOutsideDrop)
      window.removeEventListener('drop', blockOutsideDrop)
    }
  },
  { immediate: true }
)

const isInstanceArrayImport = computed(() =>
  (props.config.fields || []).some((f) => f.key === IMPORT_KEYS.INSTANCE_ARRAY)
)

async function handleConnectFolder() {
  try {
    await pickFolder()
  } catch (error) {
    notify.error({ title: 'Folder Access Failed', message: error.message || 'Could not access the folder.' })
  }
}

async function handleReconnectFolder() {
  const granted = await reconnectFolder()
  if (!granted) {
    notify.warning({ title: 'Folder Access', message: 'Permission was not granted for the remembered folder.' })
  }
}

async function handleForgetFolder() {
  await forgetFolder()
  foldersAttemptedFilenames.value = new Set()
}

function setFileInputRef(el, fieldKey) {
  if (el) {
    fileInputRefs.value[fieldKey] = el
  }
}

function triggerFileInput(fieldKey) {
  fileInputRefs.value[fieldKey]?.click()
}

function toggleExpandedField(fieldKey) {
  if (expandedFields.value.has(fieldKey)) {
    expandedFields.value.delete(fieldKey)
  } else {
    expandedFields.value.add(fieldKey)
  }
}

function isFieldExpanded(fieldKey) {
  return expandedFields.value.has(fieldKey)
}

const removeFile = (fieldKey, filename) => {
  if (isBusy.value) return
  const fieldState = formState[fieldKey]
  if (fieldState && fieldState.files.has(filename)) {
    fieldState.files.delete(filename)
    // A removed file must not come straight back from the connected folder.
    foldersAttemptedFilenames.value.add(filename)

    stagedFiles.value.mathFiles = stagedFiles.value.mathFiles.filter((f) => f.filename !== filename)
    stagedFiles.value.configFiles = stagedFiles.value.configFiles.filter((f) => f.filename !== filename)

    const instanceArrayPayload = getInstanceArrayPayload()
    if (instanceArrayPayload) {
      const resourcesLoadStatus = checkReadiness(instanceArrayPayload)
      updateDynamicFields(resourcesLoadStatus)
    } else if (fieldKey === IMPORT_KEYS.INSTANCE_ARRAY) {
      resetForm()
    }
  }
}

function deepToRaw(value) {
  const raw = toRaw(value)
  if (raw instanceof Map) {
    return new Map([...raw].map(([k, v]) => [deepToRaw(k), deepToRaw(v)]))
  }
  if (raw instanceof Set) {
    return new Set([...raw].map(deepToRaw))
  }
  if (Array.isArray(raw)) {
    return raw.map(deepToRaw)
  }
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, deepToRaw(v)]))
  }
  return raw
}

const detachReactivity = (obj) => {
  return deepToRaw(obj)
}

function initFormFromConfig(fields = []) {
  fields.forEach((field) => {
    if (!formState[field.key]) {
      formState[field.key] = createEmptyFieldState()
    }
  })
}

const unstageFiles = () => {
  stagedFiles.value = {
    mathFiles: [],
    configFiles: [],
  }
}

const resetForm = (keepInstanceArray = false) => {
  resetFormState(keepInstanceArray)
  unstageFiles()

  Object.entries(fileInputRefs.value).forEach(([, input]) => {
    if (input) input.value = ''
  })
  expandedFields.value = new Set()
  if (!keepInstanceArray) {
    foldersAttemptedFilenames.value = new Set()
  }
}

watch(
  () => props.config?.fields,
  (fields) => {
    resetFormState()
    initFormFromConfig(fields)
  },
  { immediate: true }
)

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      resetFormState()
      initFormFromConfig(props.config?.fields)
      unstageFiles()
      foldersAttemptedFilenames.value = new Set()
    }
  }
)

const displayFields = computed(() => {
  const baseFields = props.config.fields || []
  return [...baseFields, ...dynamicFields.value]
})

const requiredFieldsCount = computed(() => {
  return displayFields.value.filter((field) => field.required !== false).length
})

function syncDynamicFields(completionStatus) {
  try {
    const newFields = completionStatus.resourcesAreLoaded ? [] : createDynamicFields(completionStatus)
    const neededKeys = new Set(newFields.map((f) => f.key))
    dynamicFields.value = dynamicFields.value.filter(
      (f) => neededKeys.has(f.key) || formState[f.key]?.files.size > 0
    )
    const existingKeys = new Set(dynamicFields.value.map((f) => f.key))

    for (const newField of newFields) {
      if (!existingKeys.has(newField.key)) {
        dynamicFields.value.push(newField)
        if (!formState[newField.key]) {
          formState[newField.key] = createEmptyFieldState()
        }
      }
    }
  } catch (error) {
    console.error('Failed to create dynamic fields:', error)
  }
}

function createEmptyFieldState() {
  return {
    files: new Map(),
    readiness: null,
    warnings: [],
  }
}

function resetFormState(keepInstanceArray = false) {
  formGeneration += 1
  dynamicFields.value = []
  Object.keys(formState).forEach((key) => {
    if (!(keepInstanceArray && key === IMPORT_KEYS.INSTANCE_ARRAY)) {
      formState[key] = createEmptyFieldState()
    }
  })
  importReadiness.value = null
}

const getInstanceArrayPayload = () => {
  const instanceFiles = formState[IMPORT_KEYS.INSTANCE_ARRAY]?.files
  if (!instanceFiles || instanceFiles.size === 0) return null
  for (const fileData of instanceFiles.values()) {
    if (fileData.payload) return fileData.payload
  }
  return null
}

const createTemporaryStore = () => {
  const availableModules = detachReactivity(libraryStore.availableModules)
  const availableMath = detachReactivity(libraryStore.availableMath)
  const availableCollections = detachReactivity(libraryStore.availableCollections)

  for (const { payload: configs } of stagedFiles.value.configFiles) {
    configs.forEach((config) => {
      const module = normaliseConfig(config)
      if (!availableMath.has(module.mathRef)) {
        module.isStub = true
      }
      if (!availableModules.has(module.moduleRef)) {
        availableModules.set(module.moduleRef, module)
        if (!availableCollections.has(module.mathRef)) {
          availableCollections.set(module.mathRef, new Set())
        }
        availableCollections.get(module.mathRef).add(module.moduleRef)
      }
    })
  }

  for (const { filename, payload } of stagedFiles.value.mathFiles) {
    payload.forEach((component) => {
      const mathRef = `${filename}:${component.name}`
      if (!availableMath.has(mathRef)) {
        availableMath.set(mathRef, component.math)
        availableCollections.get(mathRef)?.forEach((moduleRef) => {
          const moduleToUpdate = availableModules.get(moduleRef)
          if (moduleToUpdate && moduleToUpdate.isStub) {
            delete availableModules.get(moduleRef).isStub
          }
        })
      }
    })
  }

  return {
    availableModules,
    availableMath,
    availableCollections,
  }
}

const checkReadiness = (instanceArrayPayload) => {
  if (!instanceArrayPayload) return null

  const temporaryStore = createTemporaryStore()
  const resourcesLoadStatus = checkResourcesAreLoaded(instanceArrayPayload, temporaryStore)

  importReadiness.value = resourcesLoadStatus
  if (formState[IMPORT_KEYS.INSTANCE_ARRAY]) {
    formState[IMPORT_KEYS.INSTANCE_ARRAY].readiness = resourcesLoadStatus
  }

  return resourcesLoadStatus
}

const isFieldReady = (fieldKey) => {
  const fieldState = formState[fieldKey]
  if (!fieldState || fieldState.files.size === 0) return false

  const filesAllValid = Array.from(fieldState.files.values()).every((f) => f?.isValid)
  if (!filesAllValid) return false

  if (fieldKey === IMPORT_KEYS.INSTANCE_ARRAY) {
    return true
  }

  if (fieldKey === IMPORT_KEYS.MODULE_CONFIG) {
    return !(importReadiness.value?.missingResources?.modules.size > 0 ?? true)
  }

  if (fieldKey === IMPORT_KEYS.CELLML_FILE) {
    return !(importReadiness.value?.missingResources?.math.size > 0 ?? true)
  }

  return true
}

const isFormValid = computed(() => {
  if (!displayFields.value || displayFields.value.length === 0) return false

  return displayFields.value.every((field) => {
    if (field.required === false) return true

    const fieldState = formState[field.key]
    if (!fieldState || fieldState.files.size === 0) return false

    return Array.from(fieldState.files.values()).every((file) => file?.isValid)
  })
})

// --- Batch import ---
const PROCESS_UPLOAD_BY_KEY = {
  [IMPORT_KEYS.CELLML_FILE]: 'cellml',
  [IMPORT_KEYS.MODULE_CONFIG]: 'config',
}

const INSTANCE_ARRAY_ROLE_KEYS = [
  IMPORT_KEYS.INSTANCE_ARRAY,
  IMPORT_KEYS.PARAMETER,
  IMPORT_KEYS.MODULE_CONFIG,
  IMPORT_KEYS.CELLML_FILE,
]

const AUTO_FILL_ROLE_KEYS = [IMPORT_KEYS.MODULE_CONFIG, IMPORT_KEYS.CELLML_FILE]

/**
 * Returns the field config used to read files for a role. Configs and CellML get staged into the
 * library on confirm, so they carry `processUpload`.
 * @param {string} key - Import key.
 * @returns {Object|null}
 */
function getRoleField(key) {
  const baseField = getImportConfig(key)?.fields?.[0]
  if (!baseField) return null
  return PROCESS_UPLOAD_BY_KEY[key] && !baseField.processUpload
    ? { ...baseField, processUpload: PROCESS_UPLOAD_BY_KEY[key] }
    : baseField
}

/**
 * Lists the fields a dropped or selected file may belong to, with `preferredKey` tried first.
 * Single-type dialogs only accept their own fields.
 * @param {string} [preferredKey]
 * @returns {Object[]}
 */
function getCandidateFields(preferredKey) {
  const fields = isInstanceArrayImport.value
    ? INSTANCE_ARRAY_ROLE_KEYS.map(getRoleField).filter(Boolean)
    : [...(props.config.fields || [])]
  if (!preferredKey) return fields
  return [...fields.filter((f) => f.key === preferredKey), ...fields.filter((f) => f.key !== preferredKey)]
}

function isFieldVisible(key) {
  return displayFields.value.some((field) => field.key === key)
}

function isFilePresent(filename) {
  return Object.values(formState).some((state) => state.files?.has(filename))
}

/**
 * Adds or replaces a valid file in a field, and shows the field if it is hidden.
 * @param {Object} field - Field config the file was parsed with.
 * @param {string} filename
 * @param {any} payload - Parsed file contents.
 */
function setFieldFile(field, filename, payload) {
  if (!formState[field.key]) {
    formState[field.key] = createEmptyFieldState()
  }
  formState[field.key].files.set(filename, { isValid: true, payload })
  if (!isFieldVisible(field.key)) {
    dynamicFields.value.push(field)
  }
}

/**
 * Lists the CellML file names used by the instance array's modules, counting staged configs.
 * @param {Object[]} instanceArrayPayload - Instance array rows.
 * @returns {Set<string>}
 */
function getReferencedCellMLFilenames(instanceArrayPayload) {
  const { availableModules } = createTemporaryStore()
  const filenames = new Set()
  for (const row of instanceArrayPayload) {
    const mathRef = availableModules.get(`${row.module_type}:${row.module_subtype}`)?.mathRef
    if (mathRef) filenames.add(parseMathRef(mathRef).componentFile)
  }
  return filenames
}

function stageFile(listKey, filename, payload) {
  const others = stagedFiles.value[listKey].filter((f) => f.filename !== filename)
  stagedFiles.value[listKey] = [...others, { filename, payload }]
}

/**
 * Parses each entry without touching dialog state.
 * @param {{ file: File }[]} entries - Planned entries.
 * @param {Object[]} candidates - Candidate field configs.
 * @returns {Promise<{ parsed: Object[], failed: Object[], skipped: Object[] }>}
 */
async function parseEntries(entries, candidates) {
  const parsed = []
  const failed = []
  const skipped = []
  for (const { file } of entries) {
    const result = await parseForRole(file, candidates, { store: libraryStore })
    if (!result.error) {
      parsed.push({ ...result, file })
    } else if (result.unsupported || result.unrecognised) {
      skipped.push({ name: file.name, reason: result.unsupported ? result.error : 'not a recognised import file' })
    } else {
      failed.push({ name: file.name, reason: result.error })
    }
  }
  return { parsed, failed, skipped }
}

/**
 * Writes parsed files into the dialog in one synchronous step, so the UI updates once.
 * @param {Object[]} parsed - Results from `parseEntries`.
 * @param {Object[]} skipped - Receives files that are left out on purpose.
 * @param {Object} [options]
 * @param {boolean} [options.onlyRequiredCellML] - Stage CellML only when readiness says its file is still missing.
 * @returns {{ name: string, key: string }[]} Files that were added.
 */
function commitParsedFiles(parsed, skipped, { onlyRequiredCellML = false } = {}) {
  const placed = []
  const byKey = (key) => parsed.filter((result) => result.key === key)
  const place = (result) => {
    setFieldFile(result.field, result.file.name, result.data)
    placed.push({ name: result.file.name, key: result.key })
  }

  const [instanceArray, ...extraArrays] = byKey(IMPORT_KEYS.INSTANCE_ARRAY)
  for (const extra of extraArrays) {
    skipped.push({ name: extra.file.name, reason: `only one instance array per import (using ${instanceArray.file.name})` })
  }
  if (instanceArray) {
    const existingFiles = formState[IMPORT_KEYS.INSTANCE_ARRAY]?.files
    if (existingFiles?.size > 0 && !existingFiles.has(instanceArray.file.name)) {
      resetForm()
    }
    place(instanceArray)
  }

  byKey(IMPORT_KEYS.PARAMETER).forEach(place)

  for (const result of byKey(IMPORT_KEYS.MODULE_CONFIG)) {
    place(result)
    if (result.field.processUpload === 'config') stageFile('configFiles', result.file.name, result.data)
  }

  const instanceArrayPayload = getInstanceArrayPayload()
  const status = instanceArrayPayload ? checkReadiness(instanceArrayPayload) : null
  // While configs are still missing, the full set of CellML files the instance array uses is unknown.
  const canJudgeCellML = status && (onlyRequiredCellML || !status.missingResources.modules.size)
  let allowedCellMLFiles = null
  if (canJudgeCellML) {
    allowedCellMLFiles = onlyRequiredCellML
      ? requiredCellMLFilenames(status)
      : getReferencedCellMLFilenames(instanceArrayPayload)
  }

  for (const result of byKey(IMPORT_KEYS.CELLML_FILE)) {
    if (result.field.processUpload === 'cellml') {
      if (allowedCellMLFiles && !allowedCellMLFiles.has(result.file.name)) {
        skipped.push({ name: result.file.name, reason: 'not used by any module in the instance array' })
        continue
      }
      stageFile('mathFiles', result.file.name, result.components)
    }
    place(result)
  }

  parsed
    .filter((result) => !INSTANCE_ARRAY_ROLE_KEYS.includes(result.key))
    .forEach(place)

  if (instanceArrayPayload) {
    syncDynamicFields(checkReadiness(instanceArrayPayload))
  } else if (!isInstanceArrayImport.value && placed.length > 0) {
    importReadiness.value = { resourcesAreLoaded: true, errors: [], warnings: [] }
  }

  return placed
}

/**
 * Replaces the previous summary toast with a new one.
 * @param {Object} options - `notify` options.
 */
function showSummary(options) {
  lastSummary?.close()
  lastSummary = notify(options)
}

/**
 * Sorts dropped or selected files into the dialog as one batch and reports the result once.
 * @param {{ file: File, path: string }[]} entries
 * @param {Object} [options]
 * @param {string} [options.preferredKey] - Field the files were dropped on or selected for.
 * @param {boolean} [options.isSelection] - True for files picked with a field's Select button.
 */
function importBatch(entries, options = {}) {
  const text = `Sorting ${entries.length} file${entries.length === 1 ? '' : 's'}…`
  return withBusy(text, () =>
    withImportLock(async () => {
      try {
        await runImportBatch(entries, options)
      } catch (error) {
        console.error('[ImportDialog] Unexpected error while importing files:', error)
        showSummary({
          type: 'error',
          title: 'Import Error',
          message: escapeHtml(`Something went wrong while sorting the files: ${error.message}`),
        })
      }
    })
  )
}

async function runImportBatch(entries, { preferredKey, isSelection = false }) {
  const { ordered, duplicates } = planBatchEntries(entries)
  const { parsed, failed, skipped } = await parseEntries(ordered, getCandidateFields(preferredKey))
  skipped.unshift(...duplicates)

  const placed = commitParsedFiles(parsed, skipped)
  const autoFill = await runAutoFillFromFolder()

  if (failed.length || placed.length === 0) {
    trackEvent('import_action', {
      category: 'Import',
      action: 'import_error',
      label: preferredKey || props.config.fields?.[0]?.key || 'unknown_field',
      file_type: 'various',
    })
  }

  // A single file picked for its own field already shows its result in the form.
  const isQuietSelection =
    isSelection &&
    entries.length === 1 &&
    placed.length === 1 &&
    placed[0].key === preferredKey &&
    !failed.length &&
    !skipped.length &&
    !autoFill?.count &&
    (!isInstanceArrayImport.value ||
      preferredKey === IMPORT_KEYS.INSTANCE_ARRAY ||
      importReadiness.value?.resourcesAreLoaded)
  if (isQuietSelection) {
    lastSummary?.close()
    return
  }

  showSummary(
    buildBatchSummary({
      placed,
      failed,
      skipped,
      isInstanceArrayImport: isInstanceArrayImport.value,
      hasInstanceArray: Boolean(getInstanceArrayPayload()),
      readiness: importReadiness.value,
      autoFill,
    })
  )
}

const handleFileChange = async (event, field) => {
  const selectedFiles = Array.from(event.target.files || [])
  event.target.value = ''
  if (!selectedFiles.length) return

  await importBatch(
    selectedFiles.map((file) => ({ file, path: file.name })),
    { preferredKey: field.key, isSelection: true }
  )
}

function notifyNothingToImport() {
  notify.warning({
    title: 'Nothing to Import',
    message: 'No supported files were found in what you dropped.',
  })
}

/**
 * Reads a drop and imports it as one batch, whichever part of the dialog it landed on.
 * @param {DragEvent} event
 * @param {string} [preferredKey] - Field the drop landed on.
 */
async function handleDrop(event, preferredKey) {
  resetAllDragState()
  if (isBusy.value) return

  // One outer busy scope keeps the overlay up between reading the drop and sorting it.
  await withBusy('Reading dropped files…', async () => {
    const entries = await filesFromDataTransfer(event.dataTransfer)
    if (!entries.length) {
      notifyNothingToImport()
      return
    }
    await importBatch(entries, { preferredKey })
  })
}

function handleFieldDrop(event, field) {
  return handleDrop(event, field.key)
}

function handleFormDrop(event) {
  return handleDrop(event)
}

// --- Folder-based auto-import ---
/**
 * Stages the configs and CellML files that are still missing from the connected folder.
 * Callers must hold the import lock.
 * @returns {Promise<{ count: number, folderName: string }|null>} Null when nothing was attempted.
 */
async function runAutoFillFromFolder() {
  const instanceArrayPayload = getInstanceArrayPayload()
  if (folderStatus.value !== 'connected' || !instanceArrayPayload || importReadiness.value?.resourcesAreLoaded) {
    return null
  }

  const startGeneration = formGeneration
  isScanningFolder.value = true
  try {
    const entries = (await scanFolder()).filter(
      ({ file }) => !foldersAttemptedFilenames.value.has(file.name) && !isFilePresent(file.name)
    )
    const { ordered } = planBatchEntries(entries)
    const { parsed, failed } = await parseEntries(ordered, AUTO_FILL_ROLE_KEYS.map(getRoleField))
    // The form was reset or closed while the folder was being read.
    if (startGeneration !== formGeneration || !getInstanceArrayPayload()) return null

    // Unreadable files are not retried; valid but unneeded ones may be needed by a later config.
    failed.forEach(({ name }) => foldersAttemptedFilenames.value.add(name))

    const status = importReadiness.value
    const needed = parsed.filter(
      (result) => result.key !== IMPORT_KEYS.MODULE_CONFIG || providesMissingModule(result.data, status)
    )
    // Committing nothing would still replace readiness and re-trigger this auto-fill.
    if (needed.length === 0) return { count: 0, folderName: folderName.value }

    const placed = commitParsedFiles(needed, [], { onlyRequiredCellML: true })
    placed.forEach(({ name }) => foldersAttemptedFilenames.value.add(name))
    return { count: placed.length, folderName: folderName.value }
  } catch (error) {
    notify.error({
      title: 'Folder Import',
      message: escapeHtml(error.message || 'Failed to read files from the connected folder.'),
    })
    return null
  } finally {
    isScanningFolder.value = false
  }
}

/** Runs the connected-folder auto-fill on its own and reports anything it added. */
function attemptAutoFillFromFolder() {
  if (isAutoFillQueued) return
  isAutoFillQueued = true
  return withImportLock(async () => {
    isAutoFillQueued = false
    const result = await runAutoFillFromFolder()
    if (!result?.count) return

    const isReady = importReadiness.value?.resourcesAreLoaded
    const files = `${result.count} file${result.count === 1 ? '' : 's'}`
    showSummary({
      type: isReady ? 'success' : 'warning',
      title: 'Folder Import',
      message: isReady
        ? `Loaded ${files} from connected folder "${escapeHtml(result.folderName)}". Ready to import.`
        : `Loaded ${files} from connected folder "${escapeHtml(result.folderName)}". Some required files are still missing.`,
      duration: isReady ? 3000 : 6000,
    })
  })
}

// Batches run the auto-fill themselves; this covers readiness changes from removing files.
watch(importReadiness, (status) => {
  if (!status || status.resourcesAreLoaded || isBusy.value) return
  attemptAutoFillFromFolder()
})

watch(folderStatus, (status) => {
  if (status !== 'connected' || isBusy.value) return
  if (importReadiness.value && !importReadiness.value.resourcesAreLoaded) {
    attemptAutoFillFromFolder()
  }
})

function updateDynamicFields(completionStatus) {
  importReadiness.value = completionStatus
  syncDynamicFields(completionStatus)
}

const commitStagedFiles = () => {
  for (const { filename, payload } of stagedFiles.value.mathFiles) {
    libraryStore.addMathFile(filename, payload)
  }
  for (const { filename, payload } of stagedFiles.value.configFiles) {
    libraryStore.addConfigFile(filename, payload)
  }
}

const handleConfirm = async () => {
  if (isBusy.value) return
  isLoading.value = true
  loadingText.value = 'Importing modules...'
  lastSummary?.close()

  await new Promise((resolve) => setTimeout(resolve, 50))

  commitStagedFiles()

  const importPayload = new Map()
  displayFields.value.forEach((field) => {
    const fieldFiles = toRaw(formState[field.key].files)
    if (fieldFiles.size === 0) return
    importPayload.set(field.key, new Map(fieldFiles))
  })

  trackEvent('import_action', {
    category: 'Import',
    action: 'import_file',
    label: props.config.title || 'Import File',
    file_type: 'various',
  })

  emit('confirm', importPayload, (progressText) => {
    loadingText.value = progressText
  })
}

const closeDialog = () => {
  if (isBusy.value) return
  lastSummary?.close()
  resetForm()
  loadingText.value = 'Loading...'
  emit('update:modelValue', false)
}

defineExpose({
  finishLoading: () => {
    isLoading.value = false
    closeDialog()
  },
})
</script>

<style scoped>
.dialog-content {
  position: relative;
  min-height: 220px;
  overflow: hidden;
  border-radius: 8px;
}

.import-form {
  position: relative;
  z-index: 1;
}

.dialog-content.is-drag-active {
  outline-offset: -4px;
  border-radius: 8px;
}

.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: color-mix(in srgb, var(--p-primary-color) 10%, var(--p-content-background) 90%);
  border-radius: 8px;
  pointer-events: none;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--p-primary-color);
}

.drop-overlay-icon {
  font-size: 2rem;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  background: var(--p-content-background);
  border-radius: 8px;
}

.loading-text {
  color: var(--p-text-color);
  font-size: 0.95rem;
}

.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 0.18s ease;
}

.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}

.fields-list {
  position: relative;
  display: block;
}

.field-pop-enter-active,
.field-pop-leave-active,
.field-pop-move {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.field-pop-enter-from,
.field-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.field-pop-leave-active {
  position: absolute;
  width: 100%;
}

.tags-row {
  display: contents;
}

.tag-pop-enter-active,
.tag-pop-move {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.tag-pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
  position: absolute;
}

.tag-pop-enter-from,
.tag-pop-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

.field-container {
  margin-bottom: 0.75rem;
}

.upload-row {
  width: 100%;
}

.form-item {
  margin-bottom: 1rem;
}

.form-item.is-info {
  margin-bottom: 0.5rem;
}

.field-label {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 600;
  margin-bottom: 0.4rem;
  color: var(--p-text-color);
}

.field-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  margin-top: 0.35rem;
}

.file-input-box {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--p-form-field-border-color, var(--p-content-border-color));
  border-radius: 6px;
  background-color: var(--p-form-field-background, var(--p-content-background));
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.file-input-box:focus-within {
  border-color: var(--p-primary-color);
  box-shadow: inset 0 0 0 1px var(--p-primary-color);
}

.file-input-box.is-valid {
  border-color: var(--p-green-500, #16a34a);
}

.file-input-box.is-valid:focus-within {
  box-shadow: inset 0 0 0 1px var(--p-green-500, rgba(22, 163, 74, 0.25));
}

.file-names-area {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  min-width: 0;
  overflow: hidden;
  cursor: default;
  flex-wrap: wrap;
}

.upload-trigger {
  flex-shrink: 0;
  border-left: 1px solid var(--p-form-field-border-color, var(--p-content-border-color));
  display: flex;
  align-items: center;
}

.hidden-file-input {
  display: none;
}

.browse-button {
  height: 100%;
  border: none;
  border-radius: 0;
  margin: 0;
  padding: 0 14px;
}

.empty-text {
  color: var(--p-text-muted-color);
  font-size: 0.9rem;
  white-space: nowrap;
}

.file-tag {
  flex-shrink: 0;
}

.overflow-tag {
  flex-shrink: 0;
  cursor: pointer;
}

.tag-content {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tag-content span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.tag-icon {
  font-size: 0.9rem;
  flex-shrink: 0;
}

.tag-remove-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
  margin-left: 2px;
  padding: 2px;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s ease, background-color 0.15s ease;
}

.tag-remove-icon:hover,
.tag-remove-icon:focus-visible {
  opacity: 1;
  background-color: rgba(0, 0, 0, 0.1);
  outline: none;
}

.folder-import-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  border: 1px dashed var(--p-content-border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--p-primary-color) 5%, transparent);
}

.folder-import-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
}

.folder-import-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.form-header {
  margin-top: 0.25rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  text-align: right;
}

.required-asterisk {
  color: var(--p-red-500, #dc2626);
}

.validation-status {
  margin-top: 1rem;
}

.validation-status :deep(.p-message) {
  border-radius: 10px;
}

.validation-status :deep(.p-message-warn) {
  background: color-mix(in srgb, var(--p-amber-500, #d97706) 10%, var(--p-content-background, #fff));
  border: 1px solid color-mix(in srgb, var(--p-amber-500, #d97706) 30%, transparent);
}

.validation-status :deep(.p-message-warn .p-message-icon) {
  color: var(--p-amber-600, #b45309);
}

.validation-status :deep(.p-message-success) {
  background: color-mix(in srgb, var(--p-green-500, #22c55e) 10%, var(--p-content-background, #fff));
  border: 1px solid color-mix(in srgb, var(--p-green-500, #22c55e) 30%, transparent);
}

.validation-status :deep(.p-message-success .p-message-icon) {
  color: var(--p-green-600, #16a34a);
}

.validation-status :deep(.p-message-success) .message-title {
  color: var(--p-green-700, #15803d);
}

.validation-status :deep(.p-message-warn) .message-title {
  color: var(--p-amber-700, #92400e);
}

.message-title {
  font-weight: 600;
}

.message-content {
  margin-top: 0.25rem;
  color: var(--p-text-color);
}

.missing-resources {
  margin: 0.5rem 0 0 0;
  padding-left: 1rem;
  color: var(--p-text-color);
}

.missing-resources li {
  margin: 0.25rem 0;
}

.component-type-list {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.config-note {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  color: var(--p-text-muted-color);
}

.config-note strong {
  color: var(--p-amber-700, #92400e);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.is-loading-content {
  opacity: 0.5;
  pointer-events: none;
  filter: grayscale(25%);
  transition: opacity 0.2s ease, filter 0.2s ease;
}
</style>
