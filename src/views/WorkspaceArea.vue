<template>
  <div class="app-layout-container">
    <header class="app-header">
      <div class="file-uploads">
        <div class="file-io-buttons">
          <!-- Hidden File Input for Workspace Load -->
          <input
            ref="workspaceFileInput"
            type="file"
            accept=".json"
            style="display: none"
            @change="handleLoadWorkspace"
          />
          <Button
            icon="pi pi-folder-open"
            size="small"
            variant="text"
            v-tooltip.bottom="{ value: 'Load workspace', showDelay: 300 }"
            @click="$refs.workspaceFileInput.click()"
          />

          <Button
            icon="pi pi-save"
            size="small"
            variant="text"
            v-tooltip.bottom="{ value: 'Save workspace', showDelay: 300 }"
            @click="handleSaveWorkspace"
            style="margin-left: 10px"
            :disabled="!somethingAvailable"
          />

          <Divider layout="vertical" style="margin: 0 15px" />

          <Button
            iconOnly
            size="small"
            variant="text"
            severity="warn"
            v-tooltip.bottom="{ value: 'Clean up workspace', showDelay: 300 }"
            @click="handleAutoLayout"
            :disabled="!somethingAvailable"
          >
            <DustpanBrush />
          </Button>

          <Button
            icon="pi pi-eraser"
            size="small"
            variant="text"
            severity="danger"
            v-tooltip.bottom="{ value: 'Clear workspace', showDelay: 300 }"
            @click="handleClearWorkspace"
            style="margin-left: 10px"
            :disabled="!somethingAvailable"
          />

          <Divider layout="vertical" style="margin: 0 15px" />

          <Button
            iconOnly
            icon="pi pi-undo"
            size="small"
            variant="text"
            severity="secondary"
            v-tooltip.bottom="{ value: 'Undo', showDelay: 300 }"
            @click="handleUndo"
            :disabled="!historyStore.canUndo"
          />

          <Button
            iconOnly
            icon="pi pi-refresh"
            size="small"
            variant="text"
            severity="secondary"
            v-tooltip.bottom="{ value: 'Redo', showDelay: 300 }"
            @click="handleRedo"
            style="margin-left: 10px"
            :disabled="!historyStore.canRedo"
          />

          <Divider layout="vertical" style="margin: 0 15px" />

          <Button
            iconOnly
            variant="text"
            severity="secondary"
            v-tooltip.bottom="{ value: 'Add left handle', showDelay: 300 }"
            :disabled="!somethingSelected"
            @click="addHandle('left')"
          >
            <AddHandleLeft />
          </Button>

          <Button
            iconOnly
            style="margin-left: 5px"
            variant="text"
            severity="secondary"
            v-tooltip.bottom="{ value: 'Add top handle', showDelay: 300 }"
            :disabled="!somethingSelected"
            @click="addHandle('top')"
          >
            <AddHandleTop />
          </Button>

          <Button
            iconOnly
            style="margin-left: 5px"
            variant="text"
            severity="secondary"
            v-tooltip.bottom="{ value: 'Add right handle', showDelay: 300 }"
            :disabled="!somethingSelected"
            @click="addHandle('right')"
          >
            <AddHandleRight />
          </Button>

          <Button
            iconOnly
            style="margin-left: 5px"
            variant="text"
            severity="secondary"
            v-tooltip.bottom="{ value: 'Add bottom handle', showDelay: 300 }"
            :disabled="!somethingSelected"
            @click="addHandle('bottom')"
          >
            <AddHandleBottom />
          </Button>

          <Divider layout="vertical" style="margin: 0 15px" />

          <Button
            iconOnly
            icon="pi pi-hammer"
            size="small"
            variant="text"
            severity="info"
            v-tooltip.bottom="{ value: 'Open macro builder', showDelay: 300 }"
            @click="onOpenMacroBuilderDialog"
          />

          <Button
            iconOnly
            style="margin-left: 10px"
            size="small"
            variant="text"
            severity="info"
            :disabled="!somethingAvailable"
            aria-label="Configure simulation settings"
            v-tooltip.bottom="{ value: 'Configure simulation settings', showDelay: 300 }"
            @click="onOpenSimSettingsDialog"
          >
            <SimulationSettingsIcon />
          </Button>

          <Button
            iconOnly
            style="margin-left: 10px"
            icon="pi pi-cog"
            size="small"
            variant="text"
            severity="info"
            aria-label="Settings"
            v-tooltip.bottom="{ value: 'Settings', showDelay: 300 }"
            @click="onOpenSettingsDialog"
          />

          <Divider layout="vertical" style="margin: 0 15px" />

          <!-- Import Dropdown / SplitButton -->
          <SplitButton
            text
            size="small"
            :model="importMenuItems"
            severity="primary"
            @click="triggerCurrentImport"
            :disabled="currentImportDisabled"
            v-tooltip.bottom="{
              value: currentImportDisabled
                ? 'The Import option is disabled because CellML library is not ready yet.'
                : `Import ${currentImportMode.label}`,
              showDelay: 300,
            }"
          >
            <template #icon>
              <ImportIcon />
            </template>
            <!-- Dropdown Menu Item Icons -->
            <template #item="{ item, props }">
              <a class="p-menuitem-link" v-ripple v-bind="props.action">
                <!-- If icon is a Vue component -->
                <component :is="item.icon" v-if="typeof item.icon !== 'string'" class="p-menuitem-icon" />
                <!-- If icon is a PrimeIcon class string -->
                <span v-else :class="[item.icon, 'p-menuitem-icon']"></span>

                <span class="p-menuitem-text">{{ item.label }}</span>
              </a>
            </template>
          </SplitButton>

          <!-- Export Dropdown / SplitButton -->
          <SplitButton
            text
            size="small"
            :model="exportMenuItems"
            severity="primary"
            style="margin-left: 10px"
            @click="triggerCurrentExport"
            :disabled="!somethingAvailable || currentExportDisabled"
            v-tooltip.bottom="{
              value:
                !somethingAvailable || currentExportDisabled
                  ? cellMlExportTooltip
                  : `Export ${currentExportMode.label}`,
              showDelay: 300,
            }"
          >
            <template #icon>
              <ExportIcon />
            </template>
            <!-- Dropdown Menu Item Icons -->
            <template #item="{ item, props }">
              <a class="p-menuitem-link" v-ripple v-bind="props.action">
                <!-- If icon is a Vue component -->
                <component :is="item.icon" v-if="typeof item.icon !== 'string'" class="p-menuitem-icon" />
                <!-- If icon is a PrimeIcon class string -->
                <span v-else :class="[item.icon, 'p-menuitem-icon']"></span>

                <span class="p-menuitem-text">{{ item.label }}</span>
              </a>
            </template>
          </SplitButton>

          <!-- Send Dropdown / SplitButton -->
          <SplitButton
            text
            size="small"
            icon="pi pi-send"
            :model="sendMenuItems"
            severity="primary"
            @click="triggerCurrentSend"
            :disabled="!somethingAvailable || currentSendDisabled"
            v-tooltip.bottom="{
              value:
                !somethingAvailable || currentSendDisabled
                  ? currentSendMode.isSelection && libcellml.status === 'ready'
                    ? 'Select instances to send them on their own.'
                    : 'The Send option is disabled because CellML library is not ready yet.'
                  : `Send to ${currentSendMode.label}`,
              showDelay: 300,
            }"
          >
            <!-- Dropdown Menu Item Icons -->
            <template #item="{ item, props }">
              <a class="p-menuitem-link" v-ripple v-bind="props.action">
                <!-- If icon is a Vue component -->
                <component :is="item.icon" v-if="typeof item.icon !== 'string'" class="p-menuitem-icon" />
                <!-- If icon is a PrimeIcon class string -->
                <span v-else :class="[item.icon, 'p-menuitem-icon']"></span>

                <span class="p-menuitem-text">{{ item.label }}</span>
              </a>
            </template>
          </SplitButton>
        </div>
      </div>

      <div class="header-right-actions">
        <a
          href="https://github.com/physiomelinks/phlynx/issues/new"
          style="font-size: 13px"
          target="_blank"
          class="report-link"
        >
          Report Issue
        </a>
        <!-- Beside the theme switch: both change how the workspace is shown, not what is in it -->
        <ViewModeToggle style="margin-left: 20px" />
        <ThemeToggle style="margin-left: 20px" />
      </div>
    </header>

    <div class="app-body-container">
      <ResizableLibraryPanel
        title="Available Modules"
        :initial-width="300"
        :min-width="150"
        :max-width="400"
        @resize="onLibraryPanelResize"
      >
        <LibraryArea />
      </ResizableLibraryPanel>
      <main
        class="workbench-main"
        :style="{
          '--library-panel-width': libraryPanelWidth + 'px',
          '--context-sidebar-width': contextSidebarWidth + 'px',
        }"
      >
        <div
          v-show="!viewMode.isBio"
          class="workspace-search-container"
          :class="{ 'search-inactive': !isSearchFocused && !searchQuery, 'search-mode-var': parsedQuery.mode === 'var' }"
        >
          <div class="workspace-search-input-wrapper">
            <IconField>
              <InputIcon class="pi pi-search" />
              <InputText
                ref="searchInputRef"
                v-model="searchQuery"
                class="w-full"
                @input="runSearch()"
                @keydown="onSearchKeydown"
                @focus="onSearchFocus"
                @blur="onSearchBlur"
              />
              <div
                v-if="!searchQuery && !isSearchFocused"
                class="search-placeholder"
              >
                <span>Type</span>
                <kbd>/</kbd>
                <span>to search</span>
              </div>
              <InputIcon
                v-if="searchQuery"
                class="search-clear-input pi pi-times-circle"
                @click="clearSearch"
              />
            </IconField>
          </div>
          <div v-if="showModePicker" class="search-suffix-content">
            <ul class="search-match-list search-mode-picker">
              <li
                v-for="(mode, index) in SEARCH_MODES"
                :key="mode.label"
                class="search-match-item"
                :class="{ active: index === pickerIndex }"
                @mousedown.prevent="pickMode(index)"
              >
                {{ mode.label }}
                <span class="search-match-vars">{{ mode.hint }}</span>
              </li>
            </ul>
          </div>
          <div v-else-if="searchQuery" class="search-suffix-content">
            <div class="search-suffix-header">
              <Tag v-if="parsedQuery.mode === 'var'" value="var" severity="secondary" rounded />
              <span v-if="matchCount !== null" class="search-match-count">
                <template v-if="parsedQuery.mode === 'var'">
                  {{ matchCount }} instance{{ matchCount !== 1 ? 's' : '' }}
                </template>
                <template v-else>{{ matchCount }} match{{ matchCount !== 1 ? 'es' : '' }}</template>
              </span>
              <div v-if="matchCount >= 1" class="search-nav-buttons">
                <Button
                  v-if="matchCount > 1"
                  icon="pi pi-chevron-up"
                  size="small"
                  text
                  @click="cycleToPreviousMatch"
                  title="Previous match (Shift+Enter)"
                />
                <Button
                  icon="pi pi-chevron-down"
                  size="small"
                  text
                  @click="cycleToNextMatch"
                  :title="matchCount === 1 ? 'Zoom to match (Enter)' : 'Next match (Enter)'"
                />
              </div>
            </div>
            <ul v-if="matchCount >= 1" ref="matchListRef" class="search-match-list">
              <li
                v-for="(match, index) in matchingNodesList"
                :key="match.node.id"
                class="search-match-item"
                :class="{ active: index === currentMatchIndex }"
                @click="selectMatch(index)"
              >
                {{ match.node.data?.name || match.node.data?.moduleRef || match.node.id }}
                <span
                  v-if="match.variables.length"
                  class="search-match-vars"
                  :title="match.variables.map(describeMatchedVariable).join(', ')"
                >
                  {{ match.variables.slice(0, 3).map(describeMatchedVariable).join(', ')
                  }}{{ match.variables.length > 3 ? ` +${match.variables.length - 3} more` : '' }}
                </span>
              </li>
            </ul>
            <p v-else-if="matchCount === 0" class="search-empty">
              <template v-if="parsedQuery.mode === 'var'">No instance has a variable matching '{{ parsedQuery.term }}'</template>
              <template v-else>No instances match '{{ parsedQuery.term }}'</template>
            </p>
          </div>
        </div>

        <div
          class="dnd-flow"
          @drop="onDrop"
          @dragover.prevent
          @dragenter.prevent
          @dragleave="onFileDragLeave"
        >
          <Transition name="fade">
            <div v-if="isUrlLoading || dropLoadingMessage" class="flow-loading-overlay">
              <i class="pi pi-spin pi-spinner loading-icon" />
              <span>{{ isUrlLoading ? 'Populating Workspace...' : dropLoadingMessage }}</span>
            </div>
          </Transition>
          <div v-if="isFileDragOver && !dropLoadingMessage" class="file-drop-overlay">
            <i class="pi pi-file-import file-drop-icon" />
            <span>Drop .cellml or .omex files to load</span>
          </div>
          <Toast
            v-if="!isUrlLoading"
            position="top-right"
            :style="{ top: `${toastTop}px`, right: `${contextSidebarWidth + 25}px` }"
          >
            <template #message="slotProps">
              <div class="p-toast-message-text" style="flex: 1">
                <!-- Summary / Title -->
                <div
                  v-if="slotProps.message.summary"
                  class="p-toast-summary font-bold"
                  style="line-height: 1.2; margin-bottom: 4px"
                >
                  {{ slotProps.message.summary }}
                </div>

                <!-- Detail / Message Content -->
                <div class="p-toast-detail" style="line-height: 1.5">
                  <component v-if="typeof slotProps.message.detail === 'object'" :is="slotProps.message.detail" />
                  <div v-else v-html="slotProps.message.detail" />
                </div>
              </div>
            </template>
          </Toast>
          <VueFlow
            :id="FLOW_IDS.MAIN"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @nodes-change="onNodeChange"
            @edges-change="onEdgeChange"
            @edge-double-click="onEdgeDoubleClick"
            @pane-context-menu="onPaneContextMenu"
            @pane-click="onPaneClick"
            class="main-flow"
            :max-zoom="1.5"
            :min-zoom="0.1"
            :default-edge-options="edgeLineOptions"
            :connection-line-options="edgeLineOptions"
            :nodes="nodes"
            :delete-key-code="dialogVisible ? [] : ['Backspace', 'Delete']"
            :class="{ 'main-flow--hidden': viewMode.isBio }"
            :inert="viewMode.isBio || null"
          >
            <component :is="'style'" v-if="highlightCss">{{ highlightCss }}</component>
            <HelperLines :horizontal="helperLineHorizontal" :vertical="helperLineVertical" :alignment="alignment" />
            <MiniMap :pannable="true" :zoomable="true" :node-color="miniMapNodeColour" class="mini-map" />
            <Controls :fit-view-params="fitViewParams">
              <ControlButton :disabled="screenshotDisabled" :title="imageExportTitle" @click="doImageExport">
                <i class="pi pi-image"></i>
              </ControlButton>
            </Controls>
            <template #edge-smoothstep="edgeProps">
              <CouplingEdge v-bind="edgeProps" />
            </template>
            <template #zoom-pane>
              <SuggestionLayer @accept="couplingSuggestions.accept" @dismiss="couplingSuggestions.dismiss" />
            </template>
            <SuggestionPanel
              @accept-all="couplingSuggestions.acceptAll"
              @dismiss-all="couplingSuggestions.dismissAll"
              @restore-dismissed="couplingSuggestions.restoreDismissed"
            />
            <template #node-instanceNode="props">
              <InstanceNode
                :id="props.id"
                :data="props.data"
                :selected="props.selected"
                @open-instance-editor="onOpenInstanceEditorDialog"
                @open-context-menu="onNodeContextMenu"
                :ref="(el) => (nodeRefs[props.id] = el)"
              />
            </template>
            <Workbench>
              <p v-if="isDragOver">Drop here</p>
            </Workbench>
          </VueFlow>
          <BioFlow
            v-if="viewMode.isBio"
            class="bio-flow-layer"
            @open-instance-editor="onOpenInstanceEditorDialog"
            @export-image="exportImageOf"
          />
        </div>
      </main>
      <ContextSidebar
        ref="contextSidebarRef"
        :initial-width="480"
        :min-width="260"
        :max-width="1200"
        @resize="onContextSidebarResize"
        @open-inspection-module-dialog="onOpenInspectionModuleDialog"
      />
    </div>
  </div>

  <!-- PrimeVue Confirmation Dialog Service component -->
  <ConfirmDialog />

  <InstanceEditorDialog
    v-model="instanceEditorDialogVisible"
    :id="currentEditingNode?.id"
    :initial-name="currentEditingNode?.name"
    :math-ref="currentEditingNode?.mathRef"
    :variables="currentEditingNode?.variables"
    :initial-ports="currentEditingNode?.ports"
    :existing-names="allNodeNames"
    :default-tab="instanceEditorDefaultTab"
    @confirm="onInstanceEditConfirm"
  />

  <SaveDialog v-model="saveDialogVisible" :default-name="sessionMetadataStore.lastSaveName" @confirm="onSaveConfirm" />

  <SaveDialog
    v-model="exportDialogVisible"
    :title="`Export for ${currentExportMode.label}`"
    :default-name="sessionMetadataStore.lastSaveName"
    :suffix="currentExportMode.suffix"
    @confirm="onExportConfirm"
  />

  <ModuleReplacementDialog
    v-model="replacementDialogVisible"
    :current-instance="currentEditingNode"
    @confirm="onReplaceConfirm"
  />

  <CreateInspectionModuleDialog
    v-model="inspectionModuleDialogVisible"
    :nodes="nodes"
    :editing-module="editingInspectionModule"
    :existing-modules="inspectionModuleStore.modules"
    @confirm="handleCreateInspectionModule"
  />

  <MacroBuilderDialog v-model="macroBuilderDialogVisible" @generate="onMacroBuilderGenerate" />

  <SimulationFloatingViewer :nodes="nodes" :is-canvas-shown="route.name === 'workspace'" />
  <SimSettingsDialog v-model="simSettingsDialog.visible" :section="simSettingsDialog.section" :nodes="nodes" />

  <ProtocolDialog v-model="protocolDialog.visible" :nodes="nodes" />

  <SettingsDialog v-model="settingsDialogVisible" />

  <ImportDialog
    ref="importDialogRef"
    v-model="importDialogVisible"
    :config="currentImportConfig"
    @confirm="onImportConfirm"
  />

  <ApplyAnnotationsDialog
    v-model="applyAnnotationsVisible"
    :prepared="preparedAnnotations"
    :plan-rows="planAnnotationRows"
    @apply="onApplyAnnotations"
  />

  <PaneContextMenu ref="contextMenuRef" :items="contextMenuItems" />

  <EdgeConnectionDialog
    v-model="edgeConnectionDialogVisible"
    :source-node="edgeDialogSourceNode"
    :target-node="edgeDialogTargetNode"
    :active-edge="edgeDialogActiveEdge"
    :subgraph="edgeDialogSubgraph"
    @confirm="onEdgeConnectionConfirm"
  />
</template>

<script>
export default {
  name: 'WorkspaceArea',
}
</script>

<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow, VueFlow } from '@vue-flow/core'
import { useRoute } from 'vue-router'

import Button from 'primevue/button'
import SplitButton from 'primevue/splitbutton'
import JSZip from 'jszip'
import Divider from 'primevue/divider'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Tag from 'primevue/tag'
import ConfirmDialog from 'primevue/confirmdialog'
import ThemeToggle from '../components/ThemeToggle.vue'
import { Toast } from 'primevue'
import { useToast } from 'primevue/usetoast'

import { Controls, ControlButton } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'

import { useLibraryStore } from '../stores/libraryStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { getUndoRedoAction, useFlowHistory } from '../composables/useFlowHistory'
import { useConnect } from '../composables/useConnect'
import { useCouplingSuggestions } from '../composables/useCouplingSuggestions'
import { useApplyAnnotations } from '../composables/useApplyAnnotations'
import { useCellmlDrop } from '../composables/useCellmlDrop'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useOmexStore } from '../stores/omexStore'
import { useAnnotationStore } from '../stores/annotationStore'

import { importOmexFile, extractOmexArchive, readArchiveEntries } from '../services/import/omex'
import { restoreOmexAnnotations } from '../services/import/omexAnnotations'
import { withAnnotationData } from '../services/annotations/nodeData'
import { findParamsForIdExtra, parseParamsForId, resolveParamsForIdRows } from '../services/simulation/paramsForId'
import { putSlider } from '../services/simulation/parameterSliders'

import useDragAndDrop from '../composables/useDnD'
import { useHandleManagement } from '../composables/useHandleManagement'
import { useInstanceSave } from '../composables/useInstanceSave'
import { useNodeDataHistory } from '../composables/useNodeDataHistory'
import { useLoadFromInstanceArray } from '../composables/useLoadFromInstanceArray'
import { useLoadFromCellML } from '../composables/useLoadFromCellml'
import { useLoadFromUrl } from '../composables/useLoadFromUrl'
import { createUrlLoaders } from '../services/urlLoaders'
import { parseCellMLConnections } from '../services/import/parseCellmlConnections'
import { prepareCellmlImport } from '../services/import/prepareCellml'
import { useGtm } from '../composables/useGtm'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useImportExportSend } from '../composables/useImportExportSend'

import LibraryArea from '../components/LibraryArea.vue'
import ResizableLibraryPanel from '../components/ResizableLibraryPanel.vue'
import Workbench from '../components/WorkbenchArea.vue'
import CouplingEdge from '../components/CouplingEdge.vue'
import SuggestionLayer from '../components/SuggestionLayer.vue'
import SuggestionPanel from '../components/SuggestionPanel.vue'
import InstanceNode from '../components/InstanceNode.vue'
import ImportDialog from '../components/ImportDialog.vue'
import ApplyAnnotationsDialog from '../components/ApplyAnnotationsDialog.vue'
import ModuleReplacementDialog from '../components/ModuleReplacementDialog.vue'
import SaveDialog from '../components/SaveDialog.vue'
import MacroBuilderDialog from '../components/MacroBuilderDialog.vue'
import SimSettingsDialog from '../components/SimSettingsDialog.vue'
import ProtocolDialog from '../components/ProtocolDialog.vue'
import SimulationFloatingViewer from '../components/simulation/SimulationFloatingViewer.vue'
import { setWorkspaceMounted } from '../router/workspaceMount'
import EdgeConnectionDialog from '../components/EdgeConnectionDialog.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import HelperLines from '../components/HelperLines.vue'
import PaneContextMenu from '../components/PaneContextMenu.vue'
import BioFlow from '../components/bio/BioFlow.vue'
import ViewModeToggle from '../components/bio/ViewModeToggle.vue'
import { useViewModeStore } from '../stores/viewModeStore'
import InstanceEditorDialog from '../components/InstanceEditorDialog.vue'
import CreateInspectionModuleDialog from '../components/dialogs/CreateInspectionModule.vue'
import ContextSidebar from '../components/ContextSidebar.vue'

import AddHandleBottom from '../components/icons/AddHandles/AddHandleBottom.vue'
import AddHandleLeft from '../components/icons/AddHandles/AddHandleLeft.vue'
import AddHandleTop from '../components/icons/AddHandles/AddHandleTop.vue'
import AddHandleRight from '../components/icons/AddHandles/AddHandleRight.vue'
import DustpanBrush from '../components/icons/DustpanBrush.vue'
import SimulationSettingsIcon from '../components/icons/SimulationSettingsIcon.vue'
import ImportIcon from '../components/icons/ImportIcon.vue'
import ExportIcon from '../components/icons/ExportIcon.vue'

import { useScreenshot } from '../services/useScreenshot'
import { useMacroGenerator } from '../services/generate/generateWorkflow'
import { separateNodeParameters } from '../services/workspaceMigrator'
import { loadWorkspaceFile } from '../services/workspaceFile'
import { useWorkspaceSaveLoad } from '../composables/useWorkspaceSaveLoad'
import { useSimulation } from '../composables/useSimulation'
import { useSimSettingsDialog } from '../composables/useSimSettingsDialog'
import { useProtocolDialog } from '../composables/useProtocolDialog'
import { useFloatingViewer } from '../composables/useFloatingViewer'
import { useActiveDocumentListeners } from '../composables/useActiveDocumentListeners'
import { useWorkspaceSearch } from '../composables/useWorkspaceSearch'
import { SEARCH_MODES, variableKindLabel } from '../utils/workspaceSearch'
import { scopeFlowObject } from '../services/simulation/scopedModel'
import { relayoutNodes } from '../services/layouts/physics'
import { extractSimData as extractSimDataFromSedml } from '../services/import/sedml'
import { extractSimData as extractSimDataFromSimulationJson } from '../services/import/simulation'
import { buildInstance } from '../services/import/buildWorkflow'

import { notify } from '../utils/notify'
import { getHelperLines } from '../utils/helperLines'
import { getPurgedUrlForResource, getUrlForResource, loadManifest } from '../utils/resources'
import { useClearWorkspace } from '../composables/useClearWorkspace'
import { shouldIgnoreShortcut, useWorkspaceClipboard } from '../composables/useWorkspaceClipboard'
import { useColorScheme } from '../composables/useColorScheme'
import { useAppSettings } from '../composables/useAppSettings'
import { useNodeThemeStore } from '../stores/nodeThemeStore'
import { categoryColour } from '../utils/nodeThemes'
import { cyrb53, takeInputFile } from '../utils/misc'
import { buildGhostHandles, normaliseHandleSlots } from '../utils/handles'
import { bindLibCellML, processCellMLData, loadParametersFromCellML } from '../utils/cellml'
import {
  edgeLineOptions,
  FLOW_IDS,
  IMPORT_KEYS,
  NEW_INSTANCE_MODULE_REF,
  NUM_GHOST_HANDLES_TOP_BOT,
  NUM_GHOST_HANDLES_LEFT_RIGHT,
  PHLYNX_PROJECT_VERSION,
} from '../utils/constants'
import { resolvePortCouplings } from '../utils/edges'
import { parseParametersFile } from '../utils/import'
import { applyParameterValues, applyParametersToNodes, skippedParametersMessage } from '../utils/parameters'
import { detachReactivity } from '../utils/reactivity'
import { saveWithDialog, stripExtension } from '../utils/save'

const workspaceFileInput = ref(null)

const libraryPanelWidth = ref(0)
function onLibraryPanelResize(width) {
  libraryPanelWidth.value = width
}
const contextSidebarWidth = ref(0)
function onContextSidebarResize(width) {
  contextSidebarWidth.value = width
}

const fitViewParams = computed(() => ({
  padding: {
    left: `${libraryPanelWidth.value + 40}px`,
    right: 0.1,
    top: 0.1,
    bottom: 0.1,
  },
  duration: 200,
}))

const SEARCH_BAR_TOP = 150
const TOAST_GAP_BELOW_SEARCH_BAR = 16
const toastTop = computed(() => SEARCH_BAR_TOP + TOAST_GAP_BELOW_SEARCH_BAR)

const {
  addEdges,
  addNodes,
  addSelectedNodes,
  dimensions,
  edges,
  findEdge,
  findNode,
  fitView,
  fromObject,
  getSelectedNodes,
  getSelectedEdges,
  nodes,
  onConnectEnd,
  removeEdges,
  removeSelectedNodes,
  screenToFlowCoordinate,
  setViewport,
  toObject,
  updateNodeData,
  viewport,
  vueFlowRef,
} = useVueFlow(FLOW_IDS.MAIN)
const viewMode = useViewModeStore()
const { processMacroGeneration } = useMacroGenerator()
const { confirm } = useConfirmDialog()
const toast = useToast()
const route = useRoute()

const pendingHistoryNodes = new Set()

const {
  onDragOver: onDragOverModule,
  onDrop: onDropModule,
  onDragLeave,
  isDragOver,
  createInstanceNode,
} = useDragAndDrop(pendingHistoryNodes)

const {
  activateHandle,
  addHandle: addHandleToNode,
  confirmActivation,
  revertPendingGhostIfUnused,
  revertHandlesForEdge,
  reactivateEdgeHandles,
  revertHandleIfUnused,
} = useHandleManagement()
const { recordEdit, findIncidentEdgeIds } = useNodeDataHistory(FLOW_IDS.MAIN)
const { saveInstanceEdit } = useInstanceSave(FLOW_IDS.MAIN)

const dialogVisible = computed(() => {
  return (
    saveDialogVisible.value ||
    importDialogVisible.value ||
    exportDialogVisible.value ||
    replacementDialogVisible.value ||
    macroBuilderDialogVisible.value ||
    simSettingsDialog.visible ||
    protocolDialog.visible ||
    settingsDialogVisible.value ||
    edgeConnectionDialogVisible.value ||
    instanceEditorDialogVisible.value ||
    inspectionModuleDialogVisible.value
  )
})

const notifyMultiFileResults = (
  results,
  { successTitle, partialTitle = 'Partial Import', failTitle = 'Import Failed' }
) => {
  const succeeded = results.filter((r) => r.ok)
  const failed = results.length - succeeded.length
  const fileWord = (n) => `${n} file${n !== 1 ? 's' : ''}`

  if (succeeded.length > 0 && failed === 0) {
    notify.success({ title: successTitle, message: `Loaded from ${fileWord(succeeded.length)}.` })
  } else if (succeeded.length > 0) {
    notify.warning({
      title: partialTitle,
      message: `Loaded from ${fileWord(succeeded.length)}. ${fileWord(failed)} failed.`,
    })
  } else {
    notify.error({ title: failTitle, message: `Failed to load all ${fileWord(failed)}.` })
  }
}

const libraryStore = useLibraryStore()
const sessionMetadataStore = useSessionMetadataStore()
const inspectionModuleStore = useInspectionModuleStore()
const historyStore = useFlowHistoryStore()
const simulationSettingsStore = useSimulationSettingsStore()
const omexStore = useOmexStore()
const annotationStore = useAnnotationStore()
const nodeThemeStore = useNodeThemeStore()
const { isDarkMode } = useColorScheme()
const { settings: appSettings } = useAppSettings()

/** MiniMap nodes follow the active node colour theme; uncategorised nodes keep the MiniMap default grey. */
function miniMapNodeColour(node) {
  return (
    categoryColour(nodeThemeStore.activeTheme, node.data?.domainType, isDarkMode.value) ??
    (isDarkMode.value ? '#3f3f46' : '#e2e2e2')
  )
}
const { loadFromInstanceArray } = useLoadFromInstanceArray({ fitViewParams })
const { loadFromCellML } = useLoadFromCellML({ fitViewParams })
const {
  readAnnotationFiles,
  planRows: planAnnotationRows,
  applyAnnotations,
} = useApplyAnnotations({ fitViewParams })
const applyAnnotationsVisible = ref(false)
const preparedAnnotations = ref(null)

/**
 * Applies the choices made in the Apply Annotations dialog and reports what was done.
 *
 * @param {{ targets: Object, rows: Array<Object> }} choices
 */
async function onApplyAnnotations(choices) {
  try {
    const { added, bound, skipped, unmatchedSidecars } = await applyAnnotations(preparedAnnotations.value, choices)
    const lines = [`Added ${added.length} and bound ${bound.length} instance${added.length + bound.length === 1 ? '' : 's'}.`]
    if (skipped.length) lines.push(`Skipped (no module): ${skipped.join(', ')}.`)
    if (unmatchedSidecars.length) lines.push(`Sidecars not stored (no math): ${unmatchedSidecars.join(', ')}.`)
    const notice = { title: 'Annotations Applied', message: lines.join('\n') }
    if (skipped.length || unmatchedSidecars.length) notify.warning(notice)
    else notify.success(notice)
  } catch (error) {
    notify.error({ title: 'Applying Annotations Failed', message: error.message })
  }
}
const { capture, error: captureError } = useScreenshot()
const { trackEvent } = useGtm()
const { clearWorkspace } = useClearWorkspace()

const helperLineHorizontal = ref(null)
const helperLineVertical = ref(null)
const alignment = ref('edge')

const libcellmlReadyPromise = inject('$libcellml_ready')
// Settles once registerBuiltInLibrary finishes or fails. Workspace and OMEX loads wait on it, so a loaded
// library always lands after the built-in one, whatever the timing.
let markBuiltInLibraryReady
const builtInLibraryReady = new Promise((resolve) => (markBuiltInLibraryReady = resolve))
const libcellml = inject('$libcellml')
const instanceEditorDefaultTab = ref('parameters')
const instanceEditorDialogVisible = ref(false)
const saveDialogVisible = ref(false)
const importDialogVisible = ref(false)
const exportDialogVisible = ref(false)
const replacementDialogVisible = ref(false)
const macroBuilderDialogVisible = ref(false)
const { state: simSettingsDialog, open: openSimSettingsDialog } = useSimSettingsDialog()
const { state: protocolDialog } = useProtocolDialog()
const settingsDialogVisible = ref(false)
const edgeConnectionDialogVisible = ref(false)
const inspectionModuleDialogVisible = ref(false)
const editingInspectionModule = ref(null)
const edgeDialogSourceNode = ref({})
const edgeDialogTargetNode = ref({})
const edgeDialogActiveEdge = ref({})
const edgeDialogSubgraph = ref(new Map())
const importDialogRef = ref(null)

const currentEditingNode = ref({
  name: '',
  variables: [],
  mathRef: '',
  moduleRef: '',
  id: '',
  ports: [],
})
const currentImportConfig = ref({})

const activeExportNotification = ref(null)

const mousePosition = ref({ x: 0, y: 0 })

const searchInputRef = ref(null)
const matchListRef = ref(null)
const {
  searchQuery,
  parsedQuery,
  matchCount,
  matchingNodesList,
  currentMatchIndex,
  isSearchFocused,
  showModePicker,
  pickerIndex,
  runSearch,
  clearSearch,
  selectMatch,
  cycleToNextMatch,
  cycleToPreviousMatch,
  pickMode,
  onSearchFocus,
  onSearchBlur,
  onSearchKeydown,
  highlightCss,
} = useWorkspaceSearch({ nodes, findNode, zoomToNode })

/**
 * Names a matched variable with its kind, such as `R (global)`.
 *
 * @param {Object} row
 * @returns {string}
 */
const describeMatchedVariable = (row) => {
  const kind = variableKindLabel(row)
  return kind ? `${row.name} (${kind})` : row.name
}

// Keep the current match in view as the arrows step through a long list.
watch(currentMatchIndex, async () => {
  await nextTick()
  matchListRef.value?.querySelector('.search-match-item.active')?.scrollIntoView?.({ block: 'nearest' })
})

const allNodeNames = computed(() => nodes.value.map((n) => n.data.name))
const somethingAvailable = computed(() => nodes.value.length > 0)
const somethingSelected = computed(() => getSelectedNodes.value.length > 0)
const hasModelChanged = computed(() => cyrb53(snapshotFlowState()) !== omexStore.archiveHash)

const {
  currentExportMode,
  currentImportMode,
  currentSendMode,
  importMenuItems,
  exportMenuItems,
  sendMenuItems,
  currentExportDisabled,
  currentImportDisabled,
  currentSendDisabled,
  triggerCurrentExport,
  triggerCurrentImport,
  triggerCurrentSend,
} = useImportExportSend({
  libcellml,
  nodes,
  edges,
  importDialogVisible,
  exportDialogVisible,
  currentImportConfig,
  onExportConfirm,
  hasModelChanged,
  snapshotFlowState,
  selectedNodeIds: computed(() => getSelectedNodes.value.map((node) => node.id)),
})

const cellMlExportTooltip = computed(() => {
  const prefix = 'The CellML export option is disabled because '
  if (libcellml.status !== 'ready') {
    return prefix + 'the CellML library is not ready yet. Please wait a moment and try again.'
  }
  if (!somethingAvailable.value) {
    return prefix + 'there is nothing to export. Please add some modules to the workspace first.'
  }
  if (currentExportMode.value?.isSelection) return 'Select instances to export them on their own.'
  return 'This should not be shown when CellML export is enabled.'
})

onConnectEnd(() => {
  revertPendingGhostIfUnused()
})

const { copySelection, pasteSelection, selectAllNodes } = useWorkspaceClipboard({ mousePosition, allNodeNames })

const onPaneClick = () => {
  if (searchQuery.value) {
    clearSearch()
  }
}

/** Focuses the search box and selects its text, so typing replaces the last query. */
const focusSearch = () => {
  const input = searchInputRef.value?.$el
  input?.focus()
  input?.select()
}

/**
 * Centres the view on a node.
 *
 * @param {string} nodeId
 */
function zoomToNode(nodeId) {
  const node = findNode(nodeId)
  if (!node) return

  const x = node.position.x + (node.dimensions?.width || 0) / 2
  const y = node.position.y + (node.dimensions?.height || 0) / 2
  const zoom = 1.2

  setViewport(
    {
      x: dimensions.value.width / 2 - x * zoom,
      y: dimensions.value.height / 2 - y * zoom,
      zoom: zoom,
    },
    { duration: 300 }
  )
}

function handleClearWorkspace() {
  clearWorkspace()
}

function updateHelperLines(changes, nodes) {
  helperLineHorizontal.value = undefined
  helperLineVertical.value = undefined

  if (changes.length === 1 && changes[0].type === 'position' && changes[0].dragging && changes[0].position) {
    const helperLines = getHelperLines(changes[0], nodes)

    // if we have a helper line, we snap the node to the helper line position
    // this is being done by manipulating the node position inside the change object
    changes[0].position.x = helperLines.snapPosition.x ?? changes[0].position.x
    changes[0].position.y = helperLines.snapPosition.y ?? changes[0].position.y

    // if helper lines are returned, we set them so that they can be displayed
    helperLineHorizontal.value = helperLines.horizontal
    helperLineVertical.value = helperLines.vertical
    alignment.value = helperLines.alignment
  }
}

const addHandle = async (side) => {
  for (const node of getSelectedNodes.value) {
    await addHandleToNode(node.id, side)
  }
}

const suppressedEdgeIds = new Set()

const { onNodeChange, onEdgeChange } = useFlowHistory({
  suppressedEdgeIds,
  indexAddEdge,
  indexRemoveEdge,
  updateHelperLines,
  revertHandlesForEdge,
  reactivateEdgeHandles,
})

useConnect({
  suppressedEdgeIds,
  confirm,
  edgeLineOptions,
  confirmActivation,
  activateHandle,
  revertHandleIfUnused,
  revertHandlesForEdge,
  reactivateEdgeHandles,
  recordEdit,
})

// Annotation-driven suggestions, drawn over the canvas but never edges until accepted.
const couplingSuggestions = useCouplingSuggestions({ activateHandle, recordEdit, edgeLineOptions })

const screenshotDisabled = computed(() => nodes.value.length === 0 && vueFlowRef.value !== null)

const loadCellMLData = (
  content,
  filename,
  { notify: shouldNotify = true, trackEvents = true, replaceUnits = true } = {}
) => {
  return new Promise((resolve) => {
    const result = processCellMLData(content)

    if (result.type === 'success') {
      const componentCount = result.components?.length ?? 0
      const unitsCount = result.units.count

      // Register math with the store
      if (componentCount > 0) {
        libraryStore.addMathFile(filename, result.components)
      }

      // Register units with the store
      if (unitsCount > 0) {
        libraryStore.addUnitsFile(
          {
            componentFile: filename,
            model: result.units.model,
          },
          { replace: replaceUnits }
        )
      }

      if (trackEvents) {
        trackEvent('cellml_load_action', {
          category: 'CellML',
          action: 'load_cellml_file',
          label: `Modules: ${componentCount}, Units: ${unitsCount}`,
          file_type: 'cellml',
        })
      }

      if (shouldNotify) {
        if (componentCount > 0 && unitsCount > 0) {
          notify.success({
            title: 'CellML File Loaded',
            message: `Loaded ${componentCount} component${componentCount !== 1 ? 's' : ''} and ${unitsCount} unit${
              unitsCount !== 1 ? 's' : ''
            } from ${filename}.`,
          })
        } else if (componentCount > 0) {
          notify.success({
            title: 'CellML Components Loaded',
            message: `Loaded ${componentCount} component${componentCount !== 1 ? 's' : ''} from ${filename}.`,
          })
        } else if (unitsCount > 0) {
          notify.success({
            title: 'CellML Units Loaded',
            message: `Loaded ${unitsCount} unit${unitsCount !== 1 ? 's' : ''} from ${filename}.`,
          })
        } else {
          notify.info({
            title: 'CellML File Loaded',
            message: `${filename} contained no components or unit definitions.`,
          })
        }
      }

      resolve({ ok: true, componentCount: componentCount, unitsCount: unitsCount })
    } else {
      if (trackEvents) {
        trackEvent('cellml_load_action', {
          category: 'CellML',
          action: 'load_cellml_file',
          label: `Error: encountered ${result.issues.length} error(s)`,
          file_type: 'cellml',
        })
      }
      if (shouldNotify) {
        notify.error({
          title: 'CellML Load Error',
          message: `${result.issues.length} issue${result.issues.length !== 1 ? 's' : ''} found in ${filename}.`,
        })
      }
      console.error('CellML import issues:', result.issues)
      resolve({ ok: false, componentCount: 0, unitsCount: 0 })
    }
  })
}

const { loadCellMLFiles, onDragOver, onFileDragLeave, onDrop, isFileDragOver, dropLoadingMessage } = useCellmlDrop({
  loadCellMLData,
  loadFromCellML,
  rebuildNodeEdgeIndex,
  confirm,
  libcellml,
  processImportedOmexArchive,
  onDragOverModule,
  onDropModule,
})

const loadParametersData = async (content, filename, { notify: shouldNotify = true, trackEvents = true } = {}) => {
  try {
    const variableCatalogue = new Set(nodes.value.flatMap((node) => node.data.variables.map((v) => v.name.trim())))

    // A loaded value never changes a row's type; a computed row's value isn't applied.
    const { variablesById, updated: totalLocal, skipped } = applyParametersToNodes(nodes.value, Array.from(content))
    for (const node of nodes.value) {
      if (variablesById.has(node.id)) node.data.variables = variablesById.get(node.id)
    }

    const globalConstants = Array.from(content)
      .filter((entry) => variableCatalogue.has(entry.variable_name.trimEnd()))
      .map((entry) => ({
        ...entry,
        name: entry.variable_name.trimEnd(),
      }))

    globalConstants.forEach((p) => {
      libraryStore.assignGlobalConstant(p.name, p.value, p.units, p.data_reference)
    })

    const totalGlobal = globalConstants.length

    const totalUpdated = totalLocal + totalGlobal

    // Told even when a batch load quiets its other messages, as these values are dropped.
    if (skipped.length) {
      notify.warning({ title: 'Some Parameters Not Applied', message: skippedParametersMessage(skipped) })
    }

    if (shouldNotify && totalUpdated > 0) {
      if (trackEvents) {
        trackEvent('parameters_load_action', {
          category: 'Parameters',
          action: 'load_parameters',
          label: `Parameters: ${totalUpdated}`,
          file_type: 'csv',
        })
      }
      notify.success({
        title: 'Parameters Loaded',
        message: `Loaded ${totalUpdated} parameters from ${filename}.`,
      })
    } else if (shouldNotify && totalUpdated === 0) {
      notify.info({
        title: 'Parameters Not Loaded',
        message: `No new parameters were added from ${filename}.`,
      })
    }
    return { ok: totalUpdated > 0, count: totalUpdated }
  } catch (err) {
    if (shouldNotify) {
      if (trackEvents) {
        trackEvent('parameters_load_action', {
          category: 'Parameters',
          action: 'load_parameters',
          label: `Error: ${err.message}`,
          file_type: 'csv',
        })
      }
      notify.error({
        title: 'Loading Parameters Error',
        message: `Failed to load parameters from ${filename}.`,
      })
    }
    return { ok: false, count: 0 }
  }
}

const loadConfigData = async (content, filename, { notify: shouldNotify = true } = {}) => {
  try {
    const added = libraryStore.addConfigFile(filename, content)
    if (shouldNotify && added > 0) {
      notify.success({
        title: 'Configurations Loaded',
        message: `Loaded ${added} configurations from ${filename}.`,
      })
    } else if (shouldNotify && added === 0) {
      notify.info({
        title: 'Configurations Not Loaded',
        message: `No new configurations were added from ${filename}.`,
      })
    }
    return { ok: added > 0, count: added }
  } catch (err) {
    if (shouldNotify) {
      notify.error({
        title: 'Loading Configuration Error',
        message: `Failed to load configurations from ${filename}.`,
      })
    }
    return { ok: false, count: 0 }
  }
}

async function loadFlowSnapshot(fileName, flowSnapshot, parameterData = {}, { notify: shouldNotify = true } = {}) {
  if (!flowSnapshot || !flowSnapshot.nodeData || !flowSnapshot.edges) {
    notify.error({
      title: 'Invalid Flow Snapshot',
      message: 'The provided flow snapshot is missing required nodes or edges data.',
    })
    return
  }

  const snapshotMathLibrary =
    flowSnapshot.mathLibrary && typeof flowSnapshot.mathLibrary === 'object' ? flowSnapshot.mathLibrary : {}

  let nodeNameToIdMap = new Map()
  const globalValues = new Map()
  const skippedParameters = []
  // Convert nodeData to nodes format expected by the workspace.
  const nodes = flowSnapshot.nodeData.map((snapshotNode) => {
    let node = snapshotNode
    // Update variables with parameter data if available.
    if (parameterData[node.data.name]) {
      const paramVars = parameterData[node.data.name]
      const result = applyParameterValues(node.data.variables, (name) =>
        paramVars.find((p) => p.name.trimEnd() === name)
      )
      node.data.variables = result.variables
      skippedParameters.push(...result.skipped.map((name) => ({ nodeName: node.data.name, name })))
    }
    // Resolve math from the snapshot math library. Older snapshots keep values in the math, which
    // move into the node's rows here.
    let nodeMathFromSnapshot =
      node.data?.mathHash in snapshotMathLibrary ? snapshotMathLibrary[node.data.mathHash] : undefined
    if (nodeMathFromSnapshot) {
      const separated = separateNodeParameters([node], [[node.data.mathRef, nodeMathFromSnapshot]])
      node = separated.nodes[0]
      nodeMathFromSnapshot = separated.mathEntries[0][1]
      for (const [name, entry] of separated.globalValues) if (!globalValues.has(name)) globalValues.set(name, entry)
    }

    // Check node math is the same as the math in the library store
    const nodeMath = libraryStore.availableMath.get(node.data.mathRef)
    if (nodeMath) {
      if (nodeMathFromSnapshot && nodeMath !== nodeMathFromSnapshot) {
        notify.warning({
          title: 'Math Mismatch',
          message: `The math for node "${node.data.name}" does not match the math in the library store. The library version will be used.`,
        })
      }
      // Remove imported math payloads from runtime node data once the store value is authoritative.
      delete node.data.mathHash
    } else {
      // Put math from the snapshot into the library store.
      if (nodeMathFromSnapshot) {
        libraryStore.addMath(node.data.mathRef, nodeMathFromSnapshot)
      }
      delete node.data.mathHash
    }
    return node
  })

  // Clear the current workspace before loading the new snapshot without creating
  // an extra history step for the reset itself; the imported graph is then added
  // as one batched history action.
  await clearWorkspace({ recordHistory: false })

  historyStore.startBatch()
  try {
    const newNodes = nodes.map((node) => {
      nodeNameToIdMap.set(node.data.name, node.id)
      const allHandles = normaliseHandleSlots([
        ...node.data.handles,
        ...buildGhostHandles(NUM_GHOST_HANDLES_TOP_BOT, NUM_GHOST_HANDLES_LEFT_RIGHT, node.data.handles),
      ])

      const instance = buildInstance(node.id, node.data.name, node.type, node.data, allHandles, node.position)
      // Its ApiCoord binding and reservoir state, which buildInstance doesn't know about.
      withAnnotationData(instance.data, node.data)
      return instance
    })

    addNodes(newNodes)
    addEdges(flowSnapshot.edges)
    const currentLastSaveName = sessionMetadataStore.lastSaveName
    sessionMetadataStore.setLastSaveName(stripExtension(fileName))
    historyStore.addCommand({
      type: 'update-name',
      undo: () => {
        sessionMetadataStore.setLastSaveName(currentLastSaveName)
      },
      redo: () => {
        sessionMetadataStore.setLastSaveName(stripExtension(fileName))
      },
    })
  } finally {
    historyStore.endBatch()
  }

  notify.success({
    title: 'Flow Snapshot Loaded',
    message: 'The flow snapshot has been successfully loaded into the workspace.',
  })
  if (skippedParameters.length) {
    notify.warning({ title: 'Some Parameters Not Applied', message: skippedParametersMessage(skippedParameters) })
  }

  // globalValues: global constant values taken out of older math, for the caller to seed.
  return { nodeNameToIdMap, globalValues }
}

async function processImportedOmexArchive(archivePayload, result, fileName) {
  await builtInLibraryReady
  const archive = await JSZip.loadAsync(archivePayload)
  const manifestFile = archive.file('manifest.xml')
  const manifestXml = manifestFile ? await manifestFile.async('string') : ''

  const archiveEntries = await readArchiveEntries(archive, result)

  const criticalLocations = [
    result.files?.cellml,
    result.files?.simulationJson,
    result.files?.sedml,
    result.files?.flowSnapshot,
  ].filter(Boolean)

  const cellmlFile = archive.file(result.files?.cellml)

  // A CellML file is required for PhLynx to function properly, this should be validated before this point.
  // We will not do nothing if the CellML file is missing, but we will notify the user.
  if (!cellmlFile) {
    notify.error({
      title: 'Missing CellML File',
      message: `The CellML file ${result.files?.cellml} is missing from the OMEX archive. PhLynx will not be able to load this OMEX archive.`,
    })
    return
  }

  const cellmlContent = await cellmlFile.async('string')
  let nodeNameToIdMap = new Map()
  if (result.files?.flowSnapshot) {
    // Best case scenario: we have a flow snapshot, which is the most complete representation of the workspace state.
    const flowSnapshotFile = archive.file(result.files.flowSnapshot)
    if (flowSnapshotFile) {
      const flowSnapshot = JSON.parse(await flowSnapshotFile.async('string'))

      const parameters = loadParametersFromCellML(cellmlContent)
      const loaded = await loadFlowSnapshot(fileName, flowSnapshot, parameters.parameters, { notify: false })
      nodeNameToIdMap = loaded?.nodeNameToIdMap

      for (const p of parameters.globalParameters) {
        libraryStore.assignGlobalConstant(p.name, p.value, p.units, p.data_reference)
      }
      // After the CellML globals, and without overwriting, so a global the CellML doesn't set keeps
      // its value from older math.
      for (const [name, { value, units, data_reference }] of loaded?.globalValues ?? []) {
        libraryStore.assignGlobalConstant(name, value, units, data_reference)
      }
    }
  } else if (result.files?.moduleConfig) {
    // Second best scenario: if we don't have a flow snapshot, we can still load the CellML file and module configuration to build the workspace.
    const moduleConfigFile = archive.file(result.files.moduleConfig)
    console.warn('------------------------------------------')
    console.warn(
      'This case is not fully implemented yet, but we will load the CellML file but the module configuration is not currently used to build the workspace.'
    )
    console.warn('moduleConfigFile', moduleConfigFile)
    const importedCellml = prepareCellmlImport(cellmlContent, result.files.cellml)
    const cellmlPayload = parseCellMLConnections(importedCellml, result.files.cellml)
    await loadCellMLData(importedCellml, result.files.cellml, { notify: false })
    const parameters = loadParametersFromCellML(importedCellml)
    if (!(await loadFromCellML(cellmlPayload, result.files.cellml))) {
      throw new Error(`${result.files.cellml} has no modules to place.`)
    }
  } else {
    // Last, and not great, scenario: if we don't have a flow snapshot or module configuration, we can still load the CellML file to build the workspace.
    const importedCellml = prepareCellmlImport(cellmlContent, result.files.cellml)
    const cellmlPayload = parseCellMLConnections(importedCellml, result.files.cellml)
    await loadCellMLData(importedCellml, result.files.cellml, { notify: false })
    const parameters = loadParametersFromCellML(importedCellml)
    if (!(await loadFromCellML(cellmlPayload, result.files.cellml, parameters))) {
      throw new Error(`${result.files.cellml} has no modules to place.`)
    }
  }

  if (result.files?.simulationJson) {
    const simJsonFile = archive.file(result.files.simulationJson)
    if (simJsonFile) {
      const simData = await extractSimDataFromSimulationJson(await simJsonFile.async('string'), {
        notify: false,
        nodeNameToIdMap,
      })

      if (simData?.plotConfig) {
        simulationSettingsStore.setPlotConfig(simData.plotConfig)
      }

      if (simData?.parameterScanConfig) {
        // Map parameter scan config nodeId and key to use the nodeId from the instance of the node in the workspace.
        const currentParameterScanConfig = simulationSettingsStore.parameterScanConfig
        simulationSettingsStore.setParameterScanConfig({
          ...currentParameterScanConfig,
          ...simData.parameterScanConfig,
        })
      }
    }
  }

  if (result.files?.sedml) {
    const sedmlFile = archive.file(result.files.sedml)
    if (sedmlFile) {
      const simulationSettings = await extractSimDataFromSedml(await sedmlFile.async('string'), result.files.sedml, {
        notify: false,
      })
      const currentSimulationSettings = simulationSettingsStore.simulationSettings
      simulationSettingsStore.setSimulationSettings({
        ...currentSimulationSettings,
        ...simulationSettings,
      })
    }
  }

  // The sidecars and instance files; the nodes' bindings came back with the flow snapshot.
  restoreOmexAnnotations(result.annotations, { libraryStore, annotationStore })

  // Rebuild the edge index so the EdgeConnectionDialog subgraph is correct.
  rebuildNodeEdgeIndex()
  recomputeMissingCouplings()

  await nextTick(fitView(fitViewParams.value))

  const preservedExtras = archiveEntries.filter(({ location }) => !criticalLocations.includes(location))

  const paramsForIdExtra = findParamsForIdExtra(preservedExtras)
  if (paramsForIdExtra) {
    try {
      const rows = parseParamsForId(paramsForIdExtra.entry.payload)
      const { selections, warnings } = resolveParamsForIdRows(rows, nodes.value, libraryStore.getGlobalConstant)
      if (selections.length) {
        let scanConfig = simulationSettingsStore.parameterScanConfig
        for (const selection of selections) scanConfig = putSlider(scanConfig, selection)
        simulationSettingsStore.setParameterScanConfig(scanConfig)
      }
      if (warnings.length) {
        notify.warning({
          title: 'params_for_id.csv',
          message: `${selections.length} slider(s) imported. ${warnings.join(' ')}`,
        })
      }
    } catch (error) {
      notify.warning({ title: 'params_for_id.csv', message: error.message })
    }
  }

  omexStore.setHash(cyrb53(snapshotFlowState()))
  omexStore.setArchive({
    archiveName: fileName,
    archiveType: result.fileType,
    cellmlFileName: result.files?.cellml || DEFAULT_CELLML_FILE_NAME,
    manifestXml,
    extras: preservedExtras,
  })
}

async function onImportConfirm(importPayload, updateProgress) {
  if (currentImportMode.value.key === IMPORT_KEYS.INSTANCE_ARRAY) {
    const instanceArrayFiles = importPayload.get(IMPORT_KEYS.INSTANCE_ARRAY)
    const [[, instanceData]] = instanceArrayFiles
    const instances = instanceData.payload
    const parametersFiles = importPayload.get(IMPORT_KEYS.PARAMETER)

    if (!instances || instances.length === 0) {
      notify.warning({
        title: 'Import Aborted',
        message: 'No instance data provided',
      })
      return
    }

    try {
      await loadFromInstanceArray({ instances }, (current, total, statusMessage) => {
        if (updateProgress) {
          updateProgress(`${statusMessage || 'Loading instance array...'} (${current}/${total})`)
        }
      })

      if (parametersFiles) {
        for (const [filename, data] of parametersFiles) {
          loadParametersData(data.payload, filename, { notify: false })
        }
      }
      rebuildNodeEdgeIndex()

      notify.success({
        title: 'Import Complete',
        message: 'Workflow built successfully!',
      })
    } catch (error) {
      notify.error({
        title: 'Import Failed',
        message: error.message,
      })
    }
  } else if (currentImportMode.value.key === IMPORT_KEYS.CELLML_FILE) {
    const entries = [...importPayload.get(IMPORT_KEYS.CELLML_FILE)].map(([name, data]) => ({
      name,
      content: data?.payload,
    }))
    await loadCellMLFiles(entries)
  } else if (currentImportMode.value.key === IMPORT_KEYS.MODULE_CONFIG) {
    const multiFile = importPayload.size > 1
    const results = await Promise.all(
      [...importPayload.get(IMPORT_KEYS.MODULE_CONFIG)].map(([filename, data]) =>
        loadConfigData(data?.payload, filename, { notify: !multiFile })
      )
    )
    if (multiFile) {
      notifyMultiFileResults(results, { successTitle: 'Configurations Loaded' })
    }
  } else if (currentImportMode.value.key === IMPORT_KEYS.PARAMETER) {
    const multiFile = importPayload.get(IMPORT_KEYS.PARAMETER).size > 1
    const results = await Promise.all(
      [...importPayload.get(IMPORT_KEYS.PARAMETER)].map(([filename, data]) =>
        loadParametersData(data?.payload, filename, { notify: !multiFile })
      )
    )
    if (multiFile) {
      notifyMultiFileResults(results, { successTitle: 'Parameters Loaded' })
    }
  } else if (currentImportMode.value.key === IMPORT_KEYS.TURTLE) {
    const filesOf = (key) =>
      [...(importPayload.get(key) ?? [])].map(([name, data]) => ({ name, text: data?.payload?.text ?? '' }))
    try {
      const [instanceFile] = filesOf(IMPORT_KEYS.API_COORDS)
      preparedAnnotations.value = await readAnnotationFiles({
        sidecarFiles: filesOf(IMPORT_KEYS.TURTLE),
        instanceFile,
      })
      applyAnnotationsVisible.value = true
    } catch (error) {
      notify.error({ title: 'Annotations Import Failed', message: error.message })
    }
  } else if (currentImportMode.value.key === IMPORT_KEYS.OMEX) {
    try {
      const archivePayload = await extractOmexArchive(importPayload, updateProgress)
      const result = await importOmexFile(archivePayload.omex, updateProgress)

      await processImportedOmexArchive(archivePayload.omex, result, archivePayload.name)

      notify.success({
        title: 'OMEX Import Complete',
        message: 'Workflow built successfully!',
      })
    } catch (error) {
      notify.error({
        title: 'OMEX Import Failed',
        message: error.message,
      })
    }
  }

  if (importDialogRef.value) {
    importDialogRef.value.finishLoading()
  }
}

function onOpenInstanceEditorDialog(eventPayload, tab = eventPayload.defaultTab ?? 'parameters') {
  currentEditingNode.value = {
    ...eventPayload,
  }
  instanceEditorDefaultTab.value = tab
  instanceEditorDialogVisible.value = true
}

function onOpenMacroBuilderDialog() {
  macroBuilderDialogVisible.value = true
}

function onOpenSimSettingsDialog() {
  openSimSettingsDialog()
}

function onOpenSettingsDialog() {
  settingsDialogVisible.value = true
}

async function onInstanceEditConfirm(save) {
  const updatedCount = await saveInstanceEdit(save)
  // Applied with the editor kept open: it reloads from the instance as saved.
  if (save.keepOpen) {
    const node = findNode(save.id)
    if (node) {
      currentEditingNode.value = {
        ...currentEditingNode.value,
        name: node.data.name,
        mathRef: node.data.mathRef,
        variables: node.data.variables,
        ports: node.data.ports,
        handles: node.data.handles,
      }
    }
  }
  notify.success({
    title: 'CellML Updated',
    message: `Updated ${updatedCount} node${updatedCount !== 1 ? 's' : ''} to ${save.mathRef.split(':').pop()}.`,
  })
}

const nodeRefs = ref({})

async function onMacroBuilderGenerate(data) {
  handleMacroGeneration(data)
  macroBuilderDialogVisible.value = false
}

function handleMacroGeneration(macroPayload) {
  // Insert at the center of the current view.
  const screenCenterX = dimensions.value.width / 2
  const screenCenterY = dimensions.value.height / 2

  // We approximate the center by negating the viewport x/y.
  const centerX = (screenCenterX - viewport.value.x) / viewport.value.zoom
  const centerY = (screenCenterY - viewport.value.y) / viewport.value.zoom

  processMacroGeneration(macroPayload, { x: centerX, y: centerY })
}

const nodeEdgeIndex = ref(new Map())

function rebuildNodeEdgeIndex() {
  const map = new Map()

  for (const edge of edges.value) {
    if (!map.has(edge.source)) map.set(edge.source, new Set())
    if (!map.has(edge.target)) map.set(edge.target, new Set())

    map.get(edge.source).add(edge.id)
    map.get(edge.target).add(edge.id)
  }

  nodeEdgeIndex.value = map
}

function indexAddEdge(edge) {
  const index = nodeEdgeIndex.value

  if (!index.has(edge.source)) index.set(edge.source, new Set())
  if (!index.has(edge.target)) index.set(edge.target, new Set())

  index.get(edge.source).add(edge.id)
  index.get(edge.target).add(edge.id)
}

function indexRemoveEdge(change) {
  const edge = findEdge(change.id)
  const source = edge?.source ?? change.source
  const target = edge?.target ?? change.target
  const index = nodeEdgeIndex.value

  index.get(source)?.delete(change.id)
  index.get(target)?.delete(change.id)

  if (index.get(source)?.size === 0) index.delete(source)
  if (index.get(target)?.size === 0) index.delete(target)
}

// Extract subgraph (1 degree of separation from the active edge).
function buildEdgeSubgraph(activeEdge) {
  const adjacentIds = new Set([
    ...(nodeEdgeIndex.value.get(activeEdge.source) || []),
    ...(nodeEdgeIndex.value.get(activeEdge.target) || []),
  ])

  const edgeSubgraph = new Map()
  for (const edgeId of adjacentIds) {
    const edge = findEdge(edgeId)
    if (edge) edgeSubgraph.set(edgeId, detachReactivity(edge))
  }
  return edgeSubgraph
}

function onEdgeDoubleClick({ edge }) {
  const sourceNode = findNode(edge.source)
  const targetNode = findNode(edge.target)

  if (!sourceNode || !targetNode) return

  edgeDialogSubgraph.value = buildEdgeSubgraph(edge)
  edgeDialogSourceNode.value = detachReactivity(sourceNode)
  edgeDialogTargetNode.value = detachReactivity(targetNode)
  edgeDialogActiveEdge.value = detachReactivity(edge)
  edgeConnectionDialogVisible.value = true
}

function onEdgeConnectionConfirm({
  sourceNodeId,
  targetNodeId,
  sourcePorts,
  targetPorts,
  couplings,
  foreignCouplings,
}) {
  const nodeIds = [sourceNodeId, targetNodeId]
  recordEdit({
    type: 'edit-connection',
    nodeIds,
    keys: ['ports'],
    edgeIds: findIncidentEdgeIds(nodeIds),
    apply: () => {
      updateNodeData(sourceNodeId, { ports: sourcePorts })
      updateNodeData(targetNodeId, { ports: targetPorts })

      const activeEdge = findEdge(edgeDialogActiveEdge.value?.id)
      if (activeEdge) {
        activeEdge.data = { ...activeEdge.data, couplings }
      }

      // Sibling edges displaced by the user swapping a "taken elsewhere" port.
      for (const [edgeId, updatedCouplings] of Object.entries(foreignCouplings ?? {})) {
        const edge = findEdge(edgeId)
        if (edge) {
          edge.data = { ...edge.data, couplings: updatedCouplings }
        }
      }
    },
  })
}

function onOpenReplacementDialog(eventPayload) {
  currentEditingNode.value = {
    ...eventPayload,
  }
  replacementDialogVisible.value = true
}

async function onReplaceConfirm(updatedData) {
  const { id } = currentEditingNode.value
  if (!id) return
  recordEdit({
    type: 'replace-module',
    nodeIds: [id],
    keys: Object.keys(updatedData),
    apply: () => updateNodeData(id, updatedData),
  })
  replacementDialogVisible.value = false
}

function onOpenInspectionModuleDialog(module = null) {
  editingInspectionModule.value = module
  inspectionModuleDialogVisible.value = true
}

function handleCreateInspectionModule(payload) {
  const variableCount = payload.variables.length
  const variableLabel = `${variableCount} variable${variableCount === 1 ? '' : 's'}`

  if (payload.id) {
    inspectionModuleStore.updateModule(payload.id, payload)
    notify.success({
      title: 'Inspection Module Updated',
      message: `"${payload.name}" now uses ${variableLabel}.`,
    })
  } else {
    inspectionModuleStore.addModule(payload)
    notify.success({
      title: 'Inspection Module Created',
      message: `"${payload.name}" now sums ${variableLabel}.`,
    })
  }
}

const contextMenuRef = ref(null)
const contextSidebarRef = ref(null)
// The floating viewer's way back to the Simulation tab, and out of the canvas's way.
const floatingViewer = useFloatingViewer()
floatingViewer.setTabOpener(() => contextSidebarRef.value?.showTab('sim'))
floatingViewer.setSidebarCollapser(() => contextSidebarRef.value?.collapse())
const { run: runSimulation } = useSimulation()
const simulationResultsStore = useSimulationResultsStore()

const paneContextMenuItems = [
  {
    label: 'Create Module',
    action: () => createNewInstanceAtPosition(mousePosition.value.x, mousePosition.value.y),
  },
  {
    label: 'Select All',
    action: () => selectAllNodes(),
  },
  {
    label: 'Fit View',
    action: () => fitView(fitViewParams.value),
  },
  {
    label: 'Clear Workspace',
    action: () => handleClearWorkspace(),
  },
]

const contextMenuItems = ref(paneContextMenuItems)

function onPaneContextMenu(event) {
  event.preventDefault()
  contextMenuItems.value = paneContextMenuItems
  contextMenuRef.value.open(event.clientX, event.clientY)
}

function onNodeContextMenu({ clientX, clientY, id }) {
  contextMenuItems.value = [
    {
      label: 'Replace Module',
      action: () => {
        const node = findNode(id)
        if (!node) return
        onOpenReplacementDialog(node)
      },
    },
    {
      label: simulateLabelFor(id),
      action: () => simulateFromNode(id),
    },
  ]
  contextMenuRef.value.open(clientX, clientY)
}

/**
 * Gets the nodes a node's Simulate menu item runs: its selection, or the node alone when it isn't selected.
 *
 * @param {string} id
 * @returns {string[]}
 */
function simulationScopeFor(id) {
  const selectedIds = getSelectedNodes.value.map((node) => node.id)
  return selectedIds.includes(id) ? selectedIds : [id]
}

/**
 * Names a node's Simulate menu item by what it will run.
 *
 * @param {string} id
 * @returns {string}
 */
function simulateLabelFor(id) {
  const count = simulationScopeFor(id).length
  return count > 1 ? `Simulate Selection (${count})` : 'Simulate Instance'
}

/**
 * Simulates a node's selection, or the node alone, and shows the Simulation tab.
 *
 * @param {string} id
 */
function simulateFromNode(id) {
  const scope = [...simulationScopeFor(id)].sort()
  // The canvas selection becomes what runs, so the Simulation tab doesn't see it as changed.
  if (!getSelectedNodes.value.some((node) => node.id === id)) {
    removeSelectedNodes(getSelectedNodes.value)
    addSelectedNodes([findNode(id)].filter(Boolean))
  }
  contextSidebarRef.value?.showTab('sim')
  simulationResultsStore.scopeMode = 'selection'
  runSimulation(scope)
}

function createNewInstanceAtPosition(clientX, clientY) {
  const module = libraryStore.availableModules.get(NEW_INSTANCE_MODULE_REF)

  const position = screenToFlowCoordinate({ x: clientX, y: clientY })
  createInstanceNode(module, position)
}

function handleAutoLayout() {
  relayoutNodes(nodes.value, edges.value)
}

/**
 * Collects all state and processes it into the current export format.
 */
async function onExportConfirm(fileName, handle) {
  if (activeExportNotification.value) {
    activeExportNotification.value.close()
    activeExportNotification.value = null
  }

  const exportMode = currentExportMode.value

  const notification = notify.info({
    title: 'Exporting...',
    message: exportMode.message,
    duration: 0,
  })

  try {
    const finalName = fileName || sessionMetadataStore.lastSaveName

    if (!exportMode.action) {
      throw new Error(`The ${exportMode.label} export isn't implemented yet.`)
    }

    const blob = await exportMode.action(finalName)

    const result = await saveWithDialog(blob, handle, finalName, exportMode.suffix)

    notification.close()

    const exportMessage = exportMode.successMessage
      ? await exportMode.successMessage(blob, finalName)
      : `${exportMode.label} export generated.`

    trackEvent('export_action', {
      category: 'Export',
      action: 'export_model',
      label: `File: ${finalName}`,
      file_type: exportMode.key,
    })

    activeExportNotification.value = notify.success({
      title: 'Export successful!',
      message: exportMessage,
      duration: 0,
    })
  } catch (error) {
    notification.close()
    trackEvent('export_action', {
      category: 'Export',
      action: 'export_model',
      label: `Error: ${error.message}`,
      file_type: exportMode.key,
    })

    notify.error({ title: 'Export failed', message: `${error.message}` })
  }
}

/**
 * Recomputes port-label couplings for edges that have none — e.g. files saved
 * before couplings were introduced, or where edge data was lost on serialisation.
 * Uses the same ordinal-index logic as the live onConnect handler so results
 * are identical to a freshly drawn connection. Might not need in future.
 */
function recomputeMissingCouplings() {
  const nodeMap = new Map(nodes.value.map((n) => [n.id, n]))

  // Normalise ports on every node: migrate legacy field names.
  for (const node of nodes.value) {
    if (!node.data?.ports) continue
    node.data.ports = node.data.ports.map((p) => ({
      ...p,
      multiportType: p.multiportType ?? 'None',
    }))
  }

  // Track inbound/outbound ordinal counts per node, matching buildEdges semantics.
  const sourceOutCount = new Map()
  const targetInCount = new Map()

  for (const edge of edges.value) {
    if (edge.data?.couplings?.length) continue // already has valid couplings

    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (!sourceNode || !targetNode) continue

    const sourceIndex = sourceOutCount.get(edge.source) ?? 0
    const targetIndex = targetInCount.get(edge.target) ?? 0

    const couplings = resolvePortCouplings(
      sourceNode.data.ports ?? [],
      targetNode.data.ports ?? [],
      sourceIndex,
      targetIndex
    )

    if (couplings.length) {
      edge.data = { ...edge.data, couplings }
    }

    sourceOutCount.set(edge.source, sourceIndex + 1)
    targetInCount.set(edge.target, targetIndex + 1)
  }
}

/**
 * Snapshots the flow (nodes, edges, math and global parameters) as JSON, for OMEX archives and for
 * detecting changes since one was imported.
 *
 * @param {string[]|null} [nodeIds] - Only these nodes and the edges between them, or every node.
 * @returns {string} The snapshot JSON.
 */
function snapshotFlowState(nodeIds = null) {
  const flowState = scopeFlowObject(toObject(), nodeIds)
  const mathLibrary = new Map()

  const nodeData = flowState.nodes.map((node) => {
    const { handles, ...restData } = node.data ?? {}
    const slimNode = {
      id: node.id,
      data: {
        ...restData,
        handles: handles?.filter((handle) => handle.variant !== 'ghost') ?? [],
      },
      position: node.position,
      dimensions: node.dimensions,
      type: node.type,
    }

    if (slimNode.data?.mathRef) {
      const mathRef = slimNode.data.mathRef
      const mathText = libraryStore.availableMath.get(mathRef)
      if (mathText) {
        const baseHash = libraryStore.getMathHashByRef(mathRef) ?? libraryStore.createMathHash(mathText)
        let mathHash = baseHash
        let collisionIndex = 1

        while (mathLibrary.has(mathHash) && mathLibrary.get(mathHash) !== mathText) {
          mathHash = `${baseHash}_${collisionIndex++}`
        }

        mathLibrary.set(mathHash, mathText)
        slimNode.data.mathHash = mathHash
      }
    }

    return slimNode
  })

  const mathLibraryObject = Object.fromEntries([...mathLibrary.entries()].sort(([a], [b]) => a.localeCompare(b)))

  return JSON.stringify({
    id: 'phlynx-flow-snapshot',
    version: PHLYNX_PROJECT_VERSION,
    nodeData,
    edges: flowState.edges,
    mathLibrary: mathLibraryObject,
    globalParameters: Array.from(libraryStore.globalVariables.entries()),
  })
}

const { handleSaveWorkspace, onSaveConfirm, applyWorkspaceState } = useWorkspaceSaveLoad({
  saveDialogVisible,
  nodes,
  edges,
  toObject,
  fromObject,
  setViewport,
  rebuildNodeEdgeIndex,
  recomputeMissingCouplings,
})

/**
 * Reads a JSON file and restores the application state. Clears the file input, so re-picking the
 * same file loads it again.
 */
async function handleLoadWorkspace(event) {
  const file = event?.target ? takeInputFile(event) : event?.raw || event
  if (!file) return

  const apply = async (state) => {
    await builtInLibraryReady
    await applyWorkspaceState(state, { source: 'json' })
  }
  if (await loadWorkspaceFile(file, apply)) {
    sessionMetadataStore.setLastSaveName(stripExtension(file.name))
  }
}

const urlLoaders = createUrlLoaders({
  applyWorkspaceState,
  importOmexFile,
  processImportedOmexArchive,
  libraryReady: builtInLibraryReady,
})

const { load: loadFromUrl, isLoading: isUrlLoading } = useLoadFromUrl()

const handleUndo = () => {
  historyStore.undo()
}

const handleRedo = () => {
  historyStore.redo()
}

/**
 * Runs a capture with nothing selected, so selection outlines, resize grips and highlighted edges
 * stay out of the image, then puts the selection back.
 */
async function withoutSelection(captureFn) {
  const selectedNodes = getSelectedNodes.value.slice()
  const selectedEdges = getSelectedEdges.value.slice()
  selectedNodes.forEach((n) => (n.selected = false))
  selectedEdges.forEach((e) => (e.selected = false))
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  try {
    return await captureFn()
  } finally {
    selectedNodes.forEach((n) => (n.selected = true))
    selectedEdges.forEach((e) => (e.selected = true))
  }
}

const imageExportTitle = computed(
  () => `Export image (${appSettings.imageExportFormat.toUpperCase()}); format and warnings are in Settings`
)

/**
 * Exports the canvas in the format chosen in Settings. Edit buttons are always hidden, warning badges
 * unless Settings asks for them; hiding (rather than removing) keeps the rest of each card in place.
 */
function doImageExport() {
  return exportImageOf({ root: vueFlowRef.value, viewport: viewport.value })
}

/**
 * Exports one view's canvas. The physiological view's selection follows the diagram's, so
 * withoutSelection clears both.
 *
 * @param {{root: HTMLElement, viewport: Object}} view
 */
async function exportImageOf({ root, viewport: shownViewport }) {
  const format = appSettings.imageExportFormat
  const includeWarnings = appSettings.imageExportWarnings
  return withoutSelection(async () => {
    root.classList.add('image-export')
    root.classList.toggle('image-export--no-warnings', !includeWarnings)

    try {
      await capture(root, { format: format, viewport: shownViewport, includeWarnings, shouldDownload: true })
      if (captureError.value) {
        notify.error({
          title: 'Screenshot error',
          message: 'Something went wrong while taking the screenshot.\n - ' + captureError.value.message,
        })
      }
    } finally {
      root.classList.remove('image-export', 'image-export--no-warnings')
    }
  }).catch((err) => notify.error({ title: 'Image export failed', message: err?.message ?? String(err) }))
}

const handleKeyDown = (event) => {
  if (shouldIgnoreShortcut(event, dialogVisible.value)) return

  const isCtrl = event.ctrlKey || event.metaKey
  const isShift = event.shiftKey

  if (isCtrl && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    copySelection()
  }

  // Pasting places by the diagram's coordinates, so it waits for the diagram.
  if (isCtrl && event.key.toLowerCase() === 'v' && !viewMode.isBio) {
    event.preventDefault()
    pasteSelection(true)
  }

  if (isCtrl && event.key.toLowerCase() === 'd' && !viewMode.isBio) {
    event.preventDefault()
    copySelection()
    pasteSelection()
  }

  if (isCtrl && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    selectAllNodes()
  }

  if (isCtrl && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (somethingAvailable.value) handleSaveWorkspace()
  }

  const undoRedoAction = getUndoRedoAction(event)
  if (undoRedoAction === 'undo' && historyStore.canUndo) {
    event.preventDefault()
    handleUndo()
  }
  if (undoRedoAction === 'redo' && historyStore.canRedo) {
    event.preventDefault()
    handleRedo()
  }

  if (isCtrl && event.key.toLowerCase() === 'e' && !currentExportDisabled.value) {
    event.preventDefault()
    triggerCurrentExport()
  }

  if (isCtrl && event.key.toLowerCase() === 'i' && !currentImportDisabled.value) {
    event.preventDefault()
    triggerCurrentImport()
  }

  // Search shortcuts
  if (!viewMode.isBio && ((isCtrl && event.key.toLowerCase() === 'f') || (event.key === '/' && !isCtrl && !event.altKey))) {
    event.preventDefault()
    focusSearch()
  }

  if (event.key === 'Escape' && searchQuery.value) {
    clearSearch()
  }
}

async function fetchAndLoadResource(entry, resourceType) {
  try {
    const url = getUrlForResource(entry.path)

    // Fetch resource content
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch ${entry.name}`)

    // Process the response
    const content = await response.text()

    // Load the content
    if (resourceType === 'cellml module' || resourceType === 'cellml units') {
      await loadCellMLData(content, entry.file ?? entry.name, { notify: false, replaceUnits: false })
    } else if (resourceType === 'module config') {
      await loadConfigData(content, entry.name, false)
      // const jsonContent = JSON.parse(content)
      // libraryStore.addConfigFile(jsonContent, entry.name, false)
    } else if (resourceType === 'parameter file') {
      const parsed = await parseParametersFile(content)
      await loadParametersData(parsed, entry.name, { notify: false })
    }

    return true
  } catch (err) {
    return false
  }
}

const cellmlModules = import.meta.glob('../assets/modules/*.cellml', {
  query: 'raw',
  eager: true,
})

const cellmlUnits = import.meta.glob('../assets/units/*.cellml', {
  query: 'raw',
  eager: true,
})

const moduleConfigs = import.meta.glob('../assets/module_configs/*.json', {
  eager: true,
})

/**
 * Binds libCellML and adds the bundled modules, units and configs to the library. Never waits on the network, and
 * never displaces a units file already loaded under the same name, such as a workspace's own units.cellml.
 */
const registerBuiltInLibrary = async () => {
  await bindLibCellML(libcellmlReadyPromise)

  const promises = []
  for (const [path, content] of Object.entries(cellmlModules)) {
    promises.push(loadCellMLData(content.default, path.split('/').pop(), { notify: false }))
  }

  for (const [path, content] of Object.entries(cellmlUnits)) {
    promises.push(loadCellMLData(content.default, path.split('/').pop(), { notify: false, replaceUnits: false }))
  }

  const results = await Promise.all(promises)
  const successCount = results.filter((result) => result?.ok).length
  const failCount = results.length - successCount

  if (successCount > 0) {
    notify.success({
      title: 'Resource Loading',
      message: `Successfully loaded ${successCount} file${successCount > 1 ? 's' : ''}.`,
    })
  }

  if (failCount > 0) {
    if (successCount > 0) await nextTick()
    notify.warning({
      title: 'Resource Loading',
      message: `${failCount} file${failCount > 1 ? 's' : ''} failed to load.`,
    })
  }

  for (const [path, content] of Object.entries(moduleConfigs)) {
    libraryStore.addConfigFile(path.split('/').pop(), content.default)
  }
}

const hydrateCellmlAndDependents = async () => {
  // Waits on the built-in library too, so manifest entries would land after it.
  const [manifest] = await Promise.all([loadManifest(), builtInLibraryReady])

  // const printPurgeUrl = false
  // if (printPurgeUrl) {
  //   console.log(getPurgedUrlForResource())
  // }

  // const promises = []
  // if (manifest?.modules) {
  //   for (const entry of manifest.modules) {
  //     if (printPurgeUrl) {
  //       console.log(getPurgedUrlForResource(entry.path))
  //     }
  //     promises.push(fetchAndLoadResource(entry, 'cellml module'))
  //   }
  // }

  // if (manifest?.units) {
  //   for (const entry of manifest.units) {
  //     if (printPurgeUrl) {
  //       console.log(getPurgedUrlForResource(entry.path))
  //     }
  //     promises.push(fetchAndLoadResource(entry, 'cellml units'))
  //   }
  // }

  // if (manifest?.parameters) {
  //   for (const entry of manifest.parameters) {
  //     if (printPurgeUrl) {
  //       console.log(getPurgedUrlForResource(entry.path))
  //     }
  //     promises.push(fetchAndLoadResource(entry, 'parameter file'))
  //   }
  // }

  // if (manifest?.configs) {
  //   for (const entry of manifest.configs) {
  //     if (printPurgeUrl) {
  //       console.log(getPurgedUrlForResource(entry.path))
  //     }
  //     promises.push(fetchAndLoadResource(entry, 'module config'))
  //   }
  // }

  // await Promise.all(promises)

  return manifest
}

onMounted(async () => {
  setWorkspaceMounted(true)

  void registerBuiltInLibrary()
    .catch((error) => {
      console.error('Failed to initialize libCellML resources in background:', error)
    })
    .finally(markBuiltInLibraryReady)

  void hydrateCellmlAndDependents().catch((error) => {
    console.error('Failed to load the resource manifest:', error)
  })

  await loadFromUrl(urlLoaders, (message) => {
    notify.error({ title: 'Failed to load from link', message })
  })
})

const onMouseMove = (event) => {
  mousePosition.value = { x: event.clientX, y: event.clientY }
}

// Canvas shortcuts act only while the canvas shows, not from another page.
useActiveDocumentListeners({ keydown: handleKeyDown, mousemove: onMouseMove })

onUnmounted(() => setWorkspaceMounted(false))

watch(
  () => route.path,
  (path) => {
    if (path !== '/') {
      toast.removeAllGroups()
    }
  },
  { immediate: true }
)

watch(
  contextSidebarWidth,
  (newWidth) => {
    document.documentElement.style.setProperty('--context-sidebar-width', `${newWidth}px`)
  },
  { immediate: true }
)

</script>

<style>
/* ==========================================================================
   1. App Layout, Header & Sidebar
   ========================================================================== */
.app-layout-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  background-color: var(--p-content-background);
  color: var(--p-text-color);
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: var(--view-header-height);
  /* Its height whatever the sidebar holds, rather than squeezed by a tall Simulation tab. */
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 var(--view-header-padding-x);
  border-bottom: 1px solid var(--p-content-border-color);
  background-color: var(--p-content-background);
}

.p-dark .app-header {
  background-color: var(--p-surface-900);
  border-bottom-color: var(--p-surface-800);
}

.file-uploads,
.file-io-buttons,
.header-right-actions {
  display: flex;
  align-items: center;
}

.report-link {
  color: var(--p-primary-color);
  font-weight: 500;
  text-decoration: none;
}

.report-link:hover {
  text-decoration: underline;
}

.app-body-container {
  position: relative;
  display: flex;
  flex-grow: 1;
  min-height: 0;
}

/* ==========================================================================
   2. Workbench Main Canvas
   ========================================================================== */
.workbench-main {
  position: relative;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  padding: 0;
  flex-grow: 1;
}

.dnd-flow {
  position: relative;
  width: 100%;
  height: 100%;
}

/* Hidden rather than removed, so its nodes stay measured while the physiological view is shown.
   Not visibility: vue-flow marks each measured node visible, which would show through. */
.main-flow--hidden {
  opacity: 0;
  pointer-events: none;
}

.bio-flow-layer {
  position: absolute;
  inset: 0;
}

/* Tutorial Slate Background for Dark Mode */
.p-dark .workbench-main {
  background-color: #2d3748;
  color: #fffffb;
}

/* Control box library aside adjustment */
.vue-flow__controls {
  transform: translateX(var(--library-panel-width, 0px));
  transition: transform 160ms ease;
}

/* Vue Flow Edges */
.vue-flow__connection-path,
.vue-flow__edge-path {
  stroke-width: 5px;
}

.vue-flow__edge.selected .vue-flow__edge-path {
  stroke: var(--p-primary-color);
  stroke-width: 7px;
}

.flow-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: color-mix(in srgb, var(--p-content-background, #18181b) 85%, transparent);
  backdrop-filter: blur(4px);
  z-index: 20;
  color: var(--p-text-muted-color, #909399);
  font-size: 20px;
  font-weight: 500;
}

.loading-icon {
  font-size: 22px;
  color: var(--p-primary-color, #409eff);
}

.file-drop-overlay {
  position: absolute;
  inset: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 2px dashed var(--p-primary-color, #409eff);
  border-radius: 8px;
  background: color-mix(in srgb, var(--p-primary-color, #409eff) 8%, transparent);
  color: var(--p-primary-color, #409eff);
  font-size: 18px;
  font-weight: 500;
  pointer-events: none;
  z-index: 20;
}

.file-drop-icon {
  font-size: 32px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease-in-out;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ==========================================================================
   3. Vue Flow Elements 
   ========================================================================== */
/* Controls Toolbar Container */
.p-dark .vue-flow__controls {
  background-color: #333;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

/* Controls Buttons */
.p-dark .vue-flow__controls-button {
  background-color: #333;
  color: #fffffb;
  fill: #fffffb;
  border: none;
}

/* Hover & Active States (Prevents white background) */
.p-dark .vue-flow__controls-button:hover,
.p-dark .vue-flow__controls-button:active,
.p-dark .vue-flow__controls-button.active {
  background-color: #4d4d4d;
  color: #fffffb;
  fill: #fffffb;
}

/* Disabled Controls Button */
.p-dark .vue-flow__controls-button:disabled {
  background-color: #333;
  color: #fffffb;
  fill: #fffffb;
  opacity: 0.4;
}

/* Nodes */
.p-dark .vue-flow__node {
  background-color: #4a5568;
  color: #fffffb;
}

.p-dark .vue-flow__node.selected {
  background-color: #333;
  box-shadow: 0 0 0 2px #2563eb;
}

/* Edge Labels */
.p-dark .vue-flow__edge-textbg {
  fill: #292524;
}

.p-dark .vue-flow__edge-text {
  fill: #fffffb;
}

/* ==========================================================================
   4. Search Bar & Highlights
   ========================================================================== */
.workspace-search-container {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  width: 15.5rem;
  max-width: calc(100% - 32px);
  transition:
    opacity 0.3s ease,
    width 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.workspace-search-container.search-mode-var {
  width: 24rem;
}

.workspace-search-container.search-inactive {
  opacity: 0.5;
}

.workspace-search-container:hover {
  opacity: 1;
}

.workspace-search-input-wrapper {
  position: relative;
}

.search-placeholder {
  position: absolute;
  left: 2.5rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: #8b949e;
  font-size: 0.875rem;
  pointer-events: none;
  white-space: nowrap;
}

.search-placeholder kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.2rem;
  height: 1.25rem;
  padding: 0 0.25rem;
  border: 1px solid #d0d7de;
  border-radius: 4px;
  background: #f6f8fa;
  color: #57606a;
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1;
  box-shadow: 0 1px 0 rgba(27, 31, 36, 0.04);
}

.search-clear-input:hover {
  color: var(--p-text-color);
}

.search-match-count {
  font-size: 12px;
  color: var(--p-text-muted-color);
  padding-right: 8px;
}

.search-suffix-content {
  display: flex;
  flex-direction: column;
  background: var(--p-content-background);
  border-radius: 4px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--p-text-color) 15%, transparent);
  overflow: hidden;
}

.search-suffix-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 4px 8px;
}

.search-nav-buttons {
  display: flex;
  gap: 2px;
}

.search-match-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 168px;
  overflow-y: auto;
  border-top: 1px solid var(--p-content-border-color, color-mix(in srgb, var(--p-text-color) 10%, transparent));
}

.search-match-item {
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--p-text-color);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-match-item:hover {
  background: color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.search-match-item.active {
  background: color-mix(in srgb, var(--p-primary-color) 15%, transparent);
  color: var(--p-primary-color);
  font-weight: 600;
}

.search-match-vars {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-empty {
  margin: 0;
  padding: 4px 2px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.cursor-pointer {
  cursor: pointer;
}

/* While exporting an image: never the edit controls or coupling suggestions, and warnings only when Settings asks. */
.image-export .instance-button,
.image-export .suggestion-layer,
.image-export .suggestion-panel,
.image-export .delete-handle-popover-btn,
.image-export .vue-flow__resize-control,
.image-export--no-warnings .status-indicator,
.image-export--no-warnings .coupling-edge-warning {
  visibility: hidden !important;
}
</style>
