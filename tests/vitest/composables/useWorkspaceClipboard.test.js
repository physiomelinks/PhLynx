// @vitest-environment happy-dom
import { computed, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ToastEventBus from 'primevue/toasteventbus'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useActiveCanvas } from '../../../src/composables/useActiveCanvas.js'
import { shouldIgnoreShortcut, useWorkspaceClipboard } from '../../../src/composables/useWorkspaceClipboard.js'
import { buildSuperInstance, buildSupermoduleInterface } from '../../../src/services/import/buildWorkflow.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const nodes = ref([])
const edges = ref([])

// Flow coordinates are the screen ones shifted, so a test can tell the conversion was applied.
const screenToFlowCoordinate = vi.fn(({ x, y }) => ({ x: x - 10, y: y - 20 }))

// The mock is hoisted above the refs, so it hands out one object, filled in below, that every useVueFlow
// caller shares.
const flow = vi.hoisted(() => ({}))
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => flow,
}))
Object.assign(flow, {
  nodes,
  edges,
  getSelectedNodes: computed(() => nodes.value.filter((node) => node.selected)),
  getSelectedEdges: computed(() => edges.value.filter((edge) => edge.selected)),
  addNodes: (added) => nodes.value.push(...added),
  addEdges: (added) => edges.value.push(...added),
  screenToFlowCoordinate,
})

const MATH_REF = 'file:decay'
const MODULE_REF = 'mod:decay'
const DECAY_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`

const createNode = (id, name, x, y, extra = {}) => ({
  id,
  type: 'moduleNode',
  position: { x, y },
  dimensions: { width: 100, height: 60 },
  selected: false,
  data: { name, moduleRef: MODULE_REF, mathRef: MATH_REF, variables: [], ports: [] },
  ...extra,
})

const createEdge = (id, source, target, extra = {}) => ({
  id,
  source,
  target,
  selected: false,
  data: { couplings: [] },
  ...extra,
})

const findNode = (id) => nodes.value.find((node) => node.id === id)

describe('useWorkspaceClipboard', () => {
  let systemClipboard, mousePosition, clipboard, library, emit

  /** Creates a clipboard on the active pinia, as one window of the app would. */
  const createClipboard = () => {
    const allNodeNames = computed(() => nodes.value.map((node) => node.data.name))
    return useWorkspaceClipboard({ mousePosition, allNodeNames })
  }

  const registerDecay = (store) => {
    store.addMath(MATH_REF, DECAY_XML)
    store.addModule({ moduleRef: MODULE_REF, mathRef: MATH_REF, name: 'decay', ports: [], variables: [] })
  }

  /** Marks nodes and edges as the selection. */
  const select = (nodeIds, edgeIds = []) => {
    nodes.value.forEach((node) => (node.selected = nodeIds.includes(node.id)))
    edges.value.forEach((edge) => (edge.selected = edgeIds.includes(edge.id)))
  }

  /** The nodes that were not on the workspace before the paste. */
  const pastedNodes = (beforeIds) => nodes.value.filter((node) => !beforeIds.includes(node.id))

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    library = useLibraryStore()
    registerDecay(library)

    systemClipboard = { text: '' }
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async (text) => {
          systemClipboard.text = text
        }),
        readText: vi.fn(async () => systemClipboard.text),
      },
    })
    emit = vi.spyOn(ToastEventBus, 'emit')
    screenToFlowCoordinate.mockClear()

    mousePosition = ref({ x: 0, y: 0 })
    nodes.value = [
      createNode('dndnode_0', 'A', 0, 0),
      createNode('dndnode_1', 'B', 200, 100),
      createNode('dndnode_2', 'C', 500, 500),
    ]
    edges.value = [createEdge('edge_0', 'dndnode_0', 'dndnode_1'), createEdge('edge_1', 'dndnode_1', 'dndnode_2')]
    clipboard = createClipboard()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    emit.mockRestore()
  })

  describe('copySelection', () => {
    it('writes the selected nodes and edges, with the modules and maths they use, as JSON', async () => {
      select(['dndnode_0', 'dndnode_1'], ['edge_0'])

      await clipboard.copySelection()

      const payload = JSON.parse(systemClipboard.text)
      expect(payload.nodes.map((node) => node.id)).toEqual(['dndnode_0', 'dndnode_1'])
      expect(payload.edges.map((edge) => edge.id)).toEqual(['edge_0'])
      const snapshot = payload.storeSnapshot[`${MODULE_REF}::${MATH_REF}`]
      expect(Object.keys(payload.storeSnapshot)).toEqual([`${MODULE_REF}::${MATH_REF}`])
      expect(snapshot.mathRef).toBe(MATH_REF)
      expect(snapshot.moduleRef).toBe(MODULE_REF)
      expect(snapshot.math).toBe(library.availableMath.get(MATH_REF))
      expect(snapshot.module.moduleRef).toBe(MODULE_REF)
    })

    it('snapshots each module and math once, however many nodes use it', async () => {
      library.addMath('file:other', DECAY_XML)
      library.addModule({ moduleRef: 'mod:other', mathRef: 'file:other', name: 'other', ports: [], variables: [] })
      const data = { name: 'D', moduleRef: 'mod:other', mathRef: 'file:other' }
      nodes.value.push(createNode('dndnode_3', 'D', 0, 0, { data }))
      // Two nodes share the first module, and the one after them uses another.
      select(['dndnode_0', 'dndnode_1', 'dndnode_3'])

      await clipboard.copySelection()

      expect(Object.keys(JSON.parse(systemClipboard.text).storeSnapshot)).toEqual([
        `${MODULE_REF}::${MATH_REF}`,
        'mod:other::file:other',
      ])
    })

    it('leaves out of the snapshot nodes whose module or math is not in the library', async () => {
      const data = { name: 'D', moduleRef: 'mod:gone', mathRef: 'file:gone' }
      nodes.value.push(createNode('dndnode_3', 'D', 0, 0, { data }))
      select(['dndnode_3'])

      await clipboard.copySelection()

      const payload = JSON.parse(systemClipboard.text)
      expect(payload.nodes.map((node) => node.id)).toEqual(['dndnode_3'])
      expect(payload.storeSnapshot).toEqual({})
    })

    it('does nothing when nothing is selected', async () => {
      select([])

      await clipboard.copySelection()

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
      await clipboard.pasteSelection()
      expect(nodes.value).toHaveLength(3)
    })

    it('still pastes within the window when the system clipboard cannot be written', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      navigator.clipboard.writeText.mockRejectedValue(new Error('denied'))
      select(['dndnode_0'])

      await clipboard.copySelection()
      await clipboard.pasteSelection()

      expect(warn).toHaveBeenCalled()
      expect(nodes.value).toHaveLength(4)
      warn.mockRestore()
    })
  })

  describe('with a super-module, whose nodes are off the canvas', () => {
    beforeEach(() => {
      const inside = (id, name) => {
        const node = createNode(id, name, 0, 0)
        return { ...node, data: { ...node.data, scope: 'sm_1' } }
      }
      nodes.value.push(inside('sm_1~dndnode_0', 'D'), inside('sm_1~dndnode_1', 'E'))
      edges.value.push(createEdge('edge_2', 'sm_1~dndnode_0', 'sm_1~dndnode_1'))
    })

    it('selects all of the canvas, nothing inside the super-module', () => {
      clipboard.selectAllNodes()
      expect(nodes.value.filter((node) => node.selected).map((node) => node.id)).toEqual(['dndnode_0', 'dndnode_1', 'dndnode_2'])
    })

    it('copies only what is selected on the canvas', async () => {
      select(['dndnode_0', 'sm_1~dndnode_0', 'sm_1~dndnode_1'], ['edge_2'])
      await clipboard.copySelection()
      const payload = JSON.parse(systemClipboard.text)
      expect(payload.nodes.map((node) => node.id)).toEqual(['dndnode_0'])
      expect(payload.edges).toEqual([])
    })

    describe('shown', () => {
      const { scope } = useActiveCanvas()
      const pasted = () => nodes.value.filter((node) => node.selected)

      beforeEach(() => nodes.value.push(buildSupermoduleInterface('sm_1', { name: 'heart' })))
      afterEach(() => (scope.value = null))

      it('never copies its interface node', async () => {
        scope.value = 'sm_1'
        select(['sm_1', 'sm_1~dndnode_0'])
        await clipboard.copySelection()
        expect(JSON.parse(systemClipboard.text).nodes.map((node) => node.id)).toEqual(['sm_1~dndnode_0'])
      })

      it('pastes into it, with its ids and names its rules allow', async () => {
        nodes.value[0].data.name = '_A__x'
        select(['dndnode_0'])
        await clipboard.copySelection()
        scope.value = 'sm_1'
        await clipboard.pasteSelection()
        expect(pasted().map(({ id, data }) => [id, data.scope, data.localId, data.name])).toEqual([
          ['sm_1~dndnode_2', 'sm_1', 'dndnode_2', 'A_x'],
        ])
      })

      it('refuses to paste a super instance whose super-module would then contain itself', async () => {
        nodes.value.push(buildSuperInstance('dndnode_9', 'heart', 'sm_1'))
        select(['dndnode_9'])
        await clipboard.copySelection()
        const before = nodes.value.length

        scope.value = 'sm_1'
        await clipboard.pasteSelection()
        expect(nodes.value).toHaveLength(before)
        expect(emit).toHaveBeenCalledWith('add', expect.objectContaining({ severity: 'warn', summary: 'Not Pasted' }))

        scope.value = null
        await clipboard.pasteSelection()
        expect(pasted().map(({ id, data }) => [id, data.smId, data.name])).toEqual([['dndnode_10', 'sm_1', 'heart_1']])
      })

      it('pastes nothing when one super instance is blocked, though the modules with it could go', async () => {
        nodes.value.push(buildSuperInstance('dndnode_9', 'heart', 'sm_1'))
        select(['dndnode_0', 'dndnode_9'])
        await clipboard.copySelection()
        const before = nodes.value.map((node) => node.id)

        scope.value = 'sm_1'
        await clipboard.pasteSelection()
        expect(nodes.value.map((node) => node.id)).toEqual(before)
        expect(emit).toHaveBeenCalledWith('add', expect.objectContaining({ severity: 'warn', summary: 'Not Pasted' }))
      })

      it('copies the super-modules a super instance depends on, and reuses one the workspace has the same', async () => {
        nodes.value.push(buildSuperInstance('dndnode_9', 'heart', 'sm_1'))
        select(['dndnode_9'])
        await clipboard.copySelection()
        const payload = JSON.parse(systemClipboard.text)
        expect(payload.supermodules.nodes.map((node) => node.id)).toEqual(['sm_1~dndnode_0', 'sm_1~dndnode_1', 'sm_1'])
        expect(payload.supermodules.edges.map((edge) => edge.id)).toEqual(['edge_2'])

        const before = nodes.value.length
        await clipboard.pasteSelection()
        expect(nodes.value).toHaveLength(before + 1)
        expect(pasted().map(({ id, data }) => [id, data.smId])).toEqual([['dndnode_10', 'sm_1']])
      })

      it('pastes a super-module gone, as in another window, or changed since, afresh with its own ids', async () => {
        nodes.value.push(buildSuperInstance('dndnode_9', 'heart', 'sm_1'))
        select(['dndnode_9'])
        await clipboard.copySelection()

        // Changed since: pasted beside the one there, its name made unique.
        findNode('sm_1~dndnode_0').data.name = 'D2'
        await clipboard.pasteSelection()
        expect(pasted().map(({ id, data }) => [id, data.smId])).toEqual([['dndnode_10', 'sm_2']])
        expect(findNode('sm_2').data.supermodule.name).toBe('heart_2')
        expect(nodes.value.filter((node) => node.data.scope === 'sm_2').map((node) => [node.id, node.data.localId, node.data.name])).toEqual([
          ['sm_2~dndnode_0', 'dndnode_0', 'D'],
          ['sm_2~dndnode_1', 'dndnode_1', 'E'],
          ['sm_2', 'sm_2', undefined],
        ])
        expect(edges.value.filter((edge) => edge.source.startsWith('sm_2~')).map((edge) => [edge.source, edge.target])).toEqual([
          ['sm_2~dndnode_0', 'sm_2~dndnode_1'],
        ])

        // Gone, as in another window: pasted with the super instance.
        nodes.value = nodes.value.filter((node) => node.id !== 'sm_1' && node.data.scope !== 'sm_1' && node.data.scope !== 'sm_2' && node.id !== 'sm_2')
        await clipboard.pasteSelection()
        const smId = pasted()[0].data.smId
        expect(findNode(smId).data.supermodule.name).toBe('heart')
        expect(emit).not.toHaveBeenCalledWith('add', expect.objectContaining({ summary: 'Not Pasted' }))
      })
    })
  })

  describe('pasteSelection', () => {
    it('restores the module and math into a fresh library, as a new window would, and adds the nodes', async () => {
      select(['dndnode_0'])
      await clipboard.copySelection()

      setActivePinia(createPinia())
      const freshLibrary = useLibraryStore()
      expect(freshLibrary.availableModules.has(MODULE_REF)).toBe(false)
      expect(freshLibrary.availableMath.has(MATH_REF)).toBe(false)
      nodes.value = []
      edges.value = []
      const otherWindow = createClipboard()

      await otherWindow.pasteSelection()

      expect(freshLibrary.availableModules.get(MODULE_REF).mathRef).toBe(MATH_REF)
      expect(freshLibrary.availableMath.get(MATH_REF)).toBe(library.availableMath.get(MATH_REF))
      expect(nodes.value).toHaveLength(1)
      expect(nodes.value[0].data.moduleRef).toBe(MODULE_REF)
      expect(nodes.value[0].data.mathRef).toBe(MATH_REF)
    })

    it('restores the math layout into a fresh library, and drops a layout that is not valid', async () => {
      const layout = {
        format: 'cellml-text-layout',
        version: 1,
        components: [{ name: 'decay', leading: ['// decay'], statements: [], footer: [] }],
      }
      library.setMathLayout(MATH_REF, layout)
      select(['dndnode_0'])
      await clipboard.copySelection()
      const copied = systemClipboard.text

      for (const [text, expected] of [
        [copied, layout],
        [copied.replace('cellml-text-layout', 'bogus'), null],
      ]) {
        setActivePinia(createPinia())
        const freshLibrary = useLibraryStore()
        nodes.value = []
        edges.value = []
        systemClipboard.text = text

        await createClipboard().pasteSelection()

        expect(freshLibrary.getMathLayout(MATH_REF)).toEqual(expected)
      }
    })

    it('gives pasted nodes new unique ids and names, and selects only them', async () => {
      select(['dndnode_0', 'dndnode_1'])
      await clipboard.copySelection()

      await clipboard.pasteSelection()
      await clipboard.pasteSelection()

      expect(nodes.value.map((node) => [node.id, node.data.name])).toEqual([
        ['dndnode_0', 'A'],
        ['dndnode_1', 'B'],
        ['dndnode_2', 'C'],
        ['dndnode_3', 'A_1'],
        ['dndnode_4', 'B_1'],
        ['dndnode_5', 'A_2'],
        ['dndnode_6', 'B_2'],
      ])
      expect(nodes.value.filter((node) => node.selected).map((node) => node.id)).toEqual(['dndnode_5', 'dndnode_6'])
      expect(nodes.value.slice(3).map((node) => node.type)).toEqual(Array(4).fill('moduleNode'))
    })

    it('gives a pasted copy of an imported self leaf neither its role nor its preserved name (#364)', async () => {
      Object.assign(findNode('dndnode_0').data, { originalName: 'channel', role: 'self' })
      select(['dndnode_0'])
      await clipboard.copySelection()

      await clipboard.pasteSelection()

      const [copy] = pastedNodes(['dndnode_0', 'dndnode_1', 'dndnode_2'])
      expect(copy.data.name).toBe('A_1')
      expect(copy.data).not.toHaveProperty('originalName')
      expect(copy.data).not.toHaveProperty('role')
    })

    it('moves values out of older math into the rows of the pasted nodes', async () => {
      const row = { name: 'k', type: 'constant', units: 'per_second', value: '' }
      const old = createNode('x0', 'Old', 0, 0, { data: { ...createNode('', '', 0, 0).data, variables: [row] } })
      const module = library.availableModules.get(MODULE_REF)
      const entry = { mathRef: MATH_REF, math: DECAY_XML, moduleRef: MODULE_REF, module }
      systemClipboard.text = JSON.stringify({ nodes: [old], edges: [], storeSnapshot: { key: entry } })

      await clipboard.pasteSelection()

      const pasted = nodes.value.at(-1)
      expect(pasted.data.variables.find((variable) => variable.name === 'k').value).toBe('0.5')
    })

    it('keeps names unique within one paste, not only against the workspace', async () => {
      // Pasting 'A' takes 'A_1', which the second pasted node (named 'A_1' in the other window) must avoid.
      const pasted = [createNode('x0', 'A', 0, 0), createNode('x1', 'A_1', 0, 0)]
      systemClipboard.text = JSON.stringify({ nodes: pasted, edges: [] })

      await clipboard.pasteSelection()

      const names = nodes.value.slice(3).map((node) => node.data.name)
      expect(names).toHaveLength(2)
      expect(new Set([...names, 'A', 'B', 'C']).size).toBe(5)
    })

    it('recreates edges between pasted nodes and drops edges to nodes that were not copied', async () => {
      select(['dndnode_0', 'dndnode_1'], ['edge_0', 'edge_1'])
      await clipboard.copySelection()

      await clipboard.pasteSelection()

      expect(edges.value).toHaveLength(3)
      const pasted = edges.value[2]
      expect(pasted).toMatchObject({
        id: 'edge_2',
        source: 'dndnode_3',
        target: 'dndnode_4',
        selected: true,
        data: { couplings: [] },
      })
      expect(edges.value.filter((edge) => edge.selected).map((edge) => edge.id)).toEqual(['edge_2'])
    })

    it('gives every pasted edge its own id', async () => {
      select(['dndnode_0', 'dndnode_1', 'dndnode_2'], ['edge_0', 'edge_1'])
      await clipboard.copySelection()

      await clipboard.pasteSelection()

      expect(edges.value.slice(2).map((edge) => [edge.id, edge.source, edge.target])).toEqual([
        ['edge_2', 'dndnode_3', 'dndnode_4'],
        ['edge_3', 'dndnode_4', 'dndnode_5'],
      ])
    })

    it('offsets pasted nodes by 50 in both directions by default', async () => {
      select(['dndnode_1'])
      await clipboard.copySelection()

      await clipboard.pasteSelection()

      expect(findNode('dndnode_3').position).toEqual({ x: 250, y: 150 })
      expect(screenToFlowCoordinate).not.toHaveBeenCalled()
    })

    it('centres the pasted nodes on the mouse when pasting at the mouse', async () => {
      // Node centres are (50, 30) and (250, 130), so the clipboard centre is (150, 80).
      select(['dndnode_0', 'dndnode_1'])
      await clipboard.copySelection()
      mousePosition.value = { x: 400, y: 300 }

      await clipboard.pasteSelection(true)

      expect(screenToFlowCoordinate).toHaveBeenCalledWith({ x: 400, y: 300 })
      // The mouse is at (390, 280) in the flow, so every node shifts by (240, 200).
      expect(findNode('dndnode_3').position).toEqual({ x: 240, y: 200 })
      expect(findNode('dndnode_4').position).toEqual({ x: 440, y: 300 })
    })

    it('falls back to the in-memory clipboard, without a notification, when the system clipboard is not ours', async () => {
      select(['dndnode_0'])
      await clipboard.copySelection()

      for (const text of ['not json at all', '{"nodes": 1}', '[]', '']) {
        systemClipboard.text = text
        await clipboard.pasteSelection()
      }

      expect(nodes.value).toHaveLength(7)
      expect(nodes.value.slice(3).every((node) => node.data.name.startsWith('A_'))).toBe(true)
      expect(emit).not.toHaveBeenCalled()
    })

    it('prefers the system clipboard over the in-memory one when it holds a copy', async () => {
      select(['dndnode_0'])
      await clipboard.copySelection()
      systemClipboard.text = JSON.stringify({ nodes: [createNode('x', 'Other', 0, 0)], edges: [] })

      await clipboard.pasteSelection()

      expect(nodes.value.at(-1).data.name).toBe('Other')
    })

    it('does nothing when there is nothing to paste, leaving the selection as it was', async () => {
      select(['dndnode_1'], ['edge_0'])

      await clipboard.pasteSelection()

      expect(nodes.value).toHaveLength(3)
      expect(edges.value).toHaveLength(2)
      expect(nodes.value.filter((node) => node.selected).map((node) => node.id)).toEqual(['dndnode_1'])
      expect(edges.value.filter((edge) => edge.selected).map((edge) => edge.id)).toEqual(['edge_0'])
    })
  })

  describe('selectAllNodes', () => {
    it('selects every node', () => {
      select(['dndnode_1'])

      clipboard.selectAllNodes()

      expect(nodes.value.map((node) => node.selected)).toEqual([true, true, true])
    })
  })

  describe('shouldIgnoreShortcut', () => {
    const eventOn = (tagName, closest = () => null) => ({ target: { tagName, closest } })

    it('ignores shortcuts typed in inputs and textareas', () => {
      expect(shouldIgnoreShortcut(eventOn('INPUT'), false)).toBe(true)
      expect(shouldIgnoreShortcut(eventOn('TEXTAREA'), false)).toBe(true)
    })

    it('ignores shortcuts while a dialog is open', () => {
      expect(shouldIgnoreShortcut(eventOn('DIV'), true)).toBe(true)
    })

    it('ignores shortcuts inside a CodeMirror editor', () => {
      const closest = vi.fn((selector) => (selector === '.cm-editor' ? {} : null))

      expect(shouldIgnoreShortcut(eventOn('DIV', closest), false)).toBe(true)
      expect(closest).toHaveBeenCalledWith('.cm-editor')
    })

    it('lets other shortcuts through', () => {
      expect(shouldIgnoreShortcut(eventOn('DIV'), false)).toBe(false)
    })

    it('ignores shortcuts while a confirm or another modal is open, wherever focus is', () => {
      for (const attributes of [{ role: 'alertdialog' }, { role: 'dialog', 'aria-modal': 'true' }, { class: 'p-overlay-mask' }]) {
        const modal = document.createElement('div')
        Object.entries(attributes).forEach(([name, value]) => modal.setAttribute(name, value))
        document.body.appendChild(modal)
        expect(shouldIgnoreShortcut(eventOn('DIV'), false)).toBe(true)
        modal.remove()
      }
      const floating = document.createElement('div')
      floating.setAttribute('role', 'dialog')
      floating.setAttribute('aria-modal', 'false')
      document.body.appendChild(floating)
      expect(shouldIgnoreShortcut(eventOn('DIV'), false)).toBe(false)
      floating.remove()
    })

    it('decides on the tag and the dialog before looking for an editor', () => {
      const closest = vi.fn()

      expect(shouldIgnoreShortcut(eventOn('INPUT', closest), false)).toBe(true)
      expect(shouldIgnoreShortcut(eventOn('DIV', closest), true)).toBe(true)
      expect(closest).not.toHaveBeenCalled()
    })
  })
})
