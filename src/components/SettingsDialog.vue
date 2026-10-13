<template>
  <Dialog
    :visible="modelValue"
    modal
    :dismissableMask="true"
    header="Settings"
    :style="{ width: '45rem' }"
    :breakpoints="{ '1199px': '75vw', '575px': '90vw' }"
    :closable="true"
    @update:visible="(visible) => !visible && closeDialog()"
  >
    <section v-for="section in SETTING_SECTIONS" :key="section.title" class="settings-section">
      <h4>{{ section.title }}</h4>

      <div v-for="setting in section.settings" :key="setting.key" class="setting-row">
        <div class="setting-text">
          <label :id="`setting-${setting.key}-label`" :for="`setting-${setting.key}`">{{ setting.label }}</label>
          <p :id="`setting-${setting.key}-desc`" class="subtle">{{ setting.description }}</p>
        </div>

        <div v-if="setting.type === 'select'" class="setting-control">
          <Select
            v-model="draft[setting.key]"
            :labelId="`setting-${setting.key}`"
            :ariaLabelledby="`setting-${setting.key}-label`"
            :options="setting.options"
            optionLabel="label"
            optionValue="value"
            fluid
            :pt="{ label: { 'aria-describedby': `setting-${setting.key}-desc` } }"
          >
            <template #option="{ option }">
              <div class="setting-option">
                <span>{{ option.label }}</span>
                <small v-if="option.hint" class="subtle">{{ option.hint }}</small>
              </div>
            </template>
          </Select>
          <small v-if="selectedOption(setting)?.hint" class="subtle setting-hint">
            {{ selectedOption(setting).hint }}
          </small>
        </div>

        <div v-else-if="setting.type === 'toggle'" class="setting-control setting-control--toggle">
          <ToggleSwitch
            v-model="draft[setting.key]"
            :inputId="`setting-${setting.key}`"
            :ariaLabelledby="`setting-${setting.key}-label`"
            :pt="{ input: { 'aria-describedby': `setting-${setting.key}-desc` } }"
          />
        </div>
      </div>
    </section>

    <!-- DIALOG FOOTER -->
    <template #footer>
      <div class="flex justify-end gap-2 mt-4">
        <Button label="Cancel" text severity="secondary" @click="closeDialog" />
        <Button label="Save Changes" @click="saveChanges" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { reactive, watch } from 'vue'
import { Dialog, Button, Select, ToggleSwitch } from 'primevue'

import { useAppSettings } from '../composables/useAppSettings'
import { SETTING_SECTIONS } from '../utils/appSettings'

const props = defineProps({
  modelValue: Boolean,
})

const emit = defineEmits(['update:modelValue'])

const { settings, saveAppSettings } = useAppSettings()

// Edits wait for Save; each open starts from the saved settings.
const draft = reactive({ ...settings })
watch(
  () => props.modelValue,
  (open) => {
    if (open) Object.assign(draft, settings)
  }
)

/** The option a select setting's draft has chosen. */
const selectedOption = (setting) => setting.options?.find((option) => option.value === draft[setting.key])

const closeDialog = () => {
  emit('update:modelValue', false)
}

function saveChanges() {
  saveAppSettings(draft)
  closeDialog()
}
</script>

<style scoped>
.settings-section + .settings-section {
  margin-top: 20px;
}
.settings-section h4 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 700;
}

/* Setting name and description on the left, its control on the right. */
.setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(12rem, 18rem);
  gap: 8px 24px;
  align-items: start;
  padding: 12px 0;
  border-bottom: 1px solid var(--p-content-border-color, #ebeef5);
}
.setting-row:last-child {
  border-bottom: none;
}
.setting-text label {
  font-size: 13px;
  font-weight: 600;
}
.setting-text p {
  margin: 4px 0 0;
}
.setting-control {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.setting-control--toggle {
  align-items: flex-end;
  justify-content: center;
}
.setting-option {
  display: flex;
  flex-direction: column;
}
.setting-hint {
  padding-left: 2px;
}
.subtle {
  font-size: 12px;
  color: var(--p-text-muted-color, #909399);
}

@media (max-width: 575px) {
  .setting-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
