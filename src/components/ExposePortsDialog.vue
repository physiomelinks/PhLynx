<template>
  <Dialog
    :visible="modelValue"
    @update:visible="(value) => !value && close()"
    modal
    :header="`Expose ports of ${childName}`"
    :style="{ width: '44rem', maxWidth: '95vw' }"
    class="expose-ports-dialog"
  >
    <p class="dialog-hint">
      Tick the ports of <strong>{{ childName }}</strong> to expose on every super instance of this super-module. Drag rows to
      order them; the order sets their slots. A label replaces the port's own on the super instances.
    </p>

    <DataTable :value="rows" data-key="key" size="small" scrollable scroll-height="22rem" @row-reorder="onRowReorder">
      <Column row-reorder header-style="width: 2.5rem" />
      <Column header-style="width: 3rem">
        <template #body="{ data }">
          <Checkbox
            v-model="ticked"
            :value="data.key"
            :input-id="`expose-${data.key}`"
            :disabled="data.disabled"
            :aria-label="`Expose ${data.port.label}`"
            v-tooltip.top="data.reason ? { value: data.reason, showDelay: 300 } : null"
          />
        </template>
      </Column>
      <Column header="Port">
        <template #body="{ data }">
          <label :for="`expose-${data.key}`" :class="{ 'text-muted': data.disabled }">{{ portName(data) }}</label>
        </template>
      </Column>
      <Column header="Type">
        <template #body="{ data }">{{ data.port.portType }}</template>
      </Column>
      <Column header="Variables">
        <template #body="{ data }">
          <span class="port-variables" :title="variablesOf(data.port)">{{ variablesOf(data.port) }}</span>
        </template>
      </Column>
      <Column header="Multiport" header-style="width: 6rem">
        <template #body="{ data }">{{ data.port.multiportType ?? 'None' }}</template>
      </Column>
      <Column header="Label" header-style="width: 9rem">
        <template #body="{ data }">
          <InputText
            v-model="labels[data.key]"
            size="small"
            class="w-full"
            :placeholder="data.port.label"
            :disabled="!ticked.includes(data.key)"
            :aria-label="`Label of ${data.port.label}`"
          />
        </template>
      </Column>
    </DataTable>

    <Message v-for="problem in problems" :key="problem" severity="error" size="small" class="expose-problem">
      {{ problem }}
    </Message>

    <template #footer>
      <Button label="Cancel" text severity="secondary" @click="close" />
      <Button label="Save" @click="save" />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Picks which of a child's ports an exposure edge exposes on its super-module's interface (see useExposure
 * exposureDialogOf): whole ports, in an order the user drags, each with an optional label. Saving emits the ticked rows
 * in order; the caller saves them and passes back any problems.
 */
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // From exposureDialogOf: { child, rows, selected }.
  dialog: { type: Object, default: null },
  problems: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'save'])

const rows = ref([])
const ticked = ref([])
const labels = ref({})

const childName = computed(() => props.dialog?.child?.data?.name ?? '')

// Exposed rows first, in their order, then the rest as the child lists them.
watch(
  () => [props.modelValue, props.dialog],
  ([visible, dialog]) => {
    if (!visible || !dialog) return
    const selected = dialog.selected ?? []
    const rest = dialog.rows.filter((row) => !row.exposedPortId)
    rows.value = [...selected, ...rest]
    ticked.value = selected.map((row) => row.key)
    labels.value = Object.fromEntries(dialog.rows.map((row) => [row.key, row.label ?? '']))
  },
  { immediate: true }
)

/** @returns {string} A row's port, with its slot when the child has more than one like it. */
function portName(row) {
  const twins = rows.value.filter((other) => other.port.portType === row.port.portType && other.port.label === row.port.label)
  return twins.length > 1 ? `${row.port.label} (${row.slot + 1})` : row.port.label
}

/** @returns {string} A port's variables, by name. */
const variablesOf = (port) => (port.variables ?? []).map((variable) => variable?.name ?? variable).join(', ')

function onRowReorder(event) {
  rows.value = event.value
}

function close() {
  emit('update:modelValue', false)
}

/** Emits the ticked rows, in the order shown, each with its label (null for the port's own). */
function save() {
  const chosen = new Set(ticked.value)
  emit(
    'save',
    rows.value.filter((row) => chosen.has(row.key)).map((row) => ({ key: row.key, label: labels.value[row.key]?.trim() || null }))
  )
}
</script>

<style scoped>
.dialog-hint {
  font-size: 13px;
  color: var(--p-text-muted-color);
  margin-top: 0;
  margin-bottom: 1rem;
}

.port-variables {
  /* Cut short, whole on hover, so a port of many variables keeps the dialog's width. */
  display: block;
  max-width: 12rem;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--p-font-family-mono, monospace);
  font-size: 12px;
}

.text-muted {
  color: var(--p-text-muted-color);
}

.expose-problem {
  margin-top: 0.5rem;
}
</style>
