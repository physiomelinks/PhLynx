<template>
  <Dialog
    :visible="modelValue"
    header="Simulation Settings"
    modal
    :draggable="false"
    :dismissableMask="true"
    :style="{ width: '840px', height: '90vh' }"
    :appendTo="'body'"
    @update:visible="
      (visible) => {
        if (!visible) requestClose()
      }
    "
  >
    <div class="dialog-content">
      <!-- Loading State -->
      <div v-if="isLoading" class="loading-state">
        <ProgressSpinner class="custom-spinner" strokeWidth="4" />
        <div class="loading-text">
          <strong>Collecting model variables...</strong>
          <span>{{ loadingText }}</span>
        </div>
      </div>

      <!-- Main Tab View -->
      <TabView v-else v-model:activeIndex="activeTabIndex" class="sim-settings-tabs">
        <!-- TAB 1: PLOT SETUP -->
        <TabPanel header="Plot Setup">
          <section class="block">
            <div class="block-header">
              <h4>Plots</h4>
              <span class="subtle">Variables assigned to the same plot are plotted together.</span>
            </div>
            <div class="group-toolbar">
              <InputText v-model="newGroupName" placeholder="New plot name" class="group-name-input" />
              <Button label="Add Plot" icon="pi pi-plus" text @click="addGroup" />
              <div class="group-list">
                <div v-for="group in plotGroups" :key="group.id" class="group-chip">
                  <span>{{ group.name }}</span>
                  <Button
                    icon="pi pi-times"
                    rounded
                    text
                    severity="secondary"
                    size="small"
                    @click="removeGroup(group.id)"
                  />
                </div>
              </div>
            </div>
          </section>

          <section class="block mt-3">
            <div class="block-header">
              <h4>Variables To Plot</h4>
              <span class="subtle">{{ visibleRows.length }} shown of {{ variableRows.length }} total</span>
            </div>

            <!-- Filter Bar -->
            <div class="filter-toolbar" v-if="variableRows.length > 0">
              <div class="node-search-combo">
                <span class="node-search-input-wrap">
                  <InputText
                    v-model="nodeSearch"
                    placeholder="Search / filter by node..."
                    class="filter-input node-search-input"
                    @focus="nodeSearchOpen = true"
                    @input="onNodeSearchInput"
                    @blur="onNodeSearchBlur"
                  />
                  <i
                    v-if="selectedNode"
                    class="pi pi-times node-search-clear"
                    title="Clear node filter"
                    @mousedown.prevent="clearNodeSelection"
                  ></i>
                </span>

                <div v-if="nodeSearchOpen && nodeSearch" class="search-suffix-content">
                  <div class="search-suffix-header">
                    <span class="search-match-count">
                      {{ matchingNodeOptions.length }} match{{ matchingNodeOptions.length !== 1 ? 'es' : '' }}
                    </span>
                  </div>
                  <ul v-if="matchingNodeOptions.length > 0" class="search-match-list">
                    <li
                      v-for="option in matchingNodeOptions"
                      :key="option.value"
                      class="search-match-item"
                      :class="{ active: option.value === selectedNode }"
                      @mousedown.prevent="selectNodeMatch(option)"
                    >
                      {{ option.label }}
                    </li>
                  </ul>
                  <div v-else class="search-no-match">No matching nodes</div>
                </div>
              </div>

              <InputText v-model="variableSearch" placeholder="Search variable..." class="filter-input" />

              <Button
                v-if="visibleRows.length > 0"
                :label="isAllVisibleSelected ? 'Deselect All Filtered' : 'Select All Filtered'"
                :icon="isAllVisibleSelected ? 'pi pi-minus-square' : 'pi pi-check-square'"
                text
                severity="secondary"
                @click="toggleSelectAllVisible"
              />

              <Button
                v-if="nodeSearch || variableSearch || selectedNode"
                label="Reset Filters"
                icon="pi pi-filter-slash"
                text
                severity="secondary"
                @click="resetVariableFilters"
              />
            </div>

            <!-- Accordion Grouped Variables -->
            <div v-if="groupedVisibleRows.length === 0" class="empty-state">
              No variables match the current filters.
            </div>

            <Accordion v-else :multiple="true" v-model:activeIndex="activeVariablePanels" class="node-accordion">
              <AccordionTab v-for="(group, index) in groupedVisibleRows" :key="group.nodeName">
                <template #header>
                  <div class="accordion-header-content">
                    <div class="node-title-group">
                      <i
                        class="pi pi-chevron-right accordion-chevron"
                        :class="{ 'accordion-chevron-open': activeVariablePanels.includes(index) }"
                      ></i>
                      <span class="font-bold node-name">{{ group.nodeName }}</span>
                    </div>
                    <div class="badge-group">
                      <span class="count-badge">{{ group.rows.length }} vars</span>
                      <span v-if="group.plottedCount > 0" class="count-badge plotted">
                        {{ group.plottedCount }} plotted
                      </span>
                    </div>
                  </div>
                </template>

                <DataTable
                  :value="group.rows"
                  dataKey="key"
                  size="small"
                  rowHover
                  :rowClass="
                    (data) => ({
                      'row-unplotted': !data.groupId,
                      'row-selected': data.selected,
                    })
                  "
                  class="vars-datatable"
                >
                  <Column style="width: 44px">
                    <template #header>
                      <Checkbox
                        :modelValue="isGroupAllSelected(group.rows)"
                        binary
                        @update:modelValue="(val) => toggleGroupSelection(group.rows, val)"
                      />
                    </template>
                    <template #body="{ data }">
                      <Checkbox v-model="data.selected" binary />
                    </template>
                  </Column>

                  <Column field="variableName" header="Variable" sortable></Column>
                  <Column field="units" header="Units" style="width: 100px">
                    <template #body="{ data }">
                      {{ data.units || '-' }}
                    </template>
                  </Column>
                  <Column header="Plot" style="width: 220px">
                    <template #body="{ data }">
                      <Select
                        v-model="data.groupId"
                        :options="groupOptions"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="Not plotted"
                        class="w-full"
                        @change="onSubplotChange(data)"
                      />
                    </template>
                  </Column>
                </DataTable>
              </AccordionTab>
            </Accordion>

            <!-- Contextual Bulk Toolbar -->
            <div class="bulk-toolbar">
              <div class="bulk-info">
                <span
                  ><strong>{{ selectedVisibleCount }}</strong> items selected</span
                >
                <Button
                  label="Clear Selection"
                  icon="pi pi-eraser"
                  text
                  size="small"
                  severity="secondary"
                  @click="clearSelection"
                />
              </div>
              <div class="bulk-actions">
                <Select
                  v-model="bulkGroupId"
                  :options="assignGroupOptions"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Assign to plot..."
                  class="bulk-group-select"
                />
                <Button
                  label="Assign"
                  icon="pi pi-check"
                  size="small"
                  :disabled="selectedUnassignedCount === 0 || !bulkGroupId"
                  @click="assignSelectedToGroup"
                />
                <Button
                  label="Remove From Plot"
                  icon="pi pi-minus-circle"
                  severity="secondary"
                  text
                  size="small"
                  :disabled="selectedAssignedCount === 0"
                  @click="moveSelectedToUngrouped"
                />
              </div>
            </div>
          </section>
        </TabPanel>

        <!-- TAB 2: PARAMETER SCAN SETUP -->
        <TabPanel header="Parameter Scan Setup">
          <section class="block">
            <div class="block-header">
              <h4>Parameter Scan</h4>
              <span class="subtle">{{ selectedConstantCount }} of {{ constantRows.length }} constants included</span>
            </div>

            <div class="filter-toolbar" v-if="constantRows.length > 0">
              <div class="node-search-combo">
                <span class="node-search-input-wrap">
                  <InputText
                    v-model="constantNodeSearch"
                    placeholder="Search / filter by instance..."
                    class="filter-input node-search-input"
                    @focus="constantNodeSearchOpen = true"
                    @input="onConstantNodeSearchInput"
                    @blur="onConstantNodeSearchBlur"
                  />
                  <i
                    v-if="selectedConstantNode"
                    class="pi pi-times node-search-clear"
                    title="Clear node filter"
                    @mousedown.prevent="clearConstantNodeSelection"
                  ></i>
                </span>

                <div v-if="constantNodeSearchOpen && constantNodeSearch" class="search-suffix-content">
                  <div class="search-suffix-header">
                    <span class="search-match-count">
                      {{ matchingConstantNodeOptions.length }} match{{
                        matchingConstantNodeOptions.length !== 1 ? 'es' : ''
                      }}
                    </span>
                  </div>
                  <ul v-if="matchingConstantNodeOptions.length > 0" class="search-match-list">
                    <li
                      v-for="option in matchingConstantNodeOptions"
                      :key="option.value"
                      class="search-match-item"
                      :class="{ active: option.value === selectedConstantNode }"
                      @mousedown.prevent="selectConstantNodeMatch(option)"
                    >
                      {{ option.label }}
                    </li>
                  </ul>
                  <div v-else class="search-no-match">No matching instances</div>
                </div>
              </div>

              <InputText v-model="constantSearch" placeholder="Search parameters..." class="filter-input" />

              <Button
                v-if="visibleConstantRows.length > 0"
                :label="isAllConstantVisibleSelected ? 'Deselect All Filtered' : 'Select All Filtered'"
                :icon="isAllConstantVisibleSelected ? 'pi pi-minus-square' : 'pi pi-check-square'"
                text
                severity="secondary"
                @click="toggleSelectAllConstantVisible"
              />

              <Button
                v-if="constantNodeSearch || constantSearch || selectedConstantNode"
                label="Reset Filters"
                icon="pi pi-filter-slash"
                text
                severity="secondary"
                @click="resetConstantFilters"
              />
            </div>

            <!-- Accordion Grouped Constants -->
            <div v-if="constantRows.length === 0" class="empty-state">
              No constants were found in the current instances.
            </div>
            <div v-else-if="groupedConstantRows.length === 0" class="empty-state">
              No constants match the current filters.
            </div>

            <Accordion v-else :multiple="true" v-model:activeIndex="activeConstantPanels" class="node-accordion">
              <AccordionTab v-for="(group, index) in groupedConstantRows" :key="group.nodeName">
                <template #header>
                  <div class="accordion-header-content">
                    <div class="node-title-group">
                      <i
                        class="pi pi-chevron-right accordion-chevron"
                        :class="{ 'accordion-chevron-open': activeConstantPanels.includes(index) }"
                      ></i>
                      <span class="font-bold node-name">{{ group.nodeName }}</span>
                    </div>
                    <span class="count-badge">{{ group.rows.length }} params</span>
                  </div>
                </template>

                <DataTable
                  :value="group.rows"
                  dataKey="key"
                  size="small"
                  rowHover
                  :rowClass="
                    (data) => ({
                      'row-unplotted': !data.selected,
                      'row-selected': data.selected,
                    })
                  "
                  class="vars-datatable scan-datatable"
                >
                  <Column style="width: 44px">
                    <template #header>
                      <Checkbox
                        :modelValue="isGroupAllSelected(group.rows)"
                        binary
                        @update:modelValue="(val) => toggleGroupSelection(group.rows, val)"
                      />
                    </template>
                    <template #body="{ data }">
                      <Checkbox v-model="data.selected" binary />
                    </template>
                  </Column>

                  <Column field="parameterName" header="Parameter" sortable></Column>
                  <Column field="units" header="Unit" style="width: 90px">
                    <template #body="{ data }">
                      {{ data.units || '-' }}
                    </template>
                  </Column>

                  <Column header="Min" style="width: 120px">
                    <template #body="{ data }">
                      <div class="param-cell-wrapper">
                        <InputNumber
                          v-if="data.selected"
                          :pt:pcInputText:root="{ 'data-testid': `param-min-${data.parameterName}` }"
                          v-model="data.min"
                          :minFractionDigits="0"
                          :maxFractionDigits="8"
                          fluid
                        />
                        <span v-else class="subtle-dash">-</span>
                      </div>
                    </template>
                  </Column>

                  <Column header="Default" style="width: 120px">
                    <template #body="{ data }">
                      <div class="param-cell-wrapper">
                        <InputNumber
                          v-if="data.selected"
                          :pt:pcInputText:root="{ 'data-testid': `param-default-${data.parameterName}` }"
                          v-model="data.default"
                          :minFractionDigits="0"
                          :maxFractionDigits="8"
                          fluid
                        />
                        <span v-else class="subtle-dash">-</span>
                      </div>
                    </template>
                  </Column>

                  <Column header="Max" style="width: 120px">
                    <template #body="{ data }">
                      <div class="param-cell-wrapper">
                        <InputNumber
                          v-if="data.selected"
                          :pt:pcInputText:root="{ 'data-testid': `param-max-${data.parameterName}` }"
                          v-model="data.max"
                          :minFractionDigits="0"
                          :maxFractionDigits="8"
                          fluid
                        />
                        <span v-else class="subtle-dash">-</span>
                      </div>
                    </template>
                  </Column>
                </DataTable>
              </AccordionTab>
            </Accordion>
          </section>
        </TabPanel>

        <!-- TAB 3: SIMULATION PARAMETERS -->
        <TabPanel header="Simulation Parameters">
          <section class="block">
            <div class="block-header">
              <h4>Time Configuration</h4>
              <span class="subtle">Define simulation bounds and time intervals.</span>
            </div>
            <div class="settings-grid">
              <div class="field">
                <label>Starting Point</label>
                <InputNumber
                  v-model="localSimulationSettings.startingPoint"
                  :pt:pcInputText:root="{ 'data-testid': 'sim-starting-point' }"
                  :minFractionDigits="0"
                  :maxFractionDigits="8"
                  fluid
                />
              </div>
              <div class="field">
                <label>Ending Point</label>
                <InputNumber
                  v-model="localSimulationSettings.endingPoint"
                  :pt:pcInputText:root="{ 'data-testid': 'sim-ending-point' }"
                  :minFractionDigits="0"
                  :maxFractionDigits="8"
                  fluid
                />
              </div>
              <div class="field">
                <label>Initial Point</label>
                <InputNumber
                  v-model="localSimulationSettings.initialPoint"
                  :pt:pcInputText:root="{ 'data-testid': 'sim-initial-point' }"
                  :minFractionDigits="0"
                  :maxFractionDigits="8"
                  fluid
                />
              </div>
              <div class="field">
                <label>Point Interval</label>
                <InputNumber
                  v-model="localSimulationSettings.pointInterval"
                  :pt:pcInputText:root="{ 'data-testid': 'sim-point-interval' }"
                  :min="0"
                  :minFractionDigits="0"
                  :maxFractionDigits="8"
                  fluid
                />
              </div>
            </div>
          </section>

          <section class="block mt-3" style="opacity: 0">
            <div class="block-header">
              <h4>Solver Configuration</h4>
              <span class="subtle">Select numerical solver and step limits.</span>
            </div>
            <div class="settings-grid">
              <div class="field">
                <label>Solver Algorithm</label>
                <Select
                  v-model="localSimulationSettings.solver"
                  :options="solverOptions"
                  optionLabel="label"
                  optionValue="value"
                  fluid
                  disabled
                />
              </div>
              <div class="field">
                <label>Time Step</label>
                <InputNumber
                  v-model="localSimulationSettings.timeStep"
                  :min="0"
                  :minFractionDigits="0"
                  :maxFractionDigits="12"
                  fluid
                  disabled
                />
              </div>
              <div class="field">
                <label>Tolerance</label>
                <InputNumber
                  v-model="localSimulationSettings.tolerance"
                  :min="0"
                  :minFractionDigits="0"
                  :maxFractionDigits="12"
                  fluid
                  disabled
                />
              </div>
              <div class="field">
                <label>Max Steps</label>
                <InputNumber v-model="localSimulationSettings.maxSteps" :min="1" :useGrouping="false" fluid disabled />
              </div>
            </div>
          </section>
        </TabPanel>
      </TabView>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" severity="secondary" text @click="requestClose" />
        <Button label="Save" severity="primary" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import Accordion from 'primevue/accordion'
import AccordionTab from 'primevue/accordiontab'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import ProgressSpinner from 'primevue/progressspinner'
import Select from 'primevue/select'
import TabPanel from 'primevue/tabpanel'
import TabView from 'primevue/tabview'

import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { notify } from '../utils/notify'

const props = defineProps({
  modelValue: Boolean,
  nodes: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['update:modelValue'])
const { confirm } = useConfirmDialog()
const libraryStore = useLibraryStore()
const simulationSettingsStore = useSimulationSettingsStore()
const { simulationSettings, plotConfig, parameterScanConfig } = storeToRefs(simulationSettingsStore)

const solverOptions = [
  { label: 'CVODE', value: 'CVODE' },
  { label: 'Euler', value: 'Euler' },
  { label: 'Runge Kutta 4', value: 'RungeKutta4' },
]

const localSimulationSettings = ref({})
const variableRows = ref([])
const constantRows = ref([])
const isLoading = ref(false)
const loadingText = ref('Preparing variable list...')
const newGroupName = ref('')
const plotGroups = ref([])
const bulkGroupId = ref(null)
const selectedNode = ref(null)
const selectedVariable = ref(null)
const nodeSearch = ref('')
const variableSearch = ref('')
const nodeSearchOpen = ref(false)
const constantNodeSearch = ref('')
const constantSearch = ref('')
const selectedConstantNode = ref(null)
const constantNodeSearchOpen = ref(false)
const activeTabIndex = ref(0)
const initialDraftSignature = ref('')
const bypassCloseGuard = ref(false)
let loadCycle = 0

// --- Computed Properties ---

const groupOptions = computed(() => {
  const options = [{ label: 'Not plotted', value: null }]
  for (const group of plotGroups.value) {
    options.push({ label: group.name, value: group.id })
  }
  return options
})

const visibleRows = computed(() => {
  const nodeTerm = nodeSearch.value.trim().toLowerCase()
  const variableTerm = variableSearch.value.trim().toLowerCase()

  return variableRows.value.filter((row) => {
    if (selectedNode.value && row.nodeName !== selectedNode.value) return false
    if (selectedVariable.value && row.variableName !== selectedVariable.value) return false
    if (nodeTerm && !row.nodeName.toLowerCase().includes(nodeTerm)) return false
    if (variableTerm && !row.variableName.toLowerCase().includes(variableTerm)) return false
    return true
  })
})

const isAllVisibleSelected = computed(() => {
  if (visibleRows.value.length === 0) return false
  return visibleRows.value.every((row) => row.selected)
})

function toggleSelectAllVisible() {
  const nextState = !isAllVisibleSelected.value
  visibleRows.value.forEach((row) => {
    row.selected = nextState
  })
}

const nodeFilterOptions = computed(() => {
  const unique = new Set(variableRows.value.map((row) => row.nodeName))
  const options = [{ label: 'All instances', value: null }]
  Array.from(unique)
    .sort((a, b) => a.localeCompare(b))
    .forEach((name) => options.push({ label: name, value: name }))
  return options
})

const constantNodeFilterOptions = computed(() => {
  const unique = new Set(constantRows.value.map((row) => row.nodeName))
  const options = [{ label: 'All instances', value: null }]
  Array.from(unique)
    .sort((a, b) => a.localeCompare(b))
    .forEach((name) => options.push({ label: name, value: name }))
  return options
})

// Matches shown in the node search comboboxes (real nodes only, no 'All nodes' entry)
const matchingNodeOptions = computed(() => {
  const term = nodeSearch.value.trim().toLowerCase()
  const options = nodeFilterOptions.value.filter((opt) => opt.value !== null)
  if (!term) return options
  return options.filter((opt) => opt.label.toLowerCase().includes(term))
})

const matchingConstantNodeOptions = computed(() => {
  const term = constantNodeSearch.value.trim().toLowerCase()
  const options = constantNodeFilterOptions.value.filter((opt) => opt.value !== null)
  if (!term) return options
  return options.filter((opt) => opt.label.toLowerCase().includes(term))
})

// Group visible variables by Node
const groupedVisibleRows = computed(() => {
  const groupsMap = new Map()
  for (const row of visibleRows.value) {
    if (!groupsMap.has(row.nodeName)) {
      groupsMap.set(row.nodeName, [])
    }
    groupsMap.get(row.nodeName).push(row)
  }

  return Array.from(groupsMap.entries()).map(([nodeName, rows]) => ({
    nodeName,
    rows,
    plottedCount: rows.filter((r) => r.plot).length,
  }))
})

// Constant rows filtered by the Parameter Scan tab's own search/node controls
const visibleConstantRows = computed(() => {
  const nodeTerm = constantNodeSearch.value.trim().toLowerCase()
  const paramTerm = constantSearch.value.trim().toLowerCase()

  return constantRows.value.filter((row) => {
    if (selectedConstantNode.value && row.nodeName !== selectedConstantNode.value) return false
    if (nodeTerm && !row.nodeName.toLowerCase().includes(nodeTerm)) return false
    if (paramTerm && !row.parameterName.toLowerCase().includes(paramTerm)) return false
    return true
  })
})

const isAllConstantVisibleSelected = computed(() => {
  if (visibleConstantRows.value.length === 0) return false
  return visibleConstantRows.value.every((row) => row.selected)
})

function toggleSelectAllConstantVisible() {
  const nextState = !isAllConstantVisibleSelected.value
  visibleConstantRows.value.forEach((row) => {
    row.selected = nextState
  })
}

// Group constant rows by Node
const groupedConstantRows = computed(() => {
  const groupsMap = new Map()
  for (const row of visibleConstantRows.value) {
    if (!groupsMap.has(row.nodeName)) {
      groupsMap.set(row.nodeName, [])
    }
    groupsMap.get(row.nodeName).push(row)
  }

  return Array.from(groupsMap.entries()).map(([nodeName, rows]) => ({
    nodeName,
    rows,
  }))
})

const activeVariablePanels = ref([])
const activeConstantPanels = ref([])

watch(
  () => groupedVisibleRows.value.map((g) => g.nodeName).join('|'),
  () => {
    activeVariablePanels.value = groupedVisibleRows.value.map((_, index) => index)
  }
)

watch(
  () => groupedConstantRows.value.map((g) => g.nodeName).join('|'),
  () => {
    activeConstantPanels.value = groupedConstantRows.value.map((_, index) => index)
  }
)

const selectedVisibleCount = computed(() => {
  return visibleRows.value.filter((row) => row.selected).length
})

const selectedAssignedCount = computed(() => {
  return visibleRows.value.filter((row) => row.selected && row.groupId).length
})

const selectedUnassignedCount = computed(() => {
  return visibleRows.value.filter((row) => row.selected && row.groupId !== bulkGroupId.value).length
})

const assignGroupOptions = computed(() => {
  return plotGroups.value.map((group) => ({ label: group.name, value: group.id }))
})

const selectedConstantCount = computed(() => constantRows.value.filter((row) => row.selected).length)

const hasUnsavedChanges = computed(() => {
  if (!props.modelValue || isLoading.value) return false
  return createDraftSignature() !== initialDraftSignature.value
})

// --- Helper Selection Functions ---

function isGroupAllSelected(rows) {
  if (!rows || rows.length === 0) return false
  return rows.every((row) => row.selected)
}

function toggleGroupSelection(rows, value) {
  rows.forEach((row) => {
    row.selected = Boolean(value)
  })
}

// --- Watchers & Initialization ---

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (isOpen) {
      await initialiseDialog()
    }
  }
)

watch(selectedNode, () => {
  if (!selectedVariable.value) return
  const stillValid = variableRows.value.some(
    (row) => row.variableName === selectedVariable.value && (!selectedNode.value || row.nodeName === selectedNode.value)
  )
  if (!stillValid) {
    selectedVariable.value = null
  }
})

function cloneSettings(input) {
  return { ...input }
}

function makeGroupId(index) {
  return `plot-${index + 1}`
}

function normaliseGroups(existingGroups) {
  if (!Array.isArray(existingGroups) || existingGroups.length === 0) {
    return [{ id: makeGroupId(0), name: 'Plot 1' }]
  }

  return existingGroups.map((group, index) => ({
    id: group.id || makeGroupId(index),
    name: group.name || `Plot ${index + 1}`,
  }))
}

function buildVariableRows(nodes, selectedByKey) {
  const rows = []

  for (const node of nodes || []) {
    if (!node?.data?.name) continue
    for (const variable of node.data.variables || []) {
      if (!variable?.name) continue

      const type = variable.type || 'variable'
      if (type !== 'variable') continue

      const key = `${node.id}::${variable.name}`
      const existing = selectedByKey.get(key)

      rows.push({
        key,
        nodeId: node.id,
        nodeName: node.data.name,
        variableName: variable.name,
        units: variable.units || '',
        type,
        plot: existing?.plot ?? false,
        groupId: existing?.groupId ?? null,
        selected: false,
      })
    }
  }

  return rows.sort((a, b) => {
    const nodeDiff = a.nodeName.localeCompare(b.nodeName)
    if (nodeDiff !== 0) return nodeDiff
    return a.variableName.localeCompare(b.variableName)
  })
}

function pickDefaultValue(variable) {
  // A global constant's value is shared, so a node's own copy may be out of date.
  const value = variable.type === 'global_constant' ? libraryStore.getGlobalConstant(variable.name)?.value : variable.value
  const candidate = variable.defaultValue ?? variable.initialValue ?? value
  const numeric = Number(candidate)
  return Number.isFinite(numeric) ? numeric : null
}

function computeScanBounds(defaultValue) {
  if (defaultValue === null || defaultValue === undefined || Number.isNaN(defaultValue)) {
    return { min: null, max: null }
  }
  const spread = Math.abs(defaultValue) * 0.1
  return { min: defaultValue - spread, max: defaultValue + spread }
}

function buildConstantRows(nodes, selectedByKey) {
  const rows = []

  for (const node of nodes || []) {
    if (!node?.data?.name) continue
    for (const variable of node.data.variables || []) {
      if (!variable?.name) continue

      const type = variable.type || 'variable'
      if (type !== 'constant' && type !== 'global_constant') continue

      const key = `${node.id}::${variable.name}`
      const existing = selectedByKey.get(key)
      const defaultValue = pickDefaultValue(variable)
      const bounds = computeScanBounds(defaultValue)

      rows.push({
        key,
        nodeId: node.id,
        nodeName: node.data.name,
        parameterName: variable.name,
        units: variable.units || '',
        type,
        selected: existing?.selected ?? false,
        default: existing?.default ?? defaultValue,
        min: existing?.min ?? bounds.min,
        max: existing?.max ?? bounds.max,
        step: existing?.step ?? null,
      })
    }
  }

  return rows.sort((a, b) => {
    const nodeDiff = a.nodeName.localeCompare(b.nodeName)
    if (nodeDiff !== 0) return nodeDiff
    return a.parameterName.localeCompare(b.parameterName)
  })
}

function createDraftPayload() {
  const selectedPlotRows = variableRows.value.filter((row) => row.plot)
  const groupsById = new Map(plotGroups.value.map((group) => [group.id, group]))

  const groupedSelections = plotGroups.value
    .map((group) => {
      const selections = selectedPlotRows.filter((row) => row.groupId === group.id)
      return {
        id: group.id,
        name: group.name,
        selections: selections.map((row) => ({
          key: row.key,
          nodeId: row.nodeId,
          nodeName: row.nodeName,
          variableName: row.variableName,
          units: row.units,
          type: row.type,
          plot: true,
          groupId: row.groupId,
        })),
      }
    })
    .filter((group) => group.selections.length > 0)

  const ungroupedSelections = selectedPlotRows
    .filter((row) => !groupsById.has(row.groupId))
    .map((row) => ({
      key: row.key,
      nodeId: row.nodeId,
      nodeName: row.nodeName,
      variableName: row.variableName,
      units: row.units,
      type: row.type,
      plot: true,
      groupId: null,
    }))

  const scanSelections = constantRows.value
    .filter((row) => row.selected)
    .map((row) => ({
      key: row.key,
      nodeId: row.nodeId,
      nodeName: row.nodeName,
      parameterName: row.parameterName,
      selected: row.selected,
      units: row.units,
      type: row.type,
      min: row.min,
      default: row.default,
      max: row.max,
      step: row.step,
    }))

  return {
    simulationSettings: { ...localSimulationSettings.value },
    plotConfig: {
      groups: plotGroups.value.map((group) => ({ ...group })),
      groupedSelections,
      selections: [...groupedSelections.flatMap((group) => group.selections), ...ungroupedSelections],
    },
    parameterScanConfig: {
      selections: scanSelections,
    },
  }
}

function createDraftSignature() {
  return JSON.stringify(createDraftPayload())
}

async function initialiseDialog() {
  loadCycle += 1
  const currentCycle = loadCycle

  isLoading.value = true
  loadingText.value = 'Preparing simulation settings...'

  localSimulationSettings.value = cloneSettings(simulationSettings.value)

  const existingPlotConfig = plotConfig.value || {}
  plotGroups.value = normaliseGroups(existingPlotConfig.groups)

  const selectedByKey = new Map((existingPlotConfig.selections || []).map((selection) => [selection.key, selection]))
  const scanSelectedByKey = new Map(
    (parameterScanConfig.value?.selections || []).map((selection) => [selection.key, selection])
  )

  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))

  if (currentCycle !== loadCycle) {
    isLoading.value = false
    return
  }

  loadingText.value = 'Scanning nodes and variables...'
  variableRows.value = buildVariableRows(props.nodes, selectedByKey)
  constantRows.value = buildConstantRows(props.nodes, scanSelectedByKey)

  resetVariableFilters()
  resetConstantFilters()

  if (variableRows.value.length === 0) {
    notify.info({
      title: 'No Variables Found',
      message: 'No variables were found on the current nodes.',
    })
  }

  initialDraftSignature.value = createDraftSignature()
  bypassCloseGuard.value = false

  isLoading.value = false
}

// --- Action Methods ---

function resetVariableFilters() {
  selectedNode.value = null
  selectedVariable.value = null
  nodeSearch.value = ''
  variableSearch.value = ''
  nodeSearchOpen.value = false
}

function resetConstantFilters() {
  selectedConstantNode.value = null
  constantNodeSearch.value = ''
  constantSearch.value = ''
  constantNodeSearchOpen.value = false
}

function selectNodeMatch(option) {
  selectedNode.value = option.value
  nodeSearch.value = option.label
  nodeSearchOpen.value = false
}

function clearNodeSelection() {
  selectedNode.value = null
  nodeSearch.value = ''
  nodeSearchOpen.value = false
}

function onNodeSearchInput() {
  nodeSearchOpen.value = true
  selectedNode.value = null
}

function onNodeSearchBlur() {
  setTimeout(() => {
    nodeSearchOpen.value = false
  }, 150)
}

function selectConstantNodeMatch(option) {
  selectedConstantNode.value = option.value
  constantNodeSearch.value = option.label
  constantNodeSearchOpen.value = false
}

function clearConstantNodeSelection() {
  selectedConstantNode.value = null
  constantNodeSearch.value = ''
  constantNodeSearchOpen.value = false
}

function onConstantNodeSearchInput() {
  constantNodeSearchOpen.value = true
  selectedConstantNode.value = null
}

function onConstantNodeSearchBlur() {
  setTimeout(() => {
    constantNodeSearchOpen.value = false
  }, 150)
}

function addGroup() {
  const name = newGroupName.value.trim() || nextDefaultGroupName()

  const id = `plot-${crypto.randomUUID()}`
  plotGroups.value.push({ id, name })
  newGroupName.value = ''
}

function nextDefaultGroupName() {
  const existingNames = new Set(plotGroups.value.map((group) => group.name))
  let n = plotGroups.value.length + 1
  while (existingNames.has(`Plot ${n}`)) {
    n += 1
  }
  return `Plot ${n}`
}

function removeGroup(groupId) {
  plotGroups.value = plotGroups.value.filter((group) => group.id !== groupId)
  if (bulkGroupId.value === groupId) bulkGroupId.value = null
  variableRows.value.forEach((row) => {
    if (row.groupId === groupId) row.groupId = null
  })
}

function onSubplotChange(row) {
  row.plot = Boolean(row.groupId)
}

function assignSelectedToGroup() {
  if (!bulkGroupId.value) return

  let updatedCount = 0
  visibleRows.value.forEach((row) => {
    if (!row.selected) return
    row.plot = true
    row.groupId = bulkGroupId.value
    row.selected = false // Reset selection on assign
    updatedCount += 1
  })

  if (updatedCount > 0) {
    notify.success({
      title: 'Bulk Assign Applied',
      message: `Assigned ${updatedCount} variable${updatedCount === 1 ? '' : 's'} to selected subplot.`,
    })
  }
}

function clearSelection() {
  visibleRows.value.forEach((row) => {
    row.selected = false
  })
}

function moveSelectedToUngrouped() {
  let updatedCount = 0
  visibleRows.value.forEach((row) => {
    if (!row.selected) return
    row.plot = false
    row.groupId = null
    row.selected = false // Reset selection on remove from plot
    updatedCount += 1
  })

  if (updatedCount > 0) {
    notify.success({
      title: 'Bulk Update Applied',
      message: `Removed ${updatedCount} variable${updatedCount === 1 ? '' : 's'} from the plot.`,
    })
  }
}

const handleConfirm = () => {
  const selected = variableRows.value.filter((row) => row.plot)

  if (selected.some((row) => !row.groupId) && plotGroups.value.length > 0) {
    const fallbackGroupId = plotGroups.value[0].id
    selected.forEach((row) => {
      if (!row.groupId) row.groupId = fallbackGroupId
    })
  }

  const payload = createDraftPayload()
  simulationSettingsStore.loadState(payload)

  bypassCloseGuard.value = true
  emit('update:modelValue', false)
}

const requestClose = async () => {
  if (bypassCloseGuard.value) {
    emit('update:modelValue', false)
    return
  }

  if (!hasUnsavedChanges.value) {
    emit('update:modelValue', false)
    return
  }

  const shouldDiscard = await confirm({
    header: 'Discard unsaved changes?',
    message: 'You have unsaved simulation settings changes. Close without saving?',
    severity: 'warning',
    acceptLabel: 'Discard',
    rejectLabel: 'Keep Editing',
  })

  if (!shouldDiscard) return

  emit('update:modelValue', false)
}
</script>

<style scoped>
.dialog-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
:deep(.sim-settings-tabs .p-tabview-panels) {
  padding: 12px 0 0;
  min-height: 560px;
}
.sim-settings-tabs {
  width: 100%;
}

/* Loading State */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 320px;
  text-align: center;
}
.custom-spinner {
  width: 44px;
  height: 44px;
}
:deep(.custom-spinner .p-progress-spinner-circle) {
  stroke: var(--p-primary-color, #2563eb) !important;
}

.loading-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.loading-text strong {
  font-size: 14px;
  color: var(--p-text-color, #1f2937);
}
.loading-text span {
  font-size: 12px;
  color: var(--p-text-muted-color, #6b7280);
}

.block {
  border: 1px solid var(--p-content-border-color, var(--p-surface-200, #ebeef5));
  border-radius: 8px;
  padding: 14px;
  background: var(--p-content-background, var(--p-surface-0, #ffffff));
  color: var(--p-text-color, inherit);
}
.mt-3 {
  margin-top: 14px;
}
.block-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.block-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--p-text-color, inherit);
}
.subtle {
  font-size: 12px;
  color: var(--p-text-muted-color, #909399);
}

/* Plots & Tags Toolbar Layout */
.group-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.group-name-input {
  width: 200px;
}
.group-list {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-left: 4px;
}
.group-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--p-content-border-color, var(--p-surface-300, #dcdfe6));
  border-radius: 16px;
  padding: 2px 6px 2px 10px;
  background: color-mix(in srgb, var(--p-text-color, #1f2937) 12%, var(--p-content-background, #ffffff));
  color: var(--p-text-color, inherit);
  font-size: 12px;
}

/* Toolbars */
.filter-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.filter-input {
  width: 180px;
}

.node-search-combo {
  position: relative;
}
.node-search-input-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.node-search-input {
  width: 220px;
  padding-right: 26px;
}
.node-search-clear {
  position: absolute;
  right: 8px;
  font-size: 12px;
  color: var(--p-text-muted-color, #9aa1ab);
  cursor: pointer;
}
.node-search-clear:hover {
  color: var(--p-text-color, #4b5563);
}
.search-suffix-content {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 260px;
  max-height: 220px;
  overflow-y: auto;
  background: var(--p-overlay-select-background, var(--p-content-background, #ffffff));
  border: 1px solid var(--p-content-border-color, var(--p-surface-300, #dcdfe6));
  border-radius: 6px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
  z-index: 30;
}
.search-suffix-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid var(--p-content-border-color, var(--p-surface-200, #f0f2f5));
  font-size: 11px;
  color: var(--p-text-muted-color, #909399);
}
.search-match-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}
.search-match-item {
  padding: 6px 10px;
  font-size: 13px;
  color: var(--p-text-color, #1f2937);
  cursor: pointer;
}
.search-match-item:hover {
  background-color: var(--p-content-hover-background, var(--p-surface-100, #f4f6f8));
}
.search-match-item.active {
  background-color: var(--p-primary-50, rgba(37, 99, 235, 0.15));
  color: var(--p-primary-color, #2563eb);
  font-weight: 600;
}
.search-no-match {
  padding: 10px;
  font-size: 12px;
  color: var(--p-text-muted-color, #909399);
  text-align: center;
}

.bulk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-top: 12px;
  background-color: var(--p-content-background, var(--p-surface-100, #f8f9fb));
  border: 1px solid var(--p-content-border-color, var(--p-surface-300, #dcdfe6));
  border-radius: 6px;
  position: sticky;
  bottom: 0;
  z-index: 15;
  box-shadow: 0 -6px 14px rgba(0, 0, 0, 0.2);
}
.bulk-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--p-text-color, inherit);
}
.bulk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bulk-group-select {
  width: 180px;
}

/* Accordion Styling */
.node-accordion {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

:deep(.node-accordion .p-accordion-tab) {
  border: 1px solid var(--p-content-border-color, var(--p-surface-300, #dcdfe6));
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 6px;
}

:deep(.node-accordion .p-accordion-header-link) {
  background-color: color-mix(
    in srgb,
    var(--p-text-color, #1f2937) 6%,
    var(--p-content-background, #ffffff)
  ) !important;
  color: var(--p-text-color, inherit) !important;
  border-bottom: 1px solid transparent;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s, border-color 0.2s;
}

:deep(.node-accordion .p-accordion-header-link:hover) {
  background-color: color-mix(
    in srgb,
    var(--p-text-color, #1f2937) 12%,
    var(--p-content-background, #ffffff)
  ) !important;
}

:deep(.node-accordion .p-accordion-tab-active .p-accordion-header-link) {
  background-color: var(--p-highlight-background, var(--p-primary-50, #e6f0fa)) !important;
  color: var(--p-highlight-color, var(--p-primary-color, inherit)) !important;
  border-bottom-color: var(--p-primary-color, #d0e3f7) !important;
  font-weight: 600;
}

:deep(.node-accordion .p-accordion-header-link > *:not(.accordion-header-content)) {
  display: none !important;
}
:deep(.node-accordion .p-accordion-header-link .p-accordion-toggle-icon),
:deep(.node-accordion .p-accordion-header-link .p-accordion-header-icon),
:deep(.node-accordion .p-accordion-header-link > .p-icon) {
  display: none !important;
}

.accordion-header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.node-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.accordion-chevron {
  font-size: 12px;
  color: var(--p-primary-color, #3b82f6);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: color-mix(in srgb, var(--p-primary-color, #3b82f6) 18%, var(--p-content-background, #ffffff));
  transition: transform 0.2s ease-in-out, background-color 0.2s;
}

.accordion-chevron.accordion-chevron-open {
  transform: rotate(90deg);
}

.node-name {
  color: var(--p-text-color, #1f2937);
  font-size: 13px;
}

.badge-group {
  display: flex;
  gap: 6px;
  align-items: center;
}
.count-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  background-color: color-mix(in srgb, var(--p-text-color, #1f2937) 12%, var(--p-content-background, #ffffff));
  color: var(--p-text-muted-color, #4b5563);
  border-radius: 12px;
}
.count-badge.plotted {
  background-color: color-mix(in srgb, var(--p-primary-color, #2563eb) 18%, var(--p-content-background, #ffffff));
  color: var(--p-primary-color, #2563eb);
}

/* DataTable Customizations */
.vars-datatable {
  border-top: 1px solid var(--p-content-border-color, var(--p-surface-200, #e5e7eb));
}
:deep(.vars-datatable .p-datatable-thead > tr > th),
:deep(.vars-datatable .p-datatable-header-cell),
:deep(.vars-datatable .p-column-title) {
  background-color: var(--p-datatable-header-cell-background, var(--p-surface-100, #f9fafb)) !important;
  color: var(--p-datatable-header-cell-color, var(--p-text-color, #1f2937)) !important;
  font-weight: 700;
  font-size: 12px;
}

/* Unplotted vs Selected Row Visual States (Applies to assigned and unassigned rows) */
:deep(.vars-datatable tr.row-unplotted) {
  opacity: 0.65;
}

:deep(.vars-datatable tr.row-selected) {
  opacity: 1 !important;
  background-color: color-mix(
    in srgb,
    var(--p-primary-color, #2563eb) 18%,
    var(--p-content-background, #ffffff)
  ) !important;
  color: var(--p-text-color, inherit) !important;
  border-left: 3px solid var(--p-primary-color, #2563eb) !important;
}

/* Checkbox Icon / Tick Mark Rendering Fix */
:deep(.p-checkbox-box) {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

:deep(.p-checkbox .p-checkbox-box .p-checkbox-icon),
:deep(.p-checkbox-icon),
:deep(.p-checkbox .p-icon) {
  display: block !important;
  visibility: visible !important;
  width: 12px !important;
  height: 12px !important;
  color: var(--p-primary-contrast-color, #ffffff) !important;
  fill: currentColor !important;
  stroke: currentColor !important;
}

/* Fixed Row Height in Parameter Scan Table */
:deep(.scan-datatable .p-datatable-tbody > tr) {
  height: 46px !important;
}
:deep(.scan-datatable .p-datatable-tbody > tr > td) {
  padding: 4px 8px !important;
  height: 46px !important;
  vertical-align: middle !important;
}
.param-cell-wrapper {
  height: 34px;
  display: flex;
  align-items: center;
}

.subtle-dash {
  color: var(--p-text-muted-color, #9ca3af);
  font-size: 12px;
  padding-left: 8px;
}

.empty-state {
  font-size: 13px;
  color: var(--p-text-muted-color, #909399);
  padding: 16px;
  text-align: center;
}

/* Grid Layouts */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-muted-color, #606266);
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
