<template>
  <div :class="['port-row', `port-row--${side}`, rowClass, { 'row--valid-target': isValidTarget }]">
    <!-- Target Side Handle -->
    <Handle
      v-if="side === 'target'"
      type="target"
      id="in"
      :position="Position.Left"
      :class="['port-handle', 'handle--left', handleClass, { 'handle--valid-target': isValidTarget }]"
    />

    <!-- Controls Container -->
    <div class="port-controls" @mousedown.stop>
      <!-- Left actions for Target Row -->
      <template v-if="side === 'target'">
        <span class="drag-handle" @mousedown.stop="$emit('start-drag', $event)">⠿</span>
        <Button icon="pi pi-trash" severity="danger" rounded text size="small" @click="$emit('delete')" />
      </template>

      <!-- Shared Configuration Fields -->
      <Select
        v-model="port.portType"
        :options="PORT_TYPE_OPTIONS"
        optionLabel="label"
        optionValue="value"
        overlayClass="compact-dropdown-panel"
        size="small"
        @change="$emit('change')"
      />

      <InputText 
        v-model="port.label"
        size="small"
        @input="$emit('change')" 
      />

      <MultiSelect
        v-model="port.variables"
        :disabled="Array.isArray(port.multiportType)"
        :options="variables"
        optionLabel="name"
        optionValue="name"
        overlayClass="compact-multiselect-panel"
        placeholder="Select variables"
        size="small"
        @change="$emit('change')"
      />

      <!-- A per-variable multi_port list is read-only here; its entries pair with the variables by position. -->
      <span
        v-if="Array.isArray(port.multiportType)"
        class="per-variable-multiport"
        title="Per-variable multiport, one entry per port variable"
      >{{ formatMultiportType(port.multiportType) }}</span>
      <Select
        v-else
        v-model="port.multiportType"
        :options="MULTIPORT_OPTIONS"
        optionLabel="label"
        overlayClass="compact-dropdown-panel"
        optionValue="value"
        size="small"
        @change="$emit('change')"
      />

      <!-- Right actions for Source Row -->
      <template v-if="side === 'source'">
        <span class="drag-handle" @mousedown.stop="$emit('start-drag', $event)">⠿</span>
        <Button icon="pi pi-trash" severity="danger" rounded text size="small" @click="$emit('delete')" />
      </template>
    </div>

    <!-- Source Side Handle -->
    <Handle
      v-if="side === 'source'"
      type="source"
      id="out"
      :position="Position.Right"
      :class="['port-handle', 'handle--right', handleClass, { 'handle--valid-target': isValidTarget }]"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import { Handle, Position } from '@vue-flow/core'
import { PORT_TYPE_OPTIONS, MULTIPORT_OPTIONS } from '../utils/constants'
import { formatMultiportType } from '../utils/config'

const props = defineProps({
  side: {
    type: String,
    required: true,
    validator: (v) => ['source', 'target'].includes(v),
  },
  port: {
    type: Object,
    required: true,
  },
  variables: {
    type: Array,
    default: () => [],
  },
  isConnected: {
    type: Boolean,
    default: false,
  },
  isTakenElsewhere: {
    type: Boolean,
    default: false,
  },
  isValidTarget: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['change', 'start-drag', 'delete'])

const rowClass = computed(() => {
  if (props.isConnected) return 'row--connected'
  if (props.isTakenElsewhere) {
    return props.port.multiportType && props.port.multiportType !== 'None' ? 'row--taken-multi' : 'row--taken'
  }
  return 'row--free'
})

const handleClass = computed(() => {
  if (props.isConnected) return 'handle--connected'
  if (props.isTakenElsewhere && props.port?.multiportType === 'None') {
    return 'handle--taken'
  }
  return 'handle--free'
})
</script>

<style scoped>
.port-row {
  width: 520px !important;
  height: 44px;
  display: flex;
  align-items: center;
  border-radius: 4px;
  border: 1px solid var(--p-content-border-color, #27272a);
  background: var(--p-content-background, #18181b);
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  position: relative;
  box-sizing: border-box !important;
}

.port-controls {
  display: grid;
  gap: 6px;
  align-items: center;
  width: 100%;
  padding: 0 8px;
  box-sizing: border-box !important;
}

.port-row--source .port-controls {
  grid-template-columns: 60px minmax(0, 1fr) minmax(0, 1.2fr) 85px 16px 28px;
}

.port-row--target .port-controls {
  grid-template-columns: 16px 28px 60px minmax(0, 1fr) minmax(0, 1.2fr) 85px;
}

:deep(.p-select),
:deep(.p-multiselect),
:deep(.p-inputtext) {
  width: 100% !important;
  min-width: 0 !important;
}

:deep(.p-inputtext),
:deep(.p-select-label),
:deep(.p-multiselect-label),
:deep(.p-multiselect-token-label) {
  font-size: 12px !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
  line-height: 1.2;
}

:deep(.p-multiselect-token) {
  padding: 2px 6px !important;
  margin-top: 1px !important;
  margin-bottom: 1px !important;
}

:deep(.p-select-dropdown),
:deep(.p-multiselect-dropdown) {
  width: 24px !important;
}

.drag-handle {
  cursor: grab;
  color: var(--p-text-muted-color, #71717a);
  font-size: 16px;
  padding: 0;
  user-select: none;
  line-height: 1;
  display: inline-flex;
  justify-content: center;
  align-items: center;
}
.drag-handle:hover {
  color: var(--p-primary-color, #409eff);
}
.drag-handle:active {
  cursor: grabbing;
}

.row--connected {
  background: color-mix(in srgb, var(--p-primary-color, #409eff) 16%, var(--p-content-background, #18181b));
  border-color: var(--p-primary-color, #409eff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-color, #409eff) 25%, transparent);
}
.row--taken {
  background: color-mix(in srgb, var(--p-warn-color, #e6a23c) 16%, var(--p-content-background, #18181b));
  border: 1px dashed var(--p-warn-color, #e6a23c);
  opacity: 0.85;
}
.row--taken-multi {
  background: var(--p-content-background, #18181b);
  border-color: var(--p-content-border-color, #3f3f46);
  opacity: 1;
}
.row--free {
  opacity: 0.55;
}
.row--free:hover,
.row--free.row--valid-target {
  opacity: 1;
  border-color: var(--p-primary-color, #409eff);
}

.port-handle {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--p-content-background, #18181b);
  transition: background 0.1s ease;
  position: absolute !important;
  top: 50% !important;
  z-index: 10;
}

.handle--left {
  left: 0 !important; 
  transform: translate(-50%, -50%) !important;
}

.handle--right {
  right: 0 !important;
  transform: translate(50%, -50%) !important;
}

.handle--connected {
  background: var(--p-primary-color, #409eff);
}
.handle--taken {
  background: var(--p-warn-color, #e6a23c);
}
.handle--free {
  background: var(--p-text-muted-color, #71717a);
}
.handle--valid-target {
  background: var(--p-green-500, #67c23a) !important;
  box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.35);
}
</style>

<style>
.compact-dropdown-panel .p-select-option,
.compact-dropdown-panel .p-dropdown-item {
  font-size: 12px !important;
  padding: 4px 8px !important;
  min-height: 24px !important;
}

/* ── MultiSelect Options & Items ── */
.compact-multiselect-panel .p-multiselect-option,
.compact-multiselect-panel .p-multiselect-item {
  font-size: 11px !important;
  padding: 4px 8px !important;
  min-height: 24px !important;
}

/* ── MultiSelect Header (Filter input & Select-All checkbox) ── */
.compact-multiselect-panel .p-multiselect-header {
  padding: 4px 8px !important;
}

.compact-multiselect-panel .p-multiselect-filter {
  font-size: 11px !important;
  padding: 2px 6px !important;
  height: 24px !important;
}

/* ── Checkbox scaling inside option rows ── */
.compact-multiselect-panel .p-checkbox,
.compact-multiselect-panel .p-checkbox-box {
  width: 14px !important;
  height: 14px !important;
}

.per-variable-multiport {
  font-size: 0.8em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>