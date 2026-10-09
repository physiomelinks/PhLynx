<template>
  <div class="theme-editor">
    <div class="editor-header">
      <span class="editor-title">{{ isNew ? 'New theme' : 'Editing theme' }}</span>
      <Tag v-if="isNew || isDirty" value="Unsaved" severity="warn" />
    </div>
    <p class="editor-hint">Changes show on the canvas as you make them. Save keeps them; Cancel puts the theme back.</p>

    <div class="field">
      <label :for="`${uid}-name`">Theme name</label>
      <InputText :id="`${uid}-name`" v-model="draft.name" size="small" :maxlength="THEME_LIMITS.name" />
    </div>
    <div class="field">
      <label :for="`${uid}-author`">Author <span class="optional">(optional)</span></label>
      <InputText :id="`${uid}-author`" v-model="draft.author" size="small" :maxlength="THEME_LIMITS.author" />
    </div>
    <div class="field">
      <label :for="`${uid}-description`">Description <span class="optional">(optional)</span></label>
      <Textarea
        :id="`${uid}-description`"
        v-model="draft.description"
        rows="2"
        autoResize
        :maxlength="THEME_LIMITS.description"
      />
    </div>

    <div class="categories-header">
      <span class="field-label">Categories</span>
      <Button
        label="Add"
        icon="pi pi-plus"
        size="small"
        text
        :disabled="draft.categories.length >= THEME_LIMITS.categories"
        @click="addCategory"
      />
    </div>

    <div class="category-columns" aria-hidden="true">
      <span>Light</span>
      <span class="category-columns-label">Label</span>
      <span>Dark</span>
      <span class="category-columns-spacer"></span>
    </div>
    <ul class="category-rows">
      <li v-for="(category, index) in draft.categories" :key="category._rowId" class="category-row">
        <ThemeColourButton
          v-model="category.color"
          :title="`${category.label || 'Category'} colour`"
          :text-colour="TEXT_COLOURS.light"
          :theme-colours="themeColours"
        />
        <div class="category-text">
          <InputText
            v-model="category.label"
            size="small"
            placeholder="Label"
            :maxlength="THEME_LIMITS.label"
            @update:modelValue="syncKey(category)"
          />
          <span class="category-key" v-tooltip.top="category._isNew ? 'Key follows the label until saved' : 'Saved nodes refer to this key, so it cannot change'">
            {{ category.key || '—' }}
          </span>
        </div>
        <ThemeColourButton
          v-model="category.dark"
          :auto-colour="autoDarkColour(safeColour(category.color))"
          :title="`${category.label || 'Category'} dark mode colour`"
          :text-colour="TEXT_COLOURS.dark"
        />
        <Button
          icon="pi pi-trash"
          size="small"
          text
          rounded
          severity="danger"
          :disabled="draft.categories.length <= 1"
          v-tooltip.top="'Remove category'"
          :aria-label="`Remove ${category.label || 'category'}`"
          @click="draft.categories.splice(index, 1)"
        />
      </li>
    </ul>

    <Message v-if="warnings.length" severity="warn" size="small" class="editor-message">
      Text may be hard to read on:
      <span v-for="(warning, i) in warnings" :key="`${warning.key}-${warning.scheme}`">
        {{ labelFor(warning.key) }} ({{ warning.scheme }}, {{ warning.ratio.toFixed(1) }}:1){{ i < warnings.length - 1 ? ', ' : '' }}
      </span>
    </Message>
    <Message v-if="errors.length" severity="error" size="small" class="editor-message">
      <div v-for="error in errors" :key="error">{{ error }}</div>
    </Message>

    <div class="editor-actions">
      <Button label="Cancel" size="small" text @click="emit('cancel')" />
      <Button label="Save" icon="pi pi-check" size="small" :disabled="!isNew && !isDirty" @click="save" />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, useId, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'

import ThemeColourButton from './ThemeColourButton.vue'
import { useNodeThemeStore } from '../stores/nodeThemeStore'
import {
  TEXT_COLOURS,
  THEME_LIMITS,
  autoDarkColour,
  contrastWarnings,
  isValidColour,
  normaliseColour,
  slugify,
} from '../utils/nodeThemes'

const props = defineProps({
  theme: {
    type: Object,
    required: true,
  },
  /** Errors from the last save attempt, reported by the parent. */
  errors: {
    type: Array,
    default: () => [],
  },
  /** The theme has not been kept yet, so Save is always offered. */
  isNew: {
    type: Boolean,
    default: false,
  },
})

/** `change` fires on every edit so the parent can clear stale errors. */
const emit = defineEmits(['save', 'cancel', 'change'])

const themeStore = useNodeThemeStore()

const uid = useId()
let nextRowId = 0

const draft = reactive({
  ...JSON.parse(JSON.stringify(props.theme)), // props.theme is a reactive proxy, which structuredClone rejects
  author: props.theme.author ?? '',
  description: props.theme.description ?? '',
  categories: props.theme.categories.map((category) => ({ ...category, _rowId: nextRowId++, _isNew: false })),
})

const warnings = computed(() => contrastWarnings(draft))

/** The theme's colours as it was opened, offered as presets; fixed so they don't move while picking. */
const themeColours = props.theme.categories.map((category) => category.color)

/** The draft as a theme, without the editor's row bookkeeping. */
function toTheme() {
  const theme = {
    ...draft,
    categories: draft.categories.map(({ _rowId, _isNew, ...category }) => {
      if (category.dark === undefined) delete category.dark
      return category
    }),
  }
  if (!theme.author) delete theme.author
  if (!theme.description) delete theme.description
  return theme
}

const initialSnapshot = JSON.stringify(toTheme())
const isDirty = computed(() => JSON.stringify(toTheme()) !== initialSnapshot)

// Show the draft on the canvas while editing.
watch(
  draft,
  () => {
    themeStore.setPreviewTheme(toTheme())
    emit('change')
  },
  { deep: true }
)
themeStore.setPreviewTheme(toTheme())
onBeforeUnmount(() => themeStore.setPreviewTheme(null))

function safeColour(value) {
  return isValidColour(value) ? normaliseColour(value) : '#000000'
}

function labelFor(key) {
  return draft.categories.find((category) => category.key === key)?.label || key
}

function uniqueKey(stem, self) {
  const taken = new Set(draft.categories.filter((category) => category !== self).map((category) => category.key))
  let key = stem || 'category'
  for (let n = 2; taken.has(key); n++) key = `${stem || 'category'}-${n}`
  return key
}

/** New categories take their key from the label; saved ones keep theirs because nodes refer to it. */
function syncKey(category) {
  if (category._isNew) category.key = uniqueKey(slugify(category.label), category)
}

function addCategory() {
  const category = { key: '', label: 'New category', color: '#e5e7eb', _rowId: nextRowId++, _isNew: true }
  category.key = uniqueKey(slugify(category.label), category)
  draft.categories.push(category)
}

function save() {
  emit('save', toTheme())
}
</script>

<style scoped>
.theme-editor {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.editor-title {
  font-size: 0.85rem;
  font-weight: 600;
}

.editor-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.category-columns {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.category-columns > span {
  width: 28px;
  text-align: center;
}

.category-columns > .category-columns-label {
  flex: 1 1 auto;
  text-align: left;
}

.category-columns > .category-columns-spacer {
  width: 2rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
}

.field-label {
  font-size: 0.8rem;
  font-weight: 600;
}

.optional {
  color: var(--p-text-muted-color);
  font-weight: normal;
}

.categories-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.category-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.category-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.category-text {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}

.category-text :deep(input) {
  width: 100%;
}

.category-key {
  font-family: monospace;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
}

.editor-message {
  font-size: 0.75rem;
}

/* Keep Save/Cancel in view however long the category list gets. */
.editor-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin: 0 -0.75rem -0.75rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--p-content-border-color);
  border-radius: 0 0 8px 8px;
  background: var(--p-content-background);
}
</style>
