<template>
  <Dialog
    :visible="modelValue"
    header="Edit Module Instance"
    :style="{ width: '800px' }"
    modal
    :dismissableMask="true"
    @hide="resetForm"
    @update:visible="closeDialog"
    @mousedown.stop
    @wheel.stop
  >
    <form class="space-y-4" @submit.prevent="handleConfirm">
      <div class="form-field">
        <label class="form-label">Instance Name</label>
        <InputText v-model="editableData.name" placeholder="Enter instance name" class="w-full" />
      </div>

      <Divider />

      <label class="form-label">Ports:</label>
      <div v-if="editableData.ports.length" class="mt-2 overflow-x-auto">
        <DataTable :value="editableData.ports" size="small" stripedRows>
          <Column header="Type" style="width: 80px">
            <template #body="slotProps">
              <Select
                v-model="slotProps.data.portType"
                :options="PORT_TYPE_OPTIONS"
                optionLabel="label"
                optionValue="value"
                class="w-full"
              />
            </template>
          </Column>

          <Column header="Label" style="width: 250px">
            <template #body="slotProps">
              <InputText v-model="slotProps.data.label" placeholder="Enter label" class="w-full" />
            </template>
          </Column>

          <Column header="Variable(s)" style="min-width: 180px">
            <template #body="slotProps">
              <Select
                v-model="slotProps.data.variables"
                :options="props.variables"
                optionLabel="name"
                optionValue="name"
                multiple
                placeholder="Select variables"
                class="w-full"
              />
            </template>
          </Column>

          <Column header="Multiport" style="width: 120px">
            <template #body="slotProps">
              <div class="flex flex-col gap-2">
                <!-- Per-variable (list-form) multi_port: shown, not editable here, so it is kept intact. -->
                <span
                  v-if="Array.isArray(slotProps.data.multiportType)"
                  class="per-variable-multiport"
                  title="Per-variable multiport, one entry per port variable"
                >{{ formatMultiportType(slotProps.data.multiportType) }}</span>
                <Select
                  v-else
                  v-model="slotProps.data.multiportType"
                  :options="MULTIPORT_OPTIONS"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Select"
                  class="w-full"
                />
                <div v-if="slotProps.data.multiportType === 'Multiply'" class="flex items-center gap-2">
                  <span class="multiply-prefix">&times;</span>
                  <InputNumber
                    v-model="slotProps.data.multiplyFactor"
                    :showButtons="false"
                    placeholder="1"
                    class="w-full"
                  />
                </div>
              </div>
            </template>
          </Column>

          <Column header="" style="width: 60px">
            <template #body="slotProps">
              <Button
                icon="pi pi-trash"
                severity="danger"
                rounded
                text
                size="small"
                @click="deletePort(editableData.ports.indexOf(slotProps.data))"
              />
            </template>
          </Column>
        </DataTable>
      </div>
      <div v-else class="mt-2 text-sm text-slate-500">No port labels added</div>

      <div class="mt-3">
        <Button icon="pi pi-plus" severity="success" rounded outlined @click="addPort" />
      </div>
    </form>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" severity="secondary" text @click="closeDialog" />
        <Button label="Confirm" severity="primary" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { formatMultiportType } from '../utils/config'
import { computed, reactive, watch } from 'vue'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import Divider from 'primevue/divider'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useGtm } from '../composables/useGtm'
import { notify } from '../utils/notify'
import { sanitiseName } from '../utils/nodes'
import { detachReactivity } from '../utils/reactivity'
import { PORT_TYPE_OPTIONS, MULTIPORT_OPTIONS } from '../utils/constants'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  id: {
    type: String,
    default: '',
  },
  initialName: {
    type: String,
    default: '',
  },
  variables: {
    type: Array,
    default: () => [],
  },
  initialPorts: {
    type: Array,
    default: () => [],
  },
  existingNames: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits([
  'update:modelValue', // Required for v-model
  'confirm', // Emits the new data
])

const editableData = reactive({
  name: '',
  ports: [], // Will hold objects like { variable: 'var_a', label: 'label_1' }
})

const { trackEvent } = useGtm()

function resetForm() {
  editableData.name = props.initialName
  editableData.ports = detachReactivity(props.initialPorts || [])
}

function closeDialog() {
  emit('update:modelValue', false)
}

function handleConfirm() {
  if (!editableData.name || !editableData.name.trim()) {
    notify.error({ message: 'Instance name cannot be empty.' })
    return
  }

  const sanitisedName = sanitiseName(editableData.name)
  if (!sanitisedName) {
    notify.error({ message: 'Instance name is invalid.' })
    return
  }
  editableData.name = sanitisedName

  const nameExists = props.existingNames.some((name) => name === editableData.name && name !== props.initialName)

  if (nameExists) {
    notify.error({ message: 'An instance with this name already exists.' })
    return
  }

  const finalPorts = editableData.ports.filter((p) => p.variables && p.label && p.label.trim())

  const invalidFactor = finalPorts.find((p) => p.multiportType === 'Multiply' && isEmpty(p.multiplyFactor))

  if (invalidFactor) {
    notify.error({
      message: `Port "${invalidFactor.label}" has Multiply selected but the scale factor is missing or zero.`,
    })
    return
  }

  trackEvent('edit_module_action', {
    category: 'EditModule',
    action: 'edit_module',
    label: editableData.name,
    file_type: 'JSON',
  })

  emit('confirm', {
    name: editableData.name,
    id: props.id,
    ports: finalPorts,
  })

  closeDialog()
}

watch(
  () => [props.initialName, , props.initialPorts, props.modelValue],
  () => {
    if (props.modelValue) {
      resetForm()
    }
  },
  { deep: true, immediate: true }
)

watch(
  () => editableData.ports.map((p) => p.variable),
  (newVariables) => {
    newVariables.forEach((varName, i) => {
      if (varName?.length > 1 && editableData.ports[i].multiportType === 'Sum') {
        editableData.ports[i].multiportType = 'None'
      }
    })
  },
  { deep: true }
)

watch(
  () => editableData.ports.map((p) => p.multiportType),
  (newMultiports) => {
    newMultiports.forEach((mp, i) => {
      if (mp !== 'Multiply') {
        editableData.ports[i].multiplyFactor = 1
      }
    })
  },
  { deep: true }
)

const usedVariables = computed(() => {
  return new Set(
    editableData.ports
      .map((p) => p.variable)
      .filter(Boolean)
      .flat()
  )
})

function isVariableDisabled(variableName, currentSelection) {
  // Disable if:
  // 1. It's in the usedVariables Set
  // 2. And it's NOT an variable this row already has selected

  // FIXME: Disabling for now as circ auto configs have multiple ports with same variable options, and this logic would prevent that. We can revisit if we want to enforce unique variable options across ports in the future.
  // return (usedVariables.value.has(optionName) && currentSelection.includes(optionName) === false)
  return false
}

function addPort() {
  editableData.ports.push({
    portType: 'general_ports',
    variable: '',
    label: '',
    multiportType: 'None',
    multiplyFactor: 1,
  })
}

function deletePort(index) {
  editableData.ports.splice(index, 1)
}
</script>

<style scoped>
.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-weight: 600;
  font-size: 16px;
  display: block;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.multiply-prefix {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.per-variable-multiport {
  font-size: 0.8em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
