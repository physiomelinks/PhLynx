import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import useDragAndDrop from '../../../src/composables/useDnD.js'
import { buildGhostHandles } from '../../../src/utils/handles.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import {
  FLOW_IDS,
  GHOST_MODULE_FILENAME,
  GHOST_NODE_TYPE,
  MAIN_NODE_TYPE,
  NUM_GHOST_HANDLES_LEFT_RIGHT,
  NUM_GHOST_HANDLES_TOP_BOT,
} from '../../../src/utils/constants.js'

const flow = vi.hoisted(() => ({
  nodes: null,
  addNodes: null,
  updateNode: null,
  off: null,
  initCallbacks: [],
  screenToFlowCoordinate: null,
  flowIds: [],
}))

vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal()
  const { ref, computed } = await import('vue')
  flow.nodes = ref([])
  flow.addNodes = vi.fn()
  flow.updateNode = vi.fn()
  flow.off = vi.fn()
  flow.screenToFlowCoordinate = vi.fn((p) => ({ x: p.x + 1000, y: p.y + 1000 }))

  return {
    ...actual,
    useVueFlow: (id) => {
      flow.flowIds.push(id)
      return {
        getNodes: computed(() => flow.nodes.value),
        addNodes: flow.addNodes,
        updateNode: flow.updateNode,
        screenToFlowCoordinate: flow.screenToFlowCoordinate,
        onNodesInitialized: (cb) => {
          flow.initCallbacks.push(cb)
          return { off: flow.off }
        },
      }
    },
  }
})

const moduleData = (overrides = {}) => ({
  moduleRef: 'membrane:basic',
  mathRef: 'membrane.cellml:basic',
  ports: [],
  variables: [],
  ...overrides,
})

describe('useDragAndDrop', () => {
  let pending
  let dnd

  beforeEach(() => {
    setActivePinia(createPinia())
    flow.nodes.value = []
    flow.addNodes.mockClear()
    flow.updateNode.mockClear()
    flow.off.mockClear()
    flow.initCallbacks.length = 0
    flow.flowIds.length = 0
    pending = new Set()
    dnd = useDragAndDrop(pending)
  })

  describe('createInstanceNode', () => {
    it('adds exactly one node with the given position, module refs and ports', () => {
      const ports = [{ portType: 'a' }]
      const { nodeId, nodeType } = dnd.createInstanceNode(moduleData({ ports }), { x: 12, y: 34 })

      expect(flow.addNodes).toHaveBeenCalledTimes(1)
      const node = flow.addNodes.mock.calls[0][0]
      expect(node.id).toBe(nodeId)
      expect(node.id).toBe('dndnode_0')
      expect(node.type).toBe(nodeType)
      expect(node.type).toBe(MAIN_NODE_TYPE)
      expect(node.position).toEqual({ x: 12, y: 34 })
      expect(node.data).toMatchObject({
        name: 'membrane',
        moduleRef: 'membrane:basic',
        mathRef: 'membrane.cellml:basic',
        ports,
      })
    })

    it('registers the new node id in pendingHistoryNodes', () => {
      const { nodeId } = dnd.createInstanceNode(moduleData(), { x: 0, y: 0 })

      expect(pending.has(nodeId)).toBe(true)
      expect(pending.size).toBe(1)
    })

    it('uses the part of moduleRef before the colon as the instance name', () => {
      dnd.createInstanceNode(moduleData({ moduleRef: 'channel:sodium' }), { x: 0, y: 0 })
      expect(flow.addNodes.mock.calls[0][0].data.name).toBe('channel')
    })

    it('uses the whole moduleRef as the instance name when it has no colon', () => {
      dnd.createInstanceNode(moduleData({ moduleRef: 'plainmodule' }), { x: 0, y: 0 })
      expect(flow.addNodes.mock.calls[0][0].data.name).toBe('plainmodule')
    })

    it('suffixes the instance name with the first free counter when names collide', () => {
      flow.nodes.value = [
        { id: 'dndnode_0', data: { name: 'membrane' } },
        { id: 'dndnode_1', data: { name: 'membrane_1' } },
        { id: 'dndnode_2', data: { name: 'other' } },
      ]

      const { nodeId } = dnd.createInstanceNode(moduleData(), { x: 0, y: 0 })

      expect(nodeId).toBe('dndnode_3')
      expect(flow.addNodes.mock.calls[0][0].data.name).toBe('membrane_2')
    })

    it('keeps the plain name when only other names are taken', () => {
      flow.nodes.value = [{ id: 'dndnode_0', data: { name: 'membrane_1' } }]
      dnd.createInstanceNode(moduleData(), { x: 0, y: 0 })
      expect(flow.addNodes.mock.calls[0][0].data.name).toBe('membrane')
    })

    it('appends the ghost handles to the supplied handles', () => {
      const supplied = [{ uid: 'mine', side: 'left' }]
      dnd.createInstanceNode(moduleData(), { x: 0, y: 0 }, supplied)

      const { handles } = flow.addNodes.mock.calls[0][0].data
      const ghostCount = 2 * NUM_GHOST_HANDLES_TOP_BOT + 2 * NUM_GHOST_HANDLES_LEFT_RIGHT
      expect(handles[0]).toBe(supplied[0])
      expect(handles).toHaveLength(1 + buildGhostHandles(NUM_GHOST_HANDLES_TOP_BOT, NUM_GHOST_HANDLES_LEFT_RIGHT).length)
      expect(handles.length).toBeGreaterThan(1)
      expect(handles.length).toBeLessThanOrEqual(1 + ghostCount)
    })

    it('treats a module from the ghost modules file as a ghost node', () => {
      const result = dnd.createInstanceNode(
        moduleData({ moduleRef: 'ghost:ghost', mathRef: `${GHOST_MODULE_FILENAME}:ghost` }),
        { x: 0, y: 0 }
      )

      expect(result.nodeType).toBe(GHOST_NODE_TYPE)
      expect(flow.addNodes.mock.calls[0][0].type).toBe(GHOST_NODE_TYPE)
    })

    it('does not treat a file that merely contains the ghost name as ghost', () => {
      const { nodeType } = dnd.createInstanceNode(
        moduleData({ mathRef: `x_${GHOST_MODULE_FILENAME}:ghost` }),
        { x: 0, y: 0 }
      )
      expect(nodeType).toBe(MAIN_NODE_TYPE)
    })

    it('assigns each global_constant variable to the library store and skips other variables', () => {
      const store = useLibraryStore()
      dnd.createInstanceNode(
        moduleData({
          variables: [
            { name: 'gNa', type: 'global_constant', value: 120, units: 'nS', data_reference: 'ref-1' },
            { name: 'x', type: 'constant', value: 5, units: 'dimensionless' },
          ],
        }),
        { x: 0, y: 0 }
      )

      expect(store.getGlobalConstant('gNa')).toEqual({ value: 120, units: 'nS', data_reference: 'ref-1' })
      expect(store.getGlobalConstant('x')).toBeUndefined()
    })

    it('does not overwrite a global constant that already exists in the store', () => {
      const store = useLibraryStore()
      store.assignGlobalConstant('gNa', 1, 'nS', 'old')

      dnd.createInstanceNode(
        moduleData({
          variables: [{ name: 'gNa', type: 'global_constant', value: 999, units: 'nS', data_reference: 'new' }],
        }),
        { x: 0, y: 0 }
      )

      expect(store.getGlobalConstant('gNa')).toEqual({ value: 1, units: 'nS', data_reference: 'old' })
    })

    it('seeds blank variable values from the math defaults held by the library store', () => {
      const store = useLibraryStore()
      store.getMathAnalysis = vi.fn(() => null)
      store.getMathDefaults = vi.fn(() => new Map([['Cm', '2.5']]))

      dnd.createInstanceNode(
        moduleData({ variables: [{ name: 'Cm', type: 'constant', value: '' }] }),
        { x: 0, y: 0 }
      )

      expect(store.getMathDefaults).toHaveBeenCalledWith('membrane.cellml:basic')
      const variables = flow.addNodes.mock.calls[0][0].data.variables
      expect(variables.find((v) => v.name === 'Cm').value).toBe('2.5')
    })

    it('subscribes to onNodesInitialized before adding the node', () => {
      dnd.createInstanceNode(moduleData(), { x: 0, y: 0 })
      expect(flow.initCallbacks).toHaveLength(1)
      expect(flow.updateNode).not.toHaveBeenCalled()
    })

    it('centres the node on its drop position once initialised, then unsubscribes', () => {
      const { nodeId } = dnd.createInstanceNode(moduleData(), { x: 100, y: 200 })

      flow.initCallbacks[0]()

      expect(flow.updateNode).toHaveBeenCalledTimes(1)
      expect(flow.updateNode.mock.calls[0][0]).toBe(nodeId)
      const node = { position: { x: 100, y: 200 }, dimensions: { width: 40, height: 20 }, data: { name: 'm' } }
      const update = flow.updateNode.mock.calls[0][1](node)
      expect(update.position).toEqual({ x: 80, y: 190 })
      expect(update.data).toBe(node.data)
      expect(flow.off).toHaveBeenCalledTimes(1)
    })

    it('puts the centred node in the layout frame of a node already laid out', () => {
      const layoutFrame = { xScale: 2, yScale: 4, xCentre: 10, yCentre: 20 }
      flow.nodes.value = [{ id: 'dndnode_0', data: { name: 'laid_out', layoutFrame } }]
      dnd.createInstanceNode(moduleData(), { x: 100, y: 200 })

      flow.initCallbacks[0]()

      const node = { position: { x: 100, y: 200 }, dimensions: { width: 40, height: 20 }, data: { name: 'm' } }
      const update = flow.updateNode.mock.calls[0][1](node)
      expect(update.position).toEqual({ x: 80, y: 190 })
      expect(update.data).toEqual({ name: 'm', layoutFrame, layoutRef: { refX: 50, refY: 67.5 } })
    })
  })

  describe('onDrop', () => {
    const dropEvent = { clientX: 5, clientY: 6 }

    it('does nothing when nothing is being dragged', () => {
      dnd.onDrop(dropEvent)

      expect(flow.addNodes).not.toHaveBeenCalled()
      expect(flow.screenToFlowCoordinate).not.toHaveBeenCalled()
    })

    it('places the dragged module at the converted flow coordinate', () => {
      dnd.onDragStart({}, moduleData())
      dnd.onDrop(dropEvent)

      expect(flow.screenToFlowCoordinate).toHaveBeenCalledWith({ x: 5, y: 6 })
      expect(flow.addNodes.mock.calls[0][0].position).toEqual({ x: 1005, y: 1006 })
      expect(dnd.isGhostSetupOpen.value).toBe(false)
      expect(dnd.pendingGhostNodeId.value).toBeNull()
    })

    it('opens ghost setup for the new node when a ghost module is dropped', () => {
      dnd.onDragStart({}, moduleData({ mathRef: `${GHOST_MODULE_FILENAME}:ghost` }))
      dnd.onDrop(dropEvent)

      expect(dnd.isGhostSetupOpen.value).toBe(true)
      expect(dnd.pendingGhostNodeId.value).toBe(flow.addNodes.mock.calls[0][0].id)
    })
  })

  describe('drag state', () => {
    it('onDragStart stores the module, sets the transfer data and flags dragging', () => {
      const module = moduleData()
      const dataTransfer = { setData: vi.fn(), effectAllowed: '' }

      dnd.onDragStart({ dataTransfer }, module)

      expect(dataTransfer.setData).toHaveBeenCalledWith('application/vueflow', 'membrane:basic')
      expect(dataTransfer.effectAllowed).toBe('move')
      expect(dnd.draggedType.value).toBe(module)
      expect(dnd.isDragging.value).toBe(true)
    })

    it('a document drop event ends the drag and clears the state', () => {
      dnd.onDragStart({}, moduleData())
      dnd.onDragOver({ preventDefault: vi.fn() })
      expect(dnd.isDragOver.value).toBe(true)

      document.dispatchEvent(new Event('drop'))

      expect(dnd.isDragging.value).toBe(false)
      expect(dnd.isDragOver.value).toBe(false)
      expect(dnd.draggedType.value).toBeNull()
    })

    it('onDragOver prevents default and sets the drop effect only while dragging', () => {
      const idle = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' } }
      dnd.onDragOver(idle)
      expect(idle.preventDefault).toHaveBeenCalled()
      expect(idle.dataTransfer.dropEffect).toBe('')
      expect(dnd.isDragOver.value).toBe(false)

      dnd.onDragStart({}, moduleData())
      const active = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' } }
      dnd.onDragOver(active)
      expect(active.dataTransfer.dropEffect).toBe('move')
      expect(dnd.isDragOver.value).toBe(true)

      dnd.onDragLeave()
      expect(dnd.isDragOver.value).toBe(false)
      document.dispatchEvent(new Event('drop'))
    })

    it('hides text selection on the body while dragging', async () => {
      const { nextTick } = await import('vue')
      dnd.onDragStart({}, moduleData())
      await nextTick()
      expect(document.body.style.userSelect).toBe('none')

      document.dispatchEvent(new Event('drop'))
      await nextTick()
      expect(document.body.style.userSelect).toBe('')
    })

    it('binds to the main flow by default and to the requested flow otherwise', () => {
      expect(flow.flowIds.at(-1)).toBe(FLOW_IDS.MAIN)
      useDragAndDrop(new Set(), FLOW_IDS.MACRO)
      expect(flow.flowIds.at(-1)).toBe(FLOW_IDS.MACRO)
    })
  })
})
