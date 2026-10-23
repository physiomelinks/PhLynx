/**
 * The one CellDL editor PhLynx mounts. The editor works as a singleton (fixed element ids, and window and
 * document listeners it never removes), so CelldlEditorHost mounts it once, on first request, and keeps it:
 * a pane claims it to show it, and it is parked off screen between claims rather than recreated.
 *
 * Commands go to the editor through its `editorCommand` prop, which it watches by reference, so each is a
 * new object.
 */
import { computed, nextTick, ref, shallowRef, watch } from 'vue'

import { chooseOpenView, lastView, rememberView } from '../utils/celldlView.js'

/** How long to wait for the editor to mount, and to answer a command. */
const READY_TIMEOUT_MS = 30000
const COMMAND_TIMEOUT_MS = 10000

/**
 * The editor's options: hovering an element shows its annotation's tooltip, the variables it has, and its element
 * list follows every diagram change, for the Parameters tab.
 */
export const EDITOR_OPTIONS = Object.freeze({ tooltip: 'tooltip', elementList: true })

/**
 * The editor's chrome: the chemical element palette above the canvas places elements, as right-click "Add element…"
 * does, and bonds are drawn by dragging from a hovered element, so the left toolbar shows no tools: an empty list
 * (not `false`, which hides the toolbar) keeps its Undo and Redo buttons. No pointer-position readout. The
 * Properties panel shows values read-only: they're set per instance, in the Parameters tab. The right-hand panels
 * are listed so the Variables and Annotations panels stay hidden when the editor adds them.
 */
export const EDITOR_CHROME = Object.freeze({
  tools: Object.freeze([]),
  palette: 'top',
  paletteDomain: 'chemical',
  statusPosition: false,
  values: 'readonly',
  valuesHint: 'Set values in the Parameters tab',
  panels: Object.freeze(['properties', 'metadata', 'style', 'reactions']),
})

/** The class marking a diagram element a conversion failed on. */
export const ERROR_CLASS = 'phlynx-celldl-error'
/** The softer class marking an element the live conversion has an issue with, as diagrams mid-edit often do. */
export const LIVE_ISSUE_CLASS = 'phlynx-celldl-issue'

/** The editor's message for a document it can't open: its name, which is the module's minted IRI, then why. */
const OPEN_ERROR = /^Cannot open \S+ -- invalid CellDL file\?\s*([\s\S]*)$/

/**
 * Says what the editor's error means for the module, without the IRI the module's diagram is read under.
 *
 * @param {string} message - e.g. `Cannot open https://…/rc.celldl -- invalid CellDL file?\n\nTypeError: …`.
 * @returns {string}
 */
export function describeEditorError(message) {
  const match = OPEN_ERROR.exec(message)
  if (!match) return message
  const reason = match[1].trim()
  return `The CellDL editor can't open this module's diagram${reason ? ` (${reason})` : ''}. Its CellML still runs.`
}

/** The diagram's own objects, which a blank diagram has none of. */
const OBJECT_SELECTOR = ['Annotation', 'Component', 'Connector', 'Connection', 'Conduit', 'Compartment', 'InterfacePort']
  .map((name) => `.celldl-${name}`)
  .join(', ')

/** The keys the editor handles on the window: undo and redo, deleting, and cancelling a path. */
const GATED_KEYS = new Set(['Backspace', 'Delete', 'Escape'])

/**
 * Checks whether a key is one the editor acts on wherever focus is.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isEditorKey(event) {
  if (GATED_KEYS.has(event.key)) return true
  const key = event.key?.toLowerCase()
  return !!(event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')
}

/**
 * Creates a host's state. The app uses the one useCelldlEditorHost returns; tests make their own.
 *
 * @param {Object} [options]
 * @param {number} [options.readyTimeout]
 * @param {number} [options.commandTimeout]
 */
export function createCelldlEditorHost({ readyTimeout = READY_TIMEOUT_MS, commandTimeout = COMMAND_TIMEOUT_MS } = {}) {
  /** Whether a pane has asked for the editor, which mounts the host. */
  const isRequested = ref(false)
  /** The claiming pane's element, or null while parked. */
  const target = shallowRef(null)
  const isActive = computed(() => target.value !== null)
  const command = shallowRef(null)
  const isReady = ref(false)
  /**
   * Whether the diagram was edited since it was opened or marked clean. A hint, as the editor reports any change but
   * not an undo or redo, except for a diagram opened blank: that is edited while it has anything on it.
   */
  const isDirty = ref(false)
  /** The editor's last error, e.g. a document it couldn't open. */
  const error = ref('')
  /**
   * Whether the user is working in the claiming pane: the last pointer press or focus landed in it. The editor
   * takes no focus of its own, so a press counts until focus moves elsewhere.
   */
  const isEngaged = ref(false)
  /** Whether the editor is opening a source, so still shows the one before. */
  const isSyncing = ref(false)
  /** The shown source's elements as the editor's annotations, by SVG id: their variables, primary one and tooltip. */
  const annotations = shallowRef({})
  /** The shown diagram's bond-graph elements, as the editor lists them (its `elements` emit); empty while opening. */
  const elements = shallowRef([])
  /** The diagram revision `elements` was listed at, or -1 before any list. */
  const elementsRevision = ref(-1)
  /** The element selected in the diagram, as its viewer events tell, and whether the host selected it. */
  const selection = shallowRef({ id: null, isHostSelection: false })

  let root = null
  let readyWaiters = []
  // The source the dialog last asked for, and the one the editor shows.
  let wanted = null
  let shown = null
  let baseline = null
  let isOpening = false
  // Whether the shown diagram was opened blank and not saved since.
  let isOpenedBlank = false
  let contentObserver = null
  let commandCount = 0
  const pendingData = new Map()
  // `element` commands waiting for their reply, by kind: `list` for `elements`, `set` and `select` for `element-result`.
  const pendingElements = new Map()
  const pendingResults = new Map()
  // `view` commands waiting for their `view-state` reply, by kind.
  const pendingViews = new Map()
  // The documentUri the shown diagram's view is remembered under, once it has opened.
  let viewKey = null
  // Whether a pane next claiming the editor sets the view a diagram opens at, for a source shown already.
  let isViewDue = false
  // The element the host last selected, whose `select` event the pane is told about as the host's own.
  let hostSelection = null
  // The claiming pane's handler for the editor's viewer events (select, unselect, active, unactive).
  let eventHandler = null
  let annotationCount = 0
  // Serialisations under way, which live marks must stay out of.
  let serialising = 0
  // Who hears the diagram as it changes or opens (onChange).
  const changeListeners = new Set()

  const svgOf = () => root?.querySelector('#svg-container > svg') ?? null

  /**
   * Records the source the editor shows, and annotates its elements. A source's elements are those it was saved
   * with, so an element added since has no annotation.
   *
   * @param {{source: Object|null}|null} request
   */
  function setShown(request) {
    shown = request
    const elements = request?.source?.elements
    const count = ++annotationCount
    if (!elements || !Object.keys(elements).length) {
      annotations.value = {}
      return
    }
    import('@physiomelinks/bg2cellml').then(
      ({ toViewerAnnotations }) => {
        if (count === annotationCount) annotations.value = toViewerAnnotations(elements)
      },
      (e) => console.error('CellDL annotations failed:', e)
    )
  }

  /**
   * Waits until a test passes, checking it as the editor's root changes or it reports an error.
   *
   * @param {() => boolean} isDone
   * @param {number} timeout
   * @param {string} what - Named in the timeout's error.
   * @returns {Promise<void>}
   */
  function waitFor(isDone, timeout, what) {
    if (isDone()) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const check = () => {
        if (!isDone()) return
        finish()
        resolve()
      }
      const observer = new MutationObserver(check)
      const stopWatching = watch(error, check, { flush: 'sync' })
      const timer = setTimeout(() => {
        finish()
        reject(new Error(`The CellDL editor didn't ${what} in time`))
      }, timeout)
      const finish = () => {
        observer.disconnect()
        stopWatching()
        clearTimeout(timer)
      }
      observer.observe(root, { childList: true, subtree: true })
    })
  }

  /**
   * Resolves once the editor has mounted and drawn its first, blank diagram. It mounts in a timeout after its
   * component does, so its component mounting isn't enough.
   *
   * @returns {Promise<void>}
   */
  function whenReady() {
    if (isReady.value) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        readyWaiters = readyWaiters.filter((waiter) => waiter.resolve !== done)
        reject(new Error("The CellDL editor didn't start in time"))
      }, readyTimeout)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      readyWaiters.push({ resolve: done })
    })
  }

  /**
   * Records the host's root element, once mounted, and watches it for the editor's diagram.
   *
   * @param {HTMLElement} element
   */
  function attach(element) {
    root = element
    contentObserver?.disconnect()
    contentObserver = new MutationObserver(checkBlankEdits)
    contentObserver.observe(root, { childList: true, subtree: true })
    waitFor(() => svgOf() !== null, readyTimeout, 'start').then(
      () => {
        isReady.value = true
        readyWaiters.forEach((waiter) => waiter.resolve())
        readyWaiters = []
      },
      (e) => (error.value = e.message)
    )
  }

  // Commands sent in one tick would reach the editor's watcher as only the last, so each after the first waits a tick.
  const queued = []
  let isSending = false

  function send(next) {
    if (isSending) return queued.push(next)
    isSending = true
    command.value = next
    nextTick(sendQueued)
  }

  function sendQueued() {
    if (!queued.length) {
      isSending = false
      return
    }
    command.value = queued.shift()
    nextTick(sendQueued)
  }

  /**
   * Sends a command whose reply comes back carrying its `kind`, and waits for that reply.
   *
   * @param {Map<string, Function>} pending - Where the reply's handler finds the waiter.
   * @param {(kind: string) => Object} make - Makes the command for a kind.
   * @param {string} what - Named in the timeout's error.
   * @returns {Promise<any>}
   */
  function sendAwaiting(pending, make, what) {
    const kind = `phlynx-${++commandCount}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(kind)
        reject(new Error(`The CellDL editor didn't ${what} in time`))
      }, commandTimeout)
      pending.set(kind, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      send(make(kind))
    })
  }

  /**
   * Asks the editor for its diagram in one of its formats.
   *
   * @param {'data'|'rdf'} action - `data` for the CellDL document, `rdf` for its BG-RDF Turtle.
   * @returns {Promise<string>}
   */
  function request(action) {
    return sendAwaiting(pendingData, (kind) => ({ command: 'file', options: { action, kind } }), 'return its diagram')
  }

  /**
   * Asks the editor for the diagram's elements, which also become `elements`.
   *
   * @returns {Promise<Object[]>} Its DiagramElements.
   */
  async function listElements() {
    await whenReady()
    const change = await sendAwaiting(
      pendingElements,
      (kind) => ({ command: 'element', options: { action: 'list', kind } }),
      'list its elements'
    )
    return change.elements
  }

  /**
   * Edits elements' fields in the diagram, as one undoable step; the editor then reports the change as any edit.
   *
   * @param {{id: string, field: string, value: string}[]} edits - Its ElementEdits.
   * @returns {Promise<{ok: boolean, errors?: {id: string, field: string, message: string}[]}>}
   */
  async function setElement(edits) {
    await whenReady()
    const { kind, ...result } = await sendAwaiting(
      pendingResults,
      (kind) => ({ command: 'element', options: { action: 'set', kind, edits } }),
      'edit the diagram'
    )
    return result
  }

  /**
   * Selects one element in the diagram, or none, panning to it if asked. Its `select` event reaches the pane marked
   * as the host's own (`isHostSelection`).
   *
   * @param {string|null} id
   * @param {boolean|'if-hidden'} [centre]
   * @returns {Promise<{ok: boolean}>}
   */
  async function selectElement(id, centre = false) {
    await whenReady()
    hostSelection = id
    try {
      const { kind, ...result } = await sendAwaiting(
        pendingResults,
        (kind) => ({ command: 'element', options: { action: 'select', kind, id, centre } }),
        'select the element'
      )
      return result
    } finally {
      // The editor emits its select before it replies.
      if (hostSelection === id) hostSelection = null
    }
  }

  /**
   * Takes the editor's `elements` emit: a reply to a list, or the list after a diagram change. A list made while a
   * source opens is the old diagram's, so is dropped.
   *
   * @param {{kind?: string, revision: number, elements: Object[]}} change
   */
  function onElements(change) {
    const resolve = change?.kind && pendingElements.get(change.kind)
    if (resolve) {
      pendingElements.delete(change.kind)
      resolve(change)
    }
    if (!Array.isArray(change?.elements) || isOpening) return
    elements.value = change.elements
    elementsRevision.value = change.revision ?? -1
  }

  /**
   * Passes on the editor's `element-result` event to the `set` or `select` it answers.
   *
   * @param {{kind?: string, ok: boolean, errors?: Object[]}} result
   */
  function onElementResult(result) {
    const resolve = result?.kind && pendingResults.get(result.kind)
    if (!resolve) return
    pendingResults.delete(result.kind)
    resolve(result)
  }

  /**
   * Gets the diagram as CellDL. The editor deselects everything to serialise it.
   *
   * @returns {Promise<string>}
   */
  async function serialise() {
    await whenReady()
    clearHighlights()
    serialising += 1
    try {
      return await request('data')
    } finally {
      serialising -= 1
    }
  }

  /**
   * Gets the diagram's BG-RDF Turtle, which, unlike serialising, leaves the selection alone.
   *
   * @returns {Promise<string>}
   */
  async function readRdf() {
    await whenReady()
    return request('rdf')
  }

  /**
   * Marks the diagram's elements a conversion has issues with, until the diagram is next serialised or opened, or
   * marked again.
   *
   * @param {string[]} ids - Their SVG ids.
   * @param {Object} [options]
   * @param {boolean} [options.isLive] - The issues are the live conversion's: marked more softly, never while the
   *   diagram is being serialised, and leaving a save's marks alone.
   */
  function highlight(ids, { isLive = false } = {}) {
    if (isLive && serialising) return
    clearHighlights(isLive ? [LIVE_ISSUE_CLASS] : undefined)
    const svg = svgOf()
    const className = isLive ? LIVE_ISSUE_CLASS : ERROR_CLASS
    ids.forEach((id) => svg?.getElementById(id)?.classList.add(className))
  }

  /**
   * Clears highlight's marks, which must never be saved with the diagram.
   *
   * @param {string[]} [classNames] - The marks to clear; all by default.
   */
  function clearHighlights(classNames = [ERROR_CLASS, LIVE_ISSUE_CLASS]) {
    for (const className of classNames) {
      root?.querySelectorAll(`.${className}`).forEach((element) => element.classList.remove(className))
    }
  }

  /**
   * Annotates the diagram's elements as the live conversion found them, so an element added since the save shows
   * its variables too. Opening a source annotates it as saved again.
   *
   * @param {Object} next - Viewer annotations by SVG id (bg2cellml's toViewerAnnotations).
   */
  function setLiveAnnotations(next) {
    annotationCount += 1
    annotations.value = next
  }

  /**
   * Hears the diagram as it changes, as a source starts opening (`rdf` null: the diagram heard so far is going), and
   * once it has opened.
   *
   * @param {(change: {rdf: string|null, documentUri: string|null, isOpened: boolean}) => void} listener
   * @returns {() => void} Stops listening.
   */
  function onChange(listener) {
    changeListeners.add(listener)
    return () => changeListeners.delete(listener)
  }

  function notifyChange(rdf, isOpened) {
    if (rdf === null) {
      elements.value = []
      elementsRevision.value = -1
      selection.value = { id: null, isHostSelection: false }
    }
    const change = { rdf, documentUri: shown?.source?.documentUri ?? null, isOpened }
    changeListeners.forEach((listener) => listener(change))
  }

  /**
   * Passes on the editor's `diagram-changed` emit while a pane holds the editor. Opening a source emits none.
   *
   * @param {{revision: number, rdf: string}} change
   */
  function onDiagramChanged(change) {
    if (isActive.value && !isOpening && typeof change?.rdf === 'string') notifyChange(change.rdf, false)
  }

  /** Lists the opened source's elements, and tells the listeners which diagram it opened as. */
  function announceOpened() {
    listElements().catch((e) => console.error("CellDL diagram's elements couldn't be listed:", e))
    if (!changeListeners.size) return
    readRdf().then(
      (rdf) => notifyChange(rdf, true),
      (e) => console.error("CellDL diagram's RDF couldn't be read:", e)
    )
  }

  /**
   * Passes on the editor's `editor-data` event.
   *
   * @param {{data: string, kind?: string}} payload
   */
  function onEditorData({ data, kind } = {}) {
    const resolve = pendingData.get(kind)
    if (!resolve) return
    pendingData.delete(kind)
    resolve(data ?? '')
  }

  /**
   * Passes on the editor's `editor-state` event, which carries its errors.
   *
   * @param {{error?: string}} state
   */
  function onEditorState(state) {
    error.value = describeEditorError(state?.error ?? '')
  }

  /**
   * Shows a source in the editor: its document, read under its documentUri, or a blank diagram for none. Rejects
   * with the editor's error for a document it can't open.
   *
   * @param {{document: string|null, documentUri: string}|null} source
   * @returns {Promise<void>}
   */
  async function open(source) {
    await whenReady()
    isOpening = true
    isViewDue = false
    viewKey = null
    error.value = ''
    try {
      const previous = svgOf()
      send(
        source?.document
          ? { command: 'file', options: { action: 'open', data: source.document, name: source.documentUri } }
          : { command: 'file', options: { action: 'close' } }
      )
      await waitFor(() => svgOf() !== previous || error.value !== '', commandTimeout, 'open the diagram')
      if (error.value) throw new Error(error.value)
      // The editor finishes setting the diagram up a tick after drawing it, and may flag it edited as it does.
      await new Promise((resolve) => setTimeout(resolve, 0))
      baseline = await serialise()
      isOpenedBlank = !source?.document
      isDirty.value = false
      await setOpenView(source?.documentUri ?? null)
    } finally {
      isOpening = false
    }
  }

  /**
   * Sets the view a diagram opens at (chooseOpenView), and remembers its view under its documentUri from then on.
   * An editor that doesn't report its view keeps its own.
   *
   * @param {string|null} key - The source's documentUri.
   * @returns {Promise<void>}
   */
  async function setOpenView(key) {
    viewKey = null
    const view = (options) =>
      sendAwaiting(pendingViews, (kind) => ({ command: 'view', options: { ...options, kind } }), 'set its view')
    try {
      const state = await view({})
      await view(chooseOpenView(state, lastView(key)))
    } catch (e) {
      console.warn("CellDL diagram's view couldn't be set:", e)
    }
    viewKey = key
  }

  /**
   * Takes the editor's `view-state` emit: a reply to a `view` command, or the view after the user pans or zooms,
   * remembered for the shown diagram while a pane holds it.
   *
   * @param {{kind?: string, scale: number, centre: {x: number, y: number}}} state
   */
  function onViewState(state) {
    const resolve = state?.kind && pendingViews.get(state.kind)
    if (resolve) {
      pendingViews.delete(state.kind)
      resolve(state)
    } else if (!state?.kind && !isOpening && isActive.value) {
      rememberView(viewKey, state)
    }
  }

  let syncing = null

  /**
   * Asks for a source to be shown: now if a pane holds the editor, e.g. a dialog reloading after a save, or else
   * the next time a pane claims it.
   *
   * @param {Object|null} source
   */
  function prepare(source) {
    // The editor already shows an unedited source, e.g. the one just saved.
    const isShown = !!shown && !isDirty.value && isSameSource(shown.source, source)
    wanted = { source }
    // Its elements may be newer, e.g. a stored source saved since. Shown again in a pane, rather than reloaded in
    // one after a save, it opens at its opening view, as if opened anew.
    if (isShown) setShown(wanted)
    isViewDue = isShown && !isActive.value
    isDirty.value = false
    if (isActive.value) sync().catch((e) => (error.value = e.message))
  }

  /**
   * Opens the wanted source, unless the editor already shows it.
   *
   * @returns {Promise<void>}
   */
  async function sync() {
    isSyncing.value = true
    try {
      while (wanted && shown !== wanted) {
        const request = wanted
        // A source that failed leaves the editor's diagram unknown, so the next sync opens it again.
        if (!syncing) notifyChange(null, false)
        syncing ??= open(request.source)
          .then(
            () => {
              setShown(request)
              announceOpened()
            },
            (e) => {
              setShown(null)
              throw e
            }
          )
          .finally(() => (syncing = null))
        await syncing
      }
      if (isViewDue && shown === wanted) {
        isViewDue = false
        await setOpenView(shown.source?.documentUri ?? null)
      }
    } finally {
      isSyncing.value = !!syncing
    }
  }

  /** Marks the diagram saved, in the editor's undo history too. */
  function markClean() {
    send({ command: 'edit', options: { action: 'clean' } })
    isDirty.value = false
  }

  /**
   * Marks the diagram saved as a source, so a dialog reloading after the save keeps it rather than opening it again.
   *
   * @param {{document: string, documentUri: string}} source - The source saved, its document as serialised.
   */
  function markSaved(source) {
    markClean()
    isOpenedBlank = false
    baseline = source.document
    wanted = { source }
    setShown(wanted)
  }

  /**
   * Checks whether the diagram differs from the one opened, by its serialisation.
   *
   * @returns {Promise<{isChanged: boolean, document: string}>}
   */
  async function compareWithBaseline() {
    const document = await serialise()
    return { isChanged: document !== baseline, document }
  }

  /**
   * Shows the editor in a pane, mounting it on first use.
   *
   * @param {HTMLElement} element
   * @param {(event: {type: string, component?: {id: string, annotation?: Object}}) => void} [onEvent] - Hears
   *   the editor's viewer events while the pane holds it.
   */
  function claim(element, onEvent = null) {
    isRequested.value = true
    isEngaged.value = false
    target.value = element
    eventHandler = onEvent
  }

  /**
   * Parks the editor again, if the pane still holds it. The diagram is kept, never closed.
   *
   * @param {HTMLElement} element
   */
  function release(element) {
    if (target.value !== element) return
    target.value = null
    isEngaged.value = false
    eventHandler = null
  }

  /**
   * Passes on the editor's viewer `event` to the claiming pane.
   *
   * @param {Object} event
   */
  function onViewerEvent(event) {
    const id = event?.component?.id ?? null
    const isOwn = event?.type === 'select' && hostSelection !== null && id === hostSelection
    if (isOwn) hostSelection = null
    if (event?.type === 'select' && id) selection.value = { id, isHostSelection: isOwn }
    else if (event?.type === 'unselect' && id === selection.value.id) selection.value = { id: null, isHostSelection: false }
    eventHandler?.(isOwn ? { ...event, isHostSelection: true } : event)
  }

  function onFileEdited() {
    if (isActive.value && !isOpening) isDirty.value = !isOpenedBlank || hasObjects()
  }

  /** Whether the diagram has anything on it. */
  const hasObjects = () => !!svgOf()?.querySelector(OBJECT_SELECTOR)

  /**
   * Follows a diagram opened blank through undo and redo, which the editor doesn't report as edits. Its objects
   * are added and removed as elements, which the host watches for.
   */
  function checkBlankEdits() {
    if (isOpenedBlank && isActive.value && !isOpening) isDirty.value = hasObjects()
  }

  /**
   * Follows where the user works: a pointer press or focus inside the claiming pane engages it, anywhere else
   * disengages it. A context menu, which the editor opens on the body, belongs to wherever it was opened.
   *
   * @param {Event} event
   */
  function onPointerOrFocus(event) {
    if (event.target?.closest?.('.p-contextmenu')) return
    isEngaged.value = !!target.value?.contains(event.target)
  }

  /**
   * Stops the editor's keys reaching its window listeners unless the user works in the claiming pane, so a parked
   * editor never undoes or deletes. It listens on the document, which the window hears after, and leaves the
   * event to every other listener there; PhLynx's own shortcuts listen on the document, or on the window for keys
   * the gate passes.
   *
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    if (isEditorKey(event) && !isEngaged.value) event.stopPropagation()
  }

  /** Listens for the editor's edits, and gates its keys. The host listens while it is mounted. */
  function listen() {
    document.addEventListener('file-edited', onFileEdited)
    document.addEventListener('pointerdown', onPointerOrFocus, true)
    document.addEventListener('focusin', onPointerOrFocus)
    document.addEventListener('keydown', onKeyDown)
  }

  function unlisten() {
    contentObserver?.disconnect()
    contentObserver = null
    document.removeEventListener('file-edited', onFileEdited)
    document.removeEventListener('pointerdown', onPointerOrFocus, true)
    document.removeEventListener('focusin', onPointerOrFocus)
    document.removeEventListener('keydown', onKeyDown)
  }

  return {
    isRequested,
    target,
    isActive,
    command,
    isReady,
    isDirty,
    error,
    isEngaged,
    isSyncing,
    annotations,
    elements,
    elementsRevision,
    selection,
    attach,
    whenReady,
    open,
    prepare,
    sync,
    serialise,
    readRdf,
    compareWithBaseline,
    markClean,
    markSaved,
    highlight,
    setLiveAnnotations,
    onChange,
    claim,
    release,
    onEditorData,
    onEditorState,
    onViewerEvent,
    onDiagramChanged,
    onElements,
    onElementResult,
    onViewState,
    listElements,
    setElement,
    selectElement,
    listen,
    unlisten,
  }
}

/**
 * Checks whether two sources open as the same diagram.
 *
 * @param {Object|null} source
 * @param {Object|null} other
 * @returns {boolean}
 */
function isSameSource(source, other) {
  return source?.document === other?.document && source?.documentUri === other?.documentUri
}

let host = null

/**
 * Gets the app's CellDL editor host.
 *
 * @returns {ReturnType<typeof createCelldlEditorHost>}
 */
export function useCelldlEditorHost() {
  host ??= createCelldlEditorHost()
  return host
}
