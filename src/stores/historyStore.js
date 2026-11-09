import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'

/** How each kind of undo step reads in a notice, by its command type. */
export const STEP_LABELS = {
  add: 'Add module',
  remove: 'Delete',
  move: 'Move in diagram',
  resize: 'Resize',
  'add-edge': 'Connect',
  'remove-edge': 'Disconnect',
  'replace-edge': 'Connect',
  'edit-connection': 'Edit connection',
  'edit-instance': 'Edit module',
  'edit-parameters': 'Edit parameters',
  'edit-global-constant': 'Edit constant',
  'rename-node': 'Rename module',
  'replace-module': 'Replace module',
  'remove-module': 'Remove library module',
  'remove-handle': 'Remove handle',
  'set-node-category': 'Set category',
  'apply-slider': 'Slider value',
  'apply-parameter-set': 'Apply parameter set',
  'edge-route': 'Route connection',
  'clear-workspace': 'Clear workspace',
  'update-cellml-code': 'Edit maths',
  'update-cellml-text-only': 'Edit maths',
  'bio-layout': 'Move',
  'bio-add': 'Add module',
  'bio-bind': 'Place on template',
  'bio-role': 'Show As',
  'bio-glyph': 'Cartoon',
  'bio-adjacent': 'Lies Against',
  'bio-take-out': 'Take out of membrane',
  'bio-unbind': 'Unbind',
  'bio-reset': 'Reset to annotations',
  'bio-relayout': 'Re-layout physiology',
  'bio-template-add': 'Add template',
  'bio-template-move': 'Move template',
  'bio-template-rename': 'Rename template',
  'bio-template-add-piece': 'Add to template',
  'bio-template-remove-piece': 'Remove from template',
  'bio-template-restore': 'Restore template elements',
  'bio-template-relayout': 'Re-layout template',
  'bio-template-remove': 'Delete template',
}

/** Types that only go along with an edit, so never name a batch. */
const INCIDENTAL_TYPES = new Set(['select', 'resize', 'update-name'])

/**
 * Names an undo step: its own type's label, else, for a batch, the last labelled type in it that isn't incidental.
 *
 * @param {Object|undefined} command - A stack entry.
 * @returns {string|null} Null for no step.
 */
export function stepLabel(command) {
  if (!command) return null
  if (STEP_LABELS[command.type]) return STEP_LABELS[command.type]
  const named = (command.types ?? []).filter((type) => STEP_LABELS[type] && !INCIDENTAL_TYPES.has(type))
  return STEP_LABELS[named.at(-1)] ?? 'Edit'
}

/**
 * Creates an undo/redo command stack with batching. The workspace shares one (useFlowHistoryStore);
 * an editor can make its own.
 *
 * @returns {Object} The stack's state and actions.
 */
export function createHistory() {
  // Command stack and pointer.
  const stack = ref([])
  const pointer = ref(-1)
  const working = ref(false)
  // Only an undo or redo: working is also set while a new command first runs.
  const replaying = ref(false)
  const lastChangeWasAdd = ref(false)
  // The step the workspace was last saved or loaded at; null before any step.
  const savedStep = shallowRef(null)

  // Batching related controls.
  let batchTimer = null
  const eventWaitTime = 25
  const pendingCommands = shallowRef([])

  // Manual batching flag, and how many commands were pending when it started (only a nested batch finds any).
  const isManualBatching = ref(false)
  let batchStart = 0

  const canUndo = computed(() => pointer.value >= 0)
  const canRedo = computed(() => pointer.value < stack.value.length - 1)
  const isUndoRedoing = computed(() => working.value)
  /** Whether an undo or a redo is running, unlike isUndoRedoing never a new command. */
  const isReplaying = computed(() => replaying.value)
  const pointerIndex = computed(() => pointer.value)
  /** Whether the history stands where the workspace was last saved or loaded. */
  const isAtSaved = computed(() => (stack.value[pointer.value] ?? null) === savedStep.value)
  /** What an undo or a redo would take back or do again, for a notice. */
  const undoLabel = computed(() => (canUndo.value ? stepLabel(stack.value[pointer.value]) : null))
  const redoLabel = computed(() => (canRedo.value ? stepLabel(stack.value[pointer.value + 1]) : null))
  const lastCommandHadOffsetApplied = computed(() => {
    if (pendingCommands.value.length) {
      const cmd = pendingCommands.value[pendingCommands.value.length - 1]
      return cmd.offset === 'applied'
    }

    return false
  })

  /**
   * Internal helper to handle stack slicing and pointer.
   */
  function _pushToStack(command) {
    if (pointer.value < stack.value.length - 1) {
      stack.value = stack.value.slice(0, pointer.value + 1)
    }
    stack.value.push(command)
    pointer.value++
  }

  function lastChangeWasAddSetter(value) {
    lastChangeWasAdd.value = value
  }

  function replaceLastCommand(command) {
    if (pendingCommands.value.length) {
      pendingCommands.value[pendingCommands.value.length - 1] = command
    }
  }

  function clear() {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    stack.value = []
    pointer.value = -1
    working.value = replaying.value = false
    lastChangeWasAdd.value = false
    pendingCommands.value = []
    isManualBatching.value = false
    batchStart = 0
    savedStep.value = null
  }

  /** Marks where the history stands as saved, first committing any steps still batching on their timer. */
  function markSaved() {
    if (!isManualBatching.value) commitBatch()
    savedStep.value = stack.value[pointer.value] ?? null
  }

  function addCommand(command) {
    if (working.value) {
      return
    }

    pendingCommands.value.push(command)

    if (isManualBatching.value) {
      return
    }

    if (batchTimer) clearTimeout(batchTimer)

    batchTimer = setTimeout(() => {
      commitBatch()
    }, eventWaitTime)
  }
  /**
   * Start a manual transaction.
   * Disables the auto-timer and holds all subsequent commands in pendingCommands. Commands still waiting on the
   * timer are committed first as their own step, so the batch neither absorbs nor rolls them back.
   */
  function startBatch() {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    if (!isManualBatching.value) commitBatch()
    batchStart = pendingCommands.value.length
    isManualBatching.value = true
  }

  /**
   * End a manual transaction.
   * Forces a commit of all pending commands into a single history step.
   *
   * @param {string} [type] - Names the step, when it is more than its last command.
   */
  function endBatch(type) {
    isManualBatching.value = false
    commitBatch(type)
  }

  /**
   * Ends a manual transaction by taking back everything done in it, so it leaves no step. Commands pending from
   * before it started are kept and committed as they would have been.
   *
   * @returns {Promise<void>}
   */
  async function rollbackBatch() {
    const batch = pendingCommands.value.slice(batchStart)
    pendingCommands.value = pendingCommands.value.slice(0, batchStart)
    isManualBatching.value = false
    working.value = true
    try {
      for (const command of batch.reverse()) await command.undo()
    } finally {
      working.value = false
    }
    commitBatch()
  }

  function commitBatch(type) {
    if (pendingCommands.value.length === 0) return

    const batch = [...pendingCommands.value]

    // Clear pending commands.
    pendingCommands.value = []
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }

    if (batch.length === 1 && !type) {
      _pushToStack(batch[0])
    } else {
      const superCommand = {
        type: type ?? 'super',
        types: batch.flatMap((cmd) => cmd.types ?? [cmd.type]),
        redo: () => {
          batch.forEach((cmd) => cmd.redo())
        },
        undo: () => {
          ;[...batch].reverse().forEach((cmd) => cmd.undo())
        },
      }
      _pushToStack(superCommand)
    }
  }

  async function executeAndAddCommand(command) {
    working.value = true

    try {
      await command.redo()
      // If manual batching is active, capture this explicit execution too
      if (isManualBatching.value) {
        pendingCommands.value.push(command)
      } else {
        _pushToStack(command)
      }
    } finally {
      working.value = false
    }
  }

  async function undo() {
    if (!canUndo.value) {
      return
    }
    working.value = true
    replaying.value = true
    try {
      const command = stack.value[pointer.value]
      pointer.value--
      await command.undo()
    } finally {
      working.value = replaying.value = false
    }
  }

  async function redo() {
    if (!canRedo.value) {
      return
    }

    working.value = true
    replaying.value = true
    try {
      pointer.value++
      const command = stack.value[pointer.value]
      await command.redo()
    } finally {
      working.value = replaying.value = false
    }
  }

  return {
    addCommand,
    canRedo,
    canUndo,
    clear,
    endBatch,
    executeAndAddCommand,
    isAtSaved,
    isReplaying,
    isUndoRedoing,
    lastChangeWasAdd,
    lastChangeWasAddSetter,
    lastCommandHadOffsetApplied,
    markSaved,
    pointerIndex,
    redo,
    redoLabel,
    replaceLastCommand,
    rollbackBatch,
    startBatch,
    undo,
    undoLabel,
  }
}

export const useFlowHistoryStore = defineStore('flowHistory', createHistory)
