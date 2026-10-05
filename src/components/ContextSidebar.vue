<template>
  <div class="resizable-context-panel">
    <div
      class="resize-handle"
      :class="{ 'resize-handle--disabled': isCollapsed }"
      @mousedown="!isCollapsed && startResize($event)"
    >
      <button
        type="button"
        class="aside-collapse-toggle"
        @mousedown.stop
        @click="toggleCollapsed"
        v-tooltip.left="isCollapsed ? 'Show context panel' : 'Hide context panel'"
      >
        <i :class="isCollapsed ? 'pi pi-chevron-left' : 'pi pi-chevron-right'"></i>
      </button>
    </div>

    <aside
      :style="{ width: isCollapsed ? '0px' : width + 'px' }"
      class="context-aside"
      :class="{ 'context-aside--collapsed': isCollapsed }"
    >
      <Tabs v-model:value="activeTabId" class="context-tabs">
        <TabList>
          <Tab v-for="tab in tabs" :key="tab.id" :value="tab.id" v-tooltip.right="tab.label">
            <i :class="['pi', tab.icon]"></i>
          </Tab>
        </TabList>

        <TabPanels>
          <!-- ── Global functions & constants ──────────────────────────────── -->
          <TabPanel value="global">
            <section class="context-section context-section--global">
              <h4 class="context-section-title">Global Constants <span class="context-count">({{ globalConstantRows.length }})</span></h4>

              <IconField class="table-search-input" v-if="globalConstantRows.length > 0">
                <InputIcon class="pi pi-search" />
                <InputText
                  v-model="globalConstantSearch"
                  placeholder="Search constants..."
                  size="small"
                  class="w-full"
                />
                <InputIcon v-if="globalConstantSearch" class="search-clear-input pi pi-times-circle" @click="clearSearch"/>
              </IconField>

                <div v-if="globalConstantRows.length === 0" class="empty-hint">
                  No global constants defined yet.
                </div>

                <div v-else-if="filteredGlobalConstantRows.length === 0" class="empty-hint">
                  No constants match your search.
                </div>

                <div v-else class="table-flex-wrapper" style="margin-top: 0.5rem;">
                  <DataTable
                    :value="filteredGlobalConstantRows"
                    dataKey="name"
                    scrollable
                    scrollHeight="flex"
                    class="p-datatable-sm parameters-table"
                    :rowClass="(row) => newlyAddedNames.has(row.name) ? 'global-constant-row--new' : ''"
                  >
                    <Column field="name" bodyClass="small-text-col" header="Name" style="min-width: 90px">
                      <template #body="slotProps">
                        <span :title="slotProps.data.name">{{ slotProps.data.name }}</span>
                      </template>
                    </Column>
                    
                    <Column field="value" header="Value" style="width: 110px">
                      <template #body="slotProps">
                        <InputText
                          v-model="slotProps.data.value"
                          size="small"
                          class="w-full"
                          placeholder="Value..."
                          @change="handleGlobalConstantChange(slotProps.data)"
                        />
                      </template>
                    </Column>
                    
                    <Column field="units" bodyClass="small-text-col" header="Units" style="min-width: 80px">
                      <template #body="slotProps">
                        <span :title="slotProps.data.units">{{ slotProps.data.units || '—' }}</span>
                      </template>
                    </Column>
                  </DataTable>
                </div>
            </section>
          </TabPanel>

          <!-- ── Parameters of the selected node ─────────────────────────────── -->
          <TabPanel value="params">
            <h4 class="context-section-title">Instance Parameters</h4>
            <section class="context-section context-section--params">
              <template v-if="selectedNode && !isMultipleSelected">
                <h4 class="context-section-title">
                  {{ `${parameterRowsNode?.data?.name ?? selectedNode.data?.name}` || 'Selected Instance' }}
                  <span class="context-count">({{ parameterRows.length }})</span>
                </h4>

                <IconField class="table-search-input" v-if="parameterRows.length > 0">
                  <InputIcon class="pi pi-search" />
                  <InputText
                    v-model="parameterSearch"
                    placeholder="Search parameters..."
                    size="small"
                    class="w-full"
                  />
                  <InputIcon v-if="parameterSearch" class="search-clear-input pi pi-times-circle" @click="clearSearch"/>
                </IconField>

                <div v-if="!parameterRowsNode" />

                <div v-else-if="parameterRows.length === 0" class="empty-hint">
                  This instance has no parameters.
                </div>

                <div v-else-if="filteredParameterRows.length === 0" class="empty-hint">
                  No parameters match your search.
                </div>

                <div v-else-if="isParamsVisible" class="table-flex-wrapper">
                  <DataTable
                    :key="parameterTableKey"
                    :value="filteredParameterRows"
                    dataKey="name"
                    scrollable
                    scrollHeight="flex"
                    :virtualScrollerOptions="parameterVirtualScrollerOptions"
                    class="p-datatable-sm parameters-table"
                  >
                    <Column field="name" bodyClass="small-text-col" header="Name" style="min-width: 90px" />
                    <Column field="value" header="Value" style="min-width: 70px">
                      <template #body="slotProps">
                        <InputText
                          v-if="hasValueCell(slotProps.data.type)"
                          v-model="slotProps.data.value"
                          size="small"
                          :placeholder="valuePlaceholder(slotProps.data.type)"
                          class="w-full"
                          @change="handleParameterValueChange(slotProps.data)"
                        />
                        <span v-else class="text-muted">-</span>
                      </template>
                    </Column>
                    <Column field="units" bodyClass="small-text-col" header="Units" style="min-width: 80px" />
                    <Column field="type" header="Type" style="width: 100px">
                      <template #body="slotProps">
                        <Select
                          v-model="slotProps.data.type"
                          :options="typeOptionsFor(slotProps.data)"
                          :disabled="isTypeFixed(slotProps.data)"
                          optionLabel="label"
                          optionValue="value"
                          size="small"
                          class="w-full"
                          @change="handleParameterTypeChange(slotProps.data)"
                        />
                      </template>
                    </Column>
                  </DataTable>
                </div>
              </template>
              <div v-else-if="isMultipleSelected" class="empty-state">
                <i class="pi pi-info-circle empty-state-icon"></i>
                <p>Parameter inspector is restricted to a single instance</p>
              </div>

              <div v-else class="empty-state">
                <i class="pi pi-info-circle empty-state-icon"></i>
                <p>Select an instance to edit its parameters here.</p>
              </div>
            </section>
          </TabPanel>

          <TabPanel value="props">
            <section class="context-section context-section--global">
              <h4 class="context-section-title">Properties</h4>
            </section>
          </TabPanel>

          <TabPanel value="sysmod">
            <section class="context-section context-section--modules">
              <div class="modules-header">
                <h4 class="context-section-title">
                  Inspection Modules
                  <span class="context-count">({{ inspectionModuleStore.modules.length }})</span>
                </h4>
                <Button
                  label="New"
                  icon="pi pi-plus"
                  size="small"
                  outlined
                  @click="emit('open-inspection-module-dialog')"
                />
              </div>

              <div v-if="inspectionModuleStore.modules.length === 0" class="empty-hint">
                No inspection modules yet. Create one to sum variables that share the same units.
              </div>

              <div v-else class="module-card-list">
                <div v-for="module in inspectionModuleStore.modules" :key="module.id" class="module-card">
                  <div class="module-card-header">
                    <div class="module-card-title-group">
                      <Button
                        icon="pi pi-pencil"
                        text
                        rounded
                        size="small"
                        v-tooltip.top="'Edit module'"
                        @click="emit('open-inspection-module-dialog', module)"
                      />
                      <span class="module-card-name" :title="module.name">{{ module.name }}</span>
                    </div>
                    <div class="module-card-actions">
                      <span class="module-card-units-badge">{{ module.units || '—' }}</span>
                      <Button
                        icon="pi pi-trash"
                        text
                        rounded
                        size="small"
                        severity="danger"
                        v-tooltip.top="'Delete module'"
                        @click="inspectionModuleStore.removeModule(module.id)"
                      />
                    </div>
                  </div>
                  <ul class="module-card-variable-list">
                    <li v-for="variable in module.variables" :key="variable.key" class="module-card-variable-item">
                      <span class="module-card-variable-sign" :class="{ negative: variable.sign === -1 }">
                        {{ variable.sign === -1 ? '-' : '+' }}
                      </span>
                      <span class="module-card-variable-node">{{ variable.nodeName }}</span>
                      <span class="module-card-variable-sep">·</span>
                      <span class="module-card-variable-name">{{ variable.variableName }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </aside>
  </div>
</template>

<script setup>
import { computed, onUnmounted, ref, shallowRef, toRaw, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import InputIcon from 'primevue/inputicon'
import IconField from 'primevue/iconfield'

import { FLOW_IDS } from '../utils/constants'
import { isTypeFixed, typeOptionsFor } from '../utils/parameterRows'
import { detachReactivity } from '../utils/reactivity'
import { hasValueCell, valuePlaceholder } from '../utils/variables'

import { useNodeDataHistory } from '../composables/useNodeDataHistory'
import { useResizableAside } from '../composables/useResizableAside'
import { useVirtualScrollerOptions } from '../composables/useVirtualScrollerOptions'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useLibraryStore } from '../stores/libraryStore'

const props = defineProps({
  initialWidth: {
    type: Number,
    default: 320,
  },
  minWidth: {
    type: Number,
    default: 260,
  },
  maxWidth: {
    type: Number,
    default: 480,
  },
})

const emit = defineEmits(['resize', 'open-inspection-module-dialog'])

const { width, startResize } = useResizableAside(props.initialWidth, props.minWidth, props.maxWidth, 'right')
const isCollapsed = ref(true)

const effectiveWidth = computed(() => (isCollapsed.value ? 0 : width.value))
watch(effectiveWidth, (newWidth) => emit('resize', newWidth), { immediate: true })

function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value
}

function clearSearch() {
  globalConstantSearch.value = ''
  parameterSearch.value = ''
}

// ── Vertical tab navigation ──────────────────────────────────────────────
const tabs = [
  { id: 'global', label: 'Global parameters', icon: 'pi-globe' },
  { id: 'params', label: 'Instance parameters', icon: 'pi-sliders-h' },
  { id: 'sysmod', label: 'Inspection modules', icon: 'pi-question-circle' },
  { id: 'props', label: 'Properties', icon: 'pi-wrench' },
]
const activeTabId = ref('global')

const libraryStore = useLibraryStore()
const inspectionModuleStore = useInspectionModuleStore()

const { getSelectedNodes, updateNodeData, userSelectionActive } = useVueFlow(FLOW_IDS.MAIN)
const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)

const selectedNode = computed(() => getSelectedNodes.value[0] || null)

const isMultipleSelected = computed(() => getSelectedNodes.value.length > 1)

const isParamsVisible = computed(() => !isCollapsed.value && activeTabId.value === 'params')

// Leaving this for future settings configuration to enable auto-popout / switch to instance parameters
// watch(selectedNode, (node) => {
//   if (node && !isCollapsed) {
//     activeTabId.value = 'params'
//     // if (isCollapsed.value) toggleCollapsed()
//   }
// })

// ── Global constants (top subsection) ───────────────────────────────────────
const globalConstantRows = ref([])
const globalConstantSearch = ref('')
const newlyAddedNames = ref(new Set())

const filteredGlobalConstantRows = computed(() => {
  const term = globalConstantSearch.value.trim().toLowerCase()
  if (!term) return globalConstantRows.value
  return globalConstantRows.value.filter(
    (row) => row.name.toLowerCase().includes(term) || (row.units || '').toLowerCase().includes(term)
  )
})

let hasInitialisedGlobalConstants = false
let highlightTimeoutId = null

watch(
  () => libraryStore.globalVariables,
  (map) => {
    const previousNames = new Set(globalConstantRows.value.map((row) => row.name))

    globalConstantRows.value = Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        value: data?.value,
        units: data?.units,
        data_reference: data?.data_reference,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (!hasInitialisedGlobalConstants) {
      hasInitialisedGlobalConstants = true
      return
    }

    const addedNames = Array.from(map.keys()).filter((name) => !previousNames.has(name))
    if (addedNames.length === 0) return

    newlyAddedNames.value = new Set(addedNames)

    clearTimeout(highlightTimeoutId)
    highlightTimeoutId = setTimeout(() => {
      newlyAddedNames.value = new Set()
    }, 2200)
  },
  { immediate: true, deep: true }
)

function handleGlobalConstantChange(row) {
  recordEdit({
    type: 'edit-global-constant',
    nodeIds: [],
    keys: [],
    apply: () => libraryStore.assignGlobalConstant(row.name, row.value, row.units, row.data_reference, true),
  })
}

onUnmounted(() => {
  clearTimeout(highlightTimeoutId)
})

// ── Selected node parameters (lower subsection) ─────────────────────────────
const parameterRows = ref([])
/** Node the current `parameterRows` were built from; lags `selectedNode` until the deferred rebuild lands. */
const parameterRowsNode = shallowRef(null)
const parameterSearch = ref('')
let pendingRowsRequestId = 0
// The variables the sidebar last wrote, so only changes made elsewhere (e.g. undo) rebuild the rows.
let lastWrittenVariables = null

const filteredParameterRows = computed(() => {
  const term = parameterSearch.value.trim().toLowerCase()
  if (!term) return parameterRows.value
  return parameterRows.value.filter(
    (row) => row.name.toLowerCase().includes(term) || (row.units || '').toLowerCase().includes(term)
  )
})

watch(selectedNode, () => {
  parameterSearch.value = ''
})

const { virtualScrollerOptions: parameterVirtualScrollerOptions, tableKey: parameterTableKey } =
  useVirtualScrollerOptions(parameterRows)

/**
 * Build detached sidebar rows from a node's variables, showing the shared value for global constants.
 * @param {Object} node - Selected Vue Flow node.
 * @returns {Array<Object>} Parameter rows.
 */
function buildParameterRows(node) {
  return detachReactivity(node.data?.variables || []).map((row) => ({
    name: row.name,
    value: row.type === 'global_constant' ? libraryStore.getGlobalConstant(row.name)?.value : row.value,
    units: row.units,
    type: row.type,
    access: row.access,
    data_reference: row.data_reference,
  }))
}

// Rows are only built while visible, never mid box-select, and after the next paint so a click-then-drag stays smooth.
watch(
  [selectedNode, isParamsVisible, userSelectionActive],
  async ([node, isVisible, isSelecting]) => {
    const requestId = ++pendingRowsRequestId
    if (!isVisible || isSelecting) return

    if (!node) {
      parameterRows.value = []
      parameterRowsNode.value = null
      return
    }

    // rAF runs before the next paint; the timeout lands after it.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    if (requestId !== pendingRowsRequestId) return

    parameterRows.value = buildParameterRows(node)
    parameterRowsNode.value = node
  },
  { immediate: true }
)

watch(
  () => toRaw(parameterRowsNode.value?.data?.variables),
  (variables) => {
    if (!variables || variables === lastWrittenVariables) return
    parameterRows.value = buildParameterRows(parameterRowsNode.value)
  }
)

// Undo or redo of a global constant changes only the store, so refresh the shown values in place.
watch(
  () => libraryStore.globalVariables,
  (map) => {
    parameterRows.value.forEach((row) => {
      if (row.type === 'global_constant' && map.has(row.name)) row.value = map.get(row.name).value
    })
  },
  { deep: true }
)

/**
 * Write one edited row back to its node, leaving the node's other variables as they are.
 * @param {Object} row - Edited sidebar row.
 * @param {Object} options
 * @param {boolean} options.isValueEdit - A value edit on a global constant overwrites the shared value.
 */
function persistParameterRow(row, { isValueEdit }) {
  // Write back to the node the rows came from, which may briefly differ from the current selection.
  const node = parameterRowsNode.value
  if (!node) return

  // Merge only what the sidebar edits, so saved fields it doesn't show (e.g. stateRole, initialiser) survive.
  const variables = (node.data?.variables || []).map((variable) =>
    variable.name === row.name ? { ...variable, value: row.value, type: row.type } : variable
  )

  recordEdit({
    type: 'edit-parameters',
    nodeIds: [node.id],
    keys: ['variables'],
    apply: () => {
      if (row.type === 'global_constant') {
        // Keep the shared units and reference, so one node's fields don't replace them.
        const shared = libraryStore.getGlobalConstant(row.name)
        libraryStore.assignGlobalConstant(
          row.name,
          row.value,
          shared?.units ?? row.units,
          shared?.data_reference ?? row.data_reference,
          isValueEdit
        )
      }
      lastWrittenVariables = detachReactivity(variables)
      updateNodeData(node.id, { variables: lastWrittenVariables })
    },
  })
}

function handleParameterValueChange(row) {
  persistParameterRow(row, { isValueEdit: true })
}

function handleParameterTypeChange(row) {
  // If a row just became a global constant, pull in whatever value is
  // already shared globally for that name instead of keeping the stale one.
  if (row.type === 'global_constant') {
    row.value = libraryStore.getGlobalConstant(row.name)?.value ?? row.value
  }
  persistParameterRow(row, { isValueEdit: false })
}
</script>

<style scoped>
.resizable-context-panel {
  display: flex;
  flex-shrink: 0;
  min-height: 0;
  height: 100%;
}

.resize-handle {
  position: relative;
  width: 6px;
  flex-shrink: 0;
  cursor: col-resize;
  background-color: var(--p-content-border-color);
  transition: background-color 120ms ease;
}

.resize-handle:hover {
  background-color: var(--p-primary-color);
}

.resize-handle--disabled {
  cursor: default;
}

.aside-collapse-toggle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--p-content-border-color);
  border-radius: 50%;
  background: var(--p-content-background);
  color: var(--p-text-muted-color);
  font-size: 10px;
  cursor: pointer;
  z-index: 2;
  transition: color 120ms ease, border-color 120ms ease;
}

.aside-collapse-toggle:hover {
  color: var(--p-primary-color);
  border-color: var(--p-primary-color);
}

.context-aside {
  background-color: var(--p-content-background);
  border-left: 1px solid var(--p-content-border-color);
  padding: 1rem;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px color-mix(in srgb, var(--p-text-color) 15%, transparent);
  transition: width 160ms ease, padding 160ms ease;
}

.context-aside--collapsed {
  padding: 0;
  border-left: none;
}

:deep(.context-tabs.p-tabs) {
  flex: 1 1 auto;
  flex-direction: row;
  min-width: v-bind('props.minWidth + "px"');
  min-height: 0;
  gap: 0.75rem;
}

:deep(.context-tabs .p-tablist) {
  flex-shrink: 0;
}

:deep(.context-tabs .p-tablist-tab-list) {
  flex-direction: column;
  gap: 0.35rem;
  border-right: 1px solid var(--p-content-border-color);
  border-width: 0 1px 0 0;
  padding-right: 0.75rem;
  background: transparent;
}

/* The built-in active-bar slides along the x-axis for horizontal tabs; it
   doesn't translate to a vertical rail, so we hide it and rely on the
   selected tab's own background/color instead. */
:deep(.context-tabs .p-tablist-active-bar) {
  display: none;
}

:deep(.context-tabs .p-tab) {
  width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
}

:deep(.context-tabs .p-tab[aria-selected='true']) {
  background: color-mix(in srgb, var(--p-primary-color) 15%, transparent);
  color: var(--p-primary-color);
}

:deep(.context-tabs .p-tabpanels) {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:deep(.context-tabs .p-tabpanel) {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.context-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.context-section-title {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0; 
}

.context-count {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--p-text-muted-color);
}

.new-system-module-btn {
  width: 100%;
  padding: 3%;
  margin-bottom: 0.85rem;
}

.new-system-module-btn :deep(.p-button-label) {
  transform: translateY(1px); 
}

.context-subheading {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  margin-bottom: 0.4rem;
}

.global-constants {
  min-height: 0;
  overflow-y: auto;
}

:deep(.global-constant-row--new > td) {
  animation: global-constant-row-highlight 2.2s ease;
}

@keyframes global-constant-row-highlight {
  0% {
    background-color: color-mix(in srgb, var(--p-primary-color) 25%, transparent);
  }
  100% {
    background-color: transparent;
  }
}

.empty-hint {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex: 1 1 auto;
  text-align: center;
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
  padding: 1rem 0.5rem;
}

.empty-state-icon {
  font-size: 1.5rem;
  opacity: 0.6;
}

.table-flex-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.parameters-table {
  width: 100%;
  font-size: 0.78rem;
}

.parameters-table :deep(.p-datatable-wrapper) {
  height: 100%;
}

.parameters-table :deep(.p-datatable-thead > tr > th) {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.4rem 0.5rem;
}

.parameters-table :deep(.p-datatable-tbody > tr > td) {
  font-size: 0.78rem;
  padding: 0.3rem 0.5rem;
}

.parameters-table :deep(.p-inputtext),
.parameters-table :deep(.p-select-label) {
  font-size: 0.78rem;
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
}

.w-full {
  width: 100%;
}

.table-search-input {
  margin-bottom: 0.5rem;
}

.text-muted {
  color: var(--p-text-muted-color);
}

/* ── Inspection modules tab ─────────────────────────────────────────────── */
.context-section--modules {
  overflow-y: auto;
}

.modules-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
}

.modules-header .context-section-title {
  margin: 0;
}

.module-card-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.module-card {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  padding: 0.65rem 0.75rem;
  background: color-mix(in srgb, var(--p-text-color) 4%, var(--p-content-background));
}

.module-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.module-card-title-group {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.module-card-icon {
  color: var(--p-primary-color);
  flex-shrink: 0;
  font-size: 0.85rem;
}

.module-card-icon-button {
  cursor: pointer;
  border-radius: 50%;
  padding: 3px;
  margin: -3px;
  transition: background-color 0.15s ease;
}

.module-card-icon-button:hover {
  background-color: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}

.module-card-name {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.module-card-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.module-card-units-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--p-primary-color) 18%, var(--p-content-background));
  color: var(--p-primary-color);
}

.module-card-advanced-badge {
  font-size: 0.65rem;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 2px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--p-text-color) 12%, var(--p-content-background));
  color: var(--p-text-muted-color);
}

.module-card-variable-list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.module-card-variable-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.module-card-variable-sign {
  flex-shrink: 0;
  width: 1rem;
  text-align: center;
  font-weight: 700;
  color: var(--p-green-500, #22c55e);
}

.module-card-variable-sign.negative {
  color: var(--p-red-500, #ef4444);
}

.module-card-variable-node {
  color: var(--p-text-color);
  font-weight: 500;
}

.module-card-variable-sep {
  margin: 0 0.25rem;
}

</style>
