import { defineStore } from 'pinia'
import { ref, computed, shallowRef, toRaw } from 'vue'

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
  // Depth of withoutHistory calls in progress.
  const suppressedDepth = ref(0)

  // Batching related controls.
  let batchTimer = null
  const eventWaitTime = 25
  const pendingCommands = shallowRef([])

  // Manual batching flag.
  const isManualBatching = ref(false)

  // Where each command was recorded, and how to capture and go back there (see setContextHandlers).
  const contexts = new WeakMap()
  let contextHandlers = null

  // The gate changes pass on their way onto the stack (see setGate), and the change it holds while it decides:
  // `{commands, timer, deciding}`.
  let gate = null
  let held = null

  const canUndo = computed(() => pointer.value >= 0)
  const canRedo = computed(() => pointer.value < stack.value.length - 1)
  const isUndoRedoing = computed(() => working.value || suppressedDepth.value > 0)
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
   *
   * @param {Object} command
   * @param {Object[]} [parts] - The commands it is made of, which the gate hears of.
   */
  function _pushToStack(command, parts = [command]) {
    if (pointer.value < stack.value.length - 1) {
      stack.value = stack.value.slice(0, pointer.value + 1)
    }
    stack.value.push(command)
    pointer.value++
    gate?.recorded?.(parts)
  }

  function lastChangeWasAddSetter(value) {
    lastChangeWasAdd.value = value
  }

  /**
   * Whether `command` is still waiting to be committed, so it can still be changed.
   *
   * @param {Object} command
   * @returns {boolean}
   */
  function isPending(command) {
    return pendingCommands.value.includes(command) || !!held?.commands.includes(command)
  }

  function replaceLastCommand(command) {
    if (pendingCommands.value.length) {
      const replaced = toRaw(pendingCommands.value[pendingCommands.value.length - 1])
      if (contexts.has(replaced)) contexts.set(toRaw(command), contexts.get(replaced))
      pendingCommands.value[pendingCommands.value.length - 1] = command
    }
  }

  /**
   * Makes every command recorded from now on remember where it was made, and undo and redo go back there before
   * applying it, so the change they make is in view: the workspace's canvas level.
   *
   * @param {{capture: () => *, restore: (context: *) => void}|null} handlers - capture gives where things are now;
   *   restore goes back to what capture gave. Null forgets them.
   */
  function setContextHandlers(handlers) {
    contextHandlers = handlers
  }

  /**
   * Has a gate decide on a change before it becomes an undo step. From a command the gate holds, every command
   * recorded, and those not yet committed, join one held change, already made, until it is complete: its manual batch
   * has ended and no command has come for a moment. `decide()` then resolves to 'keep', one undo step; 'discard',
   * undone, leaving no step; or a command to run first, made one step with the change (the change is undone, the
   * command run, and the change redone). `recorded(commands)` hears of every step made, and `cleared()` of a clear.
   *
   * @param {{holds: (command: Object) => boolean, decide: () => Promise<'keep'|'discard'|Object>,
   *   recorded?: (commands: Object[]) => void, cleared?: () => void}|null} next - Null removes it.
   */
  function setGate(next) {
    gate = next
  }

  /**
   * Adds a command to the held change, starting one when the gate holds the command.
   *
   * @param {Object} command
   * @returns {boolean} Whether it is held.
   */
  function hold(command) {
    if (!held && gate?.holds(command)) {
      held = { commands: [...pendingCommands.value], timer: null, deciding: false }
      pendingCommands.value = []
      if (batchTimer) {
        clearTimeout(batchTimer)
        batchTimer = null
      }
    }
    if (!held) return false
    held.commands.push(command)
    scheduleDecision()
    return true
  }

  /** Has the gate decide once the held change is complete: after its manual batch, and a moment with no command. */
  function scheduleDecision() {
    if (!held || held.deciding) return
    if (held.timer) clearTimeout(held.timer)
    held.timer = isManualBatching.value ? null : setTimeout(decideHeld, eventWaitTime)
  }

  /** Runs `fn` as undo and redo do, recording nothing. */
  async function unrecorded(fn) {
    working.value = true
    try {
      await fn()
    } finally {
      working.value = false
    }
  }

  /** Asks the gate about the held change, then keeps it, discards it, or puts its command first. */
  async function decideHeld() {
    const current = held
    current.timer = null
    current.deciding = true
    let decision = 'keep'
    try {
      decision = await gate.decide()
    } catch (error) {
      console.error('The history gate failed to decide; the change is kept.', error)
    }
    // A clear while the gate decided dropped the change.
    if (held !== current) return
    held = null
    const { commands } = current
    if (decision === 'discard') {
      lastChangeWasAdd.value = false
      await unrecorded(async () => {
        for (const command of [...commands].reverse()) await command.undo()
      })
      return
    }
    if (decision && typeof decision === 'object') {
      await unrecorded(async () => {
        for (const command of [...commands].reverse()) await command.undo()
        await decision.redo()
        for (const command of commands) await command.redo()
      })
      if (commands.length) contexts.set(toRaw(decision), contexts.get(toRaw(commands[0])))
      else stamp(decision)
      commands.unshift(decision)
    }
    pendingCommands.value = [...commands, ...pendingCommands.value]
    commitBatch()
  }

  /** Remembers where a command was recorded. The stack holds commands reactive, so they are keyed raw. */
  function stamp(command) {
    const key = toRaw(command)
    if (contextHandlers && !contexts.has(key)) contexts.set(key, contextHandlers.capture())
  }

  /** Goes back to where a command was recorded, without recording. */
  function revisit(command) {
    const key = toRaw(command)
    if (contextHandlers && contexts.has(key)) contextHandlers.restore(contexts.get(key))
  }

  function clear() {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    if (held?.timer) clearTimeout(held.timer)
    held = null
    gate?.cleared?.()
    stack.value = []
    pointer.value = -1
    working.value = false
    lastChangeWasAdd.value = false
    pendingCommands.value = []
    isManualBatching.value = false
  }

  function addCommand(command) {
    if (isUndoRedoing.value) {
      return
    }

    stamp(command)
    if (hold(command)) return
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
    if (held) scheduleDecision()
    else commitBatch()
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
        redo: () => runInOrder(batch, 'redo'),
        undo: () => runInOrder([...batch].reverse(), 'undo'),
      }
      // A batch is one change, made in one place.
      const first = toRaw(batch[0])
      if (contexts.has(first)) contexts.set(superCommand, contexts.get(first))
      _pushToStack(superCommand, batch)
    }
  }

  /**
   * Runs each command's `method` in order, waiting for one that returns a promise before the next. Synchronous
   * commands run synchronously, so a batch of them still applies at once.
   *
   * @param {Object[]} commands
   * @param {'undo'|'redo'} method
   * @returns {Promise<void>|undefined} A promise when a command was asynchronous.
   */
  function runInOrder(commands, method) {
    for (let i = 0; i < commands.length; i++) {
      const result = commands[i][method]()
      if (typeof result?.then === 'function') {
        return Promise.resolve(result).then(() => runInOrder(commands.slice(i + 1), method))
      }
    }
  }

  async function executeAndAddCommand(command) {
    if (suppressedDepth.value > 0) {
      await command.redo()
      return
    }

    stamp(command)
    working.value = true

    try {
      await command.redo()
      // Held, it becomes a step once the gate decides; in a manual batch, it joins the batch.
      if (hold(command)) return
      if (isManualBatching.value) {
        pendingCommands.value.push(command)
      } else {
        _pushToStack(command)
      }
    } finally {
      working.value = false
    }
  }

  /**
   * Runs `fn` without recording: commits pending commands first, then ignores every change and
   * command until `fn` (sync or async) settles. For changes that are not edits, like navigation.
   * Inside a manual batch, an undo or redo, or another withoutHistory, nothing is committed, so a
   * batch still ends as one step.
   *
   * @param {Function} fn
   * @returns {*} What `fn` returns.
   */
  function withoutHistory(fn) {
    if (!isManualBatching.value && !isUndoRedoing.value) commitBatch()
    lastChangeWasAdd.value = false
    suppressedDepth.value++

    const restore = () => {
      suppressedDepth.value--
    }
    let result
    try {
      result = fn()
    } catch (error) {
      restore()
      throw error
    }
    if (typeof result?.then === 'function') {
      return Promise.resolve(result).finally(restore)
    }
    restore()
    return result
  }

  async function undo() {
    // A held change, already made, is undone only by the gate's decision; a step still being made, undone or redone
    // finishes first, so an asynchronous one is never interleaved with another.
    if (!canUndo.value || held || working.value) {
      return
    }
    working.value = true
    try {
      const command = stack.value[pointer.value]
      pointer.value--
      revisit(command)
      await command.undo()
    } finally {
      working.value = false
    }
  }

  async function redo() {
    if (!canRedo.value || held || working.value) {
      return
    }

    working.value = true
    try {
      pointer.value++
      const command = stack.value[pointer.value]
      revisit(command)
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
    isPending,
    isUndoRedoing,
    lastChangeWasAdd,
    lastChangeWasAddSetter,
    lastCommandHadOffsetApplied,
    pointerIndex,
    redo,
    replaceLastCommand,
    setContextHandlers,
    setGate,
    startBatch,
    undo,
    withoutHistory,
  }
}

export const useFlowHistoryStore = defineStore('flowHistory', createHistory)
