<template>
  <div class="mlc" :class="{ 'is-dragging': isDragging }">

    <!-- Sticky search -->
    <div class="mlc__search">
      <IconField class="w-full">
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="filterText"
          placeholder="Search Library…"
          size="small"
          class="w-full"
        />
        <InputIcon v-if="filterText" class="mlc__clear pi pi-times-circle" @click="filterText=''"/>
      </IconField>
    </div>

    <!-- Collections -->
    <div ref="scrollEl" class="mlc__scroll">
      <!-- The workspace's super-modules: drag one to place another super instance of it, or edit it on its own. -->
      <div v-if="showsEmptySupermodule || filteredSupermodules.length + filteredLibrarySupermodules.length > 0" class="mlc__group mlc__group--supermodules">
        <button
          class="mlc__group-header"
          :class="{ 'is-open': activeCollapseNames.includes(SUPERMODULE_GROUP) }"
          @click="toggleGroup(SUPERMODULE_GROUP)"
        >
          <i class="pi pi-chevron-right mlc__group-chevron" />
          <span class="mlc__group-name"><span class="mlc__group-name-text">Super-modules</span></span>
          <Tag
            severity="secondary"
            rounded
            class="mlc__group-count"
            :value="filteredSupermodules.length + filteredLibrarySupermodules.length"
          />
        </button>

        <transition name="slide">
          <div v-show="activeCollapseNames.includes(SUPERMODULE_GROUP)" class="mlc__group-body">
            <!-- Dropped, a new, empty super-module and one super instance of it, named free. -->
            <div
              v-if="showsEmptySupermodule"
              class="mlc__card mlc__card--supermodule mlc__card--draggable mlc__card--empty-supermodule"
              data-empty-supermodule
              draggable="true"
              @dragstart="handleEmptySupermoduleDragStart"
              @dragend="handleDragEnd"
            >
              <div class="mlc__card-inner">
                <div class="mlc__card-body">
                  <div class="mlc__card-header">
                    <i class="pi pi-plus mlc__supermodule-icon" aria-hidden="true" />
                    <span class="mlc__card-name">Empty super-module</span>
                  </div>
                  <div class="mlc__supermodule-label">Drag onto the canvas for a new super instance</div>
                </div>
              </div>
            </div>
            <div
              v-for="entry in filteredSupermodules"
              :key="entry.id"
              class="mlc__card mlc__card--supermodule"
              :class="{
                'mlc__card--draggable': canPlaceHere(entry.id),
                'mlc__card--blocked': !canPlaceHere(entry.id),
              }"
              :data-supermodule="entry.id"
              :draggable="canPlaceHere(entry.id)"
              v-tooltip.right="
                canPlaceHere(entry.id)
                  ? undefined
                  : { value: 'Can’t be placed here: the super-module shown would then contain itself.', showDelay: 300 }
              "
              @dragstart="handleSupermoduleDragStart($event, entry)"
              @dragend="handleDragEnd"
            >
              <div class="mlc__card-inner">
                <div class="mlc__card-body">
                  <div class="mlc__card-header">
                    <i class="pi pi-sitemap mlc__supermodule-icon" aria-hidden="true" />
                    <span class="mlc__card-name" :title="entry.label">{{ entry.name }}</span>
                    <div class="mlc__card-actions">
                      <Tag
                        severity="info"
                        rounded
                        class="mlc__badge"
                        :value="`${entry.count} super instance${entry.count !== 1 ? 's' : ''}`"
                      />
                      <Button
                        icon="pi pi-pencil"
                        severity="secondary"
                        text
                        rounded
                        size="small"
                        class="mlc__preview-btn"
                        :aria-label="`Edit super-module ${entry.name}`"
                        v-tooltip.top="'Edit super-module'"
                        @click.stop="canvasLevel.editSupermodule(entry.id)"
                      />
                      <Button
                        icon="pi pi-tag"
                        severity="secondary"
                        text
                        rounded
                        size="small"
                        class="mlc__preview-btn"
                        :aria-label="`Rename super-module ${entry.name}`"
                        v-tooltip.top="'Rename super-module'"
                        @click.stop="openRename(entry)"
                      />
                      <Button
                        icon="pi pi-trash"
                        severity="secondary"
                        text
                        rounded
                        size="small"
                        class="mlc__preview-btn"
                        :aria-label="`Delete super-module ${entry.name}`"
                        :disabled="entry.count > 0"
                        v-tooltip.top="entry.count > 0 ? 'Used by a super instance, so it can’t be deleted' : 'Delete super-module'"
                        @click.stop="deleteSupermodule(entry.id)"
                      />
                    </div>
                  </div>
                  <div v-if="entry.label !== entry.name" class="mlc__supermodule-label">{{ entry.label }}</div>
                  <!-- What edits this session did to the library entry. -->
                  <div v-if="isModified(entry.id) || templateOf(entry.id)?.matches === false" class="mlc__supermodule-status">
                    <Tag v-if="isModified(entry.id)" severity="warn" rounded class="mlc__badge mlc__modified" value="modified" />
                    <span v-if="templateOf(entry.id)?.matches === false" class="mlc__template-drift">
                      no longer matches template {{ templateOf(entry.id).label }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <!-- The library's circulatory_autogen super-modules: dropping one makes it a workspace super-module, or
                 reuses the one made from it. -->
            <div
              v-for="entry in filteredLibrarySupermodules"
              :key="`library:${entry.moduleRef}`"
              class="mlc__card mlc__card--supermodule mlc__card--draggable"
              :data-library-supermodule="entry.moduleRef"
              draggable="true"
              @dragstart="handleLibrarySupermoduleDragStart($event, entry)"
              @dragend="handleDragEnd"
            >
              <div class="mlc__card-inner">
                <div class="mlc__card-body">
                  <div class="mlc__card-header">
                    <i class="pi pi-sitemap mlc__supermodule-icon" aria-hidden="true" />
                    <span class="mlc__card-name" :title="entry.description">{{ entry.name }}</span>
                    <div class="mlc__card-actions">
                      <Tag severity="secondary" rounded class="mlc__badge" value="library" />
                    </div>
                  </div>
                  <div class="mlc__supermodule-label">{{ entry.moduleRef }}</div>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>

      <template v-if="filteredCollections.length > 0">
        <div
          v-for="collection in filteredCollections"
          :key="collection.componentFile"
          class="mlc__group"
        >
          <!-- Group header -->
          <button
            class="mlc__group-header"
            :class="{ 'is-open': activeCollapseNames.includes(collection.componentFile) }"
            @click="toggleGroup(collection.componentFile)"
          >
            <i class="pi pi-chevron-right mlc__group-chevron" />
            <span class="mlc__group-name"><span class="mlc__group-name-text">{{ collection.label }}</span></span>
            <Tag 
              severity="secondary" 
              rounded 
              class="mlc__group-count"
              :value="collection.cards.length"
            />
          </button>

          <!-- Module cards -->
          <transition name="slide">
            <!-- v-if, not v-show: a large library mounted every card of every collapsed group. -->
            <div v-if="activeCollapseNames.includes(collection.componentFile)" class="mlc__group-body">
              <div
                v-for="card in collection.cards"
                :key="card.cardKey"
                class="mlc__card"
                :class="{
                  'mlc__card--selectable': selectable,
                  'mlc__card--stub': activeModule(card).isStub,
                  'mlc__card--draggable': !selectable && !activeModule(card).isStub,
                }"
                :draggable="!selectable && !activeModule(card).isStub"
                @dragstart="handleDragStart($event, activeModule(card))"
                @dragend="handleDragEnd"
                @click="selectable && !activeModule(card).isStub && handleSelect(activeModule(card))"
              >
                <div class="mlc__card-inner">
                  <div class="mlc__card-body">
                    <!-- Name + actions row -->
                    <div class="mlc__card-header">
                      <Button
                        v-if="![GHOST_MODULE_REF, NEW_MODULE_REF].includes(activeModule(card).moduleRef)"
                        icon="pi pi-times scale-60"
                        severity="secondary"
                        text
                        rounded
                        class="mlc__preview-btn mlc__remove-btn"
                        v-tooltip.top="'Remove module'"
                        @click.stop="deleteModule(activeModule(card))"
                      />
                      <span class="mlc__card-name">{{ card.label }}</span>
                      <div class="mlc__card-actions">
                        <Tag
                          severity="info"
                          rounded
                          class="mlc__badge"
                          :value="`${card.modules?.length} module${card.modules?.length !== 1 ? 's' : ''}`"
                        />
                        
                        <Button
                          v-if="activeModule(card).moduleRef"
                          icon="pi pi-eye"
                          severity="secondary"
                          text
                          rounded
                          size="small"
                          class="mlc__preview-btn"
                          v-tooltip.top="'Preview configuration'"
                          @click.stop="openPreview(activeModule(card))"
                        />
                      </div>
                    </div>

                    <!-- Subtype selector - switches which module this card currently represents -->
                    <div
                      class="mlc__config-row"
                      @click.stop
                    >
                      <Select
                        :modelValue="selectedModuleIndex[card.cardKey] ?? 0"
                        @update:modelValue="(val) => selectedModuleIndex[card.cardKey] = val"
                        :options="card.modules.map((m, idx) => ({ label: m.moduleRef, value: idx }))"
                        optionLabel="label"
                        optionValue="value"
                        size="small"
                        class="mlc__config-select"
                      />
                    </div>

                    <!-- Config selector - configs belonging to whichever module is currently active -->
                    <div
                      v-if="!selectable && activeModule(card).configs && activeModule(card).configs.length > 1"
                      class="mlc__config-row"
                      @click.stop
                    >
                      <Select
                        v-model="selectedConfigs[activeModule(card).moduleRef]"
                        :options="activeModule(card).configs.map((config, index) => ({
                          label: configLabel(config) || `Config ${index + 1}`,
                          value: index
                        }))"
                        optionLabel="label"
                        optionValue="value"
                        size="small"
                        class="mlc__config-select"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </template>

      <!-- Empty state -->
      <div v-if="filteredCollections.length === 0 && filteredSupermodules.length === 0" class="mlc__empty">
        <i class="pi pi-inbox mlc__empty-icon" />
        <p class="mlc__empty-text">
          {{ filterText ? `No modules match '${filterText}'` : 'No modules found' }}
        </p>
      </div>
    </div>

    <ModulePreviewDialog v-model="showPreview" :module-data="previewTarget" />
    <NewSupermoduleDialog
      v-model="renameTarget.visible"
      mode="rename"
      :sm-id="renameTarget.smId"
      :initial-name="renameTarget.name"
      @confirm="onRenameConfirm"
    />
  </div>
</template>

<script setup>
import { computed, ref, reactive, onMounted, onUnmounted, watch } from 'vue'

// PrimeVue Imports
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Select from 'primevue/select'
import vTooltip from 'primevue/tooltip'

import { useLibraryProxyStore } from '../stores/libraryProxyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useFlowHistoryStore } from '../stores/historyStore.js'
import useDragAndDrop from '../composables/useDnD'
import { useActiveCanvas } from '../composables/useActiveCanvas'
import { useCanvasLevel } from '../composables/useCanvasLevel'
import { useSupermodules } from '../composables/useSupermodules'
import { useSupermoduleEditGuard } from '../composables/useSupermoduleEditGuard'
import ModulePreviewDialog from './ModulePreviewDialog.vue'
import NewSupermoduleDialog from './dialogs/NewSupermoduleDialog.vue'
import { notify } from '../utils/notify'
import { GHOST_MODULE_REF, NEW_MODULE_REF } from '../utils/constants.js'

const props = defineProps({
  selectable: { type: Boolean, default: false },
  // Whether the workspace's super-modules are listed, as only the workspace's own palette places them.
  showSupermodules: { type: Boolean, default: false },
})

// The super-module group's key among the open groups; no component file has it.
const SUPERMODULE_GROUP = '#supermodules'

const emit = defineEmits(['select'])

const view = useLibraryProxyStore()
const store = useLibraryStore()
// The library is app-wide, so its edits stay on the workspace stack even inside the macro builder.
const history = useFlowHistoryStore()

const { onDragStart } = useDragAndDrop()

const filterText = ref('')
const activeCollapseNames = ref([SUPERMODULE_GROUP])
const selectedModuleIndex = reactive({})
const selectedConfigs = reactive({})
const showPreview = ref(false)
const previewTarget = ref(null)
const isDragging = ref(false)
const scrollEl = ref(null)

function blockScroll(e) {
  if (isDragging.value) e.preventDefault()
}

onMounted(() => {
  scrollEl.value?.addEventListener('wheel', blockScroll, { passive: false })
})

onUnmounted(() => {
  scrollEl.value?.removeEventListener('wheel', blockScroll)
})

// ─── Filtering ────────────────────────────────────────────────────────────────

// Filters a moment after typing stops, so a large library isn't re-filtered and re-rendered on every keystroke.
const FILTER_DEBOUNCE_MS = 150
const appliedFilterText = ref('')
let filterTimeout = null

watch(filterText, (text) => {
  clearTimeout(filterTimeout)
  if (!text) {
    appliedFilterText.value = ''
    return
  }
  filterTimeout = setTimeout(() => {
    appliedFilterText.value = text
  }, FILTER_DEBOUNCE_MS)
})

onUnmounted(() => clearTimeout(filterTimeout))

const filteredCollections = computed(() => {
  const q = appliedFilterText.value.toLowerCase().trim()
  if (!q) return view.groups

  return view.groups
    .map((group) => ({
      ...group,
      cards: group.cards.filter((card) => group.label.toLowerCase().includes(q) || cardMatches(card, q)),
    }))
    .filter((group) => group.cards.length > 0)
})

function cardMatches(card, q) {
  if (card.label.toLowerCase().includes(q)) return true
  return card.modules.some(
    (module) =>
      (module.moduleSubtype ?? '').toLowerCase().includes(q) || module.moduleRef.toLowerCase().includes(q)
  )
}

// The super-modules listed, matching the filter, and whether each can be placed on the canvas shown.
const { supermodules, librarySupermodules, canPlace, deleteSupermodule, renameSupermodule, templateOf } = useSupermodules()
const { isModified } = useSupermoduleEditGuard()
const { scope: canvasScope } = useActiveCanvas()
const canvasLevel = useCanvasLevel()

const filteredSupermodules = computed(() => {
  if (!props.showSupermodules || props.selectable) return []
  const q = filterText.value.toLowerCase().trim()
  if (!q) return supermodules.value
  return supermodules.value.filter((entry) => `${entry.name} ${entry.label}`.toLowerCase().includes(q))
})

const filteredLibrarySupermodules = computed(() => {
  if (!props.showSupermodules || props.selectable) return []
  const q = filterText.value.toLowerCase().trim()
  if (!q) return librarySupermodules.value
  return librarySupermodules.value.filter((entry) => `${entry.name} ${entry.moduleRef}`.toLowerCase().includes(q))
})

// The Empty super-module entry, listed where super-modules are, when the filter matches it.
const showsEmptySupermodule = computed(() => {
  if (!props.showSupermodules || props.selectable) return false
  const q = filterText.value.toLowerCase().trim()
  return !q || 'empty super-module'.includes(q)
})

// The super-module the rename dialog renames.
const renameTarget = reactive({ visible: false, smId: null, name: '' })

/** Asks for a super-module's new name. */
function openRename(entry) {
  Object.assign(renameTarget, { visible: true, smId: entry.id, name: entry.name })
}

/** @param {string} name - Checked by the dialog. */
async function onRenameConfirm(name) {
  try {
    await renameSupermodule(renameTarget.smId, name, { history })
  } catch (error) {
    notify.error({ title: 'Not Renamed', items: [error.message] })
  }
}

/** @returns {boolean} Whether a super instance of a super-module can go on the canvas shown, without a cycle. */
const canPlaceHere = (smId) => canPlace(canvasScope.value, smId)

// ─── Accordion ───────────────────────────────────────────────────────────────

function toggleGroup(componentFile) {
  const idx = activeCollapseNames.value.indexOf(componentFile)
  if (idx === -1) activeCollapseNames.value.push(componentFile)
  else activeCollapseNames.value.splice(idx, 1)
}

// ─── Config helpers ───────────────────────────────────────────────────────────

function configLabel(config) {
  if (!config) return ''
  return [config.module_type, config.module_subtype].filter(Boolean).join(' - ')
}

// ─── Module helpers ────────────────────────────────────────────────────────────

function activeModule(card) {
  const index = selectedModuleIndex[card.cardKey] ?? 0
  return card.modules[index] ?? card.modules[0]
}

function deleteModule(card) {
  const deletedModule = store.availableModules.get(card.moduleRef)
  if (!deletedModule) return

  history.executeAndAddCommand({
    type: 'remove-module',
    undo: async () => {
      store.addModule(deletedModule)
    },
    redo: async () => {
      store.removeModule(deletedModule.moduleRef)
    },
  })
}

// ─── Drag & Drop ──────────────────────────────────────────────────────────────

function handleDragStart(event, module) {
  if (props.selectable) return
  isDragging.value = true
  event.dataTransfer.effectAllowed = 'copy'
  const configIndex = selectedConfigs[module.moduleRef] ?? 0
  onDragStart(event, { ...module, configIndex })
}

/**
 * Starts dragging a super-module, to place another super instance of it; one that can't go here doesn't drag.
 *
 * @param {DragEvent} event
 * @param {{id: string}} entry
 */
function handleSupermoduleDragStart(event, entry) {
  if (!canPlaceHere(entry.id)) {
    event.preventDefault()
    return
  }
  isDragging.value = true
  event.dataTransfer.effectAllowed = 'copy'
  onDragStart(event, { smId: entry.id })
}

/**
 * Starts dragging a library super-module, which becomes a workspace super-module where it is dropped.
 *
 * @param {DragEvent} event
 * @param {{moduleRef: string}} entry
 */
function handleLibrarySupermoduleDragStart(event, entry) {
  isDragging.value = true
  event.dataTransfer.effectAllowed = 'copy'
  onDragStart(event, { caSupermodule: entry.moduleRef })
}

/** Starts dragging a new, empty super-module, made with one super instance where it is dropped. */
function handleEmptySupermoduleDragStart(event) {
  isDragging.value = true
  event.dataTransfer.effectAllowed = 'copy'
  onDragStart(event, { emptySupermodule: true })
}

function handleDragEnd() {
  isDragging.value = false
}

// ─── Preview ──────────────────────────────────────────────────────────────────

function openPreview(module) {
  previewTarget.value = {
    moduleRef: module.moduleRef,
    ports: module.ports,
    variables: module.variables,
  }
  showPreview.value = true
}

// ─── Selection ────────────────────────────────────────────────────────────────

function handleSelect(module) {
  if (props.selectable) emit('select', module)
}
</script>

<style scoped>
/* ── Dynamic Theme Tokens ────────────────────────────────────────────────────── */
.mlc {
  --mlc-bg:           var(--p-surface-100);
  --mlc-surface:      var(--p-content-background);
  --mlc-border:       var(--p-content-border-color);
  --mlc-border-hover: var(--p-primary-color);
  --mlc-accent:       var(--p-primary-color);
  --mlc-accent-light: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  --mlc-text-primary: var(--p-text-color);
  --mlc-text-regular: var(--p-text-muted-color);
  --mlc-text-muted:   var(--p-text-muted-color);
  --mlc-radius:       var(--p-content-border-radius, 6px);
  --mlc-transition:   140ms ease;
}

/* ── Layout ──────────────────────────────────────────────────────────────────── */
.mlc {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--mlc-bg);
  border-radius: var(--mlc-radius);
  overflow: hidden;
}

.mlc.is-dragging .mlc__scroll {
  pointer-events: none;
}
.mlc.is-dragging .mlc__card--draggable {
  pointer-events: auto;
}

/* ── Search bar ──────────────────────────────────────────────────────────────── */
.mlc__search {
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--mlc-border);
  flex-shrink: 0;
  background: var(--mlc-surface);
}

.mlc__clear:hover {
  color: var(--p-text-color);
}

/* ── Scroll container ────────────────────────────────────────────────────────── */
.mlc__scroll {
  flex: 1 1 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--mlc-border) transparent;
}
.mlc__scroll::-webkit-scrollbar { width: 4px; }
.mlc__scroll::-webkit-scrollbar-thumb {
  background: var(--mlc-border);
  border-radius: 2px;
}

/* ── Group ───────────────────────────────────────────────────────────────────── */
.mlc__group { margin-bottom: 2px; }

.mlc__group-header {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: calc(100% - 12px);
  margin: 0 6px;
  padding: 5px 8px;
  background: none;
  border: none;
  border-radius: var(--mlc-radius);
  cursor: pointer;
  color: var(--mlc-text-regular);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-align: left;
  transition: color var(--mlc-transition), background var(--mlc-transition);
}
.mlc__group-header:hover {
  color: var(--mlc-text-primary);
  background: var(--p-surface-200);
}
.mlc__group-header.is-open {
  color: var(--mlc-accent);
  background: var(--mlc-accent-light);
}

.mlc__group-chevron {
  flex-shrink: 0;
  font-size: 12px;
  margin-top: 2px;
  transition: transform var(--mlc-transition);
}
.mlc__group-header.is-open .mlc__group-chevron {
  transform: rotate(90deg);
}

.mlc__group-name {
  flex: 1;
  min-width: 0;
}

.mlc__group-name-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  overflow-wrap: normal;
  word-break: normal;
  line-height: 1.4;
}

.mlc__group-count {
  flex-shrink: 0;
  margin-top: 2px;
  align-self: flex-start;
  font-size: 0.7rem;
}

/* ── Slide transition ────────────────────────────────────────────────────────── */
.mlc__group-body {
  padding: 4px 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.slide-enter-active,
.slide-leave-active { transition: opacity 130ms ease, transform 130ms ease; }
.slide-enter-from,
.slide-leave-to     { opacity: 0; transform: translateY(-4px); }

/* ── Module card ─────────────────────────────────────────────────────────────── */
.mlc__card {
  border: 1px solid var(--mlc-border);
  border-radius: var(--mlc-radius);
  background: var(--mlc-surface);
  transition: border-color var(--mlc-transition), box-shadow var(--mlc-transition);
  user-select: none;
}

.mlc__card--draggable { cursor: grab; }
.mlc__card--draggable:active { cursor: grabbing; }
.mlc__card--selectable { cursor: pointer; }
/* A stub has no math, so it can't be dragged or selected, but it must still be removable. */
.mlc__card--stub { cursor: not-allowed; }
.mlc__card--stub .mlc__card-header > :not(.mlc__remove-btn),
.mlc__card--stub .mlc__config-row { opacity: 0.45; }

.mlc__card--draggable:hover,
.mlc__card--selectable:not(.mlc__card--stub):hover {
  border-color: var(--mlc-accent);
  box-shadow: 0 0 0 2px var(--mlc-accent-light), 0 2px 6px color-mix(in srgb, var(--p-text-color) 18%, transparent);
}

/* ── Card inner layout ───────────────────────────────────────────────────────── */
.mlc__card-inner {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.mlc__card-body {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
}

.mlc__card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.mlc__card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--mlc-text-primary);
}

.mlc__card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.mlc__badge {
  font-size: 0.7rem;
}

.mlc__preview-btn {
  width: 24px !important;
  height: 24px !important;
}

/* ── Super-module card ───────────────────────────────────────────────────────── */
/* One that would contain the super-module shown can't be dragged here. */
.mlc__card--blocked { cursor: not-allowed; }
.mlc__card--blocked .mlc__card-name,
.mlc__card--blocked .mlc__supermodule-icon,
.mlc__card--blocked .mlc__badge { opacity: 0.45; }

.mlc__supermodule-icon {
  font-size: 12px;
  color: var(--mlc-text-muted);
}

.mlc__supermodule-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.mlc__template-drift {
  font-size: 11.5px;
  color: var(--p-orange-500);
}

.mlc__supermodule-label {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--mlc-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Config row ──────────────────────────────────────────────────────────────── */
.mlc__config-row { margin-top: 6px; }

.mlc__config-select { width: 100%; }

/* ── Empty State ─────────────────────────────────────────────────────────────── */
.mlc__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--mlc-text-regular);
  text-align: center;
}

.mlc__empty-icon {
  font-size: 2.5rem;
  margin-bottom: 8px;
  color: var(--mlc-text-muted);
}

.mlc__empty-text {
  font-size: 0.875rem;
  margin: 0;
}
</style>
<style>
/* Unscoped on purpose: these need to react to the .p-dark class that lives
   on <html>, and Vue's scoped-style compiler can't reliably combine an
   ancestor selector living outside the component with a scoped descendant
   (:global(.p-dark) .mlc silently drops the .mlc part). .mlc / .mlc__group-header
   are specific enough to this component that going unscoped here is safe.

   --p-surface-* are raw palette values that don't swap with light/dark mode
   on their own (only semantic tokens like --p-content-background do), so
   these need an explicit override. */
.p-dark .mlc {
  --mlc-bg: var(--p-surface-950);
}

.p-dark .mlc__group-header:hover {
  background: var(--p-surface-800);
}
</style>