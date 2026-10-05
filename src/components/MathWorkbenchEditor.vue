<template>
  <div class="container" @keydown.capture="handleEditorKeyDown">
    <div class="panel">
      <div class="workbench-host">
        <EquationWorkbench
          ref="workbenchRef"
          cellml
          validate="commit"
          autofocus
          :outputs="false"
          copy
          :history="false"
          :readonly="isBlocked"
          :issues="blockIssues"
          :variable-units="variableUnits"
          @equations-change="handleEquationsChange"
          @line-commit="handleLineCommit"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * The WYSIWYG math editor, wrapped to the contract useMathSession expects of a math editor. It
 * always works like Simple Mode: it edits the equations, and the parameter table declares the
 * variables. Its "Copy as" button copies the selected equations as LaTeX, MathJSON or Content MathML.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { EquationWorkbench } from 'vue3-math-editor'
import 'vue3-math-editor/style.css'
import 'katex/dist/katex.min.css'

import { buildModelFromEquations, extractEquationsMathML } from '../services/math/mathmlModel'
import { renameCiInMathML } from '../services/math/carryRenames'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  componentName: {
    type: String,
    default: '',
  },
  variableDefinitions: {
    type: Array,
    default: () => [],
  },
})

/**
 * Emits `change` with `{ source, format, text, valid, xml }`, the contract useMathSession expects.
 * `source` is 'init' on mount, 'edit' once a line is committed, or 'external' after a prop change.
 * `text` is the lines' Content MathML.
 */
const emit = defineEmits(['change', 'save', 'undo', 'redo'])

/** What this editor's text is written in, so the session can tell its text from another editor's. */
const FORMAT = 'mathml'
const DEBOUNCE_MS = 500
const BLOCKED_MESSAGE = "The Math Editor can't edit this component. Use the CellML Text tab."

const workbenchRef = ref(null)
const errors = ref([])
const importProblems = ref([])
// The line the block message is shown on: the first one the workbench couldn't import.
const blockedLineId = ref(null)

let lines = []
let lastXml = props.modelValue
let debouncer = null
let pendingSource = 'external'
let lastDefinitionsKey = ''
// Edits are reported once the workbench commits the line, not while it is being typed.
let hasPendingEdit = false

// Math the workbench couldn't import would be lost on save, so the whole component is locked.
const isBlocked = computed(() => importProblems.value.length > 0)

// The workbench shows its own diagnostics; the only issue phlynx adds is why editing is locked.
const blockIssues = computed(() =>
  isBlocked.value && blockedLineId.value ? [{ lineId: blockedLineId.value, message: BLOCKED_MESSAGE }] : []
)

// Hovering a variable shows the units the table gives it.
const variableUnits = computed(() =>
  Object.fromEntries(props.variableDefinitions.filter((def) => def.units).map((def) => [def.name, def.units]))
)

const definitionsKey = () => JSON.stringify(props.variableDefinitions)

/** This editor's text: the lines' Content MathML. */
const linesText = () =>
  lines
    .map((line) => line.mathml)
    .filter(Boolean)
    .join('\n')

// ── Lines -> model -> report ──────────────────────────────────────────────────

/**
 * Builds the model from the current lines and reports the result.
 *
 * @param {'init'|'edit'|'external'} source - What triggered the build.
 * @param {Object} [options]
 * @param {boolean} [options.silent=false] - Build without emitting `change`.
 */
function run(source, { silent = false } = {}) {
  if (debouncer) {
    clearTimeout(debouncer)
    debouncer = null
  }
  // Uncommitted typing is part of whatever is reported now, so it keeps its undo step. A silent run
  // reports nothing, so typing that started meanwhile is still pending afterwards.
  if (!silent) {
    if (hasPendingEdit && source === 'external') source = 'edit'
    hasPendingEdit = false
  }
  pendingSource = 'external'
  lastDefinitionsKey = definitionsKey()

  const text = linesText()

  // Math the workbench couldn't import would be lost, and incomplete lines don't parse yet; both
  // are reported the way the text editor reports text that doesn't parse. The workbench shows its
  // own, more specific, message for each.
  const unsupported = importProblems.value.map((message) => ({ line: null, message }))
  const incomplete = lines.flatMap((line, index) =>
    line.mathml && !line.complete ? [{ line: index + 1, message: 'This equation is incomplete.' }] : []
  )
  const result =
    unsupported.length || incomplete.length
      ? { xml: null, errors: [...unsupported, ...incomplete] }
      : buildModelFromEquations({
          baseXml: lastXml,
          componentName: props.componentName || undefined,
          mathml: lines.map((line) => line.mathml),
          definitions: props.variableDefinitions,
        })

  errors.value = result.errors
  const valid = result.errors.length === 0 && !!result.xml
  if (valid) lastXml = result.xml

  if (!silent) {
    emit('change', {
      source,
      format: FORMAT,
      text,
      valid,
      xml: valid ? result.xml : null,
    })
  }
}

function schedule(source) {
  if (debouncer) clearTimeout(debouncer)
  pendingSource = source
  debouncer = setTimeout(() => run(pendingSource), DEBOUNCE_MS)
}

/** Reports any uncommitted edit or scheduled prop change now. */
function flush() {
  if (hasPendingEdit) run('edit')
  else if (debouncer) run(pendingSource)
}

/**
 * Keeps the latest lines. Edits wait for the workbench to commit the line, except deleting a line,
 * which is done at once and never commits one. Loads are reported by whoever called setMathML.
 *
 * @param {Array} nextLines - The workbench's EquationLine list.
 * @param {{ source: 'load'|'edit' }} info
 */
function handleEquationsChange(nextLines, info) {
  const nextIds = new Set(nextLines.map((line) => line.id))
  const removedLine = lines.some((line) => !nextIds.has(line.id))
  lines = nextLines
  if (info?.source !== 'edit') return
  hasPendingEdit = true
  if (removedLine) run('edit')
}

/**
 * Reports the edit once the workbench commits a line: on Enter, a new line, moving to another line,
 * leaving the editor, or a paste. It only commits lines whose math changed.
 */
function handleLineCommit() {
  if (hasPendingEdit) run('edit')
}

watch(
  () => props.variableDefinitions,
  () => {
    if (definitionsKey() !== lastDefinitionsKey) schedule('external')
  }
)

watch(
  () => props.componentName,
  () => schedule('external')
)

// ── Imperative API ──────────────────────────────────────────────────────────

/**
 * Loads Content MathML into the workbench and waits for its lines.
 *
 * @param {string} mathml - One or more `<math>` elements; '' leaves one empty line.
 * @returns {Promise<void>}
 */
async function loadMathML(mathml) {
  if (debouncer) {
    clearTimeout(debouncer)
    debouncer = null
  }
  hasPendingEdit = false
  const result = workbenchRef.value?.setMathML(mathml)
  importProblems.value = result?.problems ?? []
  // The workbench reports its new lines from a watcher, which has run by the next tick.
  await nextTick()
  const problemLine = result?.lineProblems?.findIndex((problems) => problems.length > 0) ?? -1
  blockedLineId.value = (lines[problemLine] ?? lines[0])?.id ?? null
}

/**
 * Shows this editor's own text (see `change`), during undo or redo.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
async function setText(text) {
  // Recording an edit replays it straight away; reloading would drop the cursor and empty lines.
  if (text !== linesText()) await loadMathML(text)
  run('external', { silent: true })
}

/**
 * Shows a model written by another editor.
 *
 * @param {string} xml
 * @returns {Promise<void>}
 */
function setModel(xml) {
  lastXml = xml
  return setText(extractEquationsMathML(xml).join('\n'))
}

/**
 * Renames every use of a variable and reports it as an edit.
 *
 * @param {string} from
 * @param {string} to
 * @returns {Promise<void>}
 */
async function renameVariable(from, to) {
  await loadMathML(renameCiInMathML(linesText(), from, to))
  run('edit')
}

defineExpose({
  format: FORMAT,
  setText,
  setModel,
  renameVariable,
  flush,
  focus: () => workbenchRef.value?.focus(),
  getErrors: () => errors.value,
})

// ── Keys ────────────────────────────────────────────────────────────────────

/**
 * Sends undo and redo to the app history, so there is one undo stack across editors.
 *
 * @param {KeyboardEvent} event
 */
function handleEditorKeyDown(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  const key = event.key.toLowerCase()
  if (key !== 'z' && key !== 'y') return
  event.preventDefault()
  event.stopPropagation()
  emit(key === 'y' || event.shiftKey ? 'redo' : 'undo')
}

/**
 * Saves on Ctrl/Cmd+Enter anywhere in the page, as the text editor does.
 *
 * @param {KeyboardEvent} event
 */
function handleWindowKeyDown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    emit('save')
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleWindowKeyDown)
  const mathml = extractEquationsMathML(props.modelValue).join('\n')
  if (mathml) await loadMathML(mathml)
  else await nextTick()
  run('init')
  workbenchRef.value?.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeyDown)
  if (debouncer) clearTimeout(debouncer)
})
</script>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  background-color: var(--p-content-background, transparent);
  color: var(--p-text-color);
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.workbench-host {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}

/* The workbench keeps its toolbar in view with position: sticky, but its status bar comes after
   every line. Keep that in view too, at the bottom of this scrolling pane. */
.workbench-host :deep([data-role='status']) {
  position: sticky;
  bottom: 0;
  z-index: 2;
}

/* With no message the status bar has no background of its own, and lines would scroll under it. */
.workbench-host :deep([data-role='status']:not([data-kind])) {
  background: var(--me-surface, var(--p-content-background));
}
</style>
