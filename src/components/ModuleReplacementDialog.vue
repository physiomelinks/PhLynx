<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    header="Replace Module"
    :dismissableMask="true"
    :style="{ width: '700px' }"
    @after-hide="resetForm"
  >
    <div class="container">
      <div class="module-list-wrapper">
        <LibraryArea selectable @select="onModuleSelected" />
      </div>

      <div class="sidebar">
        <div class="sidebar-title">
          Selected module
        </div>

        <div v-if="selectedModule" class="selected-module">
          <div class="selected-name">
            {{ selectedModule.name }}
          </div>

          <div class="selected-file">
            {{ selectedModule.moduleRef || '' }}
          </div>
        </div>

        <div v-else class="no-selection">
          Select a module from the list
        </div>

        <div class="retain-checkbox">
          <Checkbox v-model="retainMatches" binary inputId="retainMatches" />
          <label for="retainMatches">Retain matching ports?</label>
        </div>
      </div>
    </div>

    <template #footer>
      <span class="dialog-footer">
        <Button variant="outlined" @click="closeDialog">Cancel</Button>
        <Button :disabled="!selectedModule" @click="handleConfirm">
          Confirm
        </Button>
      </span>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Checkbox from 'primevue/checkbox'

import { useGtm } from '../composables/useGtm'
import LibraryArea from './LibraryArea.vue'
import { replacementData } from '../services/moduleReplacement'
import { useLibraryStore } from '../stores/libraryStore'
import { useDefaultParametersStore } from '../stores/defaultParametersStore'
import { seedRefFor, seedVariables } from '../utils/parameters/seed'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  currentInstance: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const selectedModule = ref(null)
const retainMatches = ref(false)
const { trackEvent } = useGtm()
const libraryStore = useLibraryStore()
const defaultParameters = useDefaultParametersStore()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

function resetForm() {
  selectedModule.value = null
  retainMatches.value = false
}

function closeDialog() {
  emit('update:modelValue', false)
}

function onModuleSelected(module) {
  selectedModule.value = module
}

function handleConfirm() {
  const module = selectedModule.value
  const data = replacementData(props.currentInstance.data?.ports ?? [], module, {
    retain: retainMatches.value,
    analysis: libraryStore.getMathAnalysis(module.mathRef) ?? null,
    defaults: libraryStore.getMathDefaults(module.mathRef) ?? new Map(),
  })
  // As a fresh drop: seeded from the new module's set, and no longer naming the old math's.
  const seedRef = seedRefFor(module, module.parameterisation)
  const set = seedRef ? defaultParameters.getSet(module.mathRef, seedRef) : null
  if (set) data.variables = seedVariables(data.variables, set)
  data.parameterisation = set?.ref

  trackEvent('module_replacement_action', {
    category: 'ModuleReplacement',
    action: 'confirm',
    label: `Module: ${selectedModule.value.moduleRef}`,
    file_type: 'json',
  })

  emit('confirm', data)

  closeDialog()
}
</script>

<style scoped>
.container {
  display: flex;
  gap: 12px;
  height: 460px;
  overflow: hidden;
}

.module-list-wrapper {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 6px;
}

.sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--p-content-hover-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  overflow: hidden;
}

.sidebar-title {
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}

.selected-module {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.selected-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-file {
  font-size: 12px;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-selection {
  font-size: 13px;
  color: var(--p-text-muted-color);
  font-style: italic;
}

.retain-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  font-size: 13px;
  color: var(--p-text-color);
}

.retain-checkbox label {
  cursor: pointer;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/*
 * The rules below give PrimeVue's Dialog/Button/Checkbox chrome squarer corners and the footer
 * buttons more breathing room; their colours are the theme's. :deep() is used because Dialog,
 * Button and Checkbox render their own internal markup that isn't part of this component's template.
 */
:deep(.p-dialog) {
  border-radius: 4px;
}

:deep(.p-dialog-header) {
  padding: 20px 24px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
}

:deep(.p-dialog-title) {
  font-size: 16px;
  font-weight: 600;
}

:deep(.p-dialog-content) {
  padding: 20px 24px;
}

:deep(.p-dialog-footer) {
  padding: 16px 24px 20px;
  border-top: 1px solid var(--p-content-border-color);
}

:deep(.p-button) {
  padding: 9px 20px;
  border-radius: 4px;
  font-size: 14px;
}

:deep(.p-checkbox .p-checkbox-box) {
  border-radius: 4px;
}
</style>
