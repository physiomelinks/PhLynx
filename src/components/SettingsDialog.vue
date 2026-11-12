<template>
  <Dialog
    :visible="modelValue"
    modal
    :dismissableMask="true"
    header="Settings"
    :style="{ width: '52rem' }"
    :breakpoints="{ '1199px': '75vw', '767px': '95vw' }"
    :closable="true"
    @update:visible="(visible) => !visible && closeDialog()"
  >
    <div class="settings-layout">
      <!-- SECTION RAIL -->
      <div
        class="settings-rail"
        role="tablist"
        aria-label="Settings sections"
        aria-orientation="vertical"
        @keydown="onRailKeydown"
      >
        <button
          v-for="(section, index) in SETTING_SECTIONS"
          :key="section.title"
          :id="`settings-tab-${index}`"
          ref="tabRefs"
          type="button"
          role="tab"
          class="settings-tab"
          :class="{ 'settings-tab--active': index === activeIndex }"
          :aria-selected="index === activeIndex"
          aria-controls="settings-panel"
          :tabindex="index === activeIndex ? 0 : -1"
          @click="activeIndex = index"
        >
          <span>{{ section.title }}</span>
          <!-- Its room is kept, so a section does not change width as it gains the dot. -->
          <span class="settings-tab-dot" :class="{ 'changed-dot': isSectionChanged(section) }" aria-hidden="true"></span>
          <span v-if="isSectionChanged(section)" class="visually-hidden">(changed)</span>
        </button>
      </div>

      <!-- THE SECTION CHOSEN -->
      <section
        id="settings-panel"
        class="settings-panel"
        role="tabpanel"
        :aria-labelledby="`settings-tab-${activeIndex}`"
      >
        <header class="settings-panel-head">
          <h4>{{ activeSection.title }}</h4>
          <Button
            label="Restore defaults"
            size="small"
            text
            severity="secondary"
            :disabled="isAtDefaults(activeSection)"
            @click="restoreDefaults(activeSection)"
          />
        </header>
        <p v-if="activeSection.intro" class="subtle settings-intro">{{ activeSection.intro }}</p>

        <!-- A compact list of checkboxes, read down each column -->
        <ul
          v-if="activeSection.layout === 'checklist'"
          class="setting-checklist"
          :style="{ '--checklist-rows': Math.ceil(activeSection.settings.length / 2) }"
        >
          <li v-for="setting in activeSection.settings" :key="setting.key" class="setting-check">
            <Checkbox
              binary
              :modelValue="settings[setting.key]"
              :inputId="`setting-${setting.key}`"
              :pt="{ input: { 'aria-describedby': `setting-${setting.key}-desc` } }"
              @update:modelValue="(value) => applySetting(setting.key, value)"
            />
            <label
              :for="`setting-${setting.key}`"
              class="setting-check-label"
              v-tooltip.bottom="setting.description"
            >
              <span class="setting-check-icon" aria-hidden="true">
                <component :is="SETTING_ICONS[setting.key]" v-if="typeof SETTING_ICONS[setting.key] === 'object'" />
                <i v-else-if="SETTING_ICONS[setting.key]" :class="SETTING_ICONS[setting.key]"></i>
              </span>
              {{ setting.label }}
            </label>
            <span :id="`setting-${setting.key}-desc`" class="visually-hidden">{{ setting.description }}</span>
            <template v-if="changedKeys.has(setting.key)">
              <span class="changed-dot" aria-hidden="true" :title="CHANGED_TITLE"></span>
              <span class="visually-hidden">(changed)</span>
            </template>
          </li>
        </ul>

        <!-- Setting name and description beside its control -->
        <template v-else>
          <div v-for="setting in activeSection.settings" :key="setting.key" class="setting-row">
            <div class="setting-text">
              <label :id="`setting-${setting.key}-label`" :for="`setting-${setting.key}`">{{ setting.label }}</label>
              <template v-if="changedKeys.has(setting.key)">
                <span class="changed-dot" aria-hidden="true" :title="CHANGED_TITLE"></span>
                <span class="visually-hidden">(changed)</span>
              </template>
              <p :id="`setting-${setting.key}-desc`" class="subtle">{{ setting.description }}</p>
            </div>

            <div v-if="setting.type === 'select'" class="setting-control">
              <Select
                :modelValue="settings[setting.key]"
                :labelId="`setting-${setting.key}`"
                :ariaLabelledby="`setting-${setting.key}-label`"
                :options="setting.options"
                optionLabel="label"
                optionValue="value"
                fluid
                :pt="{ label: { 'aria-describedby': `setting-${setting.key}-desc` } }"
                @update:modelValue="(value) => applySetting(setting.key, value)"
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
                :modelValue="settings[setting.key]"
                :inputId="`setting-${setting.key}`"
                :ariaLabelledby="`setting-${setting.key}-label`"
                :pt="{ input: { 'aria-describedby': `setting-${setting.key}-desc` } }"
                @update:modelValue="(value) => applySetting(setting.key, value)"
              />
            </div>
          </div>
        </template>
      </section>
    </div>

    <!-- DIALOG FOOTER -->
    <template #footer>
      <div class="settings-footer">
        <span class="subtle settings-footer-note">Changes apply as you make them.</span>
        <Button
          label="Revert changes"
          text
          severity="secondary"
          :disabled="changedKeys.size === 0"
          v-hint.top="'Put every setting back as it was when Settings opened'"
          @click="revertChanges"
        />
        <Button label="Done" @click="closeDialog" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Dialog, Button, Checkbox, Select, ToggleSwitch } from 'primevue'
import { vHint as hint, vTooltip as tooltip } from '../directives/tooltip'

import { useAppSettings } from '../composables/useAppSettings'
import { SETTING_SECTIONS } from '../utils/appSettings'
import AddHandleLeft from './icons/AddHandles/AddHandleLeft.vue'
import DustpanBrush from './icons/DustpanBrush.vue'
import ExportIcon from './icons/ExportIcon.vue'
import ImportIcon from './icons/ImportIcon.vue'
import SimulationSettingsIcon from './icons/SimulationSettingsIcon.vue'

// Registered here as well as app-wide, so the dialog brings its own.
const vTooltip = tooltip
const vHint = hint

/** The icon of the toolbar button each checklist setting shows: a PrimeIcons class or an icon component. */
const SETTING_ICONS = {
  toolbarLoad: 'pi pi-folder-open',
  toolbarSave: 'pi pi-save',
  toolbarCleanUp: DustpanBrush,
  toolbarClear: 'pi pi-eraser',
  toolbarUndoRedo: 'pi pi-undo',
  toolbarAddHandles: AddHandleLeft,
  toolbarMacroBuilder: 'pi pi-hammer',
  toolbarSimulationSettings: SimulationSettingsIcon,
  toolbarImport: ImportIcon,
  toolbarExport: ExportIcon,
  toolbarSendTo: 'pi pi-send',
}

const CHANGED_TITLE = 'Changed since Settings opened'

/** The settings the dialog lists, which Revert changes puts back. */
const LISTED_KEYS = SETTING_SECTIONS.flatMap((section) => section.settings.map((setting) => setting.key))

const props = defineProps({
  modelValue: Boolean,
})

const emit = defineEmits(['update:modelValue'])

const { settings, saveAppSettings } = useAppSettings()

/** The section shown, kept from one opening to the next. */
const activeIndex = ref(0)
const activeSection = computed(() => SETTING_SECTIONS[activeIndex.value])
const tabRefs = ref([])
// Where the sections run along the top, the one chosen may be off to one side.
watch(activeIndex, async (index) => {
  await nextTick()
  tabRefs.value[index]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
})

// A change applies at once; the settings as they were on opening are kept for Revert changes.
const settingsOnOpen = ref({})
watch(
  () => props.modelValue,
  (open) => {
    if (open) settingsOnOpen.value = Object.fromEntries(LISTED_KEYS.map((key) => [key, settings[key]]))
  },
  { immediate: true }
)

/** The settings that differ from how they were when the dialog opened. */
const changedKeys = computed(
  () => new Set(LISTED_KEYS.filter((key) => settings[key] !== settingsOnOpen.value[key]))
)
const isSectionChanged = (section) => section.settings.some((setting) => changedKeys.value.has(setting.key))
const isAtDefaults = (section) => section.settings.every((setting) => settings[setting.key] === setting.default)

/** The option a select setting has chosen. */
const selectedOption = (setting) => setting.options?.find((option) => option.value === settings[setting.key])

const applySetting = (key, value) => saveAppSettings({ [key]: value })

function restoreDefaults(section) {
  saveAppSettings(Object.fromEntries(section.settings.map((setting) => [setting.key, setting.default])))
}

function revertChanges() {
  saveAppSettings(settingsOnOpen.value)
}

/** Arrow keys, Home and End move between the sections, as in a tab list. */
function onRailKeydown(event) {
  const last = SETTING_SECTIONS.length - 1
  const moves = {
    ArrowDown: Math.min(activeIndex.value + 1, last),
    ArrowRight: Math.min(activeIndex.value + 1, last),
    ArrowUp: Math.max(activeIndex.value - 1, 0),
    ArrowLeft: Math.max(activeIndex.value - 1, 0),
    Home: 0,
    End: last,
  }
  if (!Object.hasOwn(moves, event.key)) return
  event.preventDefault()
  activeIndex.value = moves[event.key]
  tabRefs.value[activeIndex.value]?.focus()
}

const closeDialog = () => {
  emit('update:modelValue', false)
}
</script>

<style scoped>
/* One height for every section, so the dialog does not jump as the section changes. */
.settings-layout {
  display: grid;
  grid-template-columns: 11rem minmax(0, 1fr);
  gap: 24px;
  height: min(22rem, 62vh);
}

.settings-rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 12px;
  border-right: 1px solid var(--p-content-border-color);
  overflow-y: auto;
}
.settings-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--p-content-border-radius, 6px);
  background: none;
  color: var(--p-text-color);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.settings-tab-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
}
.settings-tab:hover {
  background: var(--p-content-hover-background);
}
.settings-tab:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}
.settings-tab--active,
.settings-tab--active:hover {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
  font-weight: 600;
}

.settings-panel {
  min-width: 0;
  padding-right: 4px;
  overflow-y: auto;
}
.settings-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 2rem;
}
.settings-panel-head h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.settings-intro {
  margin: 4px 0 0;
}

/* Marks a setting, or a section holding one, changed since the dialog opened. */
.changed-dot {
  display: inline-block;
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--p-primary-color);
}

/* Setting name and description on the left, its control on the right. */
.setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(11rem, 16rem);
  gap: 8px 24px;
  align-items: start;
  padding: 12px 0;
  border-bottom: 1px solid var(--p-content-border-color);
}
.setting-row:last-child {
  border-bottom: none;
}
.setting-text label {
  font-size: 13px;
  font-weight: 600;
}
.setting-text .changed-dot {
  margin-left: 6px;
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

.setting-checklist {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(var(--checklist-rows), auto);
  grid-auto-flow: column;
  gap: 2px 24px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.setting-check {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
}
.setting-check-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.setting-check-icon {
  display: inline-flex;
  justify-content: center;
  width: 1.25rem;
  color: var(--p-text-muted-color);
}

.settings-footer {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.settings-footer-note {
  margin-right: auto;
}

.subtle {
  font-size: 12px;
  color: var(--p-text-muted-color);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Narrow: the sections run along the top, and each control sits under its setting. */
@media (max-width: 767px) {
  .settings-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
    height: 70vh;
  }
  .settings-rail {
    flex-direction: row;
    padding: 0 0 8px;
    border-right: none;
    border-bottom: 1px solid var(--p-content-border-color);
    overflow: auto hidden;
  }
  .settings-tab {
    flex-shrink: 0;
  }
  .setting-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .setting-checklist {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: none;
    grid-auto-flow: row;
  }
}
</style>
