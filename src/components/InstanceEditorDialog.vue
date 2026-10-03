<template>
  <Dialog
    :visible="modelValue"
    modal
    :dismissableMask="!loading"
    :draggable="false"
    :style="{ width: '95vw', maxWidth: '1680px', height: '90vh', maxHeight: '960px' }"
    class="module-editor-dialog"
    :pt="DIALOG_PT"
    @update:visible="onDialogVisibleChange"
  >
    <template #header>
      <div class="custom-dialog-header">
        <div class="header-group">
          <span class="header-label">Instance</span>
          <SanitisedInput
            ref="instanceNameRef"
            v-model="editableName"
            :sanitise="sanitiseName"
            :invalid="!!nameError"
            :notice="nameError"
            placeholder="Instance name..."
            width="260px"
            font-size="1rem"
          />
        </div>

        <span class="header-divider" aria-hidden="true"></span>

        <div class="header-group header-group--secondary">
          <span class="header-label header-label--secondary">Component</span>
          <SanitisedInput
            v-if="isManaged"
            v-model="editableComponentName"
            :sanitise="sanitiseName"
            :fallback="componentNameForEditor"
            placeholder="Component name..."
            width="200px"
          />
          <span
            v-else
            class="header-static"
            title="While Simple Mode is off, the text sets the component name (def comp ... as)."
          >
            {{ componentNameForEditor }}
            <i class="pi pi-code"></i>
          </span>
          <span class="header-file" :title="`Defined in ${componentFile}`">
            <i class="pi pi-file"></i>
            <span class="header-file-name">{{ componentFile }}</span>
          </span>
        </div>
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
      <!-- LEFT COLUMN: CellML Text or Math Editor -->
      <div class="pane left-pane" :style="leftPaneStyle">
        <Tabs :key="editorTabsKey" :value="editorKind" class="editor-tabs" @update:value="switchEditor">
          <TabList>
            <Tab v-for="option in EDITOR_OPTIONS" :key="option.value" :value="option.value">
              <i :class="['pi', option.icon, 'tab-icon']"></i>
              {{ option.label }}
            </Tab>
          </TabList>
        </Tabs>
        <Message v-if="pendingRename" class="rename-notice" severity="info" size="small" :closable="false">
          <div class="rename-notice-body">
            <span>
              <strong>{{ pendingRename.from }}</strong> was renamed to <strong>{{ pendingRename.to }}</strong>, but is
              still used in {{ pendingRename.uses }} {{ pendingRename.uses === 1 ? 'place' : 'places' }}.
            </span>
            <span class="rename-notice-actions">
              <Button label="Rename all" size="small" text @click="renameEverywhere" />
              <Button label="Keep both" size="small" text severity="secondary" @click="dismissRename" />
            </span>
          </div>
        </Message>
        <div ref="editorWrapperRef" class="editor-wrapper">
          <div v-if="!isEditorReady" class="editor-pending">
            <ProgressSpinner style="width: 32px; height: 32px" strokeWidth="4" />
            <span>Preparing editor...</span>
          </div>
          <CellMLTextEditor
            v-else-if="editorKind === 'text'"
            ref="mathEditorRef"
            :key="mathRef"
            :model-value="currentModel"
            :layout="currentLayout"
            :simple="isManaged"
            @update:simple="onSimpleToggle"
            :component-name="componentNameForEditor"
            :variable-definitions="editorDefinitions"
            @update:component-name="onEditorComponentName"
            @change="handleEditorChange"
            @save="handleSave"
            @undo="handleEditorUndo"
            @redo="handleEditorRedo"
          />
          <MathWorkbenchEditor
            v-else
            ref="mathEditorRef"
            :key="mathRef"
            :model-value="currentModel"
            :component-name="componentNameForEditor"
            :variable-definitions="editorDefinitions"
            @change="handleEditorChange"
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
        <button
          v-if="rightCollapsed"
          type="button"
          class="collapsed-rail"
          :aria-label="railAriaLabel"
          @click="toggleRightPanel"
        >
          <span v-if="activeTab === 'parameters' && issueChips.length" class="rail-badges">
            <span
              v-for="chip in issueChips"
              :key="chip.key"
              class="rail-badge"
              :class="`issue-chip--${chip.kind}`"
              :title="chip.label"
            >
              <i :class="['pi', chip.icon]"></i>
              {{ chip.count }}
            </span>
          </span>
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
              <i class="pi pi-link tab-icon"></i>
              Ports ({{ editablePorts.length }})
            </Tab>
          </TabList>

          <TabPanels class="tab-panels-container">
            <!-- TAB 1: PARAMETER EDITOR -->
            <TabPanel value="parameters" class="tab-panel-flex">
              <ParameterTable
                ref="parameterTableRef"
                :rows="parameterRows"
                :is-managed="isManaged"
                :is-missing-units="isMissingUnits"
                :get-units-notice="getUnitsNotice"
                :issue-chips="issueChips"
                :issue-filter="issueFilter"
                :variable-kinds="variableKinds"
                :connection-supplied="connectionSupplied"
                :math-references="mathReferences"
                :unit-names="store.availableUnitNames"
                :unit-expansions="store.unitExpansions"
              />
            </TabPanel>

            <!-- TAB 2: PORT EDITOR -->
            <TabPanel value="ports" class="tab-panel-flex">
              <div class="ports-tab-body">
                <Message v-if="incompletePortCount" class="ports-header" severity="error" size="small" variant="simple">
                  {{ incompletePortCount }} {{ incompletePortCount === 1 ? 'port needs' : 'ports need' }} a label and at
                  least one variable.
                </Message>

                <div v-if="editablePorts.length" class="table-flex-wrapper">
                  <DataTable
                    ref="portsTableRef"
                    :value="editablePorts"
                    size="small"
                    stripedRows
                    scrollable
                    scrollHeight="flex"
                    tableStyle="min-width: 580px"
                    :rowClass="portRowClass"
                  >
                    <Column header="Type" style="width: 140px">
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
                        <InputText
                          v-model="slotProps.data.label"
                          :invalid="isPortFlagged(slotProps.data) && !slotProps.data.label?.trim()"
                          placeholder="Enter label"
                          size="small"
                          class="w-full"
                        />
                      </template>
                    </Column>

                    <Column header="Variable(s)" style="min-width: 180px">
                      <template #body="slotProps">
                        <MultiSelect
                          v-model="slotProps.data.variables"
                          :invalid="isPortFlagged(slotProps.data) && !slotProps.data.variables?.length"
                          :options="parameterRows"
                          optionLabel="name"
                          optionValue="name"
                          size="small"
                          placeholder="Select variables"
                          class="w-full"
                          :maxSelectedLabels="3"
                          filter
                          autoFilterFocus
                          resetFilterOnHide
                          filterPlaceholder="Search variables..."
                          emptyFilterMessage="No matching variables"
                          :pt="{ overlay: { class: 'ports-variable-overlay' } }"
                        >
                          <template #filtericon>
                            <span class="ports-variable-filter-icons">
                              <i class="pi pi-search"></i>
                              <i
                                class="search-clear-input pi pi-times-circle"
                                role="button"
                                aria-label="Clear search"
                                @mousedown.prevent
                                @click.stop="clearPortVariableSearch"
                              ></i>
                            </span>
                          </template>
                        </MultiSelect>
                      </template>
                    </Column>

                    <Column header="Multiport" style="min-width: 110px">
                      <template #body="slotProps">
                        <div class="flex flex-col gap-1">
                          <Select
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
                              :invalid="isPortFlagged(slotProps.data) && isEmpty(slotProps.data.multiplyFactor)"
                              :showButtons="false"
                              size="small"
                              placeholder="1"
                              class="w-full"
                            />
                          </div>
                        </div>
                      </template>
                    </Column>

                    <!-- Frozen, so the delete button stays in view when the table scrolls sideways -->
                    <Column frozen alignFrozen="right" style="width: 3rem">
                      <template #body="slotProps">
                        <Button
                          icon="pi pi-trash"
                          severity="danger"
                          rounded
                          text
                          size="small"
                          aria-label="Delete port"
                          title="Delete port"
                          @click="deletePort(editablePorts.indexOf(slotProps.data))"
                        />
                      </template>
                    </Column>
                  </DataTable>
                </div>
                <Button
                  v-if="editablePorts.length"
                  class="add-port-row"
                  icon="pi pi-plus"
                  label="Add port"
                  severity="secondary"
                  size="small"
                  text
                  @click="addPort"
                />
                <div v-else class="empty-state">
                  <span>No ports defined for this instance.</span>
                  <Button icon="pi pi-plus" label="Add Port" severity="success" size="small" rounded outlined @click="addPort" />
                </div>
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
          :title="`Also switch the ${siblingCount} other instance${
            siblingCount !== 1 ? 's' : ''
          } using ${componentName} from ${componentFile} to the new math. Parameters and ports only change here.`"
        >
          <Checkbox v-model="applyToAll" binary inputId="applyToAll" />
          <label for="applyToAll">
            Apply math changes to all {{ siblingCount + 1 }} instances of <strong>{{ componentName }}</strong>
          </label>
        </div>

        <div class="footer-buttons">
          <Button label="Cancel" severity="secondary" text @click="handleCancel" />
          <Button label="Save" severity="primary" @click="handleSave" />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'

import CellMLTextEditor from './CellMLTextEditor.vue'
import MathWorkbenchEditor from './MathWorkbenchEditor.vue'
import ParameterTable from './ParameterTable.vue'
import SanitisedInput from './SanitisedInput.vue'
import { useLibraryStore } from '../stores/libraryStore'
import { useIssueFilter } from '../composables/useIssueFilter'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useGtm } from '../composables/useGtm'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useMathSession } from '../composables/useMathSession'

import { isEmpty, syncInitialiserUnits } from '../utils/variables'
import { getUnknownUnitsNotice, isValueMissing } from '../utils/parameterRows'
import { isInitialisable } from '../services/math/variableKinds'
import { PORT_TYPE_OPTIONS, MULTIPORT_OPTIONS } from '../utils/constants'
import { cleanName, sanitiseName } from '../utils/identifiers'
import { detachReactivity } from '../utils/reactivity'
import { waitUntilStable } from '../utils/layout'
import { notify } from '../utils/notify'
import { getModelComponentNames } from '../utils/cellml'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  id: { type: String, required: true },
  initialName: { type: String, default: '' },
  mathRef: { type: String, required: true },
  variables: { type: Array, default: () => [] },
  initialPorts: { type: Array, default: () => [] },
  existingNames: { type: Array, default: () => [] },
  defaultTab: { type: String, default: 'parameters' },  // 'parameters' or 'ports'
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const store = useLibraryStore()
const history = useFlowHistoryStore()

const { trackEvent } = useGtm()
const { nodes } = useVueFlow()
const { confirm } = useConfirmDialog()

// ── State ────────────────────────────────────────────────────────────────────
const loading = ref(false)
const activeTab = ref('parameters')

const applyToAll = ref(false)
// The editor mounts after the table paints, so its synchronous parse doesn't delay the table.
const isEditorReady = ref(false)
const editorWrapperRef = ref(null)
// The dialog focuses its close button once its opening transition ends, so the editor takes focus
// after that. Dialog has no event for it; its transition options are merged into its <Transition>.
const isDialogShown = ref(false)
const DIALOG_PT = {
  transition: {
    onAfterEnter: () => {
      isDialogShown.value = true
    },
  },
}

// Port & Instance State
const editableName = ref('')
const editablePorts = ref([])
const instanceNameRef = ref(null)
// Why the last save rejected the instance name; cleared once the name changes.
const nameError = ref('')
let rejectedName = ''
// The ports a save rejected. Only these are flagged, so rows added afterwards start clean.
const flaggedPorts = ref(new Set())
const portsTableRef = ref(null)

watch(editableName, (name) => {
  if (name !== rejectedName) nameError.value = ''
})

// Component Name
const editableComponentName = ref('')
const componentNameForEditor = ref('')

watch(editableComponentName, (value) => {
  const cleaned = cleanName(value)
  if (cleaned) componentNameForEditor.value = cleaned
})

// Advanced Mode component name
function onEditorComponentName(name) {
  editableComponentName.value = name
  componentNameForEditor.value = name
}

// Ref to the mounted math editor, used to imperatively replay text during undo/redo
const mathEditorRef = ref(null)
const parameterTableRef = ref(null)

// The math, its analysis and the parameter rows.
const session = useMathSession({ history, editorRef: mathEditorRef, ports: editablePorts })
const {
  isManaged,
  currentModel,
  currentLayout,
  parameterRows,
  editorDefinitions,
  variableKinds,
  connectionSupplied,
  mathReferences,
  pendingRename,
  isMissingUnits,
  handleEditorChange,
  renameEverywhere,
  dismissRename,
} = session

// ── Editor Choice ───────────────────────────────────────────────────────────
const EDITOR_STORAGE_KEY = 'instanceEditorDialog.editorKind'
const EDITOR_OPTIONS = [
  { value: 'text', label: 'CellML Text', icon: 'pi-code' },
  { value: 'math', label: 'Math Editor', icon: 'pi-calculator' },
]

function loadStoredEditorKind() {
  try {
    const stored = window.localStorage.getItem(EDITOR_STORAGE_KEY)
    if (EDITOR_OPTIONS.some((option) => option.value === stored)) return stored
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) - fall back to default
  }
  return 'text'
}

const editorKind = ref(loadStoredEditorKind())
// Tabs keeps its own selection, so a cancelled switch remounts it to show the current editor.
const editorTabsKey = ref(0)

/**
 * Swaps the math editor, keeping the session. The Math Editor always works in Simple Mode.
 *
 * @param {'text'|'math'} kind
 */
async function switchEditor(kind) {
  if (kind === editorKind.value) return
  await session.flushPendingChanges()

  if ((mathEditorRef.value?.getErrors?.() ?? []).length > 0) {
    const proceed = await confirm({
      header: 'Discard Invalid Edits?',
      message: 'The math has errors. If you switch editors, edits since the last valid version will be lost.',
      severity: 'warning',
      acceptLabel: 'Switch',
      rejectLabel: 'Cancel',
    })
    if (!proceed) {
      editorTabsKey.value++
      return
    }
  }

  if (kind === 'math') isManaged.value = true
  editorKind.value = kind
  try {
    window.localStorage.setItem(EDITOR_STORAGE_KEY, kind)
  } catch (e) {
    // ignore storage errors
  }
}

// ── Simple Mode preference ──────────────────────────────────────────────────
// One app-wide choice, the last one the user made; it is never saved with the workspace.
const MANAGED_STORAGE_KEY = 'instanceEditorDialog.simpleMode'

function loadStoredManaged() {
  try {
    return window.localStorage.getItem(MANAGED_STORAGE_KEY) !== 'false'
  } catch (e) {
    return true // localStorage unavailable (e.g. private browsing) - fall back to Simple Mode
  }
}

/**
 * Applies the user's Simple Mode toggle and remembers it for the next open.
 *
 * @param {boolean} simple
 */
function onSimpleToggle(simple) {
  isManaged.value = simple
  try {
    window.localStorage.setItem(MANAGED_STORAGE_KEY, String(simple))
  } catch (e) {
    // ignore storage errors
  }
}

// ── Split / Collapse State ──────────────────────────────────────────────────
const SPLIT_STORAGE_KEY = 'instanceEditorDialog.leftPanePercent'
const DEFAULT_LEFT_PERCENT = 55
const MIN_LEFT_PERCENT = 38
const MAX_LEFT_PERCENT = 55
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

// ── Issues ───────────────────────────────────────────────────────────────────
const getUnitsNotice = (row) => getUnknownUnitsNotice(row, store.availableUnitNames)

/**
 * Checks whether a state's initial value is a variable that changes over time.
 *
 * @param {Object} row
 * @returns {boolean}
 */
function hasTimeVaryingInitialiser(row) {
  if (row.stateRole !== 'state' || !row.initialiser) return false
  const initialiserRow = parameterRows.value.find((candidate) => candidate.name === row.initialiser)
  return !!initialiserRow && !isInitialisable(initialiserRow, variableKinds.value)
}

const ISSUE_MATCHERS = {
  units: (row) => isMissingUnits(row),
  values: (row) => isValueMissing(row),
  unknown: (row) => !!getUnitsNotice(row),
  initialiser: hasTimeVaryingInitialiser,
}

const issueChips = computed(() => {
  const rows = parameterRows.value
  const count = (fn) => rows.filter(fn).length
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

  const missingUnits = count(ISSUE_MATCHERS.units)
  const missingValues = count(ISSUE_MATCHERS.values)
  const unknownUnits = count(ISSUE_MATCHERS.unknown)
  const timeVaryingInitialisers = count(ISSUE_MATCHERS.initialiser)

  const chips = []
  if (missingUnits) {
    chips.push({ key: 'units', kind: 'units', icon: 'pi-exclamation-circle', count: missingUnits, label: `${plural(missingUnits, 'variable')} missing units` })
  }
  if (missingValues) {
    chips.push({ key: 'values', kind: 'units', icon: 'pi-pencil', count: missingValues, label: `${plural(missingValues, 'value')} required` })
  }
  if (timeVaryingInitialisers) {
    chips.push({
      key: 'initialiser',
      kind: 'units',
      icon: 'pi-exclamation-triangle',
      count: timeVaryingInitialisers,
      label: `${plural(timeVaryingInitialisers, 'state')} with time-varying initialiser`,
    })
  }
  if (unknownUnits) {
    chips.push({ key: 'unknown', kind: 'unknown', icon: 'pi-info-circle', count: unknownUnits, label: `${plural(unknownUnits, 'unit')} not in library` })
  }
  return chips
})

// ── "Show only" filter ───────────────────────────────────────────────────────
const issueFilter = useIssueFilter({
  rows: parameterRows,
  matchers: ISSUE_MATCHERS,
  availableKeys: computed(() => issueChips.value.map((chip) => chip.key)),
})

// Screen readers get the same information the badges show.
const railAriaLabel = computed(() => {
  const summary = activeTab.value === 'parameters' ? issueChips.value.map((chip) => chip.label).join(', ') : ''
  const label = activeTab.value === 'parameters' ? `Parameters (${parameterRows.value.length})` : `Ports (${editablePorts.value.length})`
  return summary ? `Expand panel. ${label}. ${summary}` : `Expand panel. ${label}`
})

// ── Computed ─────────────────────────────────────────────────────────────────
const componentFile = computed(() => props.mathRef?.split(':')[0])
const componentName = computed(() => props.mathRef?.split(':')[1])

const siblings = computed(() => {
  if (!componentName.value || !componentFile.value) return []
  return nodes.value.filter((n) => n.id !== props.id && n.data?.mathRef === props.mathRef).map((n) => n.id)
})

const siblingCount = computed(() => siblings.value.length)

// ── Watchers & Handlers ──────────────────────────────────────────────────────
let openRequestId = 0

watch(
  () => isDialogShown.value && isEditorReady.value,
  async (canFocus) => {
    if (!canFocus) return
    await nextTick()
    mathEditorRef.value?.focus?.()
  }
)

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (!isOpen) {
      isEditorReady.value = false
      isDialogShown.value = false
      return
    }

    const requestId = ++openRequestId
    loading.value = true
    isEditorReady.value = false
    applyToAll.value = false
    nameError.value = ''
    rejectedName = ''
    flaggedPorts.value = new Set()
    activeTab.value = props.defaultTab || 'parameters'
    issueFilter.reset()

    editableName.value = props.initialName
    editableComponentName.value = componentName.value
    componentNameForEditor.value = componentName.value
    editablePorts.value = detachReactivity(props.initialPorts || []).map((port) => ({
      ...port,
      variables: Array.isArray(port.variables)
        ? port.variables.map((v) => (typeof v === 'object' && v !== null ? v.name : v))
        : [],
    }))

    // Saved stateRole/initialiser keep pairings the math alone can't reveal, such as shared initialisers.
    const savedRows = props.variables.map((row) => ({
      name: row.name,
      value: row.type === 'global_constant' ? store.getGlobalConstant(row.name)?.value : row.value,
      units: row.units,
      type: row.type,
      access: row.access,
      data_reference: row.data_reference ?? null,
      ...(row.stateRole === 'state' ? { stateRole: 'state', initialiser: row.initialiser } : {}),
    }))

    try {
      await session.load({
        mathRef: props.mathRef,
        rows: savedRows,
        managed: loadStoredManaged() || editorKind.value === 'math',
      })
    } catch (e) {
      console.error('Failed to load CellML source', e)
    }
    if (requestId !== openRequestId) return

    loading.value = false
    await nextTick()
    // rAF runs before the next paint; the timeout lands after it, so the table is on screen first.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    // The editor measures its glyphs when it mounts, so it waits out the dialog's opening scale.
    await waitUntilStable(editorWrapperRef.value, 400)
    if (requestId === openRequestId && props.modelValue) isEditorReady.value = true
  }
)

// Pending editor changes are recorded first, so undo steps back from the latest edit.
async function handleEditorUndo() {
  await session.flushPendingChanges()
  if (!history.canUndo) return
  await history.undo()
}

async function handleEditorRedo() {
  await session.flushPendingChanges()
  if (!history.canRedo) return
  await history.redo()
}

function clearPortVariableSearch(event) {
  const input = event.currentTarget.closest('.p-iconfield')?.querySelector('input')
  if (!input) return
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus()
}

/**
 * Checks whether a port has nothing filled in, so it can be dropped on save without losing work.
 *
 * @param {Object} port
 * @returns {boolean}
 */
function isBlankPort(port) {
  return !port.label?.trim() && !port.variables?.length
}

/**
 * Checks whether a port is partly filled in: it has a label or variables, but not both.
 *
 * @param {Object} port
 * @returns {boolean}
 */
function isIncompletePort(port) {
  return !isBlankPort(port) && (!port.label?.trim() || !port.variables?.length)
}

/**
 * Checks whether a port has a multiply factor selected but no factor entered.
 *
 * @param {Object} port
 * @returns {boolean}
 */
function isMissingFactor(port) {
  return port.multiportType === 'Multiply' && isEmpty(port.multiplyFactor)
}

const isPortFlagged = (port) => flaggedPorts.value.has(port)

const incompletePortCount = computed(
  () => editablePorts.value.filter((port) => isPortFlagged(port) && isIncompletePort(port)).length
)

const portRowClass = (port) =>
  isPortFlagged(port) && (isIncompletePort(port) || isMissingFactor(port)) ? 'port-row--invalid' : ''

async function addPort() {
  editablePorts.value.push({
    portType: 'general_ports',
    variables: [],
    label: '',
    multiportType: 'None',
    multiplyFactor: 1,
  })
  // Bring the new row into view; it's added at the bottom of the table.
  await nextTick()
  const scroller = portsTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (scroller) scroller.scrollTop = scroller.scrollHeight
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
  // Commit any rename and editor change still in flight, so an edit typed just before Escape counts.
  parameterTableRef.value?.flushPendingRenames()
  await session.flushPendingChanges()

  if (session.hasUnsavedInvalidEdit() || session.isDirty() || session.isLayoutDirty()) {
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
/**
 * Flags the instance name field with a save error and moves focus to it.
 *
 * @param {string} message
 */
function rejectInstanceName(message) {
  notify.error({ message })
  nameError.value = message
  rejectedName = editableName.value
  instanceNameRef.value?.focus()
}

/**
 * Shows a tab of the right panel, expanding the panel if it was collapsed.
 *
 * @param {'parameters'|'ports'} tab
 */
function showTab(tab) {
  activeTab.value = tab
  rightCollapsed.value = false
}

async function handleSave() {
  // Commit any rename and editor change still in flight before reading state.
  parameterTableRef.value?.flushPendingRenames()
  await session.flushPendingChanges()

  // 1. Validate Instance Name
  if (!editableName.value || !editableName.value.trim()) {
    rejectInstanceName('Instance name cannot be empty.')
    return
  }

  const sanitised = sanitiseName(editableName.value)

  if (!sanitised) {
    rejectInstanceName('Instance name is invalid.')
    return
  }
  editableName.value = sanitised

  const nameExists = props.existingNames.some((n) => n === editableName.value && n !== props.initialName)
  if (nameExists) {
    rejectInstanceName('An instance with this name already exists.')
    return
  }

  if (isManaged.value && !cleanName(editableComponentName.value)) {
    notify.error({ message: 'Component name is invalid.' })
    return
  }

  // 2. Validate Ports
  const incompletePorts = editablePorts.value.filter(isIncompletePort)
  if (incompletePorts.length) {
    flaggedPorts.value = new Set(incompletePorts)
    notify.error({ message: 'Every port needs a label and at least one variable.' })
    showTab('ports')
    return
  }
  const finalPorts = editablePorts.value.filter((p) => !isBlankPort(p))
  const invalidFactor = finalPorts.find(isMissingFactor)
  if (invalidFactor) {
    flaggedPorts.value = new Set([invalidFactor])
    notify.error({ message: `Port "${invalidFactor.label}" has Multiply selected but missing scale factor.` })
    showTab('ports')
    return
  }

  // 2b. Validate no two parameter rows share a name. This can only happen via a renamed
  // initialiser colliding with another row - block it here since a saved duplicate would
  // silently break every name-keyed lookup downstream (buildVariableDeclarations, the initialiser
  // picker options, port variable selection, ...).
  const nameCounts = new Map()
  parameterRows.value.forEach((row) => {
    const cleaned = cleanName(row.name)
    if (!cleaned) return
    nameCounts.set(cleaned, (nameCounts.get(cleaned) ?? 0) + 1)
  })
  const duplicateName = [...nameCounts.entries()].find(([, count]) => count > 1)?.[0]
  if (duplicateName) {
    notify.error({ message: `Two variables are both named "${duplicateName}". Rename one before saving.` })
    showTab('parameters')
    return
  }

  const textErrors = mathEditorRef.value?.getErrors?.() ?? []
  if (textErrors.length > 0) {
    const proceed = await confirm({
      header: editorKind.value === 'math' ? 'Math Has Errors' : 'CellML Text Has Errors',
      message: 'If you continue, the last valid version of the model will be saved and any edits since then will be lost.',
      severity: 'warning',
      acceptLabel: 'Proceed',
      rejectLabel: 'Cancel',
    })
    if (!proceed) return
  }

  // Values typed into the text belong in the rows, so an edit to values alone leaves the math unchanged.
  session.separateTypedValues()

  // Sync each state's initialiser to the state's units (only where the initialiser's own units
  // are still blank - see syncInitialiserUnits).
  syncInitialiserUnits(parameterRows.value)

  // 3. Process Global Constants from Parameters
  parameterRows.value.forEach((row) => {
    if (row.type === 'global_constant') {
      store.assignGlobalConstant(row.name, row.value, row.units, row.data_reference)
    }
  })

  // 4. Process CellML Source Changes
  let newMathRef = props.mathRef
  if (session.isDirty()) {
    const componentNames = getModelComponentNames(currentModel.value)
    if (!componentNames || componentNames.length === 0) {
      notify.error({ message: 'Could not find a valid component name in the model.' })
      return
    }
    const newComponentName = componentNames[0].trim()

    newMathRef = `${componentFile.value}:${newComponentName}`
    if (newMathRef === props.mathRef && store.availableMath.has(newMathRef)) {
      const overwrite = await handleMathOverwrite()
      if (!overwrite) return
    }
    store.addMath(newMathRef, currentModel.value, true, currentLayout.value)
  } else if (newMathRef && session.isLayoutDirty()) {
    // Only comments or formatting changed: the math, and so every instance using it, is unchanged.
    store.setMathLayout(newMathRef, currentLayout.value)
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
  flex-wrap: wrap;
}

.header-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.header-group--secondary {
  gap: 0.5rem;
  font-size: 0.9rem;
  font-weight: normal;
}

.header-label {
  color: var(--p-text-color);
}

.header-label--secondary {
  color: var(--p-text-muted-color);
}

.header-divider {
  align-self: stretch;
  width: 1px;
  margin: 0.25rem 0.25rem;
  background: var(--p-content-border-color);
}

/* The component name while the CellML text owns it: read-only, with a hint that it's set in the text */
.header-static {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--p-text-color);
  cursor: help;
}

.header-static .pi {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.header-file {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  max-width: 16rem;
  color: var(--p-text-muted-color);
  font-size: 0.9rem;
  font-weight: normal;
}

.header-file .pi {
  flex: 0 0 auto;
  font-size: 0.8125rem;
}

.header-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.editor-wrapper {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.rename-notice {
  margin-bottom: 8px;
}

.rename-notice-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
}

.rename-notice-actions {
  display: flex;
  gap: 4px;
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

.rail-badges {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  margin-bottom: 10px;
}

.rail-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  width: 100%;
  padding: 3px 0;
  border-radius: 6px;
  font-size: var(--dlg-fs-tiny);
  font-weight: 600;
  line-height: 1.1;
  color: var(--p-text-color);
  background-color: color-mix(in srgb, var(--chip-color) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--chip-color) 40%, transparent);
}

.rail-badge .pi {
  font-size: 0.7rem;
  color: var(--chip-color);
}

.collapsed-rail {
  flex: 1;
  display: flex;
  flex-direction: column;
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

/* Matches the right pane's tab bar, so the two panes' headers line up */
.editor-tabs {
  flex-shrink: 0;
  margin-bottom: 12px;
}

.tab-icon {
  margin-right: 6px;
  font-size: var(--dlg-fs-small);
}

/* Parameters tab: row-state stripes reach into ParameterTable via :deep */

.right-pane :deep(.parameter-row--unresolved) {
  background-color: color-mix(in srgb, var(--p-yellow-500, #eab308) 14%, transparent);
}

/* Flat categories: a left-edge stripe only - no indentation, italics, arrows, or adjacency. A row
   is either a state (green) or an initialiser (purple, whether shared or exclusive, computed or
   plain); never both. */
.right-pane :deep(tr.parameter-row--state) {
  box-shadow: inset 3px 0 0 0 var(--p-green-500, #22c55e);
}

.right-pane :deep(tr.parameter-row--initialiser) {
  box-shadow: inset 3px 0 0 0 var(--p-purple-400, #a78bfa);
}

/* Unresolved/missing-value urgency always wins over the state/initialiser stripe colour. */
.right-pane :deep(tr.parameter-row--state.parameter-row--unresolved),
.right-pane :deep(tr.parameter-row--initialiser.parameter-row--unresolved) {
  background-color: color-mix(in srgb, var(--p-yellow-500, #eab308) 14%, transparent);
}

/* Units cell: input plus a small flag when the name needs fixing or isn't in the library */
/* Selection checkboxes: the default is sized for forms, which is large in a dense table */
.right-pane :deep(.parameters-table) {
  --p-checkbox-width: 1rem;
  --p-checkbox-height: 1rem;
  --p-checkbox-icon-size: 0.625rem;
}

/* Ports Tab Styles */
.ports-header {
  margin-bottom: 8px;
  flex-shrink: 0;
}

/* Tints mix with the row's own opaque colour: the frozen delete cell inherits it, and a see-through
   background would show the cells scrolling underneath. */
.right-pane :deep(tr.port-row--invalid) {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 10%, var(--p-datatable-row-background));
}

.right-pane :deep(tr.p-row-odd.port-row--invalid) {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 10%, var(--p-datatable-row-striped-background));
}

/* Above the inputs in the cells scrolling underneath, which set their own stacking order */
.right-pane :deep(.p-datatable-frozen-column) {
  z-index: 2;
  box-shadow: inset 1px 0 0 var(--p-datatable-body-cell-border-color);
}

.add-port-row {
  flex-shrink: 0;
  justify-content: center;
  width: 100%;
  margin-top: 8px;
  border: 1px dashed var(--p-content-border-color);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--p-text-muted-color);
  font-size: var(--dlg-fs-small);
  margin-top: 16px;
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
  font-size: 0.85rem;
}

.footer-buttons {
  display: flex;
  gap: 8px;
}

.editor-pending {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  height: 100%;
  color: var(--p-text-muted-color);
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
</style>

<!-- The variable picker's panel is teleported to <body>, so the scoped styles above can't reach it. -->
<style>
.ports-variable-overlay {
  /* Sized to sit with the ports table (14px text), not the form-sized defaults. */
  --p-multiselect-option-font-size: 0.875rem;
  --p-multiselect-option-padding: 0.3125rem 0.625rem;
  --p-multiselect-option-gap: 0.5rem;
  --p-multiselect-list-padding: 0.25rem;
  --p-multiselect-list-gap: 1px;
  --p-checkbox-width: 1rem;
  --p-checkbox-height: 1rem;
  --p-checkbox-icon-size: 0.625rem;
}

.ports-variable-overlay .p-multiselect-header {
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
}

.ports-variable-overlay .p-multiselect-header .p-inputtext {
  font-size: 0.875rem;
}

/* Search field: search icon left, clear button right (only once there's text), like the other search bars. */
.ports-variable-overlay .p-multiselect-header .p-iconfield .p-inputtext {
  padding-inline: 2rem;
}

.ports-variable-overlay .p-multiselect-header .p-iconfield .p-inputicon {
  /* One container spanning the field, so the two icons can sit at opposite ends. */
  inset-inline: 0.625rem;
  top: 50%;
  margin-top: 0;
  width: auto;
  height: auto;
  transform: translateY(-50%);
  pointer-events: none;
}

.ports-variable-overlay .ports-variable-filter-icons {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 0.875rem;
}

.ports-variable-overlay .search-clear-input {
  pointer-events: auto;
  cursor: pointer;
}

.ports-variable-overlay .search-clear-input:hover {
  color: var(--p-text-color);
}

/* Empty field (its placeholder is showing): nothing to clear. Hidden rather than removed, so nothing shifts. */
.ports-variable-overlay .p-multiselect-header .p-inputtext:placeholder-shown + .p-inputicon .search-clear-input {
  visibility: hidden;
  pointer-events: none;
}
</style>
