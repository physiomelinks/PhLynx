<template>
  <div class="node-colour-panel">
    <!-- ── Theme choice ─────────────────────────────────────────────── -->
    <!-- Hidden while editing so the editor cannot drift from the theme on screen. -->
    <div v-if="!editingTheme" class="panel-block">
      <div class="block-header">
        <span class="block-title">Colour theme</span>
        <Button
          icon="pi pi-refresh"
          size="small"
          text
          rounded
          :loading="themeStore.remoteStatus === 'loading'"
          v-tooltip.left="'Refresh shared themes'"
          aria-label="Refresh shared themes"
          @click="themeStore.refreshRemote()"
        />
      </div>
      <Select
        :modelValue="themeStore.isActiveThemeAvailable ? themeStore.activeThemeId : null"
        :options="themeGroups"
        optionGroupLabel="label"
        optionGroupChildren="items"
        optionLabel="name"
        optionValue="id"
        :placeholder="themeStore.isActiveThemeAvailable ? 'Choose a theme' : 'Waiting for shared theme…'"
        size="small"
        class="w-full"
        @update:modelValue="onSelectTheme"
      />
      <p v-if="themeStore.activeTheme.description" class="hint">{{ themeStore.activeTheme.description }}</p>
      <p v-if="themeStore.remoteStatus === 'error'" class="hint hint--warn">
        <i class="pi pi-exclamation-triangle"></i>
        Shared themes could not be loaded ({{ themeStore.remoteError }}).
        {{ themeStore.remoteThemes.length ? 'Showing the last copy fetched.' : '' }}
      </p>
    </div>

    <!-- ── Assign a category to the selection ──────────────────────── -->
    <div v-if="!editingTheme" class="panel-block">
      <span class="block-title">
        Node colour
        <span class="context-count" v-if="selectedNodes.length">({{ selectedNodes.length }} selected)</span>
      </span>
      <p v-if="!selectedNodes.length" class="hint">Select one or more instances to colour them.</p>

      <div class="swatches" role="group" aria-label="Node categories">
        <button
          v-for="category in themeStore.activeTheme.categories"
          :key="category.key"
          type="button"
          class="swatch"
          :class="{ 'swatch--active': selectionKey === category.key }"
          :disabled="!selectedNodes.length"
          :style="swatchStyle(category)"
          @click="assignCategory(category.key)"
        >
          <span class="swatch-chip"></span>
          <span class="swatch-label">{{ category.label }}</span>
        </button>
        <button
          type="button"
          class="swatch swatch--none"
          :class="{ 'swatch--active': selectedNodes.length && selectionKey === null }"
          :disabled="!selectedNodes.length"
          @click="assignCategory(null)"
        >
          <span class="swatch-chip"></span>
          <span class="swatch-label">None</span>
        </button>
      </div>

      <p v-if="selectionKey === MIXED" class="hint">The selection has more than one category.</p>
      <p v-else-if="orphanKey" class="hint hint--warn">
        <i class="pi pi-info-circle"></i>
        Category “{{ orphanKey }}” is not in the {{ themeStore.activeTheme.name }} theme, so it shows uncoloured.
      </p>
    </div>

    <!-- ── Make and share themes ───────────────────────────────────── -->
    <div class="panel-block">
      <span class="block-title">My themes</span>

      <NodeThemeEditor
        v-if="editingTheme"
        :key="editingTheme.id"
        :theme="editingTheme"
        :errors="editorErrors"
        :is-new="isNewTheme"
        @change="editorErrors = []"
        @save="saveEdit"
        @cancel="stopEditing"
      />

      <template v-else>
        <div class="action-row">
          <Button
            label="New from this theme"
            icon="pi pi-copy"
            size="small"
            outlined
            @click="duplicateActive"
          />
          <Button
            icon="pi pi-upload"
            size="small"
            text
            rounded
            v-tooltip.top="'Import a theme file'"
            aria-label="Import a theme file"
            @click="fileInput?.click()"
          />
          <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onImportFile" />
        </div>

        <div v-if="isActiveLocal" class="action-row">
          <Button label="Edit" icon="pi pi-pencil" size="small" text @click="startEditing" />
          <Button
            icon="pi pi-download"
            size="small"
            text
            rounded
            v-tooltip.top="'Export as JSON'"
            aria-label="Export as JSON"
            @click="exportActive"
          />
          <Button
            icon="pi pi-trash"
            size="small"
            text
            rounded
            severity="danger"
            v-tooltip.top="'Delete this theme'"
            aria-label="Delete this theme"
            @click="deleteActive"
          />
        </div>

        <div v-if="isActiveLocal" class="submit-block">
          <Button
            label="Propose for everyone"
            icon="pi pi-github"
            size="small"
            severity="secondary"
            class="w-full"
            @click="submitActive"
          />
          <p class="hint">
            Opens a pre-filled GitHub issue on {{ THEME_REPO.owner }}/{{ THEME_REPO.repo }}. If accepted, the theme
            becomes available to all PhLynx users.
          </p>
        </div>
        <p v-else class="hint">Themes you make are kept in this browser. Start from any theme, then edit it.</p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import Button from 'primevue/button'
import Select from 'primevue/select'

import NodeThemeEditor from './NodeThemeEditor.vue'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useNodeDataHistory } from '../composables/useNodeDataHistory'
import { useNodeThemeStore } from '../stores/nodeThemeStore'
import { FLOW_IDS, GHOST_NODE_TYPE } from '../utils/constants'
import { notify } from '../utils/notify'
import { THEME_REPO, buildSubmissionUrl, findCategory, isLocalThemeId, toSubmission } from '../utils/nodeThemes'

const MIXED = Symbol('mixed')

const themeStore = useNodeThemeStore()
const { getSelectedNodes, updateNodeData } = useVueFlow(FLOW_IDS.MAIN)
const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)
const { confirm } = useConfirmDialog()

const selectedNodes = computed(() => getSelectedNodes.value.filter((node) => node.type !== GHOST_NODE_TYPE))

const themeGroups = computed(() =>
  [
    { label: 'Built-in', items: themeStore.builtInThemes },
    { label: 'Shared', items: themeStore.remoteThemes },
    { label: 'My themes', items: themeStore.localThemes },
  ].filter((group) => group.items.length)
)

/** The selection's common category key, null for none, or MIXED. */
const selectionKey = computed(() => {
  const keys = new Set(selectedNodes.value.map((node) => node.data?.domainType ?? null))
  if (keys.size === 0) return undefined
  return keys.size === 1 ? [...keys][0] : MIXED
})

const orphanKey = computed(() => {
  const key = selectionKey.value
  return typeof key === 'string' && !findCategory(themeStore.activeTheme, key) ? key : null
})

const isActiveLocal = computed(() => isLocalThemeId(themeStore.activeTheme.id))

function swatchStyle(category) {
  return {
    '--swatch-fill': category.color,
    '--swatch-fill-dark': category.dark ?? `color-mix(in srgb, ${category.color} 30%, var(--p-content-background))`,
  }
}

function onSelectTheme(id) {
  if (id) themeStore.setActiveTheme(id)
}

/**
 * Sets the category of every selected node as one undo step.
 *
 * @param {string|null} key
 */
function assignCategory(key) {
  const ids = selectedNodes.value.map((node) => node.id)
  if (!ids.length) return
  // Give nodes without the field an explicit null first, so undo can put "no category" back.
  selectedNodes.value.forEach((node) => {
    if (!('domainType' in (node.data ?? {}))) updateNodeData(node.id, { domainType: null })
  })
  recordEdit({
    type: 'set-node-category',
    nodeIds: ids,
    keys: ['domainType'],
    apply: () => ids.forEach((id) => updateNodeData(id, { domainType: key })),
  })
}

// ── Local themes ───────────────────────────────────────────────────────
const editingTheme = ref(null)
const isNewTheme = ref(false)
const editorErrors = ref([])
const fileInput = ref(null)

/** Opens the editor on an unsaved copy of the active theme; it is only kept on Save. */
function duplicateActive() {
  editorErrors.value = []
  isNewTheme.value = true
  editingTheme.value = themeStore.draftLocalTheme(themeStore.activeTheme.id)
}

function startEditing() {
  editorErrors.value = []
  isNewTheme.value = false
  editingTheme.value = themeStore.activeTheme
}

function stopEditing() {
  editingTheme.value = null
  isNewTheme.value = false
  editorErrors.value = []
}

function saveEdit(theme) {
  const errors = isNewTheme.value ? themeStore.addLocalTheme(theme) : themeStore.saveLocalTheme(theme)
  if (errors.length) {
    editorErrors.value = errors
    return
  }
  stopEditing()
}

async function deleteActive() {
  const theme = themeStore.activeTheme
  const ok = await confirm({
    header: 'Delete theme',
    message: `Delete “${theme.name}” from this browser? Nodes keep their categories.`,
    severity: 'warning',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
  })
  if (ok) themeStore.deleteLocalTheme(theme.id)
}

function exportActive() {
  const theme = toSubmission(themeStore.activeTheme)
  const blob = new Blob([JSON.stringify(theme, null, 2) + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${theme.id}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function onImportFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const { theme, errors } = themeStore.importTheme(await file.text())
  if (theme) notify.success({ title: 'Theme imported', message: theme.name })
  else notify.error({ title: 'Could not import theme', message: errors.join(' ') })
}

function submitActive() {
  window.open(buildSubmissionUrl(themeStore.activeTheme), '_blank', 'noopener')
}
</script>

<style scoped>
.node-colour-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  overflow-y: auto;
  min-height: 0;
}

.panel-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.block-title {
  font-size: 0.85rem;
  font-weight: 600;
}

.context-count {
  font-weight: normal;
  color: var(--p-text-muted-color);
}

.hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.hint--warn {
  color: var(--p-orange-600);
}

.swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 0.4rem;
}

.swatch {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  text-align: left;
}

.swatch:disabled {
  cursor: default;
  opacity: 0.6;
}

.swatch:not(:disabled):hover {
  border-color: var(--p-primary-color);
}

.swatch--active {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 1px var(--p-primary-color);
}

.swatch-chip {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
  background: var(--swatch-fill);
  border: 1px solid color-mix(in srgb, var(--p-text-color) 20%, transparent);
}

:global(.p-dark) .swatch-chip {
  background: var(--swatch-fill-dark);
}

.swatch--none .swatch-chip {
  background: repeating-linear-gradient(45deg, transparent 0 3px, color-mix(in srgb, var(--p-text-color) 25%, transparent) 3px 4px);
}

.swatch-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.submit-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
</style>
