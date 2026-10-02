<template>
  <Dialog
    :visible="modelValue"
    modal
    :dismissableMask="!loading"
    :draggable="false"
    :style="{ width: '95vw', maxWidth: '1680px', height: '90vh', maxHeight: '960px' }"
    class="module-editor-dialog"
    @update:visible="onDialogVisibleChange"
  >
    <template #header>
      <div class="custom-dialog-header">
        <span class="header-prefix">Editing: </span>
        <div class="header-input-wrapper">
          <InputText
            v-model="editableName"
            placeholder="Enter instance name..."
            size="small"
            class="header-input"
            :class="{ 'header-input--warning': isNameUnsanitary }"
            @blur="sanitiseNameOnBlur(editableName)"
          />
          <Transition name="name-warning-pop">
            <div v-if="isNameUnsanitary" class="name-warning-popover" role="alert">
              <div class="name-warning-arrow"></div>
              <i class="pi pi-exclamation-triangle name-warning-icon"></i>
              <span>Will be renamed to <strong>{{ sanitiseName(editableName) }}</strong></span>
            </div>
          </Transition>
        </div>
        <span class="header-suffix">({{ componentName }} - {{ componentFile }})</span>
      </div>
    </template>

    <div v-if="loading" class="loading-overlay">
      <ProgressSpinner style="width: 44px; height: 44px" strokeWidth="4" />
      <span>Loading instance data...</span>
    </div>

    <div
      v-else
      class="editor-grid"
      ref="editorGridRef"
      :class="{ 'is-dragging': dragging, 'is-suppressed': isScreenTooSmall }"
      :inert="isScreenTooSmall"
    >
      <!-- LEFT COLUMN: CellML Text Editor -->
      <div class="pane left-pane" :style="leftPaneStyle" :class="{ 'left-pane--collapsed': rightCollapsed }">
        <div class="editor-wrapper">
          <CellMLTextEditor
            ref="cellmlEditorRef"
            :key="mathRef"
            :model-value="currentModel"
            @update:code="handleCodeUpdate"
            @ready="handleEditorReady"
            @save="handleSave"
            @undo="handleEditorUndo"
            @redo="handleEditorRedo"
          />
        </div>
      </div>

      <!-- RESIZE HANDLE (also carries the collapse/expand control) -->
      <div
        class="resizer"
        :class="{ 'resizer--collapsed': rightCollapsed }"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize editor and parameter panels"
        tabindex="0"
        @pointerdown="startResize"
        @dblclick="resetSplit"
        @keydown.left.prevent="nudgeSplit(-2)"
        @keydown.right.prevent="nudgeSplit(2)"
      >
        <div class="resizer-grip"></div>
        <button
          type="button"
          class="resizer-toggle"
          :title="rightCollapsed ? 'Expand parameter/port panel' : 'Collapse parameter/port panel'"
          :aria-label="rightCollapsed ? 'Expand panel' : 'Collapse panel'"
          @pointerdown.stop
          @click.stop="toggleRightPanel"
        >
          <i :class="rightCollapsed ? 'pi pi-angle-left' : 'pi pi-angle-right'"></i>
        </button>
      </div>

      <!-- RIGHT COLUMN: Parameter & Port Tabs -->
      <div class="pane right-pane" :class="{ 'right-pane--collapsed': rightCollapsed }">
        <!-- Collapsed rail: just a slim strip with a vertical label, click to expand -->
        <button
          v-if="rightCollapsed"
          type="button"
          class="collapsed-rail"
          @click="toggleRightPanel"
        >
          <span class="collapsed-rail-label">
            {{ activeTab === 'parameters' ? `Parameters (${parameterRows.length})` : `Ports (${editablePorts.length})` }}
          </span>
        </button>

        <Tabs v-else v-model:value="activeTab" class="right-pane-tabs">
          <TabList>
            <Tab value="parameters">
              <i class="pi pi-sliders-h tab-icon"></i>
              Parameters ({{ parameterRows.length }})
            </Tab>
            <Tab value="ports">
              <i class="pi pi-pencil tab-icon"></i>
              Ports ({{ editablePorts.length }})
            </Tab>
          </TabList>

          <TabPanels class="tab-panels-container">
            <!-- TAB 1: PARAMETER EDITOR -->
            <TabPanel value="parameters" class="tab-panel-flex">
              <div class="parameters-tab-body">
                <div class="toolbar-container">
                  <div class="search-group">
                    <div class="search-input-wrapper flex-1">
                      <IconField class="w-full">
                        <InputIcon class="pi pi-search" />
                        <InputText
                          v-model="searchQuery"
                          class="w-full"
                          size="small"
                          :placeholder="`Search by ${searchColumn}...`"
                        />
                        <InputIcon
                          v-if="searchQuery"
                          class="clear-search-btn pi pi-times-circle"
                          @click="searchQuery = ''"
                        />
                      </IconField>
                    </div>
                    <Select
                      v-model="searchColumn"
                      :options="searchColumnOptions"
                      optionLabel="label"
                      optionValue="value"
                      size="small"
                      class="search-column"
                    />
                  </div>

                  <div class="bulk-controls">
                    <span class="bulk-label">Bulk Type:</span>
                    <Select
                      v-model="bulkTypeValue"
                      size="small"
                      :options="PARAMETER_TYPE_OPTIONS"
                      optionLabel="label"
                      optionValue="value"
                      placeholder="Select type..."
                      class="bulk-select"
                    />
                    <Button
                      size="small"
                      :disabled="selectedRows.length === 0"
                      @click="applyBulkType"
                    >
                      Apply ({{ selectedRows.length }})
                    </Button>
                  </div>
                </div>

                <div class="table-flex-wrapper">
                  <DataTable
                    ref="parametersTable"
                    v-model:selection="selectedRows"
                    :value="filteredParameterRows"
                    dataKey="name"
                    scrollable
                    scrollHeight="flex"
                    tableStyle="min-width: 520px"
                    :sortField="sortField"
                    :sortOrder="sortOrder"
                    class="p-datatable-sm parameters-table"
                    @sort="handleSortChange"
                  >
                    <Column selectionMode="multiple" headerStyle="width: 2.2rem" />
                    <Column field="name" bodyClass="small-text-col" header="Name" sortable style="min-width: 120px" />
                    <Column field="value" header="Value" sortable style="width: 120px">
                      <template #body="slotProps">
                        <InputText
                          v-if="isEditableVariableType(slotProps.data.type)"
                          v-model="slotProps.data.value"
                          size="small"
                          placeholder="Enter value..."
                          class="w-full"
                        />
                        <span v-else class="text-muted">-</span>
                      </template>
                    </Column>
                    <Column field="units" bodyClass="small-text-col" header="Units" sortable style="min-width: 110px" />
                    <Column field="type" header="Type" sortable style="width: 100px">
                      <template #body="slotProps">
                        <Select
                          v-model="slotProps.data.type"
                          :options="PARAMETER_TYPE_OPTIONS"
                          optionLabel="label"
                          optionValue="value"
                          size="small"
                          class="w-full"
                        />
                      </template>
                    </Column>
                  </DataTable>
                </div>
              </div>
            </TabPanel>

            <!-- TAB 2: PORT EDITOR -->
            <TabPanel value="ports" class="tab-panel-flex">
              <div class="ports-tab-body">
                <div class="ports-header">
                  <label class="form-label">Port Definitions</label>
                  <Button icon="pi pi-plus" label="Add Port" severity="success" size="small" rounded outlined @click="addPort" />
                </div>

                <div v-if="editablePorts.length" class="table-flex-wrapper">
                  <DataTable
                    :value="editablePorts"
                    size="small"
                    stripedRows
                    scrollable
                    scrollHeight="flex"
                    tableStyle="min-width: 580px"
                  >
                    <Column header="" style="width: 25px">
                      <template #body="slotProps">
                        <Button
                          icon="pi pi-trash"
                          severity="danger"
                          rounded
                          text
                          size="small"
                          @click="deletePort(editablePorts.indexOf(slotProps.data))"
                        />
                      </template>
                    </Column>
                    <Column header="Type" style="width: 3cap">
                      <template #body="slotProps">
                        <Select
                          v-model="slotProps.data.portType"
                          :options="PORT_TYPE_OPTIONS"
                          optionLabel="label"
                          optionValue="value"
                          size="small"
                          class="w-full"
                        />
                      </template>
                    </Column>

                    <Column header="Label" style="min-width: 140px">
                      <template #body="slotProps">
                        <InputText v-model="slotProps.data.label" placeholder="Enter label" size="small" class="w-full" />
                      </template>
                    </Column>

                    <Column header="Variable(s)" style="min-width: 180px">
                      <template #body="slotProps">
                        <MultiSelect
                          v-model="slotProps.data.variables"
                          :disabled="Array.isArray(slotProps.data.multiportType)"
                          :options="parameterRows"
                          optionLabel="name"
                          optionValue="name"
                          size="small"
                          placeholder="Select variables"
                          class="w-full"
                          :maxSelectedLabels="3"
                        />
                      </template>
                    </Column>

                    <Column header="Multiport" style="min-width: 110px">
                      <template #body="slotProps">
                        <div class="flex flex-col gap-1">
                          <!-- Per-variable (list-form) multi_port: shown, not editable here, so it is kept intact (the port's variables are locked too, as entries pair with them by position). -->
                          <span
                            v-if="Array.isArray(slotProps.data.multiportType)"
                            class="per-variable-multiport"
                            title="Per-variable multiport, one entry per port variable"
                          >{{ formatMultiportType(slotProps.data.multiportType) }}</span>
                          <Select
                            v-else
                            v-model="slotProps.data.multiportType"
                            :options="MULTIPORT_OPTIONS"
                            optionLabel="label"
                            optionValue="value"
                            size="small"
                            placeholder="Select"
                            class="w-full"
                          />
                          <div v-if="slotProps.data.multiportType === 'Multiply'" class="flex items-center gap-1">
                            <span class="multiply-prefix">&times;</span>
                            <InputNumber
                              v-model="slotProps.data.multiplyFactor"
                              :showButtons="false"
                              size="small"
                              placeholder="1"
                              class="w-full"
                            />
                          </div>
                        </div>
                      </template>
                    </Column>
                  </DataTable>
                </div>
                <div v-else class="empty-state">No ports defined for this instance.</div>
              </div>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </div>
    </div>

    <!-- OVERLAY:  -->
    <Transition name="resize-warning">
      <div v-if="isScreenTooSmall" class="resize-warning-overlay">
        <div class="resize-warning-card">
          <div class="resize-warning-icon">
            <i class="pi pi-angle-double-left resize-warning-arrow resize-warning-arrow--left"></i>
            <i class="pi pi-desktop resize-warning-window"></i>
            <i class="pi pi-angle-double-right resize-warning-arrow resize-warning-arrow--right"></i>
          </div>
          <h3 class="resize-warning-title">More room needed</h3>
          <p class="resize-warning-copy">
            Widen your browser window to keep editing — the parameter and port panels
            need a bit more horizontal space to display properly.
          </p>
          <div
            class="resize-warning-meter"
            role="img"
            :aria-label="`Window is ${currentWidth} pixels wide, ${MIN_REQUIRED_WIDTH} needed`"
          >
            <div class="resize-warning-meter-track">
              <div class="resize-warning-meter-fill" :style="{ width: widthProgressPercent + '%' }"></div>
            </div>
            <div class="resize-warning-meter-labels">
              <span>{{ currentWidth }}px</span>
              <span>{{ MIN_REQUIRED_WIDTH }}px needed</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- DIALOG FOOTER -->
    <template #footer>
      <div class="dialog-footer" v-if="!loading && !isScreenTooSmall">
        <div
          v-if="siblingCount > 0"
          class="apply-all-checkbox"
          :title="`Also update ${siblingCount} other node${
            siblingCount !== 1 ? 's' : ''
          } using ${componentName} from ${componentFile}`"
        >
          <Checkbox v-model="applyToAll" binary inputId="applyToAll" />
          <label for="applyToAll">Apply CellML changes to all instances</label>
          <Tag severity="info" :value="String(siblingCount + 1)" />
        </div>

        <div class="footer-buttons">
          <Button label="Cancel" severity="secondary" text @click="handleCancel" />
          <Button label="Save All Changes" severity="primary" @click="handleSave" />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { formatMultiportType } from '../utils/config'
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import InputIcon from 'primevue/inputicon'
import IconField from 'primevue/iconfield'
import ProgressSpinner from 'primevue/progressspinner'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'
import Tag from 'primevue/tag'

import CellMLTextEditor from './CellMLTextEditor.vue'
import { useLibraryStore } from '../stores/libraryStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useGtm } from '../composables/useGtm'
import { useConfirmDialog } from '../composables/useConfirmDialog'

import { PARAMETER_TYPE_OPTIONS, PORT_TYPE_OPTIONS, MULTIPORT_OPTIONS } from '../utils/constants'
import { isEditableVariableType, isEmpty } from '../utils/variables'
import { sanitiseName } from '../utils/nodes'
import { detachReactivity } from '../utils/reactivity'
import { notify } from '../utils/notify'
import { getModelComponentNames, areModelsEquivalent, extractVariablesFromMath } from '../utils/cellml'
import { sanitiseNameOnBlur } from '../utils/misc'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  id: { type: String, required: true },
  initialName: { type: String, default: '' },
  mathRef: { type: String, required: true },
  variables: { type: Array, default: () => [] },
  initialPorts: { type: Array, default: () => [] },
  existingNames: { type: Array, default: () => [] },
  defaultTab: { type: String, default: 'parameters' }, // 'parameters' or 'ports'
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const store = useLibraryStore()
const history = useFlowHistoryStore()

const { trackEvent } = useGtm()
const { nodes } = useVueFlow()
const { confirm } = useConfirmDialog()

const isNameUnsanitary = computed(() => editableName.value !== sanitiseName(editableName.value))

// ── State ────────────────────────────────────────────────────────────────────
const loading = ref(false)
const activeTab = ref('parameters')

// CellML State
const currentModel = ref('')       // parsed XML representation - used for variable extraction, save, etc.
const currentCellmlText = ref('')  // raw CellML source text - what the editor actually displays
const originalModel = ref('')
const applyToAll = ref(false)

// Parameter State
const parameterRows = ref([])
const selectedRows = ref([])
const searchQuery = ref('')
const searchColumn = ref('name')
const searchColumnOptions = [
  { label: 'Name', value: 'name' },
  { label: 'Units', value: 'units' },
  { label: 'Type', value: 'type' },
]
const bulkTypeValue = ref('')
const sortField = ref('name')
const sortOrder = ref(1)

// Port & Instance State
const editableName = ref('')
const editablePorts = ref([])

// Ref to the CellML editor, used to imperatively replay text during undo/redo
const cellmlEditorRef = ref(null)

// ── Split / Collapse State ──────────────────────────────────────────────────
const SPLIT_STORAGE_KEY = 'instanceEditorDialog.leftPanePercent'
const DEFAULT_LEFT_PERCENT = 55
const MIN_LEFT_PERCENT = 32
const MAX_LEFT_PERCENT = 60
const MIN_REQUIRED_WIDTH = 1000;

function loadStoredSplit() {
  try {
    const stored = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY))
    if (Number.isFinite(stored) && stored >= MIN_LEFT_PERCENT && stored <= MAX_LEFT_PERCENT) {
      return stored
    }
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) - fall back to default
  }
  return DEFAULT_LEFT_PERCENT
}

const editorGridRef = ref(null)
const leftPercent = ref(loadStoredSplit())
const rightCollapsed = ref(false)
const dragging = ref(false)

const leftPaneStyle = computed(() => {
  if (rightCollapsed.value) return { flex: '1 1 auto' }
  return { flex: `0 0 ${leftPercent.value}%` }
})

function clampPercent(value) {
  return Math.min(MAX_LEFT_PERCENT, Math.max(MIN_LEFT_PERCENT, value))
}

function updateSplitFromClientX(clientX) {
  const grid = editorGridRef.value
  if (!grid) return
  const rect = grid.getBoundingClientRect()
  if (!rect.width) return
  const percent = ((clientX - rect.left) / rect.width) * 100
  leftPercent.value = clampPercent(percent)
}

function persistSplit() {
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, String(leftPercent.value))
  } catch (e) {
    // ignore storage errors
  }
}

function onResizeMove(event) {
  if (!dragging.value) return
  updateSplitFromClientX(event.clientX)
}

function stopResize() {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('pointermove', onResizeMove)
  persistSplit()
}

function startResize(event) {
  if (rightCollapsed.value) return
  dragging.value = true
  event.target?.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize, { once: true })
}

function nudgeSplit(delta) {
  leftPercent.value = clampPercent(leftPercent.value + delta)
  persistSplit()
}

function resetSplit() {
  leftPercent.value = DEFAULT_LEFT_PERCENT
  persistSplit()
}

function toggleRightPanel() {
  rightCollapsed.value = !rightCollapsed.value
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onResizeMove)
})

// ── Too-small-window overlay ────────────────────────────────────────────────
const RESIZE_MEDIA_QUERY = `(min-width: ${MIN_REQUIRED_WIDTH}px)`
const isScreenTooSmall = ref(false)
const currentWidth = ref(window.innerWidth)

const widthProgressPercent = computed(() =>
  Math.min(100, Math.round((currentWidth.value / MIN_REQUIRED_WIDTH) * 100))
)

let resizeMql = null
let widthRafId = null

function updateCurrentWidth() {
  currentWidth.value = window.innerWidth
  widthRafId = null
}

function scheduleWidthUpdate() {
  if (widthRafId !== null) return
  widthRafId = requestAnimationFrame(updateCurrentWidth)
}

function handleMediaChange(event) {
  isScreenTooSmall.value = !event.matches
}

watch(isScreenTooSmall, (tooSmall) => {
  if (tooSmall) {
    updateCurrentWidth()
    window.addEventListener('resize', scheduleWidthUpdate, { passive: true })
  } else {
    window.removeEventListener('resize', scheduleWidthUpdate)
    if (widthRafId !== null) {
      cancelAnimationFrame(widthRafId)
      widthRafId = null
    }
  }
})

onMounted(() => {
  resizeMql = window.matchMedia(RESIZE_MEDIA_QUERY)
  isScreenTooSmall.value = !resizeMql.matches
  resizeMql.addEventListener('change', handleMediaChange)
})

onUnmounted(() => {
  resizeMql?.removeEventListener('change', handleMediaChange)
  window.removeEventListener('resize', scheduleWidthUpdate)
  if (widthRafId !== null) cancelAnimationFrame(widthRafId)
})

// ── Computed ─────────────────────────────────────────────────────────────────
const componentFile = computed(() => props.mathRef?.split(':')[0])
const componentName = computed(() => props.mathRef?.split(':')[1])

const siblings = computed(() => {
  if (!componentName.value || !componentFile.value) return []
  return nodes.value.filter((n) => n.id !== props.id && n.data?.mathRef === props.mathRef).map((n) => n.id)
})

const siblingCount = computed(() => siblings.value.length)

const isDirty = computed(() =>
  !areModelsEquivalent(originalModel.value, currentModel.value)
)

const filteredParameterRows = computed(() => {
  if (!searchQuery.value.trim()) return parameterRows.value
  const query = searchQuery.value.toLowerCase()
  const columnKey = searchColumn.value
  return parameterRows.value.filter((row) => String(row[columnKey] || '').toLowerCase().includes(query))
})

// ── Watchers & Handlers ──────────────────────────────────────────────────────
watch(
  () => props.modelValue,
  async (isOpen) => {
    if (isOpen) {
      loading.value = true
      applyToAll.value = false
      activeTab.value = props.defaultTab || 'parameters'

      // Load Instance & Port data
      editableName.value = props.initialName
      editablePorts.value = detachReactivity(props.initialPorts || []).map((port) => ({
        ...port,
        variables: Array.isArray(port.variables)
          ? port.variables.map((v) => (typeof v === 'object' && v !== null ? v.name : v))
          : []
      }))

      // Load Parameters
      parameterRows.value = props.variables.map((row) => ({
        name: row.name,
        value: row.type === 'global_constant' ? store.getGlobalConstant(row.name)?.value : row.value,
        units: row.units,
        type: row.type,
        access: row.access,
      }))
      sortParameterRows('type', 1)

      // Load CellML
      try {
        if (props.mathRef) {
          const math = store.availableMath.get(props.mathRef)
          currentModel.value = math
          originalModel.value = math
        }
      } catch (e) {
        console.error('Failed to load CellML source', e)
      } finally {
        await nextTick()
        loading.value = false
      }
    }
  }
)

async function reconcileStagedState(newCode, newRawText) {
  const extractedVariables = extractVariablesFromMath(newCode)
  if (!extractedVariables) return

  const previousCode = currentModel.value
  const previousRawText = currentCellmlText.value
  if (previousCode === newCode) return

  const validVarNames = new Set(extractedVariables.map((v) => v.name))

  const currentMap = new Map(parameterRows.value.map((row) => [row.name, row]))
  const previousParameterRows = parameterRows.value

  const newParameterRows = extractedVariables.map((variable) => {
    const existing = currentMap.get(variable.name)

    return {
      name: variable.name,
      units: variable.units,
      access: variable.access || 'access',
      value: existing ? existing.value : (variable.value || ''),
      type: existing ? existing.type : (variable.type || 'constant'),
    }
  })

  history.startBatch()

  await history.executeAndAddCommand({
    type: 'update-cellml-code',
    undo: async () => {
      currentModel.value = previousCode
      currentCellmlText.value = previousRawText
      await cellmlEditorRef.value?.setText(previousRawText)
    },
    redo: async () => {
      currentModel.value = newCode
      currentCellmlText.value = newRawText
      await cellmlEditorRef.value?.setText(newRawText)
    },
  })

  await history.executeAndAddCommand({
    type: 'update-parameter-rows',
    undo: async () => {
      parameterRows.value = previousParameterRows
    },
    redo: async () => {
      parameterRows.value = newParameterRows
    },
  })

  for (const port of editablePorts.value) {
    if (!Array.isArray(port.variables)) continue

    const portVars = port.variables
    const removed = portVars.filter((varName) => !validVarNames.has(varName))
    if (removed.length === 0) continue

    await history.executeAndAddCommand({
      type: 'remove-variable-from-port',
      undo: async () => {
        port.variables = portVars
      },
      redo: async () => {
        port.variables = port.variables.filter((varName) => validVarNames.has(varName))
      },
    })
  }

  history.endBatch()
}

function handleCodeUpdate(newCode, rawText, isValid) {
  if (isValid) {
    reconcileStagedState(newCode, rawText)
  } else {
    trackRawTextOnly(rawText)
  }
}

async function trackRawTextOnly(rawText) {
  const previousRawText = currentCellmlText.value
  if (previousRawText === rawText) return

  await history.executeAndAddCommand({
    type: 'update-cellml-text-only',
    undo: async () => {
      currentCellmlText.value = previousRawText
      await cellmlEditorRef.value?.setText(previousRawText)
    },
    redo: async () => {
      currentCellmlText.value = rawText
      await cellmlEditorRef.value?.setText(rawText)
    },
  })
}

async function handleEditorUndo() {
  if (!history.canUndo) return
  await history.undo()
}

async function handleEditorRedo() {
  if (!history.canRedo) return
  await history.redo()
}

function handleEditorReady(canonicalMath, rawText) {
  void isDirty.value
  currentModel.value = canonicalMath
  originalModel.value = canonicalMath
  currentCellmlText.value = rawText ?? currentCellmlText.value
}

function sortParameterRows(field = 'type', order = 1) {
  parameterRows.value.sort((a, b) => {
    const valA = String(a[field] || '').toLowerCase()
    const valB = String(b[field] || '').toLowerCase()
    const result = valA.localeCompare(valB)
    return result !== 0 ? (order === 1 ? result : -result) : a.name.localeCompare(b.name)
  })
}

function handleSortChange(event) {
  const field = event?.sortField || 'type'
  const order = event?.sortOrder === -1 ? -1 : 1
  sortField.value = field
  sortOrder.value = order
  sortParameterRows(field, order)
}

function applyBulkType() {
  if (!bulkTypeValue.value || selectedRows.value.length === 0) return
  const targetType = bulkTypeValue.value
  selectedRows.value.forEach((row) => {
    row.type = targetType
  })
  selectedRows.value = []
  bulkTypeValue.value = ''
}

function addPort() {
  editablePorts.value.push({
    portType: 'general_ports',
    variables: [],
    label: '',
    multiportType: 'None',
    multiplyFactor: 1,
  })
}

function deletePort(index) {
  editablePorts.value.splice(index, 1)
}

const onDialogVisibleChange = (visible) => {
  if (visible) {
    emit('update:modelValue', true)
  } else {
    handleCancel()
  }
}

async function handleCancel() {
  if (isDirty.value) {
    const confirmed = await confirm({
      header: 'Unsaved Changes',
      message: 'Are you sure you want to discard changes?',
      severity: 'warning',
      acceptLabel: 'Discard & Close',
      rejectLabel: 'Cancel',
    })
    if (!confirmed) return
  }
  emit('update:modelValue', false)
}

async function handleMathOverwrite() {
  return confirm({
    header: 'Overwrite Math?',
    message: `You are about to overwrite an existing math definition. This will affect ${siblingCount.value} other instances. Are you sure you want to proceed?`,
    severity: 'warning',
    acceptLabel: 'Proceed',
    rejectLabel: 'Cancel',
  })
}

// ── Save Processing ──────────────────────────────────────────────────────────
async function handleSave() {
  // 1. Validate Instance Name
  if (!editableName.value || !editableName.value.trim()) {
    notify.error({ message: 'Instance name cannot be empty.' })
    activeTab.value = 'ports'
    return
  }

  const sanitised = sanitiseName(editableName.value)

  if (!sanitised) {
    notify.error({ message: 'Instance name is invalid.' })
    activeTab.value = 'ports'
    return
  }
  editableName.value = sanitised

  const nameExists = props.existingNames.some((n) => n === editableName.value && n !== props.initialName)
  if (nameExists) {
    notify.error({ message: 'An instance with this name already exists.' })
    activeTab.value = 'ports'
    return
  }

  // 2. Validate Ports
  const finalPorts = editablePorts.value.filter((p) => p.variables?.length && p.label?.trim())
  const invalidFactor = finalPorts.find((p) => p.multiportType === 'Multiply' && isEmpty(p.multiplyFactor))
  if (invalidFactor) {
    notify.error({ message: `Port "${invalidFactor.label}" has Multiply selected but missing scale factor.` })
    activeTab.value = 'ports'
    return
  }

  // 3. Process Global Constants from Parameters
  parameterRows.value.forEach((row) => {
    if (row.type === 'global_constant') {
      store.assignGlobalConstant(row.name, row.value, row.units, row.data_reference)
    }
  })

  // 4. Process CellML Source Changes
  let newMathRef = props.mathRef
  if (isDirty.value) {
    const componentNames = getModelComponentNames(currentModel.value)
    if (!componentNames || componentNames.length === 0) {
      window.alert('Could not find a valid component name in the model.')
      return
    }
    const newComponentName = componentNames[0].trim()
    newMathRef = `${componentFile.value}:${newComponentName}`

    if (newMathRef === props.mathRef && store.availableMath.has(newMathRef)) {
      const overwrite = await handleMathOverwrite()
      if (!overwrite) return
    }
    store.addMath(newMathRef, currentModel.value)
  }

  const updateAll = (siblingCount.value > 0 && applyToAll.value) || siblingCount.value === 0

  trackEvent('editor_action', {
    category: 'Editor',
    action: 'save_unified_module',
    label: editableName.value,
  })

  // Emit consolidated payload to parent workspace
  emit('confirm', {
    id: props.id,
    name: editableName.value,
    mathRef: newMathRef,
    math: currentModel.value,
    variables: parameterRows.value,
    ports: finalPorts,
    updateAll,
    siblings: updateAll ? siblings.value : undefined,
  })

  emit('update:modelValue', false)
}
</script>

<style scoped>
.custom-dialog-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.125rem;
  font-weight: 600;
  width: 100%;
  overflow: visible;
}

.header-prefix {
  color: var(--p-text-color);
}

.header-input {
  width: 300px;
  font-size: 1rem;
  font-weight: normal;
}

.header-suffix {
  color: var(--p-text-muted-color);
  font-size: 0.9rem;
  font-weight: normal;
}

.module-editor-dialog {
  display: flex;
  flex-direction: column;
  overflow: auto;
  box-sizing: border-box;
}

.module-editor-dialog :deep(.p-dialog-header) {
  overflow: visible;
}

.module-editor-dialog :deep(.p-dialog-content) {
  position: relative !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  flex: 1 1 auto !important;
  min-height: 0 !important;
  padding-bottom: 16px !important;
}

.editor-grid {
  --dlg-fs-label: 0.875rem;   /* 14px - field/section labels */
  --dlg-fs-body: 0.875rem;    /* 14px - table cells, inputs */
  --dlg-fs-small: 0.8125rem;  /* 13px - secondary/meta text */
  --dlg-fs-tiny: 0.75rem;     /* 12px - badges, prefixes only */

  display: flex;
  align-items: stretch;
  gap: 0;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  max-width: 100%;
  transition: filter 0.2s ease, opacity 0.2s ease;
}

.editor-grid.is-dragging {
  cursor: col-resize;
  user-select: none;
}

.editor-grid.is-suppressed {
  pointer-events: none;
  opacity: 0.4;
  filter: blur(2px) saturate(0.7);
}

.pane {
  display: flex;
  flex-direction: column;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  padding: 12px;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.left-pane {
  min-width: 38%;
  max-width: 55%;
}

.left-pane--collapsed {
  max-width: 100%;
}

.editor-wrapper {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Resize handle between the two panes; also hosts the collapse/expand button ── */
.resizer {
  position: relative;
  flex: 0 0 14px;
  margin: 0 -3px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  z-index: 2;
  touch-action: none;
}

.resizer--collapsed {
  cursor: pointer;
}

.resizer-grip {
  width: 4px;
  height: 48px;
  border-radius: 3px;
  background: var(--p-content-border-color);
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.resizer--collapsed .resizer-grip {
  opacity: 0.35;
}

.resizer:hover .resizer-grip,
.resizer:focus-visible .resizer-grip {
  background: var(--p-primary-color);
}

.resizer:focus-visible {
  outline: none;
}

.resizer-toggle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-content-border-color);
  border-radius: 999px;
  background: var(--p-content-background);
  color: var(--p-text-muted-color);
  cursor: pointer;
  z-index: 3;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  opacity: 0.55;
  transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.resizer:hover .resizer-toggle,
.resizer:focus-visible .resizer-toggle,
.resizer--collapsed .resizer-toggle {
  opacity: 1;
}

.resizer-toggle:hover {
  color: var(--p-text-color);
  background: var(--p-content-hover-background, rgba(0, 0, 0, 0.04));
}

/* ── Right pane / collapse behaviour ── */
.right-pane {
  position: relative;
  flex: 1 1 auto;
  min-width: 32%;
  max-width: 72%;
  transition: min-width 0.15s ease, flex-basis 0.15s ease;
}

.right-pane--collapsed {
  flex: 0 0 32px;
  min-width: 32px;
  padding: 8px 4px;
  align-items: center;
}

.collapsed-rail {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.collapsed-rail-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: var(--dlg-fs-label);
  font-weight: 600;
  color: var(--p-text-muted-color);
  white-space: nowrap;
}

/* ── Tabs: make the whole chain fill available height so the scroll ── */
.right-pane-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.right-pane-tabs :deep(.p-tablist) {
  flex-shrink: 0;
}

.tab-panels-container {
  flex: 1;
  min-height: 0;
  padding-top: 12px;
}

.right-pane-tabs :deep(.p-tabpanels) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-panel-flex {
  flex: 1;
  min-height: 0;
  height: 100%;
}

.right-pane-tabs :deep(.p-tabpanel) {
  height: 100%;
}

.parameters-tab-body,
.ports-tab-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.table-flex-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.table-flex-wrapper :deep(.p-datatable) {
  display: flex !important;
  flex-direction: column !important;
  min-height: 0 !important;
  height: 100% !important;
  overflow: hidden !important;
}

.table-flex-wrapper :deep(.p-datatable-table-container),
.table-flex-wrapper :deep(.p-datatable-wrapper) {
  min-height: 0 !important;
  flex: 1 1 auto !important;
  overflow-y: auto !important;
}

.tab-icon {
  margin-right: 6px;
  font-size: var(--dlg-fs-small);
}

/* Parameters Tab Styles */
.toolbar-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 12px;
  background-color: var(--p-content-hover-background, rgba(0, 0, 0, 0.02));
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}

.search-group, .bulk-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-group {
  flex-wrap: wrap;
}

.search-input-wrapper {
  position: relative;
}

.bulk-controls {
  padding-top: 8px;
  border-top: 1px solid var(--p-content-border-color);
  flex-wrap: wrap;
}

.bulk-controls .bulk-select {
  margin-right: auto;
}

.search-column { width: 130px; flex: 0 0 auto; }
.bulk-select { width: 180px; }
.bulk-label { font-size: var(--dlg-fs-small); color: var(--p-text-muted-color); white-space: nowrap; }

/* Ports Tab Styles */
.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-weight: 600;
  font-size: var(--dlg-fs-label);
}

.ports-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.empty-state {
  color: var(--p-text-muted-color);
  font-size: var(--dlg-fs-small);
  margin-top: 16px;
  text-align: center;
}

.multiply-prefix {
  font-size: var(--dlg-fs-tiny);
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.w-full { width: 100%; }
.text-muted { color: var(--p-text-muted-color); }

/* Normalise table typography - DataTable renders these cells directly */
/* in our own template output (not teleported), so :deep() reaches them. */
.right-pane :deep(.p-datatable) {
  font-size: var(--dlg-fs-body);
}

.right-pane :deep(.p-datatable-thead > tr > th) {
  font-size: var(--dlg-fs-small);
  font-weight: 600;
}

.right-pane :deep(.p-select-label),
.right-pane :deep(.p-inputtext) {
  font-size: var(--dlg-fs-body);
}

/* Footer */
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  width: 100%;
}

.apply-all-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
  font-size: 0.85rem;
}

.footer-buttons {
  display: flex;
  gap: 8px;
}

.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400px;
  gap: 12px;
}

/* ── Resize warning overlay ── */
.resize-warning-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 15, 20, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.resize-warning-card {
  width: min(420px, 100%);
  text-align: center;
  padding: 32px 28px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  background: var(--p-content-background);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18);
}

.resize-warning-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-bottom: 20px;
}

.resize-warning-window {
  font-size: 2.5rem;
  color: var(--p-primary-color);
}

.resize-warning-arrow {
  font-size: 1.375rem;
  color: var(--p-primary-color);
  opacity: 0.45;
  animation-duration: 1.6s;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
}

.resize-warning-arrow--left {
  animation-name: resize-warning-pulse-left;
}

.resize-warning-arrow--right {
  animation-name: resize-warning-pulse-right;
  animation-delay: 0.1s;
}

@keyframes resize-warning-pulse-left {
  0%, 100% { transform: translateX(0); opacity: 0.4; }
  50% { transform: translateX(-6px); opacity: 1; }
}

@keyframes resize-warning-pulse-right {
  0%, 100% { transform: translateX(0); opacity: 0.4; }
  50% { transform: translateX(6px); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .resize-warning-arrow {
    animation: none;
    opacity: 0.7;
  }
}

.resize-warning-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0 0 8px;
}

.resize-warning-copy {
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0 0 22px;
}

.resize-warning-meter-track {
  height: 6px;
  border-radius: 999px;
  background: var(--p-content-hover-background, rgba(0, 0, 0, 0.08));
  overflow: hidden;
}

.resize-warning-meter-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--p-primary-color);
  transition: width 0.15s ease-out;
}

.resize-warning-meter-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  font-variant-numeric: tabular-nums;
}

/* Transition: overlay fades, card fades + scales in slightly */
.resize-warning-enter-active,
.resize-warning-leave-active {
  transition: opacity 0.18s ease;
}

.resize-warning-enter-from,
.resize-warning-leave-to {
  opacity: 0;
}

.resize-warning-enter-active .resize-warning-card,
.resize-warning-leave-active .resize-warning-card {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.resize-warning-enter-from .resize-warning-card,
.resize-warning-leave-to .resize-warning-card {
  transform: scale(0.96) translateY(6px);
  opacity: 0;
}

@media (max-width: 900px) {
  .editor-grid {
    flex-direction: column;
  }

  .left-pane {
    min-width: 0;
    flex-basis: 45vh !important;
  }

  .resizer {
    display: none;
  }

  .right-pane {
    flex-basis: 45vh !important;
    min-width: 0;
  }

  .right-pane--collapsed {
    display: none;
  }
}

.per-variable-multiport {
  font-size: 0.8em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
