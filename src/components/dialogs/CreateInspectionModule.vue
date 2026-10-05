<template>
  <Dialog
    :visible="modelValue"
    :header="editingModule ? 'Edit Inspection Module' : 'New Inspection Module'"
    modal
    :draggable="false"
    :dismissableMask="true"
    :style="{ width: '760px', height: '85vh' }"
    :appendTo="'body'"
    @update:visible="
      (visible) => {
        if (!visible) closeDialog()
      }
    "
  >
    <div class="dialog-content">
      <section class="block">
        <div class="field">
          <label for="inspection-module-name">
            Module Name <span class="subtle">(optional — defaults to '{{ defaultName }}')</span>
          </label>
          <SanitisedInput
            v-model="moduleName"
            input-id="inspection-module-name"
            :sanitise="sanitiseName"
            placeholder="e.g., total_volume"
            :invalid="isNameDuplicate"
            autofocus
            floating
          />

          <small v-if="isNameDuplicate" class="error-text">
            A module with the name "{{ sanitiseName(moduleName) }}" already exists. Please choose a unique name.
          </small>
        </div>
      </section>

      <section class="block variables-block">
        <div class="block-header">
          <h4>Variables To Sum</h4>
          <span class="subtle">{{ selectedRows.length }} selected of {{ variableRows.length }} total</span>
        </div>

        <!-- Validation / status -->
        <div class="validation-status">
          <Message v-if="isNameDuplicate" severity="error" :closable="false">
            Inspection module name must be unique.
          </Message>
          <Message v-else-if="selectedRows.length === 0" severity="secondary" :closable="false">
            Select two or more variables with matching units to sum. 
          </Message>
          <Message v-else-if="selectedRows.length === 1" severity="warn" :closable="false">
            Select at least one more variable — a module needs two or more variables to sum.
          </Message>
          <Message v-else-if="hasUnitMismatch" severity="error" :closable="false">
            Selected variables have mismatched units ({{ distinctUnits.join(', ') }}). 
          </Message>
          <Message v-else severity="success" :closable="false">
            {{ selectedRows.length }} variables selected — units: {{ distinctUnits[0] || '—' }}
          </Message>
        </div>

        <!-- Filter Bar -->
        <div class="filter-toolbar" v-if="variableRows.length > 0">
          <div class="node-search-combo">
            <span class="node-search-input-wrap">
              <InputText
                v-model="nodeSearch"
                placeholder="Search / filter by instance..."
                class="filter-input node-search-input"
                @focus="nodeSearchOpen = true"
                @input="onNodeSearchInput"
                @blur="onNodeSearchBlur"
              />
              <i
                v-if="selectedNodeFilter"
                class="pi pi-times node-search-clear"
                title="Clear instance filter"
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
                  :class="{ active: option.value === selectedNodeFilter }"
                  @mousedown.prevent="selectNodeMatch(option)"
                >
                  {{ option.label }}
                </li>
              </ul>
              <div v-else class="search-no-match">No matching instances</div>
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
            v-if="nodeSearch || variableSearch || selectedNodeFilter"
            label="Reset Filters"
            icon="pi pi-filter-slash"
            text
            severity="secondary"
            @click="resetFilters"
          />
        </div>

        <!-- Accordion Grouped Variables -->
        <div v-if="variableRows.length === 0" class="empty-state">
          No summable variables were found on the current instances.
        </div>
        <div v-else-if="groupedVisibleRows.length === 0" class="empty-state">
          No variables match the current filters.
        </div>

        <Accordion v-else :multiple="true" v-model:activeIndex="activePanels" class="node-accordion">
          <AccordionTab v-for="(group, index) in groupedVisibleRows" :key="group.nodeName">
            <template #header>
              <div class="accordion-header-content">
                <div class="node-title-group">
                  <i
                    class="pi pi-chevron-right accordion-chevron"
                    :class="{ 'accordion-chevron-open': activePanels.includes(index) }"
                  ></i>
                  <span class="font-bold node-name">{{ group.nodeName }}</span>
                </div>
                <div class="badge-group">
                  <span class="count-badge">{{ group.rows.length }} vars</span>
                  <span v-if="group.selectedCount > 0" class="count-badge selected">
                    {{ group.selectedCount }} selected
                  </span>
                </div>
              </div>
            </template>

            <DataTable
              :value="group.rows"
              dataKey="key"
              size="small"
              rowHover
              :rowClass="(data) => ({ 'row-selected': data.selected })"
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
              <Column field="units" header="Units" style="width: 90px">
                <template #body="{ data }">
                  {{ data.units || '-' }}
                </template>
              </Column>
              <Column header="Sign" style="width: 64px">
                <template #body="{ data }">
                  <Button
                    :icon="data.sign === -1 ? 'pi pi-minus' : 'pi pi-plus'"
                    text
                    rounded
                    size="small"
                    :severity="data.sign === -1 ? 'danger' : 'success'"
                    v-tooltip.top="data.sign === -1 ? 'Subtracted from total' : 'Added to total'"
                    @click="toggleSign(data)"
                  />
                </template>
              </Column>
            </DataTable>
          </AccordionTab>
        </Accordion>
      </section>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" severity="secondary" text @click="closeDialog" />
        <Button
          :label="editingModule ? 'Save Changes' : 'Create Module'"
          severity="primary"
          :disabled="!canConfirm"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

import { sanitiseName } from '../../utils/identifiers'

import Accordion from 'primevue/accordion'
import AccordionTab from 'primevue/accordiontab'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'

import SanitisedInput from '../SanitisedInput.vue'

const props = defineProps({
  modelValue: Boolean,
  nodes: {
    type: Array,
    default: () => [],
  },
  editingModule: {
    type: Object,
    default: null,
  },
  existingModules: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const moduleName = ref('')
const variableRows = ref([])
const nodeSearch = ref('')
const variableSearch = ref('')
const selectedNodeFilter = ref(null)
const nodeSearchOpen = ref(false)
const activePanels = ref([])

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) initialiseDialog()
  }
)

function buildVariableRows(nodes, editingModule) {
  const existingByKey = new Map()
  if (editingModule) {
    for (const variable of editingModule.variables || []) {
      existingByKey.set(variable.key, variable)
    }
  }

  const rows = []

  for (const node of nodes || []) {
    if (!node?.data?.name) continue
    for (const variable of node.data.variables || []) {
      if (!variable?.name) continue
      if ((variable.type || 'variable') !== 'variable') continue

      const key = `${node.id}::${variable.name}`
      const existing = existingByKey.get(key)
      if (existing) existingByKey.delete(key)

      rows.push({
        key,
        nodeId: node.id,
        nodeName: node.data.name,
        variableName: variable.name,
        units: variable.units || '',
        selected: Boolean(existing),
        sign: existing?.sign === -1 ? -1 : 1,
      })
    }
  }

  return rows.sort((a, b) => {
    const nodeDiff = a.nodeName.localeCompare(b.nodeName)
    if (nodeDiff !== 0) return nodeDiff
    return a.variableName.localeCompare(b.variableName)
  })
}

function initialiseDialog() {
  const editing = props.editingModule
  moduleName.value = editing ? editing.name : ''
  variableRows.value = buildVariableRows(props.nodes, editing)
  resetFilters()
}

function toggleSign(row) {
  row.sign = row.sign === -1 ? 1 : -1
}

const visibleRows = computed(() => {
  const nodeTerm = nodeSearch.value.trim().toLowerCase()
  const variableTerm = variableSearch.value.trim().toLowerCase()

  return variableRows.value.filter((row) => {
    if (selectedNodeFilter.value && row.nodeName !== selectedNodeFilter.value) return false
    if (nodeTerm && !row.nodeName.toLowerCase().includes(nodeTerm)) return false
    if (variableTerm && !row.variableName.toLowerCase().includes(variableTerm)) return false
    return true
  })
})

const nodeFilterOptions = computed(() => {
  const unique = new Set(variableRows.value.map((row) => row.nodeName))
  return Array.from(unique)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ label: name, value: name }))
})

const matchingNodeOptions = computed(() => {
  const term = nodeSearch.value.trim().toLowerCase()
  if (!term) return nodeFilterOptions.value
  return nodeFilterOptions.value.filter((opt) => opt.label.toLowerCase().includes(term))
})

const groupedVisibleRows = computed(() => {
  const groupsMap = new Map()
  for (const row of visibleRows.value) {
    if (!groupsMap.has(row.nodeName)) groupsMap.set(row.nodeName, [])
    groupsMap.get(row.nodeName).push(row)
  }

  return Array.from(groupsMap.entries()).map(([nodeName, rows]) => ({
    nodeName,
    rows,
    selectedCount: rows.filter((r) => r.selected).length,
  }))
})

watch(
  () => groupedVisibleRows.value.map((g) => g.nodeName).join('|'),
  () => {
    activePanels.value = groupedVisibleRows.value.map((_, index) => index)
  }
)

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

function isGroupAllSelected(rows) {
  if (!rows || rows.length === 0) return false
  return rows.every((row) => row.selected)
}

function toggleGroupSelection(rows, value) {
  rows.forEach((row) => {
    row.selected = Boolean(value)
  })
}

function resetFilters() {
  selectedNodeFilter.value = null
  nodeSearch.value = ''
  variableSearch.value = ''
  nodeSearchOpen.value = false
}

function selectNodeMatch(option) {
  selectedNodeFilter.value = option.value
  nodeSearch.value = option.label
  nodeSearchOpen.value = false
}

function clearNodeSelection() {
  selectedNodeFilter.value = null
  nodeSearch.value = ''
  nodeSearchOpen.value = false
}

function onNodeSearchInput() {
  nodeSearchOpen.value = true
  selectedNodeFilter.value = null
}

function onNodeSearchBlur() {
  setTimeout(() => {
    nodeSearchOpen.value = false
  }, 150)
}

// ── Uniqueness & Default Name Logic ─────────────────────────────────────────
const existingNames = computed(() => {
  return (props.existingModules || [])
    .filter((mod) => !props.editingModule || mod.id !== props.editingModule.id)
    .map((mod) => (mod.name || '').trim().toLowerCase())
})

const defaultName = computed(() => {
  const base = 'inspection_module'
  const taken = new Set(existingNames.value)

  if (!taken.has(base.toLowerCase())) {
    return base
  }

  let counter = 1
  while (taken.has(`${base}_${counter}`.toLowerCase())) {
    counter++
  }
  return `${base}_${counter}`
})

const isNameDuplicate = computed(() => {
  const input = sanitiseName(moduleName.value)
  if (!input) return false // Empty string falls back to defaultName, which is guaranteed unique
  return existingNames.value.includes(input)
})

// ── Selection / validation ──────────────────────────────────────────────────
const selectedRows = computed(() => variableRows.value.filter((row) => row.selected))

const distinctUnits = computed(() => {
  const set = new Set(selectedRows.value.map((row) => (row.units || '').trim()))
  return Array.from(set)
})

const hasUnitMismatch = computed(() => distinctUnits.value.length > 1)

const canConfirm = computed(() => {
  if (isNameDuplicate.value) return false
  return selectedRows.value.length >= 2 && !hasUnitMismatch.value
})

// ── Actions ──────────────────────────────────────────────────────────────
function handleConfirm() {
  if (!canConfirm.value) return

  const inferredUnits = distinctUnits.value[0] || 'dimensionless'
  const finalModuleName = sanitiseName(moduleName.value) || defaultName.value

  emit('confirm', {
    id: props.editingModule?.id,
    name: finalModuleName,
    units: inferredUnits,
    variables: selectedRows.value.map((row) => ({
      key: row.key,
      nodeId: row.nodeId,
      nodeName: row.nodeName,
      variableName: row.variableName,
      units: row.units,
      sign: row.sign,
    })),
  })

  closeDialog()
}

const closeDialog = () => {
  emit('update:modelValue', false)
}
</script>

<style scoped>

.dialog-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.block {
  border: 1px solid var(--p-content-border-color, var(--p-surface-200, #ebeef5));
  border-radius: 8px;
  padding: 14px;
  background: var(--p-content-background, var(--p-surface-0, #ffffff));
  color: var(--p-text-color, inherit);
}

.variables-block {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 14px;
  font-weight: 700;
  color: var(--p-text-color, inherit);
}

.error-text {
  color: var(--p-red-500, #f87171);
  font-size: 12px;
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
  font-weight: 400;
  color: var(--p-text-muted-color, #909399);
}

/* Toolbars */
.filter-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.filter-input {
  width: 180px;
}
.validation-status {
  display: inline-block;
  height: 30px;
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

/* Accordion styling */
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
  background-color: color-mix(in srgb, var(--p-text-color, #1f2937) 6%, var(--p-content-background, #ffffff)) !important;
  color: var(--p-text-color, inherit) !important;
  border-bottom: 1px solid transparent;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s, border-color 0.2s;
}

:deep(.node-accordion .p-accordion-header-link:hover) {
  background-color: color-mix(in srgb, var(--p-text-color, #1f2937) 12%, var(--p-content-background, #ffffff)) !important;
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
.count-badge.selected {
  background-color: color-mix(in srgb, var(--p-primary-color, #2563eb) 18%, var(--p-content-background, #ffffff));
  color: var(--p-primary-color, #2563eb);
}

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

:deep(.vars-datatable tr.row-selected) {
  background-color: color-mix(in srgb, var(--p-primary-color, #2563eb) 18%, var(--p-content-background, #ffffff)) !important;
  color: var(--p-text-color, inherit) !important;
  border-left: 3px solid var(--p-primary-color, #2563eb) !important;
}

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

.empty-state {
  font-size: 13px;
  color: var(--p-text-muted-color, #909399);
  padding: 16px;
  text-align: center;
}

.w-full {
  width: 100%;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
</style>
