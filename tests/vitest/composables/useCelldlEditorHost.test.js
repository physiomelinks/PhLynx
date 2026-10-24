import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'

import {
  createCelldlEditorHost,
  EDITOR_CHROME,
  ERROR_CLASS,
  FLASH_CLASS,
  isEditorKey,
  LIVE_ISSUE_CLASS,
} from '../../../src/composables/useCelldlEditorHost.js'

const SOURCE = { format: 'celldl', document: '<svg>rc</svg>', documentUri: 'https://phlynx.example/rc.celldl' }

/**
 * Stands in for the CellDL editor: it draws a diagram into the host's root once mounted, and answers commands
 * as the editor does.
 */
function mountFakeEditor(host, { failOpen = false, listsElements = true } = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const container = document.createElement('div')
  container.id = 'svg-container'
  root.appendChild(container)
  let diagram = 'blank'
  let unitSystem = 'cellular'
  const draw = () => container.replaceChildren(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
  const commands = []
  watch(host.command, (command) => {
    commands.push(command)
    const { action, data, kind } = command.options
    if (command.command === 'element' && action === 'list' && listsElements) {
      queueMicrotask(() => host.onElements({ kind, revision: 0, elements: [], unitSystem }))
    }
    if (command.command === 'document' && action === 'set-unit-system') {
      const { id } = command.options
      const isKnown = ['si', 'cellular'].includes(id)
      if (isKnown) unitSystem = id
      queueMicrotask(() =>
        host.onEditorData({ kind, data: unitSystem, ...(!isKnown && { error: `Unknown unit system '${id}'` }) })
      )
    }
    if (command.command !== 'file') return
    if (action === 'open') {
      if (failOpen) return host.onEditorState({ error: 'Cannot open' })
      diagram = data
      draw()
    } else if (action === 'close') {
      diagram = 'blank'
      draw()
    } else if (action === 'data') {
      queueMicrotask(() => host.onEditorData({ data: diagram, kind }))
    } else if (action === 'rdf') {
      queueMicrotask(() => host.onEditorData({ data: `rdf of ${diagram}`, kind }))
    }
  })
  host.attach(root)
  return { root, commands, draw, edit: (next) => (diagram = next) }
}

describe('useCelldlEditorHost', () => {
  let host

  beforeEach(() => {
    host = createCelldlEditorHost({ readyTimeout: 500, commandTimeout: 200 })
    host.listen()
  })

  afterEach(() => {
    host.unlisten()
    document.body.replaceChildren()
  })

  it('is ready once the editor has drawn its first diagram', async () => {
    const editor = mountFakeEditor(host)
    const ready = host.whenReady()
    expect(host.isReady.value).toBe(false)
    editor.draw()
    await ready
    expect(host.isReady.value).toBe(true)
  })

  it("gives up waiting for an editor that doesn't start", async () => {
    mountFakeEditor(host)
    await expect(host.whenReady()).rejects.toThrow("didn't start")
  })

  it('opens the prepared source under its documentUri as a pane claims it, once', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(SOURCE)
    const pane = document.createElement('div')
    host.claim(pane)
    await host.sync()

    expect(host.isActive.value).toBe(true)
    expect(editor.commands[0]).toEqual({
      command: 'file',
      options: { action: 'open', data: SOURCE.document, name: SOURCE.documentUri },
    })
    expect(editor.commands[1].options.action).toBe('data')
    // Its elements are listed for the Parameters tab.
    await vi.waitFor(() => expect(editor.commands[2]).toMatchObject({ command: 'element', options: { action: 'list' } }))

    // Shown again without reopening.
    host.release(pane)
    expect(host.isActive.value).toBe(false)
    host.claim(pane)
    await host.sync()
    expect(editor.commands).toHaveLength(3)
  })

  it('closes the diagram for a source with no document', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare({ ...SOURCE, document: null })
    host.claim(document.createElement('div'))
    await host.sync()
    expect(editor.commands[0]).toEqual({ command: 'file', options: { action: 'close' } })
  })

  it("keeps the editor's error for a document it can't open", async () => {
    const editor = mountFakeEditor(host, { failOpen: true })
    editor.draw()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await expect(host.sync()).rejects.toThrow('Cannot open')
    expect(host.error.value).toBe('Cannot open')
  })

  it("says what the editor's open error means, without the diagram's IRI", () => {
    host.onEditorState({ error: "Cannot open https://bg-rdf.org/models/local/phlynx/rc.cellml_rc.celldl -- invalid CellDL file?\n\nTypeError: Cannot read properties of null (reading 'dataset')" })
    expect(host.error.value).toBe(
      "The CellDL editor can't open this module's diagram (TypeError: Cannot read properties of null (reading 'dataset')). Its CellML still runs."
    )
    host.onEditorState({})
    expect(host.error.value).toBe('')
  })

  it('opens a source prepared while a pane holds the editor at once, saying it is opening', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await host.sync()

    const next = { ...SOURCE, document: '<svg>rlc</svg>' }
    host.prepare(next)
    expect(host.isSyncing.value).toBe(true)
    await vi.waitFor(() => expect(host.isSyncing.value).toBe(false))
    expect(editor.commands.filter(({ options }) => options.action === 'open').map(({ options }) => options.data)).toEqual([
      SOURCE.document,
      next.document,
    ])
  })

  it('opens a source again after failing to', async () => {
    const editor = mountFakeEditor(host, { failOpen: true })
    editor.draw()
    host.prepare(SOURCE)
    const pane = document.createElement('div')
    host.claim(pane)
    await expect(host.sync()).rejects.toThrow('Cannot open')
    expect(host.isSyncing.value).toBe(false)

    host.release(pane)
    host.claim(pane)
    await expect(host.sync()).rejects.toThrow('Cannot open')
    expect(editor.commands.filter(({ options }) => options.action === 'open')).toHaveLength(2)
  })

  it('serialises the diagram, and compares it with the one opened', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await host.sync()

    expect(await host.compareWithBaseline()).toEqual({ isChanged: false, document: SOURCE.document })
    editor.edit('<svg>rlc</svg>')
    expect(await host.compareWithBaseline()).toEqual({ isChanged: true, document: '<svg>rlc</svg>' })
  })

  it("gives up on a diagram the editor doesn't return", async () => {
    const root = document.createElement('div')
    root.innerHTML = '<div id="svg-container"><svg></svg></div>'
    host.attach(root)
    host.onEditorData({ data: 'stray', kind: 'other' })
    await expect(host.serialise()).rejects.toThrow("didn't return its diagram")
  })

  it('takes edits as a dirty hint only while a pane shows the editor, and marks the diagram clean', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    document.dispatchEvent(new CustomEvent('file-edited'))
    expect(host.isDirty.value).toBe(false)

    const pane = document.createElement('div')
    host.claim(pane)
    document.dispatchEvent(new CustomEvent('file-edited'))
    expect(host.isDirty.value).toBe(true)

    host.markClean()
    await nextTick()
    expect(host.isDirty.value).toBe(false)
    expect(editor.commands.at(-1)).toEqual({ command: 'edit', options: { action: 'clean' } })

    document.dispatchEvent(new CustomEvent('file-edited'))
    host.prepare(SOURCE)
    expect(host.isDirty.value).toBe(false)
  })

  it('counts a diagram opened blank as edited only while it has something on it, following undo back to blank', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(null)
    host.claim(document.createElement('div'))
    await host.sync()
    const svg = () => editor.root.querySelector('#svg-container > svg')

    document.dispatchEvent(new CustomEvent('file-edited'))
    expect(host.isDirty.value).toBe(false)

    const component = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    component.classList.add('celldl-Component')
    svg().appendChild(component)
    document.dispatchEvent(new CustomEvent('file-edited'))
    expect(host.isDirty.value).toBe(true)

    // Undo removes it, and redo puts it back, without reporting an edit.
    component.remove()
    await vi.waitFor(() => expect(host.isDirty.value).toBe(false))
    svg().appendChild(component)
    await vi.waitFor(() => expect(host.isDirty.value).toBe(true))
  })

  it("keeps a stored diagram's edits once it is back to blank, as only a serialisation tells", async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await host.sync()

    document.dispatchEvent(new CustomEvent('file-edited'))
    editor.root.querySelector('#svg-container > svg').appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g'))
    await nextTick()
    expect(host.isDirty.value).toBe(true)
  })

  it('keeps a saved diagram for the dialog reloading after the save, but reopens one edited since', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await host.sync()

    editor.edit('<svg>rlc</svg>')
    const saved = { ...SOURCE, document: '<svg>rlc</svg>' }
    host.markSaved(saved)
    host.prepare({ ...saved })
    await host.sync()
    expect(host.isSyncing.value).toBe(false)
    expect((await host.compareWithBaseline()).isChanged).toBe(false)
    const opens = () => editor.commands.filter(({ options }) => options.action === 'open')
    expect(opens()).toHaveLength(1)

    document.dispatchEvent(new CustomEvent('file-edited'))
    host.prepare({ ...saved })
    await vi.waitFor(() => expect(opens()).toHaveLength(2))
  })

  it('highlights the elements a conversion failed on until the diagram is serialised', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    const svg = editor.root.querySelector('svg')
    svg.innerHTML = '<g id="R"/><g id="C"/>'

    host.highlight(['R', 'missing'])
    expect(svg.querySelector('#R').classList.contains(ERROR_CLASS)).toBe(true)
    expect(svg.querySelector('#C').classList.contains(ERROR_CLASS)).toBe(false)

    await host.serialise()
    expect(svg.querySelector(`.${ERROR_CLASS}`)).toBeNull()
  })

  it("marks the live conversion's issues softly, beside a save's, and never serialises them", async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    const svg = editor.root.querySelector('svg')
    svg.innerHTML = '<g id="R"/><g id="C"/>'

    host.highlight(['R'])
    host.highlight(['R'], { isLive: true })
    host.highlight(['C'], { isLive: true })
    expect(svg.querySelector('#R').classList.contains(ERROR_CLASS)).toBe(true)
    expect(svg.querySelector('#R').classList.contains(LIVE_ISSUE_CLASS)).toBe(false)
    expect(svg.querySelector('#C').classList.contains(LIVE_ISSUE_CLASS)).toBe(true)

    // A live result landing while the editor serialises.
    const stopWatching = watch(
      host.command,
      (command) => command.options.action === 'data' && host.highlight(['C'], { isLive: true }),
      { flush: 'sync' }
    )
    await host.serialise()
    stopWatching()
    expect(svg.querySelector(`.${LIVE_ISSUE_CLASS}`)).toBeNull()
    expect(svg.querySelector(`.${ERROR_CLASS}`)).toBeNull()
  })

  it('passes on diagram changes while a pane holds the editor, and the diagram a source opened as', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    const changes = []
    const stop = host.onChange((change) => changes.push(change))
    host.onDiagramChanged({ revision: 1, rdf: 'parked' })
    expect(changes).toEqual([])

    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await host.sync()
    await vi.waitFor(() => expect(changes).toHaveLength(2))
    // Opening starts by saying the diagram heard so far is going.
    expect(changes[0]).toMatchObject({ rdf: null, isOpened: false })
    expect(changes[1]).toEqual({ rdf: `rdf of ${SOURCE.document}`, documentUri: SOURCE.documentUri, isOpened: true })
    // Reading the RDF, unlike serialising, sends only the rdf action.
    expect(editor.commands.at(-1).options.action).toBe('rdf')

    host.onDiagramChanged({ revision: 2, rdf: 'edited' })
    expect(changes[2]).toEqual({ rdf: 'edited', documentUri: SOURCE.documentUri, isOpened: false })

    stop()
    host.onDiagramChanged({ revision: 3, rdf: 'again' })
    expect(changes).toHaveLength(3)
  })

  it('takes live annotations until a source is next shown', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.setLiveAnnotations({ X: { primary: 'q_X' } })
    expect(host.annotations.value).toEqual({ X: { primary: 'q_X' } })
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await host.sync()
    expect(host.annotations.value).toEqual({})
  })

  it("passes the editor's viewer events to the pane holding it", () => {
    const onEvent = vi.fn()
    const pane = document.createElement('div')
    host.claim(pane, onEvent)
    host.onViewerEvent({ type: 'select', component: { id: 'ID-1' } })
    expect(onEvent).toHaveBeenCalledWith({ type: 'select', component: { id: 'ID-1' } })

    host.release(pane)
    host.onViewerEvent({ type: 'unselect' })
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it("annotates the shown diagram's elements, and their saved elements after a save", async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    const element = (name) => ({ kind: 'one', symbol: '1', primary: name, variables: [{ name, role: 'flow', ucum: 'A', units: 'ampere' }] })
    host.prepare({ ...SOURCE, elements: { J: element('v_1') } })
    expect(host.annotations.value).toEqual({})
    host.claim(document.createElement('div'))
    await host.sync()
    await vi.waitFor(() => expect(host.annotations.value).toEqual({ J: { label: '1', primary: 'v_1', variables: ['v_1'], tooltip: 'v_1 (flow, A)' } }))

    editor.edit('<svg>rlc</svg>')
    const saved = { ...SOURCE, document: '<svg>rlc</svg>', elements: { J: element('v_2') } }
    host.markSaved(saved)
    await vi.waitFor(() => expect(host.annotations.value.J.primary).toBe('v_2'))

    host.prepare({ ...saved, elements: { K: element('v_3') } })
    await vi.waitFor(() => expect(Object.keys(host.annotations.value)).toEqual(['K']))
  })

  it('drops annotations that arrive after a newer source, and clears them for a source that fails to open', async () => {
    const editor = mountFakeEditor(host, { failOpen: true })
    editor.draw()
    const elements = { J: { kind: 'one', symbol: '1', primary: 'v_1', variables: [{ name: 'v_1', role: 'flow', ucum: 'A', units: 'ampere' }] } }
    host.markSaved({ ...SOURCE, elements })
    host.markSaved(SOURCE)
    await import('@physiomelinks/bg2cellml')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(host.annotations.value).toEqual({})

    host.markSaved({ ...SOURCE, elements })
    await vi.waitFor(() => expect(Object.keys(host.annotations.value)).toEqual(['J']))
    host.prepare({ ...SOURCE, document: '<svg>rlc</svg>', elements })
    host.claim(document.createElement('div'))
    await expect(host.sync()).rejects.toThrow('Cannot open')
    expect(host.annotations.value).toEqual({})
  })

  it('annotates nothing for a source saved without elements', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await host.sync()
    expect(host.annotations.value).toEqual({})
  })

  it("doesn't park the editor for a pane that no longer holds it", () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    host.claim(first)
    host.claim(second)
    host.release(first)
    expect(host.target.value).toBe(second)
  })
})

describe("the CellDL editor's element command", () => {
  let host
  let editor
  const ELEMENT = { id: 'ID-1', kind: 'QuantityStore', species: 'S' }

  /** Stands in for the editor's element command: it lists, sets and selects, replying with the command's kind. */
  function mountElementEditor({ isSilent = false } = {}) {
    const fake = mountFakeEditor(host, { listsElements: false })
    fake.draw()
    let elements = [ELEMENT]
    let revision = 1
    watch(host.command, (command) => {
      if (command.command !== 'element' || isSilent) return
      const { action, kind, edits, id } = command.options
      queueMicrotask(() => {
        if (action === 'list') host.onElements({ kind, revision, elements })
        else if (action === 'set') {
          const bad = edits.filter((edit) => edit.value === '{')
          elements = elements.map((element) => ({ ...element, ...Object.fromEntries(edits.filter((e) => e.value !== '{').map((e) => [e.field, e.value])) }))
          revision += 1
          // The edit's diagram change brings the new list, with no kind, before the reply.
          host.onElements({ revision, elements })
          host.onElementResult(bad.length ? { kind, ok: false, errors: bad.map((e) => ({ ...e, message: 'bad' })) } : { kind, ok: true })
        } else if (action === 'select') {
          // The editor has no object 'gone', e.g. one deleted since a conversion named it.
          if (id === 'gone') return host.onElementResult({ kind, ok: false, errors: [{ id, field: '', message: 'none' }] })
          host.onViewerEvent({ type: 'unselect', component: { id: 'ID-0' } })
          host.onViewerEvent({ type: 'select', component: { id } })
          host.onElementResult({ kind, ok: true })
        }
      })
    })
    return fake
  }

  beforeEach(() => {
    host = createCelldlEditorHost({ readyTimeout: 500, commandTimeout: 200 })
    host.listen()
  })

  afterEach(() => {
    host.unlisten()
    document.body.replaceChildren()
  })

  it('lists the elements, keeping them as the latest list', async () => {
    editor = mountElementEditor()
    await expect(host.listElements()).resolves.toEqual([ELEMENT])
    expect(host.elements.value).toEqual([ELEMENT])
    expect(host.elementsRevision.value).toBe(1)
  })

  it('matches a set to its reply by kind, and follows the list the edit brings', async () => {
    editor = mountElementEditor()
    // Another command's reply is not this one's.
    host.onElementResult({ kind: 'someone-else', ok: false })
    const result = await host.setElement([{ id: 'ID-1', field: 'species', value: 'Glc' }])
    expect(result).toEqual({ ok: true })
    expect(host.elements.value[0].species).toBe('Glc')
    expect(host.elementsRevision.value).toBe(2)

    await expect(host.setElement([{ id: 'ID-1', field: 'species', value: '{' }])).resolves.toMatchObject({ ok: false, errors: [{ field: 'species' }] })
  })

  it("gives up on an element command the editor doesn't answer", async () => {
    editor = mountElementEditor({ isSilent: true })
    await expect(host.setElement([{ id: 'ID-1', field: 'species', value: 'Glc' }])).rejects.toThrow("didn't edit the diagram in time")
    await expect(host.listElements()).rejects.toThrow("didn't list its elements in time")
  })

  it('sends each of several commands made at once', async () => {
    editor = mountElementEditor()
    const [listed, set] = await Promise.all([host.listElements(), host.setElement([{ id: 'ID-1', field: 'location', value: 'm' }])])
    expect(listed).toHaveLength(1)
    expect(set.ok).toBe(true)
    expect(editor.commands.map((command) => command.options.action)).toEqual(['list', 'set'])
  })

  it("marks the selection it made as its own, and the user's as not", async () => {
    editor = mountElementEditor()
    const onEvent = vi.fn()
    host.claim(document.createElement('div'), onEvent)
    await host.selectElement('ID-1', 'if-hidden')
    expect(editor.commands.at(-1).options).toMatchObject({ action: 'select', id: 'ID-1', centre: 'if-hidden' })
    expect(host.selection.value).toEqual({ id: 'ID-1', isHostSelection: true })
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'select', component: { id: 'ID-1' }, isHostSelection: true })

    host.onViewerEvent({ type: 'select', component: { id: 'ID-1' } })
    expect(host.selection.value).toEqual({ id: 'ID-1', isHostSelection: false })
    host.onViewerEvent({ type: 'unselect', component: { id: 'ID-1' } })
    expect(host.selection.value.id).toBe(null)
  })

  it('reveals an element: selects it, centres it, and flashes it for a moment', async () => {
    editor = mountElementEditor()
    await host.whenReady()
    const svg = editor.root.querySelector('svg')
    svg.innerHTML = '<g id="ID-1"></g><g id="ID-2" class="phlynx-celldl-error"></g>'
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await expect(host.revealElement('ID-1')).resolves.toEqual({ ok: true })
      expect(editor.commands.at(-1).options).toMatchObject({ action: 'select', id: 'ID-1', centre: true })
      expect(host.selection.value).toEqual({ id: 'ID-1', isHostSelection: true })
      expect(svg.querySelector('#ID-1').classList.contains(FLASH_CLASS)).toBe(true)

      // A second reveal ends the first's flash, and leaves an error's mark alone.
      await host.revealElement('ID-2')
      expect(svg.querySelector('#ID-1').classList.contains(FLASH_CLASS)).toBe(false)
      expect(svg.querySelector('#ID-2').classList.contains(FLASH_CLASS)).toBe(true)
      vi.advanceTimersByTime(2000)
      expect(svg.querySelector('#ID-2').getAttribute('class')).toBe('phlynx-celldl-error')
    } finally {
      vi.useRealTimers()
    }
  })

  it("says an element the diagram no longer has can't be revealed, flashing nothing", async () => {
    editor = mountElementEditor()
    await host.whenReady()
    await expect(host.revealElement('gone')).resolves.toMatchObject({ ok: false })
    expect(editor.root.querySelector(`.${FLASH_CLASS}`)).toBeNull()
  })

  it("drops the elements as another source opens, and lists the new one's", async () => {
    editor = mountElementEditor()
    await host.listElements()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    const syncing = host.sync()
    expect(host.elements.value).toEqual([])
    await syncing
    await vi.waitFor(() => expect(host.elements.value).toEqual([ELEMENT]))
  })
})

describe('the CellDL key gate', () => {
  let host
  let pane
  let outside
  let reached

  const press = (key, init = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
  }
  const pressOn = (element) => element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

  beforeEach(() => {
    host = createCelldlEditorHost()
    host.listen()
    pane = document.createElement('div')
    pane.innerHTML = '<input class="in-pane">'
    outside = document.createElement('div')
    outside.innerHTML = '<input class="outside">'
    document.body.append(pane, outside)
    reached = []
    // The editor's own listeners are on the window.
    window.addEventListener('keydown', record)
  })

  function record(event) {
    reached.push(event.key)
  }

  afterEach(() => {
    window.removeEventListener('keydown', record)
    host.unlisten()
    document.body.replaceChildren()
  })

  it('knows the keys the editor acts on wherever focus is', () => {
    for (const key of ['Backspace', 'Delete', 'Escape']) expect(isEditorKey({ key })).toBe(true)
    expect(isEditorKey({ key: 'z', metaKey: true })).toBe(true)
    expect(isEditorKey({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(isEditorKey({ key: 'y', ctrlKey: true })).toBe(true)
    expect(isEditorKey({ key: 'z' })).toBe(false)
    expect(isEditorKey({ key: 's', metaKey: true })).toBe(false)
  })

  it("keeps the editor's keys from a parked editor", () => {
    press('z', { metaKey: true })
    press('Backspace')
    press('Escape')
    expect(reached).toEqual([])
  })

  it('lets other keys through, and leaves document listeners hearing every key', () => {
    const heard = []
    const onDocument = (event) => heard.push(event.key)
    document.addEventListener('keydown', onDocument)
    press('a')
    press('Enter', { metaKey: true })
    press('z', { metaKey: true })
    document.removeEventListener('keydown', onDocument)
    expect(reached).toEqual(['a', 'Enter'])
    expect(heard).toEqual(['a', 'Enter', 'z'])
  })

  it('passes them to the editor while the user works in its pane', () => {
    host.claim(pane)
    pressOn(pane)
    press('z', { metaKey: true })
    press('Delete')
    expect(reached).toEqual(['z', 'Delete'])
    expect(host.isEngaged.value).toBe(true)
  })

  it('stops them once the user moves out of the pane, by pointer or by focus', () => {
    host.claim(pane)
    pressOn(pane)
    pressOn(outside)
    press('z', { metaKey: true })
    expect(host.isEngaged.value).toBe(false)

    pane.querySelector('input').focus()
    expect(host.isEngaged.value).toBe(true)
    outside.querySelector('input').focus()
    press('Backspace')
    expect(reached).toEqual([])
  })

  it("counts the editor's context menu as where it was opened", () => {
    host.claim(pane)
    pressOn(pane)
    const menu = document.createElement('ul')
    menu.className = 'p-contextmenu'
    document.body.appendChild(menu)
    pressOn(menu)
    press('Escape')
    expect(reached).toEqual(['Escape'])
  })

  it('disengages as the pane parks the editor', () => {
    host.claim(pane)
    pressOn(pane)
    host.release(pane)
    expect(host.isEngaged.value).toBe(false)
    press('z', { metaKey: true })
    expect(reached).toEqual([])
  })
})

describe('EDITOR_CHROME panels', () => {
  it('shows the Reactions panel and hides Variables and Annotations', () => {
    expect(EDITOR_CHROME.panels).toContain('reactions')
    expect(EDITOR_CHROME.panels).not.toContain('variables')
    expect(EDITOR_CHROME.panels).not.toContain('annotations')
  })
})

describe('EDITOR_CHROME', () => {
  it('shows values read-only in the Properties panel, pointing to the Parameters tab', () => {
    expect(EDITOR_CHROME.values).toBe('readonly')
    expect(EDITOR_CHROME.valuesHint).toBe('Set values in the Parameters tab')
  })

  it('places elements from the chemical palette, keeping the toolbar for Undo and Redo only', () => {
    expect(EDITOR_CHROME.palette).toBe('top')
    expect(EDITOR_CHROME.paletteDomain).toBe('chemical')
    // An empty list, not false: false would hide the Undo and Redo buttons with the toolbar.
    expect(EDITOR_CHROME.tools).toEqual([])
    expect(EDITOR_CHROME.undo).not.toBe(false)
  })
})

describe("the CellDL editor's unit system", () => {
  let host

  beforeEach(() => {
    host = createCelldlEditorHost({ readyTimeout: 500, commandTimeout: 200 })
    host.listen()
  })

  afterEach(() => {
    host.unlisten()
    document.body.replaceChildren()
  })

  it("follows the diagram's unit system from its element list, and forgets it as another opens", async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    await host.whenReady()
    expect(host.unitSystem.value).toBeNull()
    await host.listElements()
    expect(host.unitSystem.value).toBe('cellular')
    host.onElements({ revision: 1, elements: [], unitSystem: 'si' })
    expect(host.unitSystem.value).toBe('si')
    host.claim(document.createElement('div'))
    host.prepare(SOURCE)
    expect(host.unitSystem.value).toBeNull()
  })

  it('sets the unit system, converting the values, and says why it could not', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    expect(await host.setUnitSystem('si')).toEqual({ ok: true, unitSystem: 'si' })
    expect(host.unitSystem.value).toBe('si')
    const sent = editor.commands.find((command) => command.command === 'document')
    expect(sent.options).toMatchObject({ action: 'set-unit-system', id: 'si', convert: true })
    expect(await host.setUnitSystem('kmol')).toEqual({ ok: false, unitSystem: 'si', error: "Unknown unit system 'kmol'" })
    expect(host.unitSystem.value).toBe('si')
  })
})
