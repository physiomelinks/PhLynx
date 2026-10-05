/**
 * An editing session over an instance's math: the XML, the text, the parameter rows and the
 * analysis linking them. Math editors report changes, and this is the one place they become rows
 * and undo history.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { serializeLayout } from 'cellml-text-editor'

import { useLibraryStore } from '../stores/libraryStore'
import { analyzeMathXml } from '../services/math/analyzeMath'
import { SIMPLE_MODE, applyPortTypes, getPortVariables, modeFor, reconcileRows } from '../services/math/reconcileRows'
import { carryRenames, followPendingRename } from '../services/math/carryRenames'
import { classifyRows, findConnectionSupplied } from '../services/math/variableKinds'
import { separateParameters } from '../services/math/separateParameters'
import { buildVariableDeclarations } from '../utils/variables'
import { areModelsEquivalent } from '../utils/cellml'
import { cleanName } from '../utils/identifiers'
import { restorePortVariables, setPortVariables } from '../utils/multiport'

/**
 * Checks whether two row lists hold the same set of names.
 *
 * @param {Array} rows
 * @param {Array} otherRows
 * @returns {boolean}
 */
function hasSameNames(rows, otherRows) {
  const names = new Set(otherRows.map((row) => row.name))
  return rows.length === otherRows.length && rows.every((row) => names.has(row.name))
}

/**
 * Checks whether two text layouts are the same.
 *
 * @param {import('cellml-text-editor').TextLayout | null} layout
 * @param {import('cellml-text-editor').TextLayout | null} otherLayout
 * @returns {boolean}
 */
function isSameLayout(layout, otherLayout) {
  if (layout === otherLayout) return true
  if (!layout || !otherLayout) return false
  return serializeLayout(layout) === serializeLayout(otherLayout)
}

/**
 * Creates a math editing session. A plugged-in editor emits `change` with
 * `{ source: 'init'|'edit'|'external', format, text, valid, xml, layout? }` and exposes `format` (what its
 * text is written in), `setText`, `setModel`, `flush`, `getErrors` and `renameVariable` (renames
 * a variable everywhere in its text and reports that as an edit). Editors can be swapped
 * mid-session; a later `init` is the new editor's view of the same math.
 *
 * @param {Object} options
 * @param {Object} options.history - The undo history edits are recorded in.
 * @param {import('vue').Ref} options.editorRef - The mounted math editor.
 * @param {import('vue').Ref<Array>} options.ports - Editable ports; variables removed from the math are removed from them, and renamed ones renamed.
 * @returns {Object} Session state, queries and actions.
 */
export function useMathSession({ history, editorRef, ports }) {
  const store = useLibraryStore()

  const isManaged = ref(true) // Simple Mode: the table owns the declarations
  const currentModel = ref('') // latest valid XML
  // Latest editor text, valid or not, with the layout of the last valid CellML text at that point.
  const currentText = ref({ format: null, value: '', layout: null })
  const originalModel = ref('')
  const loadedLayout = shallowRef(null)
  const originalLayout = shallowRef(null)
  /** The text layout to save with the math: comments, blank lines and statements as typed. */
  const currentLayout = computed(() => currentText.value.layout ?? loadedLayout.value)
  const parameterRows = ref([])
  const analysis = shallowRef(null)
  // Simple Mode: a variable renamed in only some places, `{ from, to, uses }`, offered for renaming everywhere.
  const pendingRename = shallowRef(null)

  const mode = computed(() => modeFor(isManaged.value))

  /**
   * Gets the options every reconcile shares: the mode and the ports. The math's defaults only seed new
   * instances, so a row the session adds starts blank.
   *
   * @param {Iterable<string>} [portNames] - Port variables, if they differ from the current ports.
   * @returns {Object} reconcileRows options.
   */
  const reconcileOptions = (portNames = portVariables.value) => ({
    mode: mode.value,
    portVariables: portNames,
  })
  // A mode switch always rebuilds the rows, so remember which mode built them.
  let rowsBuiltAsManaged = null
  // An editor mounted after a switch also reports 'init', which only moves the baseline if nothing
  // has changed, since each editor writes the same math its own way (e.g. `0.0` as `0`).
  let hasInitialised = false
  // The user's latest edit doesn't parse, so it isn't in currentModel and isDirty can't see it.
  let hasInvalidEdit = false

  /**
   * Replaces the rows and records the mode that built them.
   *
   * @param {Array} rows
   */
  function setRows(rows) {
    parameterRows.value = rows
    rowsBuiltAsManaged = isManaged.value
  }

  // Rows an edit removed this session, by name. A variable that drops out of the math for a moment
  // (an equation deleted and retyped, a cut and paste) gets its value and source back. Never saved.
  const parkedRows = new Map()

  /**
   * Reconciles like reconcileRows, but parks the rows it drops and offers parked rows back, so a
   * name that returns keeps what its row held.
   *
   * @param {import('../services/math/analyzeMath').MathAnalysis|null} nextAnalysis
   * @param {Array} rows - The current rows.
   * @param {Object} options - reconcileRows options.
   * @returns {Array} New row objects.
   */
  function reconcileKeepingRemoved(nextAnalysis, rows, options) {
    const currentNames = new Set(rows.map((row) => row.name))
    const parked = [...parkedRows.values()].filter((row) => !currentNames.has(row.name))
    const result = reconcileRows(nextAnalysis, [...rows, ...parked], options)
    const keptNames = new Set(result.map((row) => row.name))
    for (const row of rows) {
      if (!keptNames.has(row.name)) parkedRows.set(row.name, row)
    }
    return result
  }

  /** Every variable name the ports carry. A row nothing computes and no port supplies is a parameter. */
  const portVariables = computed(() => getPortVariables(ports.value))

  watch(portVariables, (names) => applyPortTypes(parameterRows.value, analysis.value, names))

  /** Declarations Simple Mode writes into the model. */
  const editorDefinitions = computed(() => buildVariableDeclarations(parameterRows.value))

  /** Each variable's kind (constant, computed constant, ...), or null before the first analysis. */
  const variableKinds = computed(() => classifyRows(analysis.value, parameterRows.value))

  /** Names constant only because a connection supplies them, labelled as such in the initialiser picker. */
  const connectionSupplied = computed(() => findConnectionSupplied(analysis.value, parameterRows.value))

  /** Names the equations use. A state's link to its initialiser doesn't count. */
  const mathReferences = computed(() => new Set(analysis.value?.referenced ?? []))

  // Simple Mode reads units from the table; Advanced Mode asks the analysis of the text.
  const unresolvedInText = computed(() => new Set(isManaged.value ? [] : (analysis.value?.unresolved ?? [])))

  /**
   * Checks whether a row is missing its units.
   *
   * @param {Object} row
   * @returns {boolean}
   */
  const isMissingUnits = (row) => (isManaged.value ? !cleanName(row.units) : unresolvedInText.value.has(row.name))

  /**
   * Checks whether the math differs from what was loaded. The libcellml comparison only runs when
   * the XML text differs.
   *
   * @returns {boolean}
   */
  function isDirty() {
    if (currentModel.value === originalModel.value) return false
    return !areModelsEquivalent(originalModel.value, currentModel.value)
  }

  /**
   * Checks whether the text layout differs from what was loaded, e.g. after editing only comments.
   *
   * @returns {boolean}
   */
  function isLayoutDirty() {
    return !isSameLayout(originalLayout.value, currentLayout.value)
  }

  /**
   * Checks whether the user's latest edit left the math invalid, e.g. an incomplete equation.
   *
   * @returns {boolean}
   */
  function hasUnsavedInvalidEdit() {
    return hasInvalidEdit
  }

  // Bumped by each load, so an analysis that arrives after a later load started is dropped.
  let loadRequestId = 0

  /**
   * Loads an instance's math and rows. A cache miss is analyzed in the worker, so the caller can
   * show a loading state meanwhile. A load overtaken by a later one leaves the session to it.
   *
   * @param {Object} options
   * @param {string} options.mathRef
   * @param {Array} options.rows - The instance's saved rows.
   * @param {boolean} options.managed - Whether to start in Simple Mode.
   * @returns {Promise<void>}
   */
  async function load({ mathRef, rows, managed }) {
    const requestId = ++loadRequestId
    isManaged.value = managed
    const math = (mathRef && store.availableMath.get(mathRef)) || ''
    currentModel.value = math
    originalModel.value = math
    loadedLayout.value = (mathRef && store.getMathLayout(mathRef)) || null
    originalLayout.value = loadedLayout.value
    currentText.value = { format: null, value: '', layout: null }
    pendingRename.value = null
    hasInitialised = false
    hasInvalidEdit = false
    parkedRows.clear()

    const nextAnalysis = mathRef ? await store.ensureMathAnalysis(mathRef) : null
    if (requestId !== loadRequestId) return
    analysis.value = nextAnalysis
    setRows(reconcileRows(nextAnalysis, rows, reconcileOptions()))
  }

  /**
   * Removes port variables that no longer exist in the rows.
   *
   * @param {Array} rows
   */
  function pruneMissingPortVariables(rows) {
    const names = new Set(rows.map((row) => row.name))
    for (const port of ports.value) {
      if (Array.isArray(port.variables)) setPortVariables(port, port.variables.filter((name) => names.has(name)))
    }
  }

  // ── Editor events ──────────────────────────────────────────────────────────
  let pendingChange = Promise.resolve()

  /**
   * Queues an editor change so changes are handled one at a time, since recording history is async.
   *
   * @param {Object} change - The editor's `change` payload.
   */
  function handleEditorChange(change) {
    pendingChange = pendingChange
      .then(() => processEditorChange(change))
      .catch((error) => console.error('Failed to process math editor change', error))
  }

  /**
   * Flushes the editor's debounce and waits for every queued change.
   *
   * @returns {Promise<void>}
   */
  async function flushPendingChanges() {
    editorRef.value?.flush?.()
    await pendingChange
  }

  /**
   * Applies one editor change to the text, the analysis and the rows.
   *
   * @param {Object} change - The editor's `change` payload.
   * @returns {Promise<void>}
   */
  async function processEditorChange({ source, format, text, valid, xml, layout }) {
    const isEditorSwitch = source === 'init' && hasInitialised
    if (isEditorSwitch) source = 'external'
    if (source === 'init') hasInitialised = true
    // A change queued before an editor switch still carries the format it was written in. Text
    // without a layout (invalid, or from an editor that has none) keeps the current one.
    const textState = {
      format: format ?? editorRef.value?.format ?? null,
      value: text,
      layout: layout ?? currentLayout.value,
    }

    if (!valid) {
      if (source === 'edit') {
        hasInvalidEdit = true
        await recordTextEdit(textState)
      } else currentText.value = textState
      return
    }
    hasInvalidEdit = false

    const nextAnalysis = analyzeMathXml(xml)
    if (source === 'edit') return handleValidEdit(xml, textState, nextAnalysis)

    // 'init' (first editor mounted) or 'external' (mode, definitions, component name or editor changed).
    const rebaseline = source === 'init' || (isEditorSwitch && !isDirty())
    const rebaselineLayout = source === 'init' || (isEditorSwitch && !isLayoutDirty())
    currentText.value = textState
    currentModel.value = xml
    if (rebaseline) originalModel.value = xml
    if (rebaselineLayout) originalLayout.value = textState.layout
    analysis.value = nextAnalysis
    const unchanged = { renames: [], partial: null }
    pendingRename.value = isManaged.value ? followPendingRename(pendingRename.value, unchanged, nextAnalysis) : null

    const rows = reconcileKeepingRemoved(nextAnalysis, parameterRows.value, reconcileOptions())
    // Keep the existing row objects unless the structure changed, so table inputs aren't reset.
    if (source === 'init' || rowsBuiltAsManaged !== isManaged.value || !hasSameNames(rows, parameterRows.value)) {
      setRows(rows)
      if (source === 'init') pruneMissingPortVariables(rows)
    }
  }

  /**
   * Shows a text state in the mounted editor. Text from another editor can't be shown as is, so
   * that editor gets the model instead.
   *
   * @param {{ format: string|null, value: string, layout: Object|null }} textState
   * @param {string} xml - The model matching the text.
   * @returns {Promise<void>|undefined}
   */
  function restoreEditor(textState, xml) {
    const editor = editorRef.value
    if (!editor) return
    if (editor.format === textState.format) return editor.setText(textState.value)
    return editor.setModel?.(xml)
  }

  /**
   * Restores a text state during undo or redo.
   *
   * @param {string} xml
   * @param {{ format: string|null, value: string, layout: Object|null }} textState
   * @param {import('../services/math/analyzeMath').MathAnalysis} textAnalysis
   * @returns {Promise<void>|undefined}
   */
  function applyTextState(xml, textState, textAnalysis) {
    currentModel.value = xml
    currentText.value = textState
    analysis.value = textAnalysis
    pendingRename.value = null
    return restoreEditor(textState, xml)
  }

  /**
   * Records a valid edit as one undo step: the code, the rows it implies, and any port variables
   * it renamed or removed. In Simple Mode a renamed variable keeps its row (see carryRenames).
   *
   * @param {string} newXml
   * @param {{ format: string|null, value: string, layout: Object|null }} newText
   * @param {import('../services/math/analyzeMath').MathAnalysis} newAnalysis
   * @returns {Promise<void>}
   */
  async function handleValidEdit(newXml, newText, newAnalysis) {
    const previousXml = currentModel.value
    const previousText = currentText.value
    const previousAnalysis = analysis.value
    // Only comments or formatting changed, which are saved with the layout.
    if (previousXml === newXml) return recordTextEdit(newText)

    const previousRows = parameterRows.value
    const pending = pendingRename.value
    const carried =
      mode.value === SIMPLE_MODE ? carryRenames(previousAnalysis, newAnalysis, previousRows, { pending }) : null

    const renamedTo = new Map((carried?.portRenames ?? []).map(({ from, to }) => [from, to]))
    // Typed as the ports will be once the renames below reach them.
    const renamedPortVariables = [...portVariables.value].map((name) => renamedTo.get(name) ?? name)
    const newRows = reconcileKeepingRemoved(newAnalysis, carried?.rows ?? previousRows, reconcileOptions(renamedPortVariables))
    const validNames = new Set(newRows.map((row) => row.name))

    history.startBatch()
    try {
      await history.executeAndAddCommand({
        type: 'update-cellml-code',
        undo: async () => applyTextState(previousXml, previousText, previousAnalysis),
        redo: async () => applyTextState(newXml, newText, newAnalysis),
      })

      await history.executeAndAddCommand({
        type: 'update-parameter-rows',
        undo: async () => setRows(previousRows),
        redo: async () => setRows(newRows),
      })

      // A port's multiport types and factors are per variable, so they go and come back with its variables;
      // an undo keeps any multiport change made since.
      const snapshotPort = ({ variables, multiportType, multiplyFactor }) => ({ variables, multiportType, multiplyFactor })

      for (const port of ports.value) {
        if (!Array.isArray(port.variables)) continue
        const previousPort = snapshotPort(port)
        if (!port.variables.some((name) => renamedTo.has(name))) continue

        await history.executeAndAddCommand({
          type: 'rename-variable-in-port',
          undo: async () => {
            restorePortVariables(port, previousPort, (name) => renamedTo.get(name) ?? name)
          },
          redo: async () => {
            // New name to old, the first old name winning when two are renamed alike.
            const previousName = new Map()
            for (const name of port.variables) {
              const newName = renamedTo.get(name) ?? name
              if (!previousName.has(newName)) previousName.set(newName, name)
            }
            setPortVariables(port, [...previousName.keys()], (name) => previousName.get(name))
          },
        })
      }

      for (const port of ports.value) {
        if (!Array.isArray(port.variables)) continue
        const previousPort = snapshotPort(port)
        if (port.variables.every((name) => validNames.has(name))) continue

        await history.executeAndAddCommand({
          type: 'remove-variable-from-port',
          undo: async () => {
            restorePortVariables(port, previousPort)
          },
          redo: async () => {
            setPortVariables(port, port.variables.filter((name) => validNames.has(name)))
          },
        })
      }
    } finally {
      history.endBatch()
    }
    // After the batch, since replaying the code (applyTextState) drops the offer.
    pendingRename.value = carried ? followPendingRename(pending, carried, newAnalysis) : null
  }

  /**
   * Records an edit that leaves the model unchanged (it didn't parse, or changed only comments or
   * formatting), so undo and redo can still replay the text. Another editor restores to the
   * current model.
   *
   * @param {{ format: string|null, value: string, layout: Object|null }} textState
   * @returns {Promise<void>}
   */
  async function recordTextEdit(textState) {
    const previousText = currentText.value
    if (previousText.format === textState.format && previousText.value === textState.value) return

    await history.executeAndAddCommand({
      type: 'update-cellml-text-only',
      undo: async () => {
        currentText.value = previousText
        await restoreEditor(previousText, currentModel.value)
      },
      redo: async () => {
        currentText.value = textState
        await restoreEditor(textState, currentModel.value)
      },
    })
  }

  /**
   * Renames the offered partial rename's remaining uses. The editor reports it as an edit, so it
   * is one undo step and the ports follow.
   *
   * @returns {Promise<void>}
   */
  async function renameEverywhere() {
    await flushPendingChanges()
    const pending = pendingRename.value
    if (!pending || !editorRef.value?.renameVariable) return
    await editorRef.value.renameVariable(pending.from, pending.to)
    await flushPendingChanges()
  }

  /** Keeps both names, dismissing the offered rename. */
  function dismissRename() {
    pendingRename.value = null
  }

  /**
   * Moves values typed into the text (Advanced Mode `{init: …}`) into their rows and out of the
   * model, so only the rows hold values. The text wins, since it is what those rows show.
   */
  function separateTypedValues() {
    const { math, values } = separateParameters(currentModel.value)
    if (math === currentModel.value) return

    const rows = parameterRows.value.map((row) => (values.has(row.name) ? { ...row, value: values.get(row.name) } : row))
    const nextAnalysis = analyzeMathXml(math)
    const options = reconcileOptions()
    currentModel.value = math
    analysis.value = nextAnalysis
    // A value typed on a state now belongs to its new initialiser, which only the values know.
    setRows(reconcileKeepingRemoved(nextAnalysis, rows, { ...options, defaults: values }))
  }

  return {
    // state
    isManaged,
    currentModel,
    currentLayout,
    parameterRows,
    editorDefinitions,
    variableKinds,
    connectionSupplied,
    mathReferences,
    pendingRename,
    // queries
    isMissingUnits,
    isDirty,
    isLayoutDirty,
    hasUnsavedInvalidEdit,
    // actions
    load,
    handleEditorChange,
    flushPendingChanges,
    separateTypedValues,
    renameEverywhere,
    dismissRename,
  }
}
