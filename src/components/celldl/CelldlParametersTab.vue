<template>
  <div class="celldl-parameters">
    <div class="celldl-parameters-toolbar">
      <div class="toolbar-row">
        <template v-if="chips.length">
          <span class="toolbar-label">Show only:</span>
          <button
            v-for="chip in chips"
            :key="chip.key"
            type="button"
            class="issue-chip"
            :class="[`issue-chip--${chip.kind}`, { 'issue-chip--active': activeFilters.includes(chip.key) }]"
            :aria-pressed="activeFilters.includes(chip.key)"
            :title="activeFilters.includes(chip.key) ? 'Showing only these. Click to show all again.' : 'Click to show only these'"
            @click="toggleFilter(chip.key)"
          >
            <i :class="['pi', chip.icon]"></i>
            {{ chip.label }}
          </button>
        </template>
        <span v-else class="toolbar-label toolbar-label--ok"><i class="pi pi-check-circle"></i> Every element is named and valued</span>
        <label class="unit-system" :title="unitSystemTitle">
          <span>Units</span>
          <Select
            :model-value="host.unitSystem.value"
            :options="UNIT_SYSTEM_OPTIONS"
            option-label="label"
            option-value="value"
            placeholder="Unknown"
            size="small"
            class="unit-system-select"
            :disabled="!isDiagramShown || isSettingUnits"
            input-id="celldl-unit-system"
            aria-label="Unit system"
            @update:model-value="onUnitSystemChange"
          />
        </label>
      </div>
      <p class="toolbar-note">
        Types, species and locations change the diagram. Values are this instance's: a blank one uses the diagram's,
        shown greyed.
      </p>
      <Message v-if="!isDiagramShown" class="toolbar-message" severity="secondary" size="small" :closable="false">
        <span class="toolbar-message-body">
          Show the diagram to change types, species and locations.
          <Button label="Show diagram" size="small" text @click="emit('show-in-diagram', null)" />
        </span>
      </Message>
    </div>

    <div ref="scrollerRef" class="celldl-parameters-scroller">
      <p v-if="!table.sections.length" class="empty-note">
        {{ isOpening ? 'Opening the diagram...' : 'The diagram has no elements yet. Add them from the bond graph palette.' }}
      </p>
      <table v-else class="celldl-parameters-table">
        <colgroup>
          <col class="col-element" />
          <col class="col-type" />
          <col class="col-name" />
          <col class="col-name" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Element</th>
            <th scope="col">Type</th>
            <th scope="col">Species</th>
            <th scope="col">Location</th>
          </tr>
        </thead>
        <tbody v-for="section in shownSections" :key="section.key" :data-section="section.key">
          <tr class="section-row">
            <th colspan="4" scope="colgroup">
              <button
                type="button"
                class="section-toggle"
                :aria-expanded="!collapsed.has(section.key)"
                @click="toggleSection(section.key)"
              >
                <i :class="['pi', collapsed.has(section.key) ? 'pi-chevron-right' : 'pi-chevron-down']"></i>
                {{ section.label }}
                <span class="section-count">{{ section.rows.length }}</span>
              </button>
            </th>
          </tr>
          <template v-for="row in collapsed.has(section.key) ? [] : section.rows" :key="row.id">
            <tr
              :data-element-id="row.element?.id"
              :class="[rowClass(row), 'element-row--main', { 'element-row--has-values': row.values.length }]"
              @click="onRowClick(row, $event)"
            >
              <!-- Element: its glyph's label, its kind and the names it is generated as -->
              <td class="cell-element" :rowspan="row.values.length ? 2 : 1">
                <div class="element-heading">
                  <i v-if="row.depth" class="pi pi-link link-icon" title="This store's 0-junction"></i>
                  <span v-if="row.element" class="glyph">
                    {{ row.element.symbol }}<sup v-if="row.element.species">{{ row.element.species }}</sup
                    ><sub v-if="row.element.location">{{ row.element.location }}</sub>
                  </span>
                  <span v-else class="glyph glyph--constant">{{ row.names[0] }}</span>
                  <i
                    v-if="row.clash"
                    class="pi pi-clone flag flag--clash"
                    v-tooltip.top="clashText(row)"
                    :aria-label="clashText(row)"
                  ></i>
                  <i
                    v-if="row.unset.length"
                    class="pi pi-exclamation-circle flag flag--unset"
                    v-tooltip.top="row.unset.join('\n')"
                    :aria-label="row.unset.join('. ')"
                  ></i>
                  <Button
                    v-if="row.element && !isDiagramShown"
                    icon="pi pi-map-marker"
                    text
                    rounded
                    size="small"
                    class="show-button"
                    aria-label="Show in diagram"
                    title="Show in diagram"
                    @click.stop="emit('show-in-diagram', row.element.id)"
                  />
                </div>
                <div v-if="row.element" class="element-kind">{{ row.element.kindName }}</div>
                <div class="element-names" :title="row.names.join(', ')">{{ row.names.join(', ') || ' ' }}</div>
              </td>

              <!-- Type: the templates the editor's Properties panel offers the element -->
              <td class="cell-type">
                <template v-if="row.element?.isBondElement && typeOptions(row.element).options.length">
                  <Select
                    :model-value="typeOptions(row.element).value"
                    :options="typeOptions(row.element).options"
                    :placeholder="typeOptions(row.element).placeholder"
                    option-label="label"
                    option-value="value"
                    size="small"
                    class="type-select"
                    :invalid="!row.element.template"
                    :disabled="!isDiagramShown"
                    :aria-label="`Type of ${label(row.element)}`"
                    @update:model-value="(value) => onTypeChange(row.element, value)"
                  />
                </template>
                <span v-else-if="row.element" class="cell-static">{{ row.element.templateName ?? row.element.kindName }}</span>
                <span v-else class="cell-static cell-static--muted">Model constant</span>
              </td>

              <!-- Species and location: the diagram's -->
              <td v-for="field in NAME_FIELDS" :key="field" class="cell-name">
                <template v-if="row.element && row.element[field] !== undefined">
                  <CommitInput
                    :model-value="row.element[field]"
                    :validate="validateName"
                    :disabled="!isDiagramShown"
                    :invalid="isDefaultName(row.element, field)"
                    :title="isDefaultName(row.element, field) ? `Still the default ${field}` : ''"
                    :aria-label="`${field === 'species' ? 'Species' : 'Location'} of ${label(row.element)}`"
                    @commit="(value) => onNameCommit(row, field, value)"
                  />
                </template>
                <span v-if="row.depth && field === 'species' && ownsNaming(row)" class="own-chip" title="This junction has its own species or location, so it doesn't follow its store">
                  own {{ field }}
                </span>
              </td>

            </tr>
            <!-- Values: this instance's, with the diagram's as their defaults -->
            <tr
              v-if="row.values.length"
              :data-element-id="row.element?.id"
              :class="[rowClass(row), 'element-row--values']"
              @click="onRowClick(row, $event)"
            >
              <td colspan="3" class="cell-values">
                <div class="value-list">
                  <label v-for="cell in row.values" :key="cell.key" class="value-item" :data-variable="cell.name">
                    <span class="value-label">{{ cell.label }}</span>
                    <!-- One the math computes, e.g. an inductor's acceleration, takes no value -->
                    <span
                      v-if="cell.isComputed"
                      class="computed-value"
                      :title="`${cell.name}: computed by the math, so it takes no value`"
                    >
                      computed
                    </span>
                    <CommitInput
                      v-else
                      numeric
                      :model-value="shownValue(cell)"
                      :placeholder="cell.defaultValue"
                      :validate="validateNumber"
                      :disabled="!cell.name || !!suppliedBy(cell)"
                      :invalid="isMissing(cell)"
                      :class="{ 'value-input--ignored': ignoredNotices.has(cell.name) }"
                      :title="valueTitle(cell)"
                      :aria-label="`${cell.label} of ${row.element ? label(row.element) : cell.name}`"
                      @commit="(value) => emit('set-value', cell, value)"
                    />
                    <span class="value-units">{{ cell.units }}</span>
                    <span v-if="suppliedBy(cell)" class="supplied-hint" :title="valueTitle(cell)">
                      <i class="pi pi-link"></i> {{ suppliedBy(cell) }}
                    </span>
                    <span
                      v-else-if="!cell.isComputed && isDefault(cell) && !isEmptyValue(cell.defaultValue)"
                      class="default-hint"
                    >
                      default
                    </span>
                  </label>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
/**
 * The Parameters tab of a CellDL module: its diagram's elements, one row each (services/celldl/elementTable). Type,
 * species and location edit the diagram through the CellDL editor, one undo step each; values edit this instance's
 * rows, with the diagram's values as greyed defaults.
 */
import { computed, nextTick, ref, watch } from 'vue'

import Button from 'primevue/button'
import Message from 'primevue/message'
import Select from 'primevue/select'

import CommitInput from './CommitInput.vue'
import { useCelldlEditorHost } from '../../composables/useCelldlEditorHost'
import {
  DEFAULT_LOCATION,
  DEFAULT_SPECIES,
  hasOwnNaming,
  isDefaultValue,
  NAME_PATTERN,
  structureEdits,
  typeOptions,
} from '../../services/celldl/elementTable'
import { isEmpty } from '../../utils/variables'
import { notify } from '../../utils/notify'

const props = defineProps({
  /** The tab's rows (buildElementTable). */
  table: { type: Object, required: true },
  /** The module's values as saved, which rows still on them follow. */
  savedDefaults: { type: Map, default: () => new Map() },
  /** Whether the diagram shows in the CellDL tab, so the editor can change it. */
  isDiagramShown: { type: Boolean, default: false },
  /** Whether the diagram is still opening, so has no elements yet. */
  isOpening: { type: Boolean, default: false },
  /** Each row name to where its value comes from (resolveBoundaryValues' `status`). */
  connectionStatus: { type: Map, default: () => new Map() },
  /** Each row whose value export ignores, as something else supplies its variable, with why. */
  ignoredNotices: { type: Map, default: () => new Map() },
})

const emit = defineEmits(['set-value', 'show-in-diagram'])

const host = useCelldlEditorHost()
const NAME_FIELDS = ['species', 'location']
/** The unit systems a diagram can build its CellML in. */
const UNIT_SYSTEM_OPTIONS = [
  { value: 'cellular', label: 'Cellular (fmol, pL)' },
  { value: 'si', label: 'SI (mol, L)' },
]
// The "Junctions follow their store" switch is gone, as junctions always follow: drop the setting it kept.
try {
  window.localStorage.removeItem('celldlParameters.followStore')
} catch {
  // ignore storage errors
}

// ── Toolbar ─────────────────────────────────────────────────────────────────
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`
const chips = computed(() => {
  const list = []
  if (props.table.unsetCount) {
    list.push({ key: 'unset', kind: 'units', icon: 'pi-exclamation-circle', label: `${plural(props.table.unsetCount, 'row')} to set` })
  }
  if (props.table.clashCount) {
    list.push({ key: 'clash', kind: 'clash', icon: 'pi-clone', label: `${plural(props.table.clashCount, 'name')} clashing` })
  }
  return list
})

const filters = ref([])
const activeFilters = computed(() => filters.value.filter((key) => chips.value.some((chip) => chip.key === key)))
// Rows the filter showed, kept while it is on, so a row doesn't vanish as it is fixed.
const stickyIds = ref(new Set())
const matchesFilter = (row) =>
  (activeFilters.value.includes('unset') && row.unset.length > 0) || (activeFilters.value.includes('clash') && !!row.clash)

function toggleFilter(key) {
  filters.value = filters.value.includes(key) ? filters.value.filter((other) => other !== key) : [...filters.value, key]
  stickyIds.value = new Set(allRows().filter(matchesFilter).map((row) => row.id))
}

const allRows = () => props.table.sections.flatMap((section) => section.rows)

const shownSections = computed(() => {
  if (!activeFilters.value.length) return props.table.sections
  return props.table.sections
    .map((section) => ({ ...section, rows: section.rows.filter((row) => stickyIds.value.has(row.id) || matchesFilter(row)) }))
    .filter((section) => section.rows.length)
})

const collapsed = ref(new Set())
function toggleSection(key) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

// ── Rows ────────────────────────────────────────────────────────────────────
/** The element's label as its glyph shows it, e.g. `q S c`. */
const label = (element) => [element.symbol, element.species, element.location].filter(Boolean).join(' ')

const selectedId = computed(() => host.selection.value.id)

const rowClass = (row) => ({
  'element-row': true,
  'element-row--junction': row.depth > 0,
  'element-row--unset': row.unset.length > 0,
  'element-row--clash': !!row.clash,
  'element-row--selected': !!row.element && row.element.id === selectedId.value,
})

function clashText(row) {
  const others = row.clash.others.map(label).join(', ')
  return `Same name as ${others}: ${row.clash.name}`
}

const isDefaultName = (element, field) => element[field] === (field === 'species' ? DEFAULT_SPECIES : DEFAULT_LOCATION)

function ownsNaming(row) {
  const store = props.table.rowsById.get(row.storeId)?.element
  return !!store && hasOwnNaming(row.element, store)
}

const validateName = (value) => (NAME_PATTERN.test(value) ? '' : 'A letter or _, then letters, digits or _')

function validateNumber(value) {
  if (value === '') return ''
  return Number.isFinite(Number(value)) ? '' : 'A number'
}

const isEmptyValue = isEmpty
const isDefault = (cell) => isDefaultValue(cell, props.savedDefaults)
/** A value still on the diagram's shows blank, so the diagram's greyed placeholder reads as its default. */
const shownValue = (cell) => (isDefault(cell) ? '' : String(cell.row?.value ?? ''))
const isMissing = (cell) => !cell.supplied && isEmpty(cell.row?.value) && isEmpty(cell.defaultValue)

/**
 * Says where a connection supplies a cell's value from, e.g. `Set by other_1.X`, or, for a store's initial value,
 * what drives the store; null when it doesn't.
 *
 * @param {Object} cell - A value cell.
 * @returns {string|null}
 */
function suppliedBy(cell) {
  const status = cell.name ? props.connectionStatus.get(cell.name) : null
  const isSupplied = status?.state === 'connected' || status?.state === 'drivenInitial'
  return isSupplied ? `Set by ${status.from.join(', ') || 'a connection'}` : null
}

function valueTitle(cell) {
  if (!cell.name) return 'Converting the diagram...'
  if (props.ignoredNotices.has(cell.name)) return `${cell.name}: ${props.ignoredNotices.get(cell.name)}`
  if (suppliedBy(cell)) return `${cell.name}: ${suppliedBy(cell)}`
  const own = cell.row?.carriedFrom
    ? ` It was ${cell.row.carriedFrom}'s, and moves to the new name when the diagram is saved.`
    : cell.row?.pending
      ? ' It is kept for this instance when the diagram is saved.'
      : ''
  if (isDefault(cell)) {
    return isEmpty(cell.defaultValue) ? `${cell.name}: no value yet` : `${cell.name}: the diagram's ${cell.defaultValue}.${own}`
  }
  return `${cell.name}: this instance's own value.${own}`
}

// ── Edits ───────────────────────────────────────────────────────────────────
/**
 * Sends edits to the diagram, saying why any couldn't be made.
 *
 * @param {{id: string, field: string, value: string}[]} edits
 */
async function sendEdits(edits) {
  if (!edits.length || !props.isDiagramShown) return
  try {
    const result = await host.setElement(edits)
    if (!result.ok) {
      notify.error({ message: (result.errors ?? []).map((error) => error.message).join('\n') || "The diagram wasn't changed" })
    }
  } catch (error) {
    notify.error({ message: error.message })
  }
}

function onTypeChange(element, value) {
  if (!value || value === element.template) return
  sendEdits([{ id: element.id, field: 'type', value }])
}

function onNameCommit(row, field, value) {
  const junction = row.junctionId ? props.table.rowsById.get(row.junctionId)?.element : null
  sendEdits(structureEdits(row.element, field, value, { junction }))
}

// ── Unit system ─────────────────────────────────────────────────────────────
const isSettingUnits = ref(false)
const unitSystemTitle = computed(() =>
  props.isDiagramShown
    ? "The units the diagram's CellML is in. Changing them is a diagram edit; saving rescales this instance's values to match."
    : 'Show the diagram to change its unit system'
)

/**
 * Sets the diagram's unit system, as a diagram edit.
 *
 * @param {string} id
 */
async function onUnitSystemChange(id) {
  if (!id || id === host.unitSystem.value || !props.isDiagramShown) return
  isSettingUnits.value = true
  try {
    const result = await host.setUnitSystem(id)
    if (!result.ok) notify.error({ message: result.error || "The diagram's unit system wasn't changed" })
  } catch (error) {
    notify.error({ message: error.message })
  } finally {
    isSettingUnits.value = false
  }
}

// ── Selection, both ways ────────────────────────────────────────────────────
function onRowClick(row, event) {
  if (!row.element || event.target.closest('input, button, .p-select, label')) return
  if (props.isDiagramShown) host.selectElement(row.element.id, 'if-hidden').catch(() => {})
}

const scrollerRef = ref(null)
watch(
  () => host.selection.value,
  async ({ id, isHostSelection }) => {
    if (!id || isHostSelection) return
    await nextTick()
    const row = scrollerRef.value?.querySelector(`tr[data-element-id="${CSS.escape(id)}"]`)
    row?.scrollIntoView?.({ block: 'nearest' })
  }
)
</script>

<style scoped>
.celldl-parameters {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 6px;
}

.celldl-parameters-toolbar {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  min-height: 1.75rem;
}

.toolbar-label {
  font-size: var(--dlg-fs-tiny);
  color: var(--p-text-muted-color);
}

.toolbar-label--ok .pi {
  color: var(--p-green-500, #22c55e);
}

.toolbar-note {
  margin: 0;
  font-size: var(--dlg-fs-tiny);
  color: var(--p-text-muted-color);
}

.toolbar-message-body {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.unit-system {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: var(--dlg-fs-tiny);
  color: var(--p-text-color);
}

.unit-system-select {
  min-width: 10rem;
}

.issue-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font: inherit;
  font-size: var(--dlg-fs-tiny);
  color: var(--p-text-color);
  cursor: pointer;
  background-color: color-mix(in srgb, var(--chip-color) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--chip-color) 40%, transparent);
}

.issue-chip--active {
  font-weight: 600;
  background-color: color-mix(in srgb, var(--chip-color) 34%, transparent);
  border-color: var(--chip-color);
}

.issue-chip .pi {
  font-size: 0.75rem;
  color: var(--chip-color);
}

.issue-chip--units {
  --chip-color: var(--p-yellow-500, #eab308);
}

.issue-chip--clash {
  --chip-color: var(--p-red-500, #ef4444);
}

.celldl-parameters-scroller {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}

.empty-note {
  margin: 1rem;
  color: var(--p-text-muted-color);
  font-size: var(--dlg-fs-small);
}

.celldl-parameters-table {
  width: 100%;
  min-width: 480px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--dlg-fs-body);
}

.col-element {
  width: 9rem;
}

.col-name {
  width: 5.5rem;
}

.celldl-parameters-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 6px 8px;
  text-align: left;
  font-weight: 600;
  font-size: var(--dlg-fs-small);
  background: var(--p-datatable-header-cell-background, var(--p-content-background));
  border-bottom: 1px solid var(--p-content-border-color);
}

.section-row th {
  padding: 4px 6px;
  text-align: left;
  background: color-mix(in srgb, var(--p-text-muted-color) 8%, var(--p-content-background));
  border-bottom: 1px solid var(--p-content-border-color);
}

.section-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: 600;
  font-size: var(--dlg-fs-small);
  color: var(--p-text-color);
  cursor: pointer;
}

.section-toggle .pi {
  font-size: 0.7rem;
}

.section-count {
  font-weight: normal;
  color: var(--p-text-muted-color);
}

.element-row td {
  padding: 5px 8px;
  vertical-align: top;
  border-bottom: 1px solid var(--p-content-border-color);
  border-left: 0;
}

.element-row--has-values td:not(.cell-element) {
  padding-bottom: 2px;
  border-bottom: 0;
}

.element-row--values td {
  padding-top: 0;
}

.element-row {
  cursor: default;
}

.element-row td:first-child {
  border-left: 3px solid transparent;
}

.element-row--unset td:first-child {
  border-left-color: var(--p-yellow-500, #eab308);
}

.element-row--clash td:first-child {
  border-left-color: var(--p-red-500, #ef4444);
}

.element-row--junction .cell-element {
  padding-left: 1.25rem;
}

.element-row--selected td {
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}

.element-row:hover td {
  background: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
}

.element-row--selected:hover td {
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
}

.element-heading {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 1.6rem;
}

.glyph {
  font-family: 'Times New Roman', serif;
  font-style: italic;
  font-size: 1.05rem;
  white-space: nowrap;
}

.glyph sup,
.glyph sub {
  font-size: 0.7em;
}

.glyph--constant {
  font-family: var(--p-font-family, inherit);
  font-style: normal;
  font-size: var(--dlg-fs-body);
  font-weight: 600;
}

.link-icon {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.flag {
  font-size: 0.8rem;
  cursor: help;
}

.flag--unset {
  color: var(--p-yellow-600, #ca8a04);
}

.flag--clash {
  color: var(--p-red-500, #ef4444);
}

.show-button {
  margin-left: auto;
  width: 1.5rem !important;
  height: 1.5rem !important;
}

.element-kind {
  font-size: var(--dlg-fs-tiny);
  color: var(--p-text-muted-color);
}

.element-names {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: var(--dlg-fs-tiny);
  color: var(--p-text-muted-color);
}

.type-select {
  width: 100%;
}

.cell-static {
  display: inline-block;
  padding-top: 0.35rem;
  font-size: var(--dlg-fs-small);
}

.cell-static--muted {
  color: var(--p-text-muted-color);
}

.own-chip {
  display: inline-block;
  margin-top: 3px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: var(--dlg-fs-tiny);
  white-space: nowrap;
  color: var(--p-text-muted-color);
  border: 1px solid var(--p-content-border-color);
}

.value-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}

.value-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.value-item :deep(.commit-input) {
  width: 5.5rem;
}

.value-label {
  white-space: nowrap;
  font-size: var(--dlg-fs-small);
  color: var(--p-text-muted-color);
}

.computed-value {
  width: 5.5rem;
  font-size: var(--dlg-fs-tiny);
  font-style: italic;
  color: var(--p-text-muted-color);
}

.value-units {
  font-size: var(--dlg-fs-tiny);
  color: var(--p-text-muted-color);
  white-space: nowrap;
}

.supplied-hint {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--dlg-fs-tiny);
  color: var(--p-text-muted-color);
  white-space: nowrap;
}

.supplied-hint .pi {
  font-size: var(--dlg-fs-tiny);
}

.value-item .value-input--ignored {
  color: var(--p-text-muted-color, #64748b);
  text-decoration: line-through;
}

.default-hint {
  font-size: var(--dlg-fs-tiny);
  font-style: italic;
  color: var(--p-text-muted-color);
}
</style>
