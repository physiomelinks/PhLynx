import { useVueFlow } from '@vue-flow/core'
import { ref, shallowRef, watch } from 'vue'
import {
  FLOW_IDS,
  GHOST_MODULE_FILENAME,
  GHOST_NODE_TYPE,
  MAIN_NODE_TYPE,
  NUM_GHOST_HANDLES_LEFT_RIGHT,
  NUM_GHOST_HANDLES_TOP_BOT
} from '../utils/constants'
import { attachNewNodeToFrame, findAnyNode, generateUniqueInstanceName } from '../utils/nodes'
import { buildInstance } from '../services/import/buildWorkflow'
import { buildGhostHandles } from '../utils/handles'
import { useActiveCanvas } from './useActiveCanvas'
import { usePreservedNaming } from './usePreservedNaming'
import { useSupermodules } from './useSupermodules'
import { notify } from '../utils/notify'
import { toLocalName } from '../utils/hierarchy'
import { useLibraryStore } from '../stores/libraryStore'
import { extractGlobalConstants } from '../utils/variables'

/**
 * In a real world scenario you'd want to avoid creating refs in a global scope like this as they might not be cleaned up properly.
 * @type {{draggedType: Ref<string|null>, isDragOver: Ref<boolean>, isDragging: Ref<boolean>}}
 */
const state = {
  /**
   * The type of the node being dragged.
   */
  draggedType: shallowRef(null),
  isDragOver: ref(false),
  isDragging: ref(false),
}

/**
 * Drag and drop of modules and super-modules onto a flow's canvas.
 *
 * @param {Set|Object} pendingHistoryNodes
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @param {Object} [options]
 * @param {Function} [options.confirm] - The confirm dialog, which asks before another super instance changes preserved
 *   flat names (see usePreservedNaming).
 */
export default function useDragAndDrop(pendingHistoryNodes, flowId = FLOW_IDS.MAIN, { confirm = null } = {}) {
  const { draggedType, isDragOver, isDragging } = state

  const { addNodes, onNodesInitialized, screenToFlowCoordinate, updateNode } = useVueFlow(flowId)
  const { scope, nodes: canvasNodes, nextNodeId } = useActiveCanvas(flowId)
  const store = useLibraryStore()
  const { addSuperInstance, createEmptySuperModule, freeSupermoduleName, placeLibrarySupermodule } = useSupermodules(flowId)

  const preservedNaming = usePreservedNaming({ flowId, confirm })
  const isGhostSetupOpen = ref(false)
  const pendingGhostNodeId = ref(null)

  watch(isDragging, (dragging) => {
    document.body.style.userSelect = dragging ? 'none' : ''
  })

  /**
   * Starts dragging a module, a super-module (`{smId}`) to place another super instance of, a library super-module
   * (`{caSupermodule: moduleRef}`), or a new, empty super-module (`{emptySupermodule: true}`).
   *
   * @param {DragEvent} event
   * @param {Object} module - A library module, `{smId}`, `{caSupermodule}` or `{emptySupermodule}`.
   */
  function onDragStart(event, module) {
    if (event.dataTransfer) {
      event.dataTransfer.setData('application/vueflow', module.moduleRef ?? module.smId ?? module.caSupermodule ?? 'empty-supermodule')
      event.dataTransfer.effectAllowed = 'move'
    }

    draggedType.value = module
    isDragging.value = true

    document.addEventListener('drop', onDragEnd)
  }

  /**
   * Handles the drag over event.
   *
   * @param {DragEvent} event
   */
  function onDragOver(event) {
    event.preventDefault()

    if (draggedType.value) {
      isDragOver.value = true

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    }
  }

  function onDragLeave() {
    isDragOver.value = false
  }

  function onDragEnd() {
    isDragging.value = false
    isDragOver.value = false
    draggedType.value = null
    document.removeEventListener('drop', onDragEnd)
  }

  /**
   * Creates a new instance node at the given position and adds it to the flow.
   * Returns the new node's id and type so the caller can handle any
   * post-creation logic (e.g. opening the ghost setup dialog).
   *
   * @param {object} moduleData - The module descriptor (ports, mathRef, variables)
   * @param {{x: number, y: number}} position - Flow coordinates to place the node.
   * @returns {{ nodeId: string, nodeType: string }}
   */
  function createInstanceNode(moduleData, position, handles = []) {
    const nodeId = nextNodeId()
    pendingHistoryNodes.add(nodeId)

    const existingNames = new Set(canvasNodes.value.map((n) => n.data.name))
    const moduleName = moduleData.moduleRef.includes(":") ? moduleData.moduleRef.split(":")[0] : moduleData.moduleRef
    // Inside a super-module, names keep its rules (see utils/hierarchy localNameProblem).
    const instanceName = scope.value ? toLocalName(moduleName) : moduleName
    const finalName = generateUniqueInstanceName(instanceName, existingNames)

    const allHandles = [...handles, ...buildGhostHandles(NUM_GHOST_HANDLES_TOP_BOT, NUM_GHOST_HANDLES_LEFT_RIGHT)]

    const componentFile = moduleData.mathRef.split(":")[0]
    const nodeType = componentFile === GHOST_MODULE_FILENAME ? GHOST_NODE_TYPE : MAIN_NODE_TYPE

    const mathAnalysis = store.getMathAnalysis(moduleData.mathRef)
    const mathDefaults = store.getMathDefaults(moduleData.mathRef)
    const newNode = buildInstance(nodeId, finalName, nodeType, moduleData, allHandles, position, mathAnalysis, mathDefaults)

    const globalConstants = extractGlobalConstants(newNode.data.variables)
    
    for (const g of globalConstants) {
      store.assignGlobalConstant(g.name, g.value, g.units, g.data_reference)
    }

    /**
     * Align node position after drop, so it's centered to the mouse.
     * We can hook into events even in a callback, and we can remove the event listener after it's been called.
     */
    const { off } = onNodesInitialized(() => {
      updateNode(nodeId, (node) => {
        const centredPosition = {
          x: node.position.x - node.dimensions.width / 2,
          y: node.position.y - node.dimensions.height / 2,
        }

        const existingNode = findAnyNode()
        const frameData = existingNode
          ? attachNewNodeToFrame(centredPosition, existingNode.data)
          : null

        return {
          position: centredPosition,
          data: frameData ? { ...node.data, ...frameData } : node.data,
        }
      })

      off()
    })

    addNodes(newNode)

    return { nodeId, nodeType }
  }

  /**
   * Handles the drop event.
   *
   * @param {DragEvent} event
   */
  function onDrop(event) {
    const moduleData = draggedType.value
    if (!moduleData) return

    const position = screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY,
    })

    if (moduleData.caSupermodule) {
      return placeLibrarySupermodule(moduleData.caSupermodule, position).then((id) => {
        if (!id) notify.warning({ title: 'Not Placed', message: 'This super-module would then contain itself, so it can’t go here.' })
      }, (error) => notify.error({ title: 'Not Placed', items: [error.message] }))
    }

    if (moduleData.emptySupermodule) {
      // Named free, as an instance is; renamed on the canvas, or in the library.
      try {
        createEmptySuperModule(freeSupermoduleName(), position)
      } catch (error) {
        notify.error({ title: 'Not Placed', items: [error.message] })
      }
      return
    }

    if (moduleData.smId) {
      const place = () => {
        if (!addSuperInstance(moduleData.smId, position)) {
          notify.warning({ title: 'Not Placed', message: 'This super-module would then contain itself, so it can’t go here.' })
        }
      }
      // A super-module keeping its components' own names asks first, as its flat names change.
      const after = preservedNaming.withSuperInstance(moduleData.smId, scope.value)
      if (!preservedNaming.asks(after)) return place()
      return preservedNaming.allow(after, place)
    }

    const { nodeId, nodeType } = createInstanceNode(moduleData, position)

    if (nodeType === GHOST_NODE_TYPE) {
      pendingGhostNodeId.value = nodeId
      isGhostSetupOpen.value = true
    }
  }

  return {
    draggedType,
    isDragOver,
    isDragging,
    isGhostSetupOpen,
    pendingGhostNodeId,
    onDragStart,
    onDragLeave,
    onDragOver,
    onDrop,
    createInstanceNode,
  }
}