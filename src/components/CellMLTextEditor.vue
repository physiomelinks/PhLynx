<template>
  <div class="container" :class="{ 'is-resizing': draggingPreview }" ref="rootRef">
    <div class="panel">
      <!-- Equation preview (or parse errors) -->
      <section
        ref="previewSectionRef"
        class="preview-section"
        :class="{ 'preview-section--collapsed': previewCollapsed }"
        :style="previewStyle"
      >
        <!-- Collapsed preview -->
        <button
          v-if="previewCollapsed"
          type="button"
          class="preview-collapsed-bar"
          :class="{ 'preview-collapsed-bar--error': shownErrors.length > 0 }"
          title="Expand equation preview"
          @click="togglePreview"
        >
          <span class="preview-toggle-icon"><i class="pi pi-angle-down"></i></span>
          <span v-if="shownErrors.length" class="preview-collapsed-text">
            <strong v-if="shownErrors[0].line">Line {{ shownErrors[0].line }}:</strong> {{ shownErrors[0].message }}
            <template v-if="shownErrors.length > 1"> (+{{ shownErrors.length - 1 }} more)</template>
          </span>
          <span v-else class="preview-collapsed-text">Equation preview</span>
        </button>

        <template v-else>
          <button
            type="button"
            class="preview-toggle"
            title="Collapse equation preview"
            aria-label="Collapse equation preview"
            @click="togglePreview"
          >
            <span class="preview-toggle-icon"><i class="pi pi-angle-up"></i></span>
          </button>
          <div v-if="shownErrors.length > 0" class="error-banner">
            <div v-for="(err, index) in shownErrors" :key="index">
              <strong v-if="err.line">Line {{ err.line }}:</strong> {{ err.message }}
            </div>
          </div>
          <div v-else class="preview-pane" ref="latexContainer"></div>
        </template>
      </section>

      <div
        v-if="!previewCollapsed"
        class="preview-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize equation preview"
        :aria-valuenow="previewHeight"
        :aria-valuemin="MIN_PREVIEW_HEIGHT"
        tabindex="0"
        @pointerdown="startPreviewResize"
        @dblclick="resetPreviewHeight"
        @keydown.up.prevent="nudgePreview(-16)"
        @keydown.down.prevent="nudgePreview(16)"
      >
        <div class="preview-resizer-grip"></div>
      </div>

      <div class="editor-section">
        <div class="panel-header">
          <label class="mode-switch">
            <ToggleSwitch v-model="isSimple" />
            <span>Simple Mode</span>
          </label>
          <div class="font-size-control" role="group" aria-label="Editor font size">
            <button
              type="button"
              class="font-size-btn"
              :disabled="fontSize <= MIN_FONT_SIZE"
              title="Decrease font size"
              aria-label="Decrease font size"
              @click="decreaseFontSize"
            >
              <i class="pi pi-minus" style="font-size: 0.7rem"></i>
            </button>
            <span class="font-size-value">{{ fontSize }}px</span>
            <button
              type="button"
              class="font-size-btn"
              :disabled="fontSize >= MAX_FONT_SIZE"
              title="Increase font size"
              aria-label="Increase font size"
              @click="increaseFontSize"
            >
              <i class="pi pi-plus" style="font-size: 0.7rem"></i>
            </button>
          </div>
        </div>
        <codemirror
          v-model="cellmlText"
          class="editor-host"
          :style="{ '--cm-font-size': fontSize + 'px' }"
          :autofocus="true"
          :indent-with-tab="true"
          :tab-size="2"
          :extensions="extensions"
          :disabled="isLocked"
          @ready="handleReady"
          @update="handleStateUpdate"
        >
        </codemirror>
      </div>
    </div>
  </div>
</template>

<script setup>
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import 'katex/dist/katex.min.css'

import {
  CellMLTextGenerator,
  CellMLTextParser,
  CellMLLatexGenerator,
  applyVariableDefinitions,
  cellml,
  mergeSimpleLayout,
  renameIdentifier,
} from 'cellml-text-editor'

const katexPromise = import('katex')

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  simple: {
    type: Boolean,
    default: true
  },
  componentName: {
    type: String,
    default: ''
  },
  variableDefinitions: {
    type: Array,
    default: () => []
  },
  // The text layout saved with the math (comments, blank lines, statements as typed). Read on mount.
  layout: {
    type: Object,
    default: null
  },
})

/** What this editor's text is written in, so the session can tell its text from another editor's. */
const FORMAT = 'cellml-text'

/**
 * Emits `change` with `{ source, format, text, valid, xml, layout }`, the contract useMathSession expects.
 * `source` is 'init' on mount, 'edit' for typing, or 'external' after a prop change.
 */
const emit = defineEmits(['update:simple', 'update:componentName', 'change', 'save', 'undo', 'redo'])

const DEBOUNCE_MS = 500

const isSimple = computed({
  get: () => props.simple,
  set: (v) => emit('update:simple', v),
})

const generator = new CellMLTextGenerator({ simplified: props.simple })
const parser = new CellMLTextParser({ simplified: props.simple })
const latexGen = new CellMLLatexGenerator()

let lastXml = props.modelValue
// The Advanced Mode layout of the last valid text. Simple Mode edits are merged into it.
let lastLayout = props.layout

// Math the text can't hold, found when the text was generated. Editing it would lose that math.
const generatorErrors = ref([])

/**
 * Generates this editor's text for a model, noting anything the text can't hold.
 *
 * @param {string} xml
 * @returns {string}
 */
function generateText(xml) {
  const result = generator.generateResult(xml, { layout: lastLayout })
  if (result.layoutRejected) console.warn('CellML text layout ignored: it would have changed the math.')
  generatorErrors.value = result.errors
  return result.text
}

const cellmlText = ref(generateText(lastXml))
const errors = ref([])

// The text is locked when it can't hold all the math; its parse errors then only repeat that.
const isLocked = computed(() => generatorErrors.value.length > 0)
const shownErrors = computed(() =>
  isLocked.value
    ? [
        {
          line: null,
          message: "CellML Text can't show part of this math, so it can't be edited here. Use the Math Editor tab.",
        },
        ...generatorErrors.value.map(({ message }) => ({ line: null, message })),
      ]
    : errors.value
)
const latexContainer = ref(null)
const rootRef = ref(null)
const previewSectionRef = ref(null)

let currentDoc = null
let debouncer = null
let pendingSource = 'edit'
let lastDefinitionsKey = ''
let resizeObserver = null
let resizeRaf = null

let applyingExternalText = false
const cursorLine = ref(1)

// ── Storage helpers ─────────────────────────────────────────────────────────
function readStored(key) {
  try {
    return window.localStorage.getItem(key)
  } catch (e) {
    return null // localStorage unavailable (e.g. private browsing)
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch (e) {
    // ignore storage errors
  }
}

// ── Font size ───────────────────────────────────────────────────────────────
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 20
const FONT_SIZE_STORAGE_KEY = 'cellml-editor-font-size'
const DEFAULT_FONT_SIZE = 12.5

function loadStoredFontSize() {
  const stored = Number(readStored(FONT_SIZE_STORAGE_KEY))
  return stored && stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE ? stored : DEFAULT_FONT_SIZE
}

const fontSize = ref(loadStoredFontSize())

function increaseFontSize() {
  fontSize.value = Math.min(MAX_FONT_SIZE, fontSize.value + 1)
  writeStored(FONT_SIZE_STORAGE_KEY, fontSize.value)
}

function decreaseFontSize() {
  fontSize.value = Math.max(MIN_FONT_SIZE, fontSize.value - 1)
  writeStored(FONT_SIZE_STORAGE_KEY, fontSize.value)
}

// ── Equation preview: size + collapse ───────────────────────────────────────
const MIN_FIT_SCALE = 0.5
const MIN_PREVIEW_HEIGHT = 72
const MAX_PREVIEW_HEIGHT = 480
const DEFAULT_PREVIEW_HEIGHT = 150
const PREVIEW_HEIGHT_STORAGE_KEY = 'cellml-editor-preview-height'
const PREVIEW_COLLAPSED_STORAGE_KEY = 'cellml-editor-preview-collapsed'

function clampPreviewHeight(value) {
  const available = rootRef.value?.clientHeight
  const max = available ? Math.min(MAX_PREVIEW_HEIGHT, Math.round(available * 0.6)) : MAX_PREVIEW_HEIGHT
  return Math.min(max, Math.max(MIN_PREVIEW_HEIGHT, Math.round(value)))
}

const previewHeight = ref(clampPreviewHeight(Number(readStored(PREVIEW_HEIGHT_STORAGE_KEY)) || DEFAULT_PREVIEW_HEIGHT))
const previewCollapsed = ref(readStored(PREVIEW_COLLAPSED_STORAGE_KEY) === 'true')
const draggingPreview = ref(false)
let dragStartY = 0
let dragStartHeight = 0

const previewStyle = computed(() => (previewCollapsed.value ? {} : { height: `${previewHeight.value}px` }))

function togglePreview() {
  previewCollapsed.value = !previewCollapsed.value
  writeStored(PREVIEW_COLLAPSED_STORAGE_KEY, previewCollapsed.value)
  if (!previewCollapsed.value) nextTick(updatePreview)
}

function onPreviewResizeMove(event) {
  previewHeight.value = clampPreviewHeight(dragStartHeight + (event.clientY - dragStartY))
}

function stopPreviewResize() {
  if (!draggingPreview.value) return
  draggingPreview.value = false
  window.removeEventListener('pointermove', onPreviewResizeMove)
  writeStored(PREVIEW_HEIGHT_STORAGE_KEY, previewHeight.value)
}

function startPreviewResize(event) {
  draggingPreview.value = true
  dragStartY = event.clientY
  dragStartHeight = previewHeight.value
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', onPreviewResizeMove)
  window.addEventListener('pointerup', stopPreviewResize, { once: true })
}

function nudgePreview(delta) {
  previewHeight.value = clampPreviewHeight(previewHeight.value + delta)
  writeStored(PREVIEW_HEIGHT_STORAGE_KEY, previewHeight.value)
}

function resetPreviewHeight() {
  previewHeight.value = clampPreviewHeight(DEFAULT_PREVIEW_HEIGHT)
  writeStored(PREVIEW_HEIGHT_STORAGE_KEY, previewHeight.value)
}

// ── Dynamic Dark Mode Detection ─────────────────────────────────────────────
const isDarkMode = ref(false)
let observer = null

const checkDarkMode = () => {
  isDarkMode.value = document.documentElement.classList.contains('p-dark')
}

let cmView = null

// Captured as soon as the view exists, so focus() works before the first update.
const handleReady = ({ view }) => {
  cmView = view
}

const handleStateUpdate = (viewUpdate) => {
  cmView = viewUpdate.view

  if (viewUpdate.selectionSet || viewUpdate.docChanged) {
    const state = viewUpdate.state
    const pos = state.selection.main.head
    const line = state.doc.lineAt(pos)

    cursorLine.value = line.number
    updatePreview()
  }
}

const shiftSpaceKeymap = keymap.of([
  {
    key: 'Shift-Space',
    run: (view) => {
      view.dispatch(view.state.replaceSelection(' '))
    },
  },
])

const appHistoryKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Mod-z',
      run: () => {
        emit('undo')
        return true
      },
    },
    {
      key: 'Mod-Shift-z',
      run: () => {
        emit('redo')
        return true
      },
    },
    {
      key: 'Mod-y',
      run: () => {
        emit('redo')
        return true
      },
    },
  ])
)

const handleKeyDown = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    emit('save')
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
  }
}

const extensions = computed(() => {
  const base = [basicSetup, cellml(), shiftSpaceKeymap, appHistoryKeymap]
  return isDarkMode.value ? [...base, oneDark] : base
})

const applyFitScale = () => {
  const container = latexContainer.value
  if (!container) return

  const content = container.querySelector('.katex-html')
  if (!content) return

  const containerWidth = container.clientWidth - 30
  const containerHeight = container.clientHeight - 10
  if (containerWidth <= 0 || containerHeight <= 0) return

  const contentWidth = content.scrollWidth
  const contentHeight = content.scrollHeight

  if (contentHeight > containerHeight || contentWidth > containerWidth) {
    const rawScale = Math.min(containerWidth / contentWidth, containerHeight / contentHeight)
    const scale = Math.max(rawScale * 0.95, MIN_FIT_SCALE)
    content.style.transform = `scale(${scale})`
    content.style.transformOrigin = 'center center'
  } else {
    content.style.transform = 'none'
  }
}

const scheduleFitScale = () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  resizeRaf = requestAnimationFrame(applyFitScale)
}

const updatePreview = async () => {
  if (!currentDoc || previewCollapsed.value) return

  const katex = (await katexPromise).default
  const equations = Array.from(currentDoc.getElementsByTagNameNS('*', 'apply'))

  let bestMatch = null

  for (let i = 0; i < equations.length; i++) {
    const eq = equations[i]
    if (!eq) continue

    const loc = eq.getAttribute('data-source-location')
    if (!loc) continue

    const [startStr, endStr] = loc.split('-')
    const start = parseInt(startStr || '0', 10)
    const end = endStr ? parseInt(endStr, 10) : start

    if (start > cursorLine.value) break

    if (cursorLine.value >= start && cursorLine.value <= end) {
      bestMatch = eq
      break
    }
  }

  if (!latexContainer.value) return

  if (bestMatch) {
    katex.render(latexGen.convert(bestMatch), latexContainer.value, { throwOnError: false, displayMode: true })
    nextTick(applyFitScale)
  } else {
    latexContainer.value.innerHTML = "<span class='placeholder'>No equation selected</span>"
  }
}

// ── Parse -> declare variables -> report ──────────────────────────────────────
const definitionsKey = () => (parser.simplified ? JSON.stringify(props.variableDefinitions) : '')

/**
 * Parses the text into CellML and reports the result.
 *
 * @param {'init'|'edit'|'external'} source - What triggered the parse.
 * @param {Object} [options]
 * @param {string} [options.text] - Text to parse; defaults to the editor's text.
 * @param {boolean} [options.silent=false] - Parse without emitting `change`.
 */
function run(source, { text = cellmlText.value, silent = false } = {}) {
  if (debouncer) {
    clearTimeout(debouncer)
    debouncer = null
  }
  pendingSource = 'edit'

  const simple = parser.simplified
  const result = parser.parse(text, {
    baseXml: lastXml,
    componentName: props.componentName || undefined,
    finalise: simple ? (doc) => applyVariableDefinitions(doc, props.variableDefinitions) : undefined,
  })

  errors.value = result.errors
  lastDefinitionsKey = definitionsKey()

  const valid = result.errors.length === 0 && !!result.xml && !!result.doc

  if (valid) {
    currentDoc = result.doc
    lastXml = result.xml
    if (result.layout) lastLayout = simple ? mergeSimpleLayout(lastLayout, result.layout) : result.layout

    // Advanced Mode: the text defines the component name
    const textComponentName = simple ? '' : result.doc.getElementsByTagName('component')[0]?.getAttribute('name')
    if (textComponentName && textComponentName !== props.componentName) {
      emit('update:componentName', textComponentName)
    }
  }

  if (!silent) {
    emit('change', {
      source,
      format: FORMAT,
      text,
      valid,
      xml: valid ? result.xml : null,
      layout: valid ? lastLayout : null,
    })
  }

  if (valid) nextTick(updatePreview)
}

function schedule(source) {
  if (debouncer && pendingSource === 'edit') source = 'edit'
  if (debouncer) clearTimeout(debouncer)
  pendingSource = source
  debouncer = setTimeout(() => run(pendingSource), DEBOUNCE_MS)
}

function flush() {
  if (debouncer) run(pendingSource)
}

watch(cellmlText, () => {
  if (!applyingExternalText) schedule('edit')
})

watch(
  () => props.variableDefinitions,
  () => {
    if (parser.simplified && definitionsKey() !== lastDefinitionsKey) schedule('external')
  }
)

watch(
  () => props.componentName,
  () => {
    if (parser.simplified) schedule('external')
  }
)

watch(
  () => props.simple,
  (simple) => {
    if (debouncer) run('edit') 
    generator.simplified = simple
    parser.simplified = simple
    setText(generateText(lastXml), { report: true })
  }
)

async function setText(newText, { report = false, source = 'external' } = {}) {
  if (debouncer) {
    clearTimeout(debouncer)
    debouncer = null
  }

  applyingExternalText = true

  const oldText = cellmlText.value

  if (cmView && oldText !== newText) {
    const maxPrefix = Math.min(oldText.length, newText.length)
    let prefixLen = 0
    while (prefixLen < maxPrefix && oldText[prefixLen] === newText[prefixLen]) {
      prefixLen++
    }

    const maxSuffix = Math.min(oldText.length, newText.length) - prefixLen
    let suffixLen = 0
    while (
      suffixLen < maxSuffix &&
      oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
    ) {
      suffixLen++
    }

    const from = prefixLen
    const to = oldText.length - suffixLen
    const insert = newText.slice(prefixLen, newText.length - suffixLen)

    cmView.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    })
  } else {
    cellmlText.value = newText
  }

  await nextTick()
  applyingExternalText = false

  run(source, { text: newText, silent: !report })
}

/**
 * Simple Mode: renames every use of a variable, keeping formatting and comments, and reports it as
 * an edit.
 *
 * @param {string} from
 * @param {string} to
 * @returns {Promise<void>}
 */
function renameVariable(from, to) {
  return setText(renameIdentifier(cellmlText.value, from, to), { report: true, source: 'edit' })
}

/**
 * Shows a model written by another editor, as this editor's text.
 *
 * @param {string} xml
 * @returns {Promise<void>}
 */
function setModel(xml) {
  lastXml = xml
  return setText(generateText(xml))
}

defineExpose({
  format: FORMAT,
  setText,
  setModel,
  renameVariable,
  flush,
  focus: () => cmView?.focus(),
  getErrors: () => shownErrors.value,
})

onMounted(() => {
  checkDarkMode()
  observer = new MutationObserver(checkDarkMode)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  run('init')

  window.addEventListener('keydown', handleKeyDown)
  if (previewSectionRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleFitScale)
    resizeObserver.observe(previewSectionRef.value)
  }
})

onUnmounted(() => {
  if (debouncer) clearTimeout(debouncer)
  if (observer) observer.disconnect()
  if (resizeObserver) resizeObserver.disconnect()
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('pointermove', onPreviewResizeMove)
})
</script>

<style scoped>
/* Main layout container */
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  font-family: sans-serif;
  box-sizing: border-box;
  position: relative;
  background-color: var(--p-content-background, transparent);
  color: var(--p-text-color);
}

/* Panel structure for Editor */
.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 0;
}

.container.is-resizing {
  user-select: none;
  cursor: row-resize;
}

/* Equation preview: sized by the person (drag handle) or collapsed to a strip */
.preview-section {
  position: relative;
  flex: 0 0 auto;
  min-height: 0;
}

.preview-section--collapsed {
  height: auto;
  margin-bottom: 12px;
}

.preview-collapsed-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 12px 0 5px; /* 5px + the 1px border puts the chevron 6px from the corner, like the expanded button */
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background-color: color-mix(in srgb, var(--p-content-background) 96%, var(--p-text-color));
  color: var(--p-text-muted-color);
  font-size: 0.8125rem;
  text-align: left;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.preview-collapsed-bar:hover {
  color: var(--p-text-color);
  background-color: var(--p-content-hover-background, rgba(255, 255, 255, 0.06));
}

.preview-collapsed-bar--error {
  color: var(--p-red-400, #f87171);
  border-color: color-mix(in srgb, var(--p-red-500, #ef4444) 35%, transparent);
  background-color: color-mix(in srgb, var(--p-red-500, #ef4444) 15%, var(--p-content-background));
}

/* One box for the toggle in both states: 20px, centred 16px from the top and left edges of the preview. */
.preview-toggle-icon {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 0.8rem;
  opacity: 0.7;
  transition: opacity 0.15s ease, background-color 0.15s ease;
}

.preview-collapsed-bar:hover .preview-toggle-icon,
.preview-toggle:hover .preview-toggle-icon,
.preview-toggle:focus-visible .preview-toggle-icon {
  opacity: 1;
  background: var(--p-content-hover-background, rgba(255, 255, 255, 0.06));
}

.preview-toggle {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  padding: 0;
  border: none;
  background: none;
  color: var(--p-text-muted-color);
  cursor: pointer;
}

.preview-toggle:hover {
  color: var(--p-text-color);
}

.preview-collapsed-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Drag handle under the preview; also hosts the collapse button */
.preview-resizer {
  position: relative;
  flex: 0 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
  touch-action: none;
}

.preview-resizer-grip {
  width: 48px;
  height: 4px;
  border-radius: 3px;
  background: var(--p-content-border-color);
  transition: background-color 0.15s ease;
}

.preview-resizer:hover .preview-resizer-grip,
.preview-resizer:focus-visible .preview-resizer-grip {
  background: var(--p-primary-color);
}

.preview-resizer:focus-visible {
  outline: none;
}

/* Text area takes whatever height the preview leaves */
.editor-section {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 12px;
}

.editor-host {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mode-switch {
  /* A compact switch: the default is sized for forms, which looks oversized next to a 13px label. */
  --p-toggleswitch-width: 2rem;
  --p-toggleswitch-height: 1.125rem;
  --p-toggleswitch-handle-size: 0.75rem;
  --p-toggleswitch-gap: 0.1875rem;

  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1;
  color: var(--p-text-muted-color);
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease;
}

.mode-switch:hover {
  color: var(--p-text-color);
}

.font-size-control {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  padding: 2px;
}

.font-size-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--p-text-muted-color);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.font-size-btn:hover:not(:disabled) {
  background: var(--p-content-hover-background, rgba(255, 255, 255, 0.06));
  color: var(--p-text-color);
}

.font-size-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.font-size-value {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  min-width: 2.6em;
  text-align: center;
  user-select: none;
}

/* CodeMirror Base Styling */
:deep(.cm-editor) {
  flex: 1;
  min-width: 0;
  border-radius: 6px;
  font-size: var(--cm-font-size, 11.5px);
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background-color: var(--p-content-background);
  color: var(--p-text-color);
  outline:none;
  border: 1px solid var(--p-content-border-color);
}

:deep(.cm-scroller) {
  border-radius: 6px;
}

/* CodeMirror Gutters */
:deep(.cm-gutters) {
  background-color: color-mix(in srgb, var(--p-content-background) 92%, var(--p-text-color));
  color: var(--p-text-muted-color);
  border-right: 1px solid var(--p-content-border-color);
}

:deep(.cm-activeLine) {
  background-color: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}

:deep(.cm-activeLineGutter) {
  background-color: color-mix(in srgb, var(--p-primary-color) 20%, transparent);
  color: var(--p-text-color);
}

:deep(.cm-cursor) {
  border-left-color: var(--p-text-color);
}

:deep(.cm-content) {
  tab-size: 4;
}

.cm-line {
  white-space: pre-wrap !important;
}

/* LaTeX Preview Area - Adapts to Dark Mode */
.preview-pane {
  height: 100%;
  box-sizing: border-box;
  padding: 15px;
  background-color: color-mix(in srgb, var(--p-content-background) 96%, var(--p-text-color));
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4em;
  overflow: auto;
  color: var(--p-text-color);
  scrollbar-width: thin;
}

.preview-pane::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.preview-pane::-webkit-scrollbar-thumb {
  background-color: var(--p-content-border-color);
  border-radius: 4px;
}

.preview-pane::-webkit-scrollbar-track {
  background: transparent;
}

.preview-pane :deep(.katex) {
  color: var(--p-text-color) !important;
}

.preview-pane :deep(.katex-display) {
  margin: 0;
}

.preview-pane :deep(.katex-html) {
  display: inline-block;
}

.preview-pane :deep(.placeholder) {
  color: var(--p-text-muted-color);
  font-style: italic;
  font-size: 0.85em;
}

/* Error Banner styling for Light/Dark Mode */
.error-banner {
  background-color: color-mix(in srgb, var(--p-red-500, #ef4444) 15%, var(--p-content-background));
  color: var(--p-red-400, #f87171);
  padding: 10px 15px;
  border: 1px solid color-mix(in srgb, var(--p-red-500, #ef4444) 35%, transparent);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  height: 100%;
  box-sizing: border-box;
  padding-left: 40px; /* clear of the collapse button */
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow-y: auto;
}

/* ==========================================================================
   CodeMirror Dark Mode Overrides (Selection, Gutters, Tokens)
   ========================================================================== */

:root.p-dark :deep(.cm-editor),
:root.dark :deep(.cm-editor) {
  background-color: #1e1e2e !important;
  color: #cdd6f4 !important;
}

:root.p-dark :deep(.cm-focused .cm-selectionBackground),
:root.p-dark :deep(.cm-selectionBackground),
:root.dark :deep(.cm-selectionBackground) {
  background-color: rgba(69, 71, 90, 0.7) !important;
}

:root.p-dark :deep(.cm-gutters),
:root.dark :deep(.cm-gutters) {
  background-color: #181825 !important;
  color: #6c7086 !important;
  border-right: 1px solid #313244 !important;
}

:root.p-dark :deep(.cm-cursor),
:root.dark :deep(.cm-cursor) {
  border-left-color: #f5e0dc !important;
}

/* Syntax Highlighting Token Overrides */
:root.p-dark :deep(.cm-editor),
:root.dark :deep(.cm-editor) {
  .tok-keyword, .cm-keyword { color: #f38ba8 !important; font-weight: 600; }
  .tok-string, .cm-string { color: #a6e3a1 !important; }
  .tok-number, .cm-number, .tok-atom, .cm-atom { color: #fab387 !important; }
  .tok-comment, .cm-comment { color: #6c7086 !important; font-style: italic; }
  .tok-operator, .cm-operator, .tok-punctuation, .cm-punctuation { color: #89dceb !important; }
  .tok-variableName, .cm-variableName { color: #cdd6f4 !important; }
  .tok-typeName, .cm-typeName, .tok-className, .cm-className { color: #94e2d5 !important; }
  .tok-propertyName, .cm-propertyName, .tok-attributeName, .cm-attributeName { color: #89b4fa !important; }
}
</style>
