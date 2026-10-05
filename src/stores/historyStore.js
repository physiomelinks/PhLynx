import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'

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
  const lastChangeWasAdd = ref(false)

  // Batching related controls.
  let batchTimer = null
  const eventWaitTime = 25
  const pendingCommands = shallowRef([])

  // Manual batching flag.
  const isManualBatching = ref(false)

  const canUndo = computed(() => pointer.value >= 0)
  const canRedo = computed(() => pointer.value < stack.value.length - 1)
  const isUndoRedoing = computed(() => working.value)
  const pointerIndex = computed(() => pointer.value)
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
    working.value = false
    lastChangeWasAdd.value = false
    pendingCommands.value = []
    isManualBatching.value = false
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
   * Disables the auto-timer and holds all subsequent commands in pendingCommands.
   */
  function startBatch() {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    isManualBatching.value = true
  }

  /**
   * End a manual transaction.
   * Forces a commit of all pending commands into a single history step.
   */
  function endBatch() {
    isManualBatching.value = false
    commitBatch()
  }

  function commitBatch() {
    if (pendingCommands.value.length === 0) return

    const batch = [...pendingCommands.value]

    // Clear pending commands.
    pendingCommands.value = []
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }

    if (batch.length === 1) {
      _pushToStack(batch[0])
    } else {
      const superCommand = {
        type: 'super',
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
    try {
      const command = stack.value[pointer.value]
      pointer.value--
      await command.undo()
    } finally {
      working.value = false
    }
  }

  async function redo() {
    if (!canRedo.value) {
      return
    }

    working.value = true
    try {
      pointer.value++
      const command = stack.value[pointer.value]
      await command.redo()
    } finally {
      working.value = false
    }
  }

  return {
    addCommand,
    canRedo,
    canUndo,
    clear,
    endBatch,
    executeAndAddCommand,
    isUndoRedoing,
    lastChangeWasAdd,
    lastChangeWasAddSetter,
    lastCommandHadOffsetApplied,
    pointerIndex,
    redo,
    replaceLastCommand,
    startBatch,
    undo,
  }
}

export const useFlowHistoryStore = defineStore('flowHistory', createHistory)
