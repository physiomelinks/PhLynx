<template>
  <Dialog
    :visible="modelValue"
    modal
    :dismissableMask="false"
    :closeOnEscape="false"
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
            v-if="(isManaged && !isMathLocked) || isDiagramRenamable"
            v-model="editableComponentName"
            :sanitise="sanitiseName"
            :fallback="componentNameForEditor"
            placeholder="Component name..."
            width="200px"
          />
          <span v-else class="header-static" :title="componentNameTitle">
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
      <!-- LEFT COLUMN: CellML Text, Math Editor or a format's own editor -->
      <div class="pane left-pane" :style="leftPaneStyle">
        <Tabs :key="editorTabsKey" :value="editorKind" class="editor-tabs" @update:value="switchEditor">
          <TabList>
            <template v-for="option in editorOptions" :key="option.value">
              <!-- A disabled tab takes no pointer events, so its wrapper shows why. -->
              <span v-if="option.isLocked" v-tooltip.bottom="option.lockedNotice" class="editor-tab-locked">
                <Tab :value="option.value" disabled>
                  <i :class="['pi', option.icon, 'tab-icon']"></i>
                  {{ option.label }}
                </Tab>
              </span>
              <Tab v-else :value="option.value">
                <i :class="['pi', option.icon, 'tab-icon']"></i>
                {{ option.label }}
              </Tab>
            </template>
          </TabList>
        </Tabs>
        <Message v-if="pendingRename && !isMathLocked" class="rename-notice" severity="info" size="small" :closable="false">
          <div class="rename-notice-body">
            <span>
              <strong>{{ pendingRename.from }}</strong> was renamed to <strong>{{ pendingRename.to }}</strong
              >, but is still used in {{ pendingRename.uses }} {{ pendingRename.uses === 1 ? 'place' : 'places' }}.
            </span>
            <span class="rename-notice-actions">
              <Button label="Rename all" size="small" text @click="renameEverywhere" />
              <Button label="Keep both" size="small" text severity="secondary" @click="dismissRename" />
            </span>
          </div>
        </Message>
        <MultiportSummary v-if="isEditorReady" :entries="multiportEntries" />
        <div ref="editorWrapperRef" class="editor-wrapper">
          <div v-if="!isEditorReady" class="editor-pending">
            <ProgressSpinner style="width: 32px; height: 32px" strokeWidth="4" />
            <span>Preparing editor...</span>
          </div>
          <CellMLTextEditor
            v-else-if="editorKind === 'text'"
            ref="mathEditorRef"
            :model-value="shownModel"
            :layout="shownLayout"
            :simple="isMathLocked ? isLockedSimple : isManaged"
            @update:simple="onSimpleToggle"
            :component-name="componentNameForEditor"
            :variable-definitions="editorDefinitions"
            :keep-variables="keptVariables"
            :readonly="isMathLocked"
            @update:component-name="onEditorComponentName"
            @change="handleEditorChange"
            @variable-click="plotClickedVariable"
            @save="handleSave"
            @undo="handleEditorUndo"
            @redo="handleEditorRedo"
          />
          <MathWorkbenchEditor
            v-else-if="editorKind === 'math'"
            ref="mathEditorRef"
            :model-value="shownModel"
            :component-name="componentNameForEditor"
            :variable-definitions="editorDefinitions"
            :keep-variables="keptVariables"
            :readonly="isMathLocked"
            @change="handleEditorChange"
            @variable-click="plotClickedVariable"
            @save="handleSave"
            @undo="handleEditorUndo"
            @redo="handleEditorRedo"
          />
          <CelldlPane
            v-else-if="editorKind === 'celldl'"
            :rows="parameterRows"
            :component-name="componentName"
            :math-ref="diagramPreviewRef"
            @variable-click="plotClickedVariable"
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
          <span class="collapsed-rail-label">{{ rightTabLabel }}</span>
        </button>

        <Tabs v-else v-model:value="activeTab" class="right-pane-tabs">
          <TabList>
            <Tab value="parameters">
              <i class="pi pi-sliders-h tab-icon"></i>
              Parameters ({{ parametersCount }})
            </Tab>
            <Tab value="ports">
              <i class="pi pi-link tab-icon"></i>
              Ports ({{ editablePorts.length }})
            </Tab>
            <Tab value="plot">
              <i class="pi pi-chart-line tab-icon"></i>
              Plot ({{ plottedCount }})
            </Tab>
          </TabList>

          <TabPanels class="tab-panels-container">
            <!-- TAB 1: PARAMETER EDITOR -->
            <TabPanel value="parameters" class="tab-panel-flex">
              <!-- A diagram's elements, whose structure is the diagram's and values this instance's -->
              <CelldlParametersTab
                v-if="isCelldlModule"
                :table="celldlTable"
                :saved-defaults="savedDefaults"
                :is-diagram-shown="isDiagramShown"
                :is-opening="celldlHost.isSyncing.value"
                :connection-status="connectionStatus"
                :ignored-notices="ignoredNotices"
                @set-value="setInstanceValue"
                @show-in-diagram="showInDiagram"
              />
              <ParameterTable
                v-else
                ref="parameterTableRef"
                :rows="parameterRows"
                :is-managed="isManaged"
                :is-missing-units="isMissingUnits"
                :get-units-notice="getUnitsNotice"
                :issue-chips="issueChips"
                :issue-filter="issueFilter"
                :variable-kinds="variableKinds"
                :connection-supplied="connectionSupplied"
                :ignored-notices="ignoredNotices"
                :connection-status="connectionStatus"
                :math-references="mathReferences"
                :suggest-units="suggestUnitsFor"
                :values-only="isMathLocked"
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
                        <div class="flex items-center gap-2">
                          <!-- Whether the port is connected, as the edge dialog shows it -->
                          <span
                            :class="[
                              'port-status',
                              portConnections(slotProps.data).length ? 'port-status--connected' : 'port-status--free',
                            ]"
                            v-tooltip.top="portStatus(slotProps.data)"
                          ></span>
                          <InputText
                            v-model="slotProps.data.label"
                            :invalid="isPortFlagged(slotProps.data) && !slotProps.data.label?.trim()"
                            placeholder="Enter label"
                            size="small"
                            class="w-full"
                          />
                        </div>
                      </template>
                    </Column>

                    <!-- One connection with every variable None, or several with each True, Sum or Multiply -->
                    <Column header="Mode" style="width: 5rem">
                      <template #body="slotProps">
                        <Button
                          text
                          rounded
                          size="small"
                          :severity="isMultiport(slotProps.data) ? undefined : 'secondary'"
                          :aria-pressed="isMultiport(slotProps.data)"
                          aria-label="Multiport"
                          :title="
                            isMultiport(slotProps.data)
                              ? 'Multiport: takes several connections'
                              : 'Basicport: takes one connection'
                          "
                          @click="setMultiport(slotProps.data, !isMultiport(slotProps.data))"
                        >
                          <template #icon>
                            <MultiportIcon v-if="isMultiport(slotProps.data)" />
                            <BasicportIcon v-else />
                          </template>
                        </Button>
                      </template>
                    </Column>

                    <Column header="Variables" style="min-width: 200px">
                      <template #body="slotProps">
                        <PortVariableSelect
                          :port="slotProps.data"
                          :options="parameterRows"
                          :flagged="isPortFlagged(slotProps.data)"
                          class="w-full"
                        />
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
                <div v-if="editablePorts.length" class="ports-key">
                  <span class="port-key-item"><span class="port-status port-status--connected"></span>Connected</span>
                  <span class="port-key-item"><span class="port-status port-status--free"></span>Available</span>
                  <MultiportKey />
                </div>
                <div v-else class="empty-state">
                  <span>No ports defined for this instance.</span>
                  <Button
                    icon="pi pi-plus"
                    label="Add Port"
                    severity="success"
                    size="small"
                    rounded
                    outlined
                    @click="addPort"
                  />
                </div>
              </div>
            </TabPanel>

            <!-- TAB 3: SIMULATE AND PLOT, as the Simulation tab does -->
            <TabPanel value="plot" class="tab-panel-flex plot-tab">
              <Message v-if="hasUnsavedEdits" severity="info" size="small" class="plot-tab-note">
                Runs use the saved instance.
                <Button label="Save to include your edits" link size="small" class="plot-tab-save" @click="handleSave({ keepOpen: true })" />
              </Message>
              <!-- Kept mounted through an Apply's reload, so its choices, such as the whole model, last. -->
              <SimulationPanel
                v-if="activeTab === 'plot'"
                ref="simulationPanelRef"
                v-model:plot-config="editorPlotConfig"
                :instance-id="id"
                :is-unit-filtered="!isAutoUpdate"
                class="plot-tab-workbench"
              >
                <template #toolbar>
                  <label
                    class="plot-tab-auto-label"
                    v-tooltip.bottom="'Click a variable in the math to plot it alone. Off, adding offers only the plot\'s units.'"
                  >
                    <ToggleSwitch
                      v-model="isAutoUpdate"
                      class="plot-tab-auto-switch"
                      aria-label="Auto-update: plot a variable clicked in the math"
                    />
                    <span class="plot-tab-auto-text">Auto-update</span>
                  </label>
                  <span v-if="plotNotice" class="plot-tab-auto-notice" role="status" :title="plotNotice">{{ plotNotice }}</span>
                </template>
              </SimulationPanel>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </div>
    </div>

    <!-- OVERLAY: Resize Warning -->
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
            Widen your browser window to keep editing — the parameter and port panels need a bit more horizontal space
            to display properly.
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

    <ComponentSaveAsDialog
      v-if="saveAs.visible"
      v-model="saveAs.visible"
      :message="saveAs.message"
      :initial-name="saveAs.initialName"
      :file="saveAs.file"
      :is-taken="isComponentNameTaken"
      @confirm="(name) => resolveSaveAs(name)"
      @cancel="resolveSaveAs(null)"
    />

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
          <Button
            label="Apply"
            severity="secondary"
            outlined
            v-tooltip.top="'Save and keep editing'"
            :loading="isConverting"
            @click="handleSave({ keepOpen: true })"
          />
          <Button label="Save" severity="primary" :loading="isConverting" @click="handleSave" />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick, toRaw } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Select from 'primevue/select'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'
import ToggleSwitch from 'primevue/toggleswitch'

import CellMLTextEditor from './CellMLTextEditor.vue'
import MathWorkbenchEditor from './MathWorkbenchEditor.vue'
import ParameterTable from './ParameterTable.vue'
import SimulationPanel from './simulation/SimulationPanel.vue'
import SanitisedInput from './SanitisedInput.vue'
import MultiportKey from './MultiportKey.vue'
import MultiportSummary from './MultiportSummary.vue'
import PortVariableSelect from './PortVariableSelect.vue'
import ComponentSaveAsDialog from './dialogs/ComponentSaveAsDialog.vue'
import CelldlPane from './celldl/CelldlPane.vue'
import CelldlParametersTab from './celldl/CelldlParametersTab.vue'
import MultiportIcon from './icons/MultiportIcon.vue'
import BasicportIcon from './icons/BasicportIcon.vue'

import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { useIssueFilter } from '../composables/useIssueFilter'
import { createHistory } from '../stores/historyStore'
import { useGtm } from '../composables/useGtm'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useMathSession } from '../composables/useMathSession'
import { useAppSettings } from '../composables/useAppSettings'
import { useCelldlEditorHost } from '../composables/useCelldlEditorHost'
import { useEditorCloseGuard } from '../composables/useEditorCloseGuard'
import { useLiveCelldlConvert } from '../composables/useLiveCelldlConvert'

import { isInitialisable } from '../services/math/variableKinds'
import { resolveBoundaryValues, storeOptions } from '../services/export/boundaryValues'
import { confirmDrivenStores } from '../services/export/drivenStores'
import {
  createSinglePlotConfig,
  getNodePlotEntries,
  renamePlotVariables,
  replacePlotSelections,
  resolvePlotConfig,
} from '../services/simulation/plotSelections'

import { isEmpty, isNumericLiteral, syncInitialiserUnits } from '../utils/variables'
import { getUnknownUnitsNotice, isValueMissing } from '../utils/parameterRows'
import {
  NEW_MODULE_MATH_REF,
  PORT_TYPE_OPTIONS,
  PROTECTED_MATH_REFS,
  USER_MODULES_FILE,
} from '../utils/constants'
import {
  diagramSaveRef,
  findInGrouping,
  groupingUnitsAfterSave,
  isSameName,
  newComponentGrouping,
} from '../services/userModules'
import { cleanName, sanitiseName } from '../utils/identifiers'
import { detachReactivity } from '../utils/reactivity'
import { waitUntilStable } from '../utils/layout'
import { notify } from '../utils/notify'
import { areModelsEquivalent, getModelComponentNames, renameLayoutComponent, renameModelComponent } from '../utils/cellml'
import { areUnitsModelsEquivalent, mergeUnitDefinitions } from '../utils/units'
import { separateParameters } from '../services/math/separateParameters'
import { getEditorTabFormats, getModuleFormat } from '../services/moduleFormats'
import { issueItems } from '../services/celldl/issues'
import { buildElementTable, variableRenames } from '../services/celldl/elementTable'
import { renamePortVariables, renameRows, renameValues } from '../services/math/reconcileRows'
import { liveComponentMath } from '../services/celldl/liveMath'
import { sectionLayout } from '../services/celldl/sectionLayout'
import { analyzeMathXml } from '../services/math/analyzeMath'
import {
  declaredUnits,
  findUnitRescales,
  formatFactor,
  isIdentityFactor,
  rescaleRows,
  rescaleValues,
  withInitialiserRescales,
} from '../services/math/unitRescale'
import { findPort } from '../utils/ports'
import { previewCouplings } from '../utils/edges'
import {
  isMultiport,
  multiplyVariables,
  multiportSummary,
  setMultiport,
  variableFactor,
} from '../utils/multiport'
import { suggestUnits } from '../utils/unitExpression'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  id: { type: String, required: true },
  initialName: { type: String, default: '' },
  mathRef: { type: String, required: true },
  variables: { type: Array, default: () => [] },
  initialPorts: { type: Array, default: () => [] },
  existingNames: { type: Array, default: () => [] },
  defaultTab: { type: String, default: 'parameters' }, // 'parameters', 'ports' or 'plot'
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const store = useLibraryStore()
const simulationSettingsStore = useSimulationSettingsStore()
const history = reactive(createHistory())

const { trackEvent } = useGtm()
const { nodes, edges } = useVueFlow()
const { confirm, alert, choose } = useConfirmDialog()
const { settings: appSettings } = useAppSettings()

/** Each units name's expansion beside its suggestion, in the units the user chose in Settings. */
const unitExpansions = computed(() =>
  appSettings.unitDisplay === 'base' ? store.unitExpansions : store.builtInUnitExpansions
)

/**
 * Library units that could complete the typed units; a units expression (e.g. `mV/ms`) also offers a new units, and a
 * new name (e.g. `number_of_sharks`) a new base units.
 */
function suggestUnitsFor(typed) {
  const library = {
    names: store.availableUnitNames,
    definitions: store.unitDefinitions,
    expansions: store.unitExpansions,
    baseUnits: store.generatedBaseUnits,
  }
  const options = { details: unitExpansions.value, builtIn: appSettings.unitDisplay !== 'base' }
  return suggestUnits(typed, library, options).map(({ create, ...item }) =>
    create ? { ...item, onPick: () => store.addGeneratedUnits(create) } : item
  )
}

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
/** A class on the dialog's mask, so the close guard knows it from other dialogs' masks. */
const EDITOR_MASK_CLASS = 'module-editor-mask'
const DIALOG_PT = {
  // Clicks on it and Escape are guarded (useEditorCloseGuard).
  mask: { class: EDITOR_MASK_CLASS },
  transition: {
    onAfterEnter: () => {
      isDialogShown.value = true
    },
  },
}

// Port & Instance State
const editableName = ref('')
const editablePorts = ref([])
// The plotted variables' names as the math session renames them, so a save can rename the plots.
const trackedNames = ref([])
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
const session = useMathSession({
  history,
  editorRef: mathEditorRef,
  ports: editablePorts,
  plotVariables: trackedNames,
  beforeInit: () => signEditorState() === savedEditorState.value,
  onInit: rebaselineEditorState,
  isLocked: () => isMathLocked.value,
})
const {
  isManaged,
  currentModel,
  currentLayout,
  parameterRows,
  editorDefinitions,
  keptVariables,
  variableKinds,
  connectionSupplied,
  mathReferences,
  pendingRename,
  isMissingUnits,
  handleEditorChange,
  renameEverywhere,
  dismissRename,
} = session

// ── Module Format ───────────────────────────────────────────────────────────
// A module keeps the format its math is stored in. The template starts in none: the first editor the user changes
// decides, until the edits are undone, and Save As fixes it.
const isTemplate = computed(() => props.mathRef === NEW_MODULE_MATH_REF)
const storedFormat = computed(() => getModuleFormat(store.getMathFormat(props.mathRef)))

// The CellDL editor, which a module's diagram opens in when its tab shows. Escape there is the editor's,
// e.g. to drop a path being drawn, so it doesn't close the dialog.
const celldlHost = useCelldlEditorHost()

/** Whether the math differs from what was loaded, valid or not. */
const isMathEdited = computed(() => session.isDirty() || session.isLayoutDirty() || session.hasUnsavedInvalidEdit())

// A diagram saved from the template stays chosen until the dialog reloads on its new module, though the math it
// generated now differs from the template's.
const isDiagramSaved = ref(false)

/** The format the template's edits chose: CellDL once a diagram is drawn, CellML once its math is edited. */
const chosenFormat = computed(() => {
  if (!isTemplate.value || loading.value) return null
  if (celldlHost.isDirty.value || isDiagramSaved.value) return getModuleFormat('celldl')
  return isMathEdited.value ? storedFormat.value : null
})

/** The format the math is authored in (see services/moduleFormats). */
const moduleFormat = computed(() => chosenFormat.value ?? storedFormat.value)
/** Whether the math is generated from a source, so only its values can be edited here. */
const isMathLocked = computed(() => moduleFormat.value.isMathLocked)
/** Whether the format is settled, so editors for other formats' sources are locked. */
const isSourceLocked = computed(() => !isTemplate.value || chosenFormat.value !== null)

const isDiagramEditable = computed(() => isEditorOffered('celldl'))
/**
 * Whether the component name field names a diagram's module: renamed, a save makes a new module for this instance,
 * as a renamed CellML component does. The template is always saved as a new component.
 */
const isDiagramRenamable = computed(
  () => isDiagramEditable.value && isMathLocked.value && !isTemplate.value && moduleFormat.value.id === 'celldl'
)
/** Whether the diagram has edits, which a run doesn't see either. */
const isDiagramDirty = computed(() => isDiagramEditable.value && celldlHost.isDirty.value)

const componentNameTitle = computed(() =>
  isMathLocked.value
    ? `The ${moduleFormat.value.label} source sets the component name.`
    : 'While Simple Mode is off, the text sets the component name (def comp ... as).'
)

// ── Editor Choice ───────────────────────────────────────────────────────────
const EDITOR_STORAGE_KEY = 'instanceEditorDialog.editorKind'
const MATH_EDITOR_OPTIONS = [
  { value: 'text', label: 'CellML Text', icon: 'pi-code', errorHeader: 'CellML Text Has Errors' },
  { value: 'math', label: 'Math Editor', icon: 'pi-calculator', errorHeader: 'Math Has Errors' },
]
const MATH_EDITOR_KINDS = new Set(MATH_EDITOR_OPTIONS.map((option) => option.value))

/**
 * The editor tabs: the math editors, then each available format's own editor, locked once the math is in another
 * format.
 */
const editorOptions = computed(() => [
  ...MATH_EDITOR_OPTIONS,
  ...getEditorTabFormats().map((format) => ({
    ...format.editorTab,
    isLocked: isSourceLocked.value && format.id !== moduleFormat.value.id,
    lockedNotice: isTemplate.value ? format.editorTab.editedNotice : format.editorTab.lockedNotice,
  })),
])

/** Whether an editor can be chosen for this math. */
const isEditorOffered = (kind) => editorOptions.value.some((option) => option.value === kind && !option.isLocked)

/**
 * Gets the editor last chosen, if this math offers it.
 *
 * @returns {string}
 */
function loadStoredEditorKind() {
  try {
    const stored = window.localStorage.getItem(EDITOR_STORAGE_KEY)
    if (isEditorOffered(stored)) return stored
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) - fall back to default
  }
  return 'text'
}

const editorKind = ref(loadStoredEditorKind())
// Tabs keeps its own selection, so a cancelled switch remounts it to show the current editor.
const editorTabsKey = ref(0)

// A tab locked while shown, e.g. the template's diagram once a Parameters edit makes it CellML, gives way.
watch(
  () => !loading.value && !isEditorOffered(editorKind.value),
  (isLocked) => {
    if (isLocked) editorKind.value = loadStoredEditorKind()
  }
)

// The diagram's live conversion, which the math editors show while the diagram has unsaved edits. Locked math
// ignores what they report, so the session keeps the saved math.
const liveConvert = useLiveCelldlConvert()

// ── CellDL Parameters ───────────────────────────────────────────────────────
/**
 * Whether the Parameters tab shows the diagram's elements: for a module drawn in CellDL, and for the template
 * while its diagram is shown and no format is chosen yet, where this build can edit diagrams.
 */
const isCelldlModule = computed(
  () =>
    isDiagramEditable.value &&
    (moduleFormat.value.id === 'celldl' || (isTemplate.value && chosenFormat.value === null && editorKind.value === 'celldl'))
)

/** Whether the diagram shows, so the editor can change it. */
const isDiagramShown = computed(
  () =>
    editorKind.value === 'celldl' &&
    celldlHost.isActive.value &&
    !celldlHost.isSyncing.value &&
    !celldlHost.error.value
)

/** The module's values as saved: the defaults its instances' rows follow. */
const savedDefaults = computed(() => store.getMathDefaults(props.mathRef))

/**
 * Values typed for variables an unsaved diagram edit adds, which have no row until the diagram is saved, by name.
 * The save gives them to the rows it makes.
 */
const pendingValues = ref(new Map())

/** The instance's rows, with the pending values as rows of their own. */
const celldlRows = computed(() => {
  const rows = parameterRows.value
  const names = new Set(rows.map((row) => row.name))
  const pending = [...pendingValues.value]
    .filter(([name]) => !names.has(name))
    .map(([name, value]) => ({ name, value, units: '', type: 'constant', pending: true }))
  return [...rows, ...pending]
})

/**
 * The element manifest for the diagram as it is, from the live conversion once it has caught up; null until then.
 * Names are read from the last one, or the saved diagram's, meanwhile.
 */
const liveManifest = computed(() => {
  const elements = liveConvert.result.value?.elements
  return !liveConvert.isPending.value && elements && Object.keys(elements).length ? elements : null
})
const namesManifest = computed(() => {
  const elements = liveConvert.result.value?.elements
  if (elements && Object.keys(elements).length) return elements
  return store.getMathSource(props.mathRef)?.elements ?? null
})

/**
 * The variables the diagram's unsaved edits renamed, e.g. `K_q_S_c` to `K_q_Sub_c` for a new species, whose values
 * this instance's rows hold under their old names until the save renames them.
 */
const celldlRenames = computed(() => variableRenames(store.getMathSource(props.mathRef)?.elements ?? null, namesManifest.value))

const celldlTable = computed(() =>
  buildElementTable({
    elements: celldlHost.elements.value,
    manifest: liveManifest.value,
    namesManifest: namesManifest.value,
    rows: celldlRows.value,
    savedDefaults: savedDefaults.value,
    savedManifest: store.getMathSource(props.mathRef)?.elements ?? null,
    renames: celldlRenames.value,
    supplied: connectionSuppliedNames.value,
  })
)

// The editor lists a diagram's elements as it opens and as it changes; one it holds without either, e.g. drawn
// before the tab showed, is listed once the table needs it.
watch(
  () => isCelldlModule.value && isDiagramShown.value && activeTab.value === 'parameters' && !celldlHost.elements.value.length,
  (isNeeded) => {
    if (isNeeded) celldlHost.listElements().catch((e) => console.error("CellDL diagram's elements couldn't be listed:", e))
  },
  { immediate: true }
)

/**
 * Sets this instance's value of a diagram element's variable: in its row, or, for a variable the diagram has yet to
 * be saved with, kept until the save makes its row. A blank value follows the diagram's.
 *
 * @param {{name: string|null, row: Object|null}} cell - A value cell (services/celldl/elementTable).
 * @param {string} value
 */
function setInstanceValue(cell, value) {
  if (!cell.name) return
  const row = parameterRows.value.find((candidate) => candidate.name === cell.name)
  if (row) {
    row.value = value
    return
  }
  const next = new Map(pendingValues.value)
  // A blank value for a renamed variable is kept, so the value its old name held doesn't come back.
  const isRenamed = [...celldlRenames.value.values()].includes(cell.name)
  if (value === '' && !isRenamed) next.delete(cell.name)
  else next.set(cell.name, value)
  pendingValues.value = next
}

/**
 * Shows the diagram in the CellDL tab, then selects an element in it.
 *
 * @param {string|null} id
 */
async function showInDiagram(id) {
  if (!id) return switchEditor('celldl')
  if (!(await openDiagram())) return
  celldlHost.selectElement(id, 'if-hidden').catch(() => {})
}

/**
 * Shows the diagram in the CellDL tab, then takes the user to the element an issue names, centring it at the same
 * zoom, or says it has gone since.
 *
 * @param {{elementId: string, label: string}} issue
 */
async function showIssueInDiagram({ elementId, label }) {
  if (!(await openDiagram())) return
  try {
    const { ok } = await celldlHost.revealElement(elementId)
    if (!ok) notify.info({ message: `${label} is no longer in the diagram.`, duration: 3000 })
  } catch (e) {
    console.error("CellDL element couldn't be shown:", e)
  }
}

/**
 * Switches to the CellDL tab, waiting for it to show its diagram.
 *
 * @returns {Promise<boolean>} Whether it shows the diagram.
 */
async function openDiagram() {
  await switchEditor('celldl')
  await new Promise((resolve) => {
    const stop = watch(
      isDiagramShown,
      (isShown) => {
        if (!isShown) return
        queueMicrotask(() => stop())
        resolve()
      },
      { immediate: true }
    )
    setTimeout(() => {
      stop()
      resolve()
    }, 10000)
  })
  return isDiagramShown.value
}

/** The live conversion's math, read only for a math editor shown over an edited diagram; null otherwise. */
const liveMath = computed(() => {
  if (!isMathLocked.value || !isDiagramDirty.value || !MATH_EDITOR_KINDS.has(editorKind.value)) return null
  const conversion = liveConvert.cellml.value
  return conversion && liveComponentMath(conversion.cellml, conversion.componentName)
})

/** The math the math editors show: the live conversion's, or else the session's. */
const shownModel = computed(() => liveMath.value || currentModel.value)

/** The text layout of the math shown: the live math's sections, or else the session's. */
const shownLayout = computed(() => {
  if (!liveMath.value) return currentLayout.value
  const conversion = liveConvert.cellml.value
  return sectionLayout(liveMath.value, conversion.componentName, conversion.sections)
})

// A mounted editor follows the live math, and goes back to the session's once the diagram is saved.
watch(liveMath, () => {
  if (!MATH_EDITOR_KINDS.has(editorKind.value)) return
  mathEditorRef.value?.setModel?.(shownModel.value, shownLayout.value)
})

/**
 * Gets the mounted editor's errors. Locked math ignores its editor, so none of them can be saved.
 *
 * @returns {Array}
 */
function getEditorErrors() {
  if (isMathLocked.value) return []
  return mathEditorRef.value?.getErrors?.() ?? []
}

/**
 * Swaps the math editor, keeping the session. The Math Editor works in Simple Mode, unless the math is
 * locked, where the table can't rewrite it.
 *
 * @param {string} kind - An editor option's value.
 */
async function switchEditor(kind) {
  if (kind === editorKind.value || !isEditorOffered(kind)) return
  await session.flushPendingChanges()

  if (getEditorErrors().length > 0) {
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

  if (kind === 'math' && !isMathLocked.value) isManaged.value = true
  editorKind.value = kind
  // Only a math editor is remembered: a format's own editor opens with its math anyway.
  if (!MATH_EDITOR_OPTIONS.some((option) => option.value === kind)) return
  try {
    window.localStorage.setItem(EDITOR_STORAGE_KEY, kind)
  } catch (e) {
    // ignore storage errors
  }
}

// ── Simple Mode preference ──────────────────────────────────────────────────
// One app-wide choice, the last one the user made; it is never saved with the workspace.
const MANAGED_STORAGE_KEY = 'instanceEditorDialog.simpleMode'

/** Whether locked math, which is never managed, is shown in Simple Mode: only how it reads, as it can't be edited. */
const isLockedSimple = ref(loadStoredManaged())

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
  if (isMathLocked.value) isLockedSimple.value = simple
  else isManaged.value = simple
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
const MIN_REQUIRED_WIDTH = 1000

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

const widthProgressPercent = computed(() => Math.min(100, Math.round((currentWidth.value / MIN_REQUIRED_WIDTH) * 100)))

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

/**
 * Where this instance's rows get their values, from resolveBoundaryValues, using the rows and complete ports as
 * edited here against the rest of the canvas. Couplings are previewed as save would recompute them.
 */
const connection = computed(() => {
  const rows = parameterRows.value
  const ports = editablePorts.value.filter((port) => !isBlankPort(port) && !isIncompletePort(port))
  const canvasNodes = (nodes.value ?? []).map((node) =>
    node.id === props.id ? { ...node, data: { ...node.data, variables: rows, ports } } : node
  )
  const couplings = previewCouplings(props.id, ports, canvasNodes, edges.value ?? [])
  const canvasEdges = (edges.value ?? []).map((edge) =>
    couplings.has(edge.id) ? { ...edge, data: { ...edge.data, couplings: couplings.get(edge.id) } } : edge
  )
  let resolved
  try {
    // The store analyses the saved math, while this instance's rows already follow the math as edited.
    const savedAnalysis = (mathRef) => (mathRef === props.mathRef ? null : (store.getMathAnalysis?.(mathRef) ?? null))
    resolved = resolveBoundaryValues(canvasNodes, canvasEdges, savedAnalysis, storeOptions(store))
  } catch {
    return { status: new Map(), ignored: new Set(), emptySums: new Set() } // a malformed multiport, which export reports
  }
  return {
    status: resolved.status.get(props.id) ?? new Map(),
    ignored: resolved.ignored.get(props.id) ?? new Set(),
    emptySums: resolved.emptySums.get(props.id) ?? new Set(),
  }
})

/** Each row name to where its value comes from (see resolveBoundaryValues' `status`). */
const connectionStatus = computed(() => connection.value.status)

/**
 * The rows a connection supplies, the initial values of stores it drives, or Sums nothing is connected to (so 0), which
 * need no value of their own.
 */
const connectionSuppliedNames = computed(() => {
  const { status, emptySums } = connection.value
  const supplied = [...status].filter(([, { state }]) => state === 'connected' || state === 'drivenInitial')
  return new Set([...supplied.map(([name]) => name), ...emptySums])
})

/** Each row whose value export ignores, as something else supplies its variable, with why. */
const ignoredNotices = computed(() => {
  const { ignored, emptySums, status } = connection.value
  // A driven store's initial value is unused, blank or not.
  const drivenInitials = [...status].filter(([, { state }]) => state === 'drivenInitial').map(([name]) => name)
  return new Map(
    [...new Set([...ignored, ...drivenInitials])].map((name) => {
      if (emptySums.has(name)) return [name, 'Sums its connections, and none are connected: it is 0, and this value is ignored on export']
      const from = status.get(name)?.from ?? []
      if (status.get(name)?.state === 'drivenInitial') {
        return [name, `Its store is set by ${from.join(', ') || 'a connection'}, so this initial value is ignored`]
      }
      return [name, `Set by ${from.length ? from.join(', ') : 'a connection'}: this value is ignored on export`]
    })
  )
})

const ISSUE_MATCHERS = {
  units: (row) => isMissingUnits(row),
  values: (row) => isValueMissing(row),
  unknown: (row) => !!getUnitsNotice(row),
  initialiser: hasTimeVaryingInitialiser,
  ignored: (row) => ignoredNotices.value.has(row.name),
  unconnected: (row) => connectionStatus.value.get(row.name)?.state === 'missing',
}

/** The CellDL tab's issues, as chips for the collapsed rail. */
const celldlIssueChips = computed(() => {
  const { unsetCount, clashCount } = celldlTable.value
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  return [
    unsetCount && { key: 'unset', kind: 'units', icon: 'pi-exclamation-circle', count: unsetCount, label: `${plural(unsetCount, 'row')} to set` },
    clashCount && { key: 'clash', kind: 'units', icon: 'pi-clone', count: clashCount, label: `${plural(clashCount, 'name')} clashing` },
  ].filter(Boolean)
})

const issueChips = computed(() => {
  if (isCelldlModule.value) return celldlIssueChips.value
  const rows = parameterRows.value
  const count = (fn) => rows.filter(fn).length
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

  const missingUnits = count(ISSUE_MATCHERS.units)
  const missingValues = count(ISSUE_MATCHERS.values)
  const unknownUnits = count(ISSUE_MATCHERS.unknown)
  const timeVaryingInitialisers = count(ISSUE_MATCHERS.initialiser)
  const ignoredValues = count(ISSUE_MATCHERS.ignored)
  const unconnected = count(ISSUE_MATCHERS.unconnected)

  const chips = []
  if (missingUnits) {
    chips.push({
      key: 'units',
      kind: 'units',
      icon: 'pi-exclamation-circle',
      count: missingUnits,
      label: `${plural(missingUnits, 'variable')} missing units`,
    })
  }
  if (missingValues) {
    chips.push({
      key: 'values',
      kind: 'units',
      icon: 'pi-sliders-h',
      count: missingValues,
      label: `${plural(missingValues, 'value')} required`,
    })
  }
  if (unconnected) {
    chips.push({
      key: 'unconnected',
      kind: 'units',
      icon: 'pi-exclamation-triangle',
      count: unconnected,
      label: `${plural(unconnected, 'boundary condition')} not connected`,
    })
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
  if (ignoredValues) {
    chips.push({
      key: 'ignored',
      kind: 'unknown',
      icon: 'pi-link',
      count: ignoredValues,
      label: `${plural(ignoredValues, 'value')} ignored on export`,
    })
  }
  if (unknownUnits) {
    chips.push({
      key: 'unknown',
      kind: 'unknown',
      icon: 'pi-info-circle',
      count: unknownUnits,
      label: `${plural(unknownUnits, 'unit')} not in library`,
    })
  }
  return chips
})

// ── "Show only" filter ───────────────────────────────────────────────────────
const issueFilter = useIssueFilter({
  rows: parameterRows,
  matchers: ISSUE_MATCHERS,
  availableKeys: computed(() => issueChips.value.map((chip) => chip.key)),
})

// The Plot tab's own single plot, made afresh on each open and never saved.
const editorPlotConfig = ref(createSinglePlotConfig())
// Whether clicking a variable in the math plots it.
const isAutoUpdate = ref(true)
const simulationPanelRef = ref(null)
// Says why a clicked variable wasn't plotted.
const plotNotice = ref('')
let plotNoticeTimer = null

/** How many variables the Plot tab's plot shows. */
const plottedCount = computed(() => editorPlotConfig.value.selections?.length ?? 0)

/**
 * Gets the names of the instance's variables the Plot tab's plot shows or plots against.
 *
 * @returns {Array<string>}
 */
function getEditorPlotNames() {
  const axisNames = (editorPlotConfig.value.groups ?? [])
    .map((group) => group.xAxis)
    .filter((xAxis) => xAxis?.nodeId === props.id)
    .map((xAxis) => xAxis.variableName)
  return [...getNodePlotEntries(editorPlotConfig.value, props.id).map(({ name }) => name), ...axisNames]
}

// Variables joining the Plot tab's plot are followed through the math's renames too, so an Apply keeps them.
watch(getEditorPlotNames, (names) => {
  const tracked = new Set(trackedNames.value.map(({ savedName }) => savedName))
  const added = [...new Set(names)].filter((name) => !tracked.has(name))
  if (added.length) trackedNames.value = [...trackedNames.value, ...added.map((name) => ({ name, savedName: name }))]
})

/**
 * Gives a plot under the names a save gave the instance's variables, without those it no longer has.
 *
 * @param {Object} plotConfig
 * @returns {Object}
 */
function followSavedNames(plotConfig) {
  const renamed = new Map(trackedNames.value.map(({ savedName, name }) => [savedName, name]))
  return resolvePlotConfig(renamePlotVariables(plotConfig, props.id, renamed), nodes.value)
}

/**
 * Shows a note beside the Auto-update switch for a few seconds.
 *
 * @param {string} text
 */
function showPlotNotice(text) {
  plotNotice.value = text
  clearTimeout(plotNoticeTimer)
  plotNoticeTimer = setTimeout(() => (plotNotice.value = ''), 5000)
}

/**
 * Plots a variable clicked in the math alone, while the Plot tab shows and auto-updates, running the model when
 * no results of its scope are shown. Runs use the saved instance, so only its variables can be plotted.
 *
 * @param {string} name
 * @param {Object} [options]
 * @param {boolean} [options.isUnsaved] - The variable is a diagram element's that the math doesn't have until saved.
 */
function plotClickedVariable(name, { isUnsaved = false } = {}) {
  if (activeTab.value !== 'plot' || rightCollapsed.value || !isAutoUpdate.value) return
  const node = nodes.value.find((candidate) => candidate.id === props.id)
  const row = node?.data?.variables?.find((candidate) => candidate.name === name)
  if (!row) {
    const isMathVariable = parameterRows.value.some((candidate) => candidate.name === name)
    if (isUnsaved || isMathVariable) showPlotNotice(`Save to plot ${name}`)
    return
  }
  plotNotice.value = ''
  editorPlotConfig.value = replacePlotSelections(editorPlotConfig.value, node, row)
  simulationPanelRef.value?.ensureResults()
}

/**
 * Signs what a run reads from the instance besides its math: its name, rows and ports.
 *
 * @returns {string}
 */
const signEditorState = () =>
  JSON.stringify({
    name: editableName.value,
    rows: parameterRows.value.map(({ name, value, type, units, initialiser }) => ({ name, value, type, units, initialiser })),
    ports: editablePorts.value,
  })
// The signature as loaded, so edits to values, the name or the ports count as unsaved.
const savedEditorState = ref('')

/**
 * Moves the baseline to the state once the editor's first view of the math is applied, so anything
 * that view changes in the rows or ports (e.g. a variable it no longer declares) never shows as an
 * unsaved edit on open. The load sets the baseline first, in case no editor mounts. An edit made before the
 * editor mounted keeps the old baseline, so it still counts as unsaved.
 *
 * @param {boolean} [wasUnchanged=true] - Whether the state still matched the baseline just before that view.
 */
function rebaselineEditorState(wasUnchanged = true) {
  if (!loading.value && wasUnchanged) savedEditorState.value = signEditorState()
}

// Edits a run wouldn't see, since runs use the saved instance.
const hasUnsavedEdits = computed(
  () =>
    !loading.value &&
    (session.isDirty() ||
      session.isLayoutDirty() ||
      session.hasUnsavedInvalidEdit() ||
      isDiagramDirty.value ||
      signEditorState() !== savedEditorState.value)
)

/** How many rows the Parameters tab has: a diagram's elements and constants, or the math's variables. */
const parametersCount = computed(() =>
  isCelldlModule.value
    ? celldlTable.value.sections.reduce((count, section) => count + section.rows.length, 0)
    : parameterRows.value.length
)

/** The active right-hand tab's name and count, shown on the collapsed rail. */
const rightTabLabel = computed(() => {
  if (activeTab.value === 'ports') return `Ports (${editablePorts.value.length})`
  if (activeTab.value === 'plot') return `Plot (${plottedCount.value})`
  return `Parameters (${parametersCount.value})`
})

// Screen readers get the same information the badges show.
const railAriaLabel = computed(() => {
  const summary = activeTab.value === 'parameters' ? issueChips.value.map((chip) => chip.label).join(', ') : ''
  return summary ? `Expand panel. ${rightTabLabel.value}. ${summary}` : `Expand panel. ${rightTabLabel.value}`
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
      clearTimeout(plotNoticeTimer)
      plotNotice.value = ''
      isEditorReady.value = false
      isDialogShown.value = false
      history.clear()
      reloadAfterSave = false
      return
    }
    editorPlotConfig.value = createSinglePlotConfig()
    isAutoUpdate.value = true
    await loadEditor()
  }
)

// A save that keeps the editor open reloads it from the saved instance, once the workspace has it.
let reloadAfterSave = false
watch(
  () => [props.mathRef, props.variables, props.initialName, props.initialPorts],
  () => {
    if (!reloadAfterSave || !props.modelValue) return
    reloadAfterSave = false
    loadEditor({ keepTab: true })
  }
)

/**
 * Loads the instance into the editor, as it opens or after a save that keeps it open.
 *
 * @param {{keepTab?: boolean}} [options] - Stay on the tab shown, rather than the one it opens on.
 */
async function loadEditor({ keepTab = false } = {}) {
  const requestId = ++openRequestId
  history.clear()
  loading.value = true
  isDiagramSaved.value = false
  isEditorReady.value = false
  applyToAll.value = false
  nameError.value = ''
  rejectedName = ''
  flaggedPorts.value = new Set()
  if (!keepTab) activeTab.value = props.defaultTab
  // A format with its own editor opens on it, where this build offers it; another math's editor is locked.
  const formatEditor = isEditorOffered(moduleFormat.value.editorTab?.value) ? moduleFormat.value.editorTab.value : null
  if (formatEditor && !keepTab) editorKind.value = formatEditor
  else if (!isEditorOffered(editorKind.value)) {
    editorKind.value = formatEditor ?? loadStoredEditorKind()
  }
  issueFilter.reset()
  pendingValues.value = new Map()
  // The diagram opens as the tab first shows, so a dialog that never shows it never loads the editor.
  if (isDiagramEditable.value) celldlHost.prepare(store.getMathSource(props.mathRef))

  editableName.value = props.initialName
  editableComponentName.value = componentName.value
  componentNameForEditor.value = componentName.value
  editablePorts.value = detachReactivity(props.initialPorts || []).map((port) => ({
    ...port,
    variables: Array.isArray(port.variables)
      ? port.variables.map((v) => (typeof v === 'object' && v !== null ? v.name : v))
      : [],
  }))
  indexPortConnections()
  if (keepTab) editorPlotConfig.value = followSavedNames(editorPlotConfig.value)
  // What the instance plots, so a rename in the math reaches its plots. Only these: tracking every name could
  // see a rename onto a removed variable's name merged away (see useMathSession).
  const plottedNames = [...getNodePlotEntries(simulationSettingsStore.plotConfig, props.id).map(({ name }) => name), ...getEditorPlotNames()]
  trackedNames.value = [...new Set(plottedNames)].map((name) => ({ name, savedName: name }))

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
      // Locked math is shown as stored, never rebuilt from the table.
      managed: !isMathLocked.value && (loadStoredManaged() || editorKind.value === 'math'),
    })
    isLockedSimple.value = loadStoredManaged()
  } catch (e) {
    console.error('Failed to load CellML source', e)
  }
  if (requestId !== openRequestId) return

  savedEditorState.value = signEditorState()
  loading.value = false
  await nextTick()
  // rAF runs before the next paint; the timeout lands after it, so the table is on screen first.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  // The editor measures its glyphs when it mounts, so it waits out the dialog's opening scale.
  await waitUntilStable(editorWrapperRef.value, 400)
  if (requestId === openRequestId && props.modelValue) isEditorReady.value = true
}

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
 * Checks whether a port has a Multiply variable with no factor entered.
 *
 * @param {Object} port
 * @returns {boolean}
 */
function isMissingFactor(port) {
  return multiplyVariables(port).some((name) => isEmpty(variableFactor(port, name)))
}

const isPortFlagged = (port) => flaggedPorts.value.has(port)

// The modules each port is connected to, read from the canvas edges when the editor opens.
const connectionsByPort = new WeakMap()
// Each editable port's saved self, which the canvas edges hold.
const originalByPort = new WeakMap()

const nameOf = (id) => nodes.value.find((node) => node.id === id)?.data.name ?? id

/** Records, for each editable port, its saved self and the names of the modules its couplings reach. */
function indexPortConnections() {
  editablePorts.value.forEach((port, i) => {
    const original = props.initialPorts[i]
    originalByPort.set(toRaw(port), original)
    const names = edges.value.flatMap((edge) =>
      (edge.data?.couplings ?? []).flatMap(({ sourcePort, targetPort }) => {
        const own = edge.source === props.id ? sourcePort : edge.target === props.id ? targetPort : null
        return own && findPort([original], own) ? [nameOf(edge.source === props.id ? edge.target : edge.source)] : []
      })
    )
    connectionsByPort.set(toRaw(port), names)
  })
}

/** The math export builds for this instance's Sum and Multiply variables, as the ports are edited. */
const multiportEntries = computed(() =>
  multiportSummary(props.id, edges.value ?? [], {
    nameOf,
    ownPorts: editablePorts.value.map((current) => ({ original: originalByPort.get(toRaw(current)), current })),
  })
)

const portConnections = (port) => connectionsByPort.get(toRaw(port)) ?? []

const portStatus = (port) => {
  const names = portConnections(port)
  return names.length ? `Connected to ${names.join(', ')}` : 'Not connected'
}

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

/**
 * Whether the instance has edits Cancel asks before discarding. Plots and sliders apply as they change, so only the
 * instance's own edits count.
 *
 * @returns {boolean}
 */
function hasDiscardableEdits() {
  return session.hasUnsavedInvalidEdit() || session.isDirty() || session.isLayoutDirty() || isDiagramDirty.value
}

/** Commits any rename and editor change still in flight, so an edit typed just before closing counts. */
async function flushEdits() {
  parameterTableRef.value?.flushPendingRenames()
  await session.flushPendingChanges()
}

/** Closes the editor on a click outside it, unless that would discard edits. */
async function closeOnOutsideClick() {
  if (loading.value) return
  await flushEdits()
  // Any edit at all keeps the editor open, the instance's name and ports included.
  if (hasUnsavedEdits.value || hasDiscardableEdits()) {
    notify.info({ message: 'Save or cancel your edits to close the editor.', duration: 2500 })
    return
  }
  emit('update:modelValue', false)
}

useEditorCloseGuard({
  isOpen: () => props.modelValue,
  maskClass: EDITOR_MASK_CLASS,
  // Escape in the CellDL editor is its own, e.g. to drop a path being drawn.
  ownsEscape: () => celldlHost.isEngaged.value,
  onOutsideClick: closeOnOutsideClick,
  onEscape: handleCancel,
})

const onDialogVisibleChange = (visible) => {
  if (visible) {
    emit('update:modelValue', true)
  } else {
    handleCancel()
  }
}

async function handleCancel() {
  await flushEdits()
  if (hasDiscardableEdits()) {
    // Keeping the edits is the default, so a stray Enter or click doesn't lose them.
    const confirmed = await confirm({
      header: 'Unsaved Changes',
      message: 'Are you sure you want to discard changes?',
      severity: 'warning',
      acceptLabel: 'Discard & Close',
      rejectLabel: 'Keep Editing',
      isRejectDefault: true,
    })
    if (!confirmed) return
  }
  emit('update:modelValue', false)
}

// ── Save As ──────────────────────────────────────────────────────────────────
const saveAs = ref({ visible: false, message: '', initialName: '', file: USER_MODULES_FILE })
let saveAsResolver = null

/**
 * Checks whether a component name is a template's (PROTECTED_MATH_REFS), in any grouping.
 *
 * @param {string} name
 * @returns {boolean}
 */
const isTemplateName = (name) => [...PROTECTED_MATH_REFS].some((ref) => isSameName(ref.split(':')[1], name))

/**
 * Gets the grouping a component saved under a new name goes in. Only a module new from the template is a user module:
 * a diagram's goes in User_Modules.celldl, CellML's in User_Modules.cellml. An edit of existing math, renamed or saved
 * as new, stays in that math's grouping.
 *
 * @param {boolean} [isDiagram] - Whether it's a diagram's, as the module's format says by default.
 * @returns {string}
 */
const newComponentFile = (isDiagram = moduleFormat.value.id === 'celldl') =>
  newComponentGrouping(props.mathRef, { isDiagram })

/**
 * Explains why a name can't be a new component's, or returns '' when it can: a template's, the edited component's, or
 * one its grouping already has are all refused, ignoring case. Names only need to differ within a grouping.
 *
 * @param {string} name
 * @param {{file?: string}} [options] - The grouping it goes in, as Save As last asked by default.
 * @returns {string}
 */
function isComponentNameTaken(name, { file = saveAs.value.file } = {}) {
  if (isTemplateName(name)) return `"${name}" is a template and can't be overwritten.`
  if (isSameName(name, componentName.value ?? '') || findInGrouping(store.availableMath.keys(), file, name)) {
    return `A component named "${name}" already exists.`
  }
  return ''
}

/**
 * Asks for a new component name before saving math that can't keep its current one.
 *
 * @param {string} message - Why a new name is needed.
 * @param {{file?: string, initialName?: string}} [options] - The grouping the component goes in (newComponentFile by
 *   default), and the name offered, the instance's by default.
 * @returns {Promise<string|null>} The new name, or null if cancelled.
 */
function promptComponentSaveAs(message, { file = newComponentFile(), initialName = editableName.value } = {}) {
  resolveSaveAs(null)
  saveAs.value = { visible: true, message, initialName: sanitiseName(initialName ?? ''), file }
  return new Promise((resolve) => {
    saveAsResolver = resolve
  })
}

function resolveSaveAs(name) {
  saveAsResolver?.(name)
  saveAsResolver = null
}

/**
 * Counts the instances, other than this one, on a module's math.
 *
 * @param {string} mathRef
 * @returns {number}
 */
const otherInstanceCount = (mathRef) => nodes.value.filter((n) => n.id !== props.id && n.data?.mathRef === mathRef).length

/**
 * Asks whether to overwrite stored math, or save it as a new component under an unused name.
 *
 * @param {string} name - The stored component's name, offered to edit.
 * @param {{file?: string, mathRef?: string}} [options] - The grouping a new component goes in (newComponentFile by
 *   default), and the math overwritten, the instance's by default, whose other instances the warning counts.
 * @returns {Promise<{name: string|null}|null>} The new component's name, a null name to overwrite, or null to cancel.
 */
async function handleMathOverwrite(name, { file = newComponentFile(), mathRef = props.mathRef } = {}) {
  const count = otherInstanceCount(mathRef)
  const affects = count > 0 ? ` This will affect ${count} other instance${count === 1 ? '' : 's'}.` : ''
  const choice = await choose({
    header: 'Overwrite Math?',
    message: `"${name}" already exists.${affects} Overwrite it, or save your changes as a new component?`,
    severity: 'warning',
    acceptLabel: 'Overwrite',
    extraLabel: 'Save as new component',
    rejectLabel: 'Cancel',
  })
  if (choice === 'accept') return { name: null }
  if (choice !== 'extra') return null
  const renamed = await promptComponentSaveAs('Save your changes as a new component under an unused name.', {
    file,
    initialName: name,
  })
  return renamed ? { name: renamed } : null
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

/**
 * Gets the instance's plotted variables under the names this save gives them, following the math's renames.
 *
 * @returns {Array<{name: string, groupId: string|null}>}
 */
function renamedPlotEntries() {
  const renamed = new Map(trackedNames.value.map(({ savedName, name }) => [savedName, name]))
  return getNodePlotEntries(simulationSettingsStore.plotConfig, props.id).map((entry) => ({ ...entry, name: renamed.get(entry.name) ?? entry.name }))
}

/** Whether a save is under way, which may wait on a conversion and on the user's answers. */
const isSaving = ref(false)
/** Whether a save is converting the diagram, which takes a moment. */
const isConverting = ref(false)

/**
 * Gets the component name typed for a diagram's module, when it differs from the module's (isDiagramRenamable).
 *
 * @returns {string|null}
 */
function renamedDiagramComponent() {
  if (!isDiagramRenamable.value) return null
  const name = cleanName(editableComponentName.value)
  return name && name !== componentName.value ? name : null
}

/**
 * The math the diagram's save converts for, which its live conversion names units against: the template's in the
 * CellDL user modules grouping, a renamed module's under its new name in its own grouping.
 */
const diagramPreviewRef = computed(() => diagramSaveRef(props.mathRef, renamedDiagramComponent()))

/**
 * Gets the diagram's module a renamed diagram may overwrite: one under that name in the diagram's grouping, where a
 * renamed diagram is saved, never a template's or CellML's.
 *
 * @param {string} name
 * @returns {string|null} Its math reference, or null when there's none to overwrite.
 */
function overwritableDiagram(name) {
  const mathRef = `${componentFile.value}:${name}`
  if (isTemplateName(name) || isSameName(name, componentName.value ?? '') || PROTECTED_MATH_REFS.has(mathRef)) return null
  if (!store.availableMath.has(mathRef)) return null
  return store.getMathSource(mathRef)?.format === 'celldl' ? mathRef : null
}

/**
 * Checks whether a diagram's conversion gives its module's stored math and units, compared as the math's dirty check
 * does, so the edit changed only the diagram, e.g. its layout. Values are left out: the module keeps its defaults.
 *
 * @param {string} math - The converted component's math.
 * @param {{componentFile: string, model: string|null}} units - Its grouping's units after the save.
 * @returns {boolean}
 */
function isDiagramOnlyChange(math, units) {
  const storedMath = store.availableMath.get(props.mathRef)
  if (!storedMath || !areModelsEquivalent(storedMath, separateParameters(math).math)) return false
  const storedUnits = store.availableUnits.find((file) => file.componentFile === units.componentFile)?.model ?? null
  return areUnitsModelsEquivalent(storedUnits, units.model)
}

/**
 * Converts the diagram, when edited since it was opened or saved, into the math this save writes. Errors stop the
 * save, keeping the stored math and diagram, with the elements they name highlighted; warnings ask first. The
 * template's diagram, and a diagram whose component is renamed, is a new component, named first so its CellML is, under
 * a new documentUri: the template's in the CellDL user modules grouping, a renamed one's in its module's grouping
 * (newComponentFile), leaving its module, diagram and units as they are. The grouping's modules share its units
 * (groupingUnitsAfterSave). A diagram
 * saved under its module's name, or renamed to another diagram's module's (overwritableDiagram), overwrites that, or is
 * converted again as a new component, asking once it converts. One saved under its module's name that gives the
 * stored math and units (isDiagramOnlyChange) replaces only the module's diagram, without asking.
 *
 * @param {{newName?: string|null, isWarned?: boolean}} [options] - A new component's name, chosen instead of
 *   overwriting, and whether its warnings were already accepted.
 * @returns {Promise<{mathRef: string, math: string|null, layout?: Object|null, source: Object, units: Object|null, isEditorDocument: boolean}|null|false>}
 *   Where the generated math goes, the math and its sections' text layout, its source and its grouping's units (a null
 *   model when none), and whether the editor shows the source's document as it is; null math and units when only the
 *   diagram changed; null when the diagram is unchanged; false when the save stops.
 */
async function stageDiagram({ newName = null, isWarned = false } = {}) {
  let name = newName ?? renamedDiagramComponent() ?? componentName.value
  const isRenamed = name !== componentName.value
  if (!isDiagramDirty.value && !isRenamed) return null
  const stored = store.getMathSource(props.mathRef)
  const requestId = openRequestId
  let document, result
  // The grouping the diagram's live conversion named its units against too (diagramPreviewRef).
  let file = newComponentFile(true)
  let documentUri = stored?.documentUri
  let isEditorDocument = true
  // Another diagram's module this renamed one may overwrite, its source replaced by this diagram.
  let overwriteRef = null
  isConverting.value = true
  try {
    if (isDiagramDirty.value) {
      const comparison = await celldlHost.compareWithBaseline()
      if (!comparison.isChanged && !isRenamed) return null
      document = comparison.document
    } else {
      // Only renamed: the stored diagram is copied, whether or not the editor has opened it.
      document = stored.document
      isEditorDocument = false
    }
    if (!stored || isRenamed) {
      isConverting.value = false
      overwriteRef = isRenamed && !newName ? overwritableDiagram(name) : null
      const taken = isRenamed && !newName && !overwriteRef && isComponentNameTaken(name, { file })
      if (!stored || taken) {
        const renamed = await promptComponentSaveAs(
          stored
            ? `${taken} Save your diagram as a new component under another name.`
            : `"${name}" is the template new instances start from. Save your diagram as a new component instead.`,
          { file, ...(stored && { initialName: name }) }
        )
        if (!renamed) return false
        name = renamed
      }
      isConverting.value = true
      const { mintDocumentUri } = await import('../services/celldl/documentUri.js')
      documentUri = (overwriteRef && store.getMathSource(overwriteRef)?.documentUri) || mintDocumentUri(`${file}:${name}`)
      // A diagram naming its model under its own absolute IRI is read under that, so it's renamed to the new one.
      if (stored?.documentUri && document?.includes(stored.documentUri)) {
        document = document.split(stored.documentUri).join(documentUri)
        isEditorDocument = false
      }
    }
    const { convertCelldl, knownUnitsForModule } = await import('../services/celldl/convert.js')
    result = await convertCelldl(document, {
      documentUri,
      componentName: name,
      knownUnits: knownUnitsForModule(store, `${file}:${name}`),
    })
  } catch (error) {
    console.error('CellDL conversion failed:', error)
    notify.error({ message: `The diagram can't be converted: ${error.message}` })
    return false
  } finally {
    isConverting.value = false
  }
  // The dialog closed, or opened another instance, while the diagram converted.
  if (requestId !== openRequestId || !props.modelValue) return false
  // Only the module's own component becomes its math, as on import.
  const component = result.components?.find((candidate) => candidate.name === name)
  const errors =
    result.ok && !component ? [{ message: `The diagram's CellML has no component named ${name}` }] : result.errors
  // Where issues' element labels come from: the conversion's manifest, else the diagram's annotations.
  const labelSources = { elements: result.elements, annotations: celldlHost.annotations.value }
  if (errors.length) {
    celldlHost.highlight(errors.map((issue) => issue.elementId).filter(Boolean))
    // An issue naming an element links to it: following the link closes this and shows the element.
    let followed = null
    await alert({
      header: moduleFormat.value.editorTab.errorHeader,
      message: "The diagram can't be converted, so nothing was saved:",
      issues: issueItems({ errors }, labelSources),
      onIssue: (issue) => (followed = issue),
      severity: 'error',
    })
    if (followed) showIssueInDiagram(followed)
    return false
  }
  if (result.warnings.length && !isWarned) {
    let followed = null
    const proceed = await confirm({
      header: 'Diagram Warnings',
      message: 'The diagram converted with warnings. Save it anyway?',
      issues: issueItems({ warnings: result.warnings }, labelSources),
      // Following a warning's link cancels the save.
      onIssue: (issue) => (followed = issue),
      severity: 'warning',
      acceptLabel: 'Save',
      rejectLabel: 'Cancel',
    })
    if (followed) showIssueInDiagram(followed)
    if (!proceed) return false
  }
  const source = {
    ...(overwriteRef ? store.getMathSource(overwriteRef) : stored),
    format: moduleFormat.value.id,
    document,
    documentUri: result.documentUri,
    elements: result.elements,
    generator: result.generator,
    frameworkVersion: result.frameworkVersion,
  }
  // A diagram with no units of its own drops any its module had, keeping those its grouping's other modules use.
  const units = groupingUnitsAfterSave(store, `${file}:${name}`, result.unitsModel)
  const isOwnModule = stored && !isRenamed && store.availableMath.has(props.mathRef)
  // Only the diagram changed, so its module keeps its math, and the instances on it theirs.
  if (isOwnModule && !overwriteRef && isDiagramOnlyChange(component.math, units)) {
    return { mathRef: props.mathRef, math: null, source, units: null, isEditorDocument }
  }
  // Saved under its module's name, it overwrites it, or is converted again as a new component, as CellML is saved.
  if (overwriteRef || isOwnModule) {
    const choice = await handleMathOverwrite(name, { file, mathRef: overwriteRef ?? props.mathRef })
    if (!choice) return false
    if (choice.name) return stageDiagram({ newName: choice.name, isWarned: true })
  }
  return {
    mathRef: `${file}:${name}`,
    math: component.math,
    // Its sections' headings, for the CellML Text tab.
    layout: result.layout ?? null,
    source,
    units,
    isEditorDocument,
  }
}

/**
 * Gives a diagram's rows the values typed in the Parameters tab for variables they lacked before the save, and blank
 * rows the diagram's values, as a blank value follows them.
 *
 * @param {{isStaged: boolean}} options - Whether the save converts the diagram, whose values blank rows then took.
 */
function applyCelldlValues({ isStaged }) {
  const pending = pendingValues.value
  const defaults = savedDefaults.value
  parameterRows.value.forEach((row) => {
    // A blank pending value is a renamed row's, which the conversion already gave the diagram's value.
    if (pending.has(row.name)) {
      if (pending.get(row.name) !== '') row.value = pending.get(row.name)
    } else if (!isStaged && isEmpty(row.value) && defaults.has(row.name)) row.value = defaults.get(row.name)
  })
}

/**
 * Renames this instance's rows, and the plotted variables it follows, for the variables a diagram edit renamed, so
 * their values go with them. Values typed for the new names replace the old names' values, a blank one with the
 * diagram's.
 *
 * @param {Map<string, string>} renames - Each old name to its new one (variableRenames).
 */
function renameCelldlRows(renames) {
  if (!renames.size) return
  const pending = pendingValues.value
  parameterRows.value = renameRows(parameterRows.value, renames).map((row) =>
    pending.has(row.name) ? { ...row, value: pending.get(row.name) } : row
  )
  trackedNames.value = trackedNames.value.map((entry) => ({ ...entry, name: renames.get(entry.name) ?? entry.name }))
}

/**
 * Finds the variables a regenerated math gives compatible new units, e.g. a diagram switched to Cellular gives
 * `mole` rows `fmol`, so their values are rescaled to keep the quantities they were; values are numbers in their
 * row's units, so would otherwise change by the factor. A rescale that changes a value this instance or the module
 * holds is confirmed first.
 *
 * @param {{mathRef: string, math: string, units: Object|null}} staged - stageDiagram's.
 * @param {Map<string, string>} renames - The variables the diagram edit renamed.
 * @param {Map<string, string>} defaults - The module's defaults before the save, under their old names.
 * @returns {Promise<Array<Object>|null>} findUnitRescales', with initialisers, or null when the save stops.
 */
async function confirmUnitRescales(staged, renames, defaults) {
  const fromUnits = declaredUnits(analyzeMathXml(store.availableMath.get(props.mathRef) ?? ''), renames)
  const toUnits = declaredUnits(analyzeMathXml(staged.math))
  // The new units are those the save writes: its grouping's file first, then the library's others.
  const ownFile = staged.units?.componentFile
  const toModels = [
    ...(staged.units?.model ? [staged.units.model] : []),
    ...store.availableUnits.filter((file) => file.componentFile !== ownFile).map((file) => file.model),
  ]
  const rows = renameRows(parameterRows.value, renames)
  const rescales = withInitialiserRescales(
    findUnitRescales(fromUnits, toUnits, { from: store.unitDefinitions, to: mergeUnitDefinitions(toModels) }),
    rows
  )
  // Only values change, so only variables holding one are listed.
  const valued = new Set([
    ...rows.filter((row) => isNumericLiteral(row.value)).map((row) => row.name),
    ...[...defaults].filter(([, value]) => isNumericLiteral(value)).map(([name]) => renames.get(name) ?? name),
  ])
  const changed = rescales.filter((rescale) => !isIdentityFactor(rescale.factor) && valued.has(rescale.name))
  if (!changed.length) return rescales
  const whose =
    staged.mathRef === props.mathRef
      ? "every instance of the module has its values"
      : applyToAll.value && siblingCount.value
        ? 'this instance and those it applies to have their values'
        : "this instance's values are"
  const proceed = await confirm({
    header: 'Units Changed',
    message: `The diagram changes these variables' units, so ${whose} rescaled to keep the same quantities:`,
    issues: changed.map((rescale) => ({
      key: rescale.name,
      label: rescale.name,
      message: `${rescale.from} → ${rescale.to}, ${formatFactor(rescale.factor)}`,
    })),
    severity: 'info',
    acceptLabel: 'Rescale and Save',
    rejectLabel: 'Cancel',
  })
  return proceed ? rescales : null
}

/**
 * Rescales the values this instance holds for variables whose units a regenerated math changed (confirmUnitRescales):
 * its rows, and values typed for renamed variables, which are in the units their old rows show.
 *
 * @param {Array<Object>} rescales
 * @param {Map<string, string>} renames
 */
function rescaleInstanceValues(rescales, renames) {
  if (!rescales.length) return
  const renamedTo = new Set(renames.values())
  const pending = pendingValues.value
  const carried = new Map([...pending].filter(([name]) => renamedTo.has(name)))
  pendingValues.value = new Map([...pending, ...rescaleValues(carried, rescales)])
  parameterRows.value = rescaleRows(parameterRows.value, rescales)
}

/**
 * Works out the math reference a save writes to, asking before overwriting stored math or renaming a save of the
 * template. Math saved under its component's name overwrites it in place; a new component, renamed or saved as new,
 * stays in its math's grouping, or, from the template, goes in the CellML user modules grouping (newComponentFile).
 * A diagram's module there is never overwritten.
 *
 * @param {string} math - The math to save.
 * @param {Object|null} layout - Its text layout.
 * @returns {Promise<{mathRef: string, math: string, layout: Object|null}|null>} Null when the save stops.
 */
async function resolveMathTarget(math, layout) {
  const componentNames = getModelComponentNames(math)
  if (!componentNames || componentNames.length === 0) {
    notify.error({ message: 'Could not find a valid component name in the model.' })
    return null
  }
  const newComponentName = componentNames[0].trim()
  const file = newComponentFile(false)
  const renamedTo = (name) => ({
    mathRef: `${file}:${name}`,
    math: renameModelComponent(math, newComponentName, name),
    layout: renameLayoutComponent(layout, newComponentName, name),
  })

  // The template, or math renamed to a template's name, is saved as a new component, as a diagram is.
  const isRenamed = newComponentName !== componentName.value
  const ownRef = `${componentFile.value}:${newComponentName}`
  if (PROTECTED_MATH_REFS.has(ownRef) || (isRenamed && isTemplateName(newComponentName))) {
    const why = PROTECTED_MATH_REFS.has(ownRef)
      ? 'is the template new instances start from'
      : "is a template and can't be overwritten"
    const renamed = await promptComponentSaveAs(
      `"${newComponentName}" ${why}. Save your changes as a new component instead.`,
      { file }
    )
    return renamed ? renamedTo(renamed) : null
  }
  const mathRef = isRenamed ? `${file}:${newComponentName}` : ownRef
  // A renamed component's grouping may have its name in another case, or a diagram's module under it, neither of which
  // it can overwrite.
  const sameName = isRenamed && findInGrouping(store.availableMath.keys(), file, newComponentName)
  const isDiagramModule = !!sameName && (store.getMathSource(sameName)?.format ?? 'cellml') !== 'cellml'
  if (sameName && (sameName !== mathRef || isDiagramModule)) {
    const renamed = await promptComponentSaveAs(
      `A component named "${newComponentName}" already exists. Save your changes as a new component under another name.`,
      { file, initialName: newComponentName }
    )
    return renamed ? renamedTo(renamed) : null
  }
  if (store.availableMath.has(mathRef)) {
    const choice = await handleMathOverwrite(newComponentName, { file, mathRef })
    if (!choice) return null
    if (choice.name) return renamedTo(choice.name)
  }
  return { mathRef, math, layout }
}

/**
 * Asks, for each CellDL store the edited ports would newly couple to what another instance computes, whether the
 * connection should drive it (see confirmDrivenStores). Only edges whose couplings the ports change are asked about.
 *
 * @param {Array} ports - The ports to save.
 * @returns {Promise<Map<string, Array>|null>} Each edge's couplings as they will be, marked where they drive a store,
 *   under the variable names before any rename; null when one was declined.
 */
async function confirmPortDrives(ports) {
  const canvasNodes = (nodes.value ?? []).map((node) =>
    node.id === props.id ? { ...node, data: { ...node.data, variables: parameterRows.value, ports } } : node
  )
  const canvasEdges = edges.value ?? []
  const couplings = previewCouplings(props.id, ports, canvasNodes, canvasEdges)
  const unmarked = (list) => JSON.stringify((list ?? []).map(({ drivesState, ...coupling }) => coupling))
  const changed = new Set(
    [...couplings]
      .filter(([edgeId, next]) => unmarked(canvasEdges.find((edge) => edge.id === edgeId)?.data?.couplings) !== unmarked(next))
      .map(([edgeId]) => edgeId)
  )
  if (!changed.size) return couplings
  const edited = canvasEdges.map((edge) =>
    couplings.has(edge.id) ? { ...edge, data: { ...edge.data, couplings: couplings.get(edge.id) } } : edge
  )
  const marked = await confirmDrivenStores({ nodes: canvasNodes, edges: edited, edgeIds: changed, libraryStore: store, confirm })
  return marked && new Map([...couplings, ...marked])
}

/**
 * Validates and saves the instance, then closes the editor, or keeps it open on the saved instance.
 *
 * @param {{keepOpen?: boolean}|Event} [options] - A button's click event passes as no options.
 */
async function handleSave(options) {
  if (isSaving.value) return
  isSaving.value = true
  try {
    await saveInstance(options)
  } finally {
    isSaving.value = false
  }
}

/**
 * Saves the instance (see handleSave).
 *
 * @param {{keepOpen?: boolean}|Event} [options]
 */
async function saveInstance(options) {
  const keepOpen = options?.keepOpen === true
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

  if ((isManaged.value || isDiagramRenamable.value) && !cleanName(editableComponentName.value)) {
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

  // 2c. A port change that couples a CellDL store to what another instance computes asks first.
  const drivenCouplings = await confirmPortDrives(finalPorts)
  if (!drivenCouplings) return

  const textErrors = getEditorErrors()
  if (textErrors.length > 0) {
    const proceed = await confirm({
      header: editorOptions.value.find((option) => option.value === editorKind.value)?.errorHeader ?? 'Math Has Errors',
      message:
        'If you continue, the last valid version of the model will be saved and any edits since then will be lost.',
      severity: 'warning',
      acceptLabel: 'Proceed',
      rejectLabel: 'Cancel',
    })
    if (!proceed) return
  }

  // An edited diagram gives the math, and values for variables new to the module.
  const staged = await stageDiagram()
  if (staged === false) return
  // A diagram giving new math, not one whose diagram alone changed.
  const isRegenerated = !!staged?.math
  // Its math replaces the session's only once the save goes ahead, so a cancelled save keeps the stored math.
  let target = null
  // The module's defaults before this save, which its variables keep (keepDefaults).
  let previousDefaults = isRegenerated && store.getMathSource(props.mathRef) ? new Map(store.getMathDefaults(props.mathRef)) : new Map()
  let renames = new Map()
  // Variables whose units the regenerated math changed, whose values every instance that moves to it rescales.
  let unitRescales = []
  if (isRegenerated) {
    // Variables the edit renamed keep this instance's values under their new names.
    renames = variableRenames(store.getMathSource(props.mathRef)?.elements ?? null, staged.source.elements ?? null)
    const rescales = await confirmUnitRescales(staged, renames, previousDefaults)
    if (!rescales) return
    unitRescales = rescales
    previousDefaults = rescaleValues(previousDefaults, rescales, renames)
    // A diagram saved under its module's name overwrites it, as asked while staging. The template's, a renamed one's, or
    // one saved as a new component, was named as it converted, so is a new module.
    target = {
      mathRef: staged.mathRef,
      math: staged.math,
      layout: staged.layout,
    }
    renameCelldlRows(renames)
    rescaleInstanceValues(rescales, renames)
    session.applyGeneratedModel(staged.math, { previousDefaults: renameValues(previousDefaults, renames) })
  }
  if (isCelldlModule.value) applyCelldlValues({ isStaged: isRegenerated })

  // Values typed into the text belong in the rows, so an edit to values alone leaves the math unchanged.
  session.separateTypedValues()

  // Give each state and its initialiser the same units. In Advanced Mode the text owns units, so only
  // blank initialisers are filled (see syncInitialiserUnits).
  syncInitialiserUnits(parameterRows.value, { overwrite: isManaged.value })

  // 3. Check the math's new reference. A diagram's math is saved with its values, the math's defaults, even when
  // only they changed.
  const isMathChanged = isRegenerated || session.isDirty()
  if (isMathChanged && !target) {
    target = await resolveMathTarget(currentModel.value, currentLayout.value)
    if (!target) return
  }
  const newMathRef = target?.mathRef ?? props.mathRef
  const mathToSave = target?.math
  const layoutToSave = target ? target.layout : currentLayout.value

  const updateAll = applyToAll.value || siblingCount.value === 0

  trackEvent('editor_action', {
    category: 'Editor',
    action: 'save_unified_module',
    label: editableName.value,
  })

  const wasGlobal = new Set(props.variables.filter((row) => row.type === 'global_constant').map((row) => row.name))

  emit(
    'confirm',
    detachReactivity({
      id: props.id,
      name: editableName.value,
      mathRef: newMathRef,
      previousMathRef: props.mathRef,
      math: isMathChanged ? mathToSave : null,
      layout: layoutToSave,
      isLayoutChanged: !isMathChanged && session.isLayoutDirty(),
      source: staged?.source ?? null,
      isSourceChanged: !!staged,
      units: staged?.units ?? null,
      // The module's defaults before the diagram regenerated its math, which its variables keep.
      previousDefaults: isRegenerated ? [...previousDefaults] : null,
      // Variables the diagram edit renamed, whose values every instance's rows on the saved math move to the new names.
      renames: [...renames],
      // Variables whose units the regenerated math changed, by their new names, whose values those rows rescale.
      unitRescales,
      // Only rows that were already global edit the shared value; a row just switched to global joins it as is.
      globalConstants: parameterRows.value
        .filter((row) => row.type === 'global_constant')
        .map(({ name, value, units, data_reference }) => ({
          name,
          value,
          units,
          data_reference,
          overwrite: wasGlobal.has(name),
        })),
      variables: parameterRows.value,
      ports: renamePortVariables(finalPorts, renames),
      // Edges' couplings set to drive a CellDL store, which they keep once recomputed from the ports.
      drivenCouplings: [...drivenCouplings],
      // The instance's plotted variables, under the names this save gives them.
      plotVariables: renamedPlotEntries(),
      updateAll,
      siblings: updateAll ? siblings.value : [],
      keepOpen,
    })
  )

  // The editor keeps the diagram as saved, so the dialog reloading after Apply doesn't open it again, unless it shows
  // another document, which the reload then opens.
  if (staged) {
    isDiagramSaved.value = true
    if (staged.isEditorDocument) celldlHost.markSaved(staged.source)
    else if (isDiagramDirty.value) celldlHost.markClean()
  }
  if (keepOpen) reloadAfterSave = true
  else emit('update:modelValue', false)
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
  --dlg-fs-label: 0.875rem; /* 14px - field/section labels */
  --dlg-fs-body: 0.875rem; /* 14px - table cells, inputs */
  --dlg-fs-small: 0.8125rem; /* 13px - secondary/meta text */
  --dlg-fs-tiny: 0.75rem; /* 12px - badges, prefixes only */

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

.table-flex-wrapper :deep(.p-datatable-table-container) {
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

.editor-tab-locked {
  display: flex;
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

/* Selection checkboxes: the default is sized for forms, which is large in a dense table */
.right-pane :deep(.parameters-table) {
  --p-checkbox-width: 1rem;
  --p-checkbox-height: 1rem;
  --p-checkbox-icon-size: 0.625rem;
}

/* Plot Tab: the workbench fills the pane, with a note above it while edits are unsaved */
.plot-tab {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* In the run's toolbar, beside the whole model switch. */
.plot-tab-auto-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-size: 0.8125rem;
  color: var(--p-text-color);
  cursor: pointer;
}

/* Measured against the toolbar: too narrow for the label, the switch stands alone, its meaning in the tooltip. */
@container (max-width: 360px) {
  .plot-tab-auto-text {
    display: none;
  }
}

/* Shrinks to an ellipsis, its full text in the title, so it never pushes the toolbar's buttons off. */
.plot-tab-auto-notice {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-text-muted-color);
}

.plot-tab-note {
  flex-shrink: 0;
}

.plot-tab-save {
  padding: 0 0 0 4px;
}

.plot-tab-workbench {
  flex: 1;
  min-height: 0;
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

/* A port's connection state, coloured as in the edge dialog's legend */
.port-status {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--p-text-muted-color);
}

.port-status--connected {
  background: var(--p-primary-color);
}

.ports-key {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 6px 4px 0;
}

.port-key-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--p-text-muted-color);
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

.w-full {
  width: 100%;
}

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
  0%,
  100% {
    transform: translateX(0);
    opacity: 0.4;
  }
  50% {
    transform: translateX(-6px);
    opacity: 1;
  }
}

@keyframes resize-warning-pulse-right {
  0%,
  100% {
    transform: translateX(0);
    opacity: 0.4;
  }
  50% {
    transform: translateX(6px);
    opacity: 1;
  }
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
