<template>
  <!-- A port's variable picker, with a search box over its options -->
  <MultiSelect
    :modelValue="port.variables"
    @update:modelValue="setPortVariables(port, $event)"
    :invalid="flagged && !port.variables?.length"
    :options="options"
    optionLabel="name"
    optionValue="name"
    size="small"
    placeholder="Select variables"
    filter
    autoFilterFocus
    resetFilterOnHide
    filterPlaceholder="Search variables..."
    emptyFilterMessage="No matching variables"
    :pt="{ overlay: { class: compact ? 'ports-variable-overlay ports-variable-overlay--compact' : 'ports-variable-overlay' } }"
    @change="$emit('change')"
  >
    <template #value="{ value, placeholder }">
      <PortVariableChips
        v-if="value?.length"
        :port="port"
        :limit="chipLimit"
        :invalid="flagged"
        :locked="locked"
        @change="$emit('change')"
      />
      <template v-else>{{ placeholder }}</template>
    </template>
    <template #filtericon>
      <span class="ports-variable-filter-icons">
        <i class="pi pi-search"></i>
        <i
          class="search-clear-input pi pi-times-circle"
          role="button"
          aria-label="Clear search"
          @mousedown.prevent
          @click.stop="clearSearch"
        ></i>
      </span>
    </template>
  </MultiSelect>
</template>

<script setup>
import MultiSelect from 'primevue/multiselect'
import PortVariableChips from './PortVariableChips.vue'
import { setPortVariables } from '../utils/multiport'

defineProps({
  port: { type: Object, required: true },
  // Variable rows to pick from, each with a `name`.
  options: { type: Array, default: () => [] },
  // Chips shown in the field before the "+N" chip.
  chipLimit: { type: Number, default: 3 },
  // Marks the field invalid when it has no variables, and flags blank Multiply factors.
  flagged: { type: Boolean, default: false },
  // Smaller panel text, for the edge dialog's port rows.
  compact: { type: Boolean, default: false },
  // Read-only multiport types on the chips, e.g. set by an annotation.
  locked: { type: Boolean, default: false },
})

defineEmits(['change'])

/**
 * Empties the search box and refilters, keeping focus in it.
 *
 * @param {MouseEvent} event - Click on the clear icon.
 */
function clearSearch(event) {
  const input = event.currentTarget.closest('.p-iconfield')?.querySelector('input')
  if (!input) return
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus()
}
</script>

<!-- The panel is teleported to <body>, so scoped styles can't reach it. -->
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

/* Compact: sized to the edge dialog's 12px port rows. */
.ports-variable-overlay--compact {
  --p-multiselect-option-padding: 4px 8px;
  --p-checkbox-width: 14px;
  --p-checkbox-height: 14px;
}

.ports-variable-overlay--compact .p-multiselect-option {
  font-size: 11px;
  min-height: 24px;
}

.ports-variable-overlay--compact .p-multiselect-header {
  padding: 4px 8px;
}

.ports-variable-overlay--compact .p-multiselect-header .p-inputtext {
  font-size: 11px;
  height: 24px;
  padding-block: 2px;
}

.ports-variable-overlay--compact .ports-variable-filter-icons {
  font-size: 11px;
}
</style>
