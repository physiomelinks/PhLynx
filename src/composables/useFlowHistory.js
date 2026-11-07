import { useVueFlow } from '@vue-flow/core'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { FLOW_IDS } from '../utils/constants'
import { enclosedEdgeOffsets, getEdgeWaypoints, translateWaypoints, withEdgeWaypoints } from '../utils/edgeRoute'
import { detachReactivity } from '../utils/reactivity'
import { useEdgeDragOffsets } from './useEdgeDragOffsets'

/**
 * Maps a keydown event to an undo or redo request: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and
 * Ctrl/Cmd+Y redo. Ignores whether there is anything to undo or redo.
 *
 * @param {KeyboardEvent} event
 * @returns {'undo'|'redo'|null}
 */
export function getUndoRedoAction(event) {
  const isCtrl = event.ctrlKey || event.metaKey
  const isShift = event.shiftKey
  const key = event.key.toLowerCase()

  if (isCtrl && !isShift && key === 'z') return 'undo'
  if (isCtrl && isShift && key === 'z') return 'redo'
  if (isCtrl && key === 'y') return 'redo'
  return null
}

/**
 * Turns Vue Flow node and edge changes into undo/redo commands on the history store.
 *
 * @param {Object} options
 * @param {Set<string>} options.suppressedEdgeIds - Edge ids whose add/remove changes are not recorded.
 * @param {Function} options.indexAddEdge - Adds an edge to the node-edge index.
 * @param {Function} options.indexRemoveEdge - Removes an edge change from the node-edge index.
 * @param {Function} options.updateHelperLines - Updates alignment helper lines for node changes.
 * @param {Function} options.revertHandlesForEdge - From useHandleManagement.
 * @param {Function} options.reactivateEdgeHandles - From useHandleManagement.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @returns {{ onNodeChange: Function, onEdgeChange: Function }}
 */
export function useFlowHistory({
  suppressedEdgeIds,
  indexAddEdge,
  indexRemoveEdge,
  updateHelperLines,
  revertHandlesForEdge,
  reactivateEdgeHandles,
  flowId = FLOW_IDS.MAIN,
}) {
  const { addEdges, addNodes, applyNodeChanges, applyEdgeChanges, edges, findEdge, findNode, nodes, removeEdges, removeNodes } =
    useVueFlow(flowId)
  const { edgeDragOffsets } = useEdgeDragOffsets()
  const historyStore = useFlowHistoryStore()
  const libraryStore = useLibraryStore()

  const activeInteractionBuffer = new Map()
  const undoRedoSelection = false

  const createSelectCommand = (changes, findFn) => {
    return {
      type: 'select',
      undo: () => {
        changes.forEach((s) => {
          const item = findFn(s.id)
          if (item) item.selected = s.from
        })
      },
      redo: () => {
        changes.forEach((s) => {
          const item = findFn(s.id)
          if (item) item.selected = s.to
        })
      },
    }
  }

  const snapshotEdge = (change) => {
    if (change.type === 'add') {
      return detachReactivity(change.item)
    }

    const edge = findEdge(change.id)
    if (!edge) return null

    // Create a deep copy to break reactivity references
    return detachReactivity(edge)
  }

  const snapshotNode = (change) => {
    if (change.type === 'add') {
      // For added nodes, snapshot is the node itself
      return detachReactivity(change.item)
    }

    const node = findNode(change.id)
    if (!node) return null

    // Create a deep copy to break reactivity references
    return detachReactivity(node)
  }

  const processPositionChange = (c, buffer, moveChanges) => {
    if (c.position === undefined && c.from && buffer.has(c.id)) {
      // Drag End
      const start = buffer.get(c.id)
      const end = snapshotNode({ id: c.id })

      if (end && (start.position.x !== end.position.x || start.position.y !== end.position.y)) {
        moveChanges.push({ start, end })
      }
      buffer.delete(c.id)
    } else if (c.position && !buffer.has(c.id)) {
      // Drag Start
      const snap = snapshotNode({ id: c.id })
      if (snap) buffer.set(c.id, snap)
    }
  }

  const processDimensionChange = (c, buffer) => {
    if (historyStore.lastChangeWasAdd) {
      historyStore.lastChangeWasAddSetter(false)
      if (!historyStore.lastCommandHadOffsetApplied) {
        const node = snapshotNode(c)
        node.position = {
          x: node.position.x - node.dimensions.width / 2,
          y: node.position.y - node.dimensions.height / 2,
        }
        historyStore.replaceLastCommand({
          type: 'add',
          offset: 'applied',
          undo: () => removeNodes(node.id),
          redo: () => addNodes(node),
        })
      }
    } else if (c.dimensions === undefined && buffer.has(c.id)) {
      const startSnapshot = buffer.get(c.id)
      const endSnapshot = snapshotNode({ id: c.id })

      // Only add command if dimensions actually changed
      if (
        endSnapshot &&
        (startSnapshot.dimensions.width !== endSnapshot.dimensions.width ||
          startSnapshot.dimensions.height !== endSnapshot.dimensions.height)
      ) {
        historyStore.addCommand({
          type: 'resize',
          undo: () => {
            const n = findNode(startSnapshot.id)
            if (n) {
              n.dimensions = startSnapshot.dimensions
              n.position = startSnapshot.position
              n.style = { ...startSnapshot.style }
            }
          },
          redo: () => {
            const n = findNode(endSnapshot.id)
            if (n) {
              n.dimensions = endSnapshot.dimensions
              n.position = endSnapshot.position
              n.style = { ...endSnapshot.style }
            }
          },
        })
      }
      buffer.delete(c.id)
    } else if (c.dimensions) {
      if (!buffer.has(c.id)) {
        const snap = snapshotNode({ id: c.id })
        if (snap) {
          buffer.set(c.id, snap)
        }
      }
    }
  }

  /**
   * Shows routed edges between nodes dragged together moving with them, until the drag ends.
   *
   * @param {Array<Object>} changes - Position changes of a drag in progress.
   */
  const carryRoutesWhileDragging = (changes) => {
    const offsets = new Map()
    changes.forEach((c) => {
      const start = activeInteractionBuffer.get(c.id)
      if (start) offsets.set(c.id, { x: c.position.x - start.position.x, y: c.position.y - start.position.y })
    })
    edgeDragOffsets.value = enclosedEdgeOffsets(edges.value, offsets)
  }

  /**
   * Moves the waypoints of routed edges whose two nodes moved together, as one undo step that
   * batches with the move.
   *
   * @param {Array<{start: Object, end: Object}>} moveChanges
   */
  const carryRoutesAfterMove = (moveChanges) => {
    if (edgeDragOffsets.value.size) edgeDragOffsets.value = new Map()
    const offsets = new Map(
      moveChanges.map(({ start, end }) => [start.id, { x: end.position.x - start.position.x, y: end.position.y - start.position.y }])
    )
    const moved = [...enclosedEdgeOffsets(edges.value, offsets)].map(([id, offset]) => {
      const before = getEdgeWaypoints(findEdge(id))
      return { id, before, after: translateWaypoints(before, offset.x, offset.y) }
    })
    if (!moved.length) return

    const apply = (side) =>
      moved.forEach((m) => {
        const edge = findEdge(m.id)
        if (edge) edge.data = withEdgeWaypoints(edge.data, m[side])
      })
    apply('after')
    historyStore.addCommand({ type: 'edge-route', undo: () => apply('before'), redo: () => apply('after') })
  }

  /**
   * Moves the waypoints of routed edges whose two nodes were nudged together by the arrow keys.
   *
   * @param {Array<Object>} changes - Position changes outside a drag.
   */
  const carryRoutesWhileNudging = (changes) => {
    const offsets = new Map()
    changes.forEach((c) => {
      const node = findNode(c.id)
      if (node) offsets.set(c.id, { x: c.position.x - node.position.x, y: c.position.y - node.position.y })
    })
    enclosedEdgeOffsets(edges.value, offsets).forEach((offset, id) => {
      const edge = findEdge(id)
      edge.data = withEdgeWaypoints(edge.data, translateWaypoints(getEdgeWaypoints(edge), offset.x, offset.y))
    })
  }

  /**
   * Records node changes as undo steps, then applies them to the flow.
   *
   * @param {Array<Object>} changes - Vue Flow node changes.
   */
  const onNodeChange = (changes) => {
    if (historyStore.isUndoRedoing) {
      // If we are currently undoing/redoing, bypass history tracking
      return applyNodeChanges(changes)
    }

    // Add node and dimension changes are single node events.
    // All other changes can be performed on multiple nodes in a change set.

    const addChanges = []
    const removeChanges = []
    const moveChanges = []
    const selectChanges = []
    // Arrow-key moves come as one position change each, with no drag around them.
    const nudges = changes.filter((c) => c.type === 'position' && c.position && !c.dragging)
    if (nudges.length) carryRoutesWhileNudging(nudges)

    changes.forEach((c) => {
      // Deal with the changes that we need to buffer first, which are the posiiton and dimension type changes.
      if (c.type === 'position' && c.position && !c.dragging) {
        // A nudge has no end to wait for.
      } else if (c.type === 'position') {
        processPositionChange(c, activeInteractionBuffer, moveChanges)
      } else if (c.type === 'dimensions') {
        processDimensionChange(c, activeInteractionBuffer)
      } else {
        // Non-active interaction buffer changes.
        activeInteractionBuffer.delete(c.id)
        if (c.type === 'add') {
          addChanges.push({ node: snapshotNode(c) })
        } else if (c.type === 'remove') {
          removeChanges.push({ node: snapshotNode(c) })
        } else if (c.type === 'select' && undoRedoSelection) {
          const node = findNode(c.id)
          if (node) {
            selectChanges.push({ id: c.id, from: node.selected, to: c.selected })
          }
        }
      }
    })

    const dragging = changes.filter((c) => c.type === 'position' && c.position && c.dragging)
    if (dragging.length > 1) carryRoutesWhileDragging(dragging)

    if (moveChanges.length) {
      carryRoutesAfterMove(moveChanges)
      historyStore.addCommand({
        type: 'move',
        undo: () => {
          moveChanges.forEach((m) => {
            const n = findNode(m.start.id)
            if (n) n.position = m.start.position
          })
        },
        redo: () => {
          moveChanges.forEach((m) => {
            const n = findNode(m.end.id)
            if (n) n.position = m.end.position
          })
        },
      })
    }
    if (addChanges.length) {
      const nodesToAdd = addChanges.map((c) => c.node)
      const idsToRemove = addChanges.map((c) => c.node.id)

      historyStore.lastChangeWasAddSetter(true)
      historyStore.addCommand({
        type: 'add',
        offset: 'not-applied',
        undo: () => removeNodes(idsToRemove),
        redo: () => addNodes(nodesToAdd),
      })
    }
    if (removeChanges.length) {
      const nodesToRestore = removeChanges.map((change) => change.node)
      const idsToRemove = new Set(removeChanges.map((change) => change.node.id))
      const remainingNodes = nodes.value.filter((n) => !idsToRemove.has(n.id))
      const removedConstants = libraryStore.cleanupUnusedGlobalConstants(remainingNodes)
      historyStore.addCommand({
        type: 'remove',
        undo: () => {
          addNodes(nodesToRestore)
          removedConstants.forEach((c) => {
            libraryStore.assignGlobalConstant(c.name, c.value, c.units, c.data_reference)
          })
        },
        redo: () => {
          removeNodes(Array.from(idsToRemove))
          removedConstants.forEach((c) => {
            libraryStore.removeGlobalConstant(c.name)
          })
        },
      })
    }
    if (selectChanges.length) {
      historyStore.addCommand(createSelectCommand(selectChanges, findNode))
    }

    updateHelperLines(changes, nodes.value)

    // Have Vue Flow update the graph
    applyNodeChanges(changes)
  }

  /**
   * Records edge changes as undo steps, then applies them to the flow.
   *
   * @param {Array<Object>} changes - Vue Flow edge changes.
   */
  const onEdgeChange = (changes) => {
    if (historyStore.isUndoRedoing) {
      // If we are currently undoing/redoing, bypass history tracking
      return applyEdgeChanges(changes)
    }

    const removeChanges = []
    const addChanges = []
    const selectChanges = []
    changes.forEach((c) => {
      if (c.type === 'remove') {
        indexRemoveEdge(c)
        if (!suppressedEdgeIds.has(c.id)) {
          removeChanges.push({ edge: snapshotEdge(c) })
        }
      } else if (c.type === 'add') {
        indexAddEdge(c.item)
        if (!suppressedEdgeIds.has(c.item.id)) {
          addChanges.push({ edge: snapshotEdge(c) })
        }
      } else if (c.type === 'select' && undoRedoSelection) {
        const edge = findEdge(c.id)
        selectChanges.push({ id: c.id, from: edge.selected, to: c.selected })
      }
    })

    if (addChanges.length) {
      const edgesToRestore = addChanges.map((change) => change.edge)
      const idsToRemove = addChanges.map((change) => change.edge.id)
      historyStore.addCommand({
        undo: () => {
          removeEdges(idsToRemove)
          edgesToRestore.forEach((edge) => revertHandlesForEdge(edge, idsToRemove, { trackHistory: false }))
        },
        redo: () => {
          addEdges(edgesToRestore)
          edgesToRestore.forEach((edge) => reactivateEdgeHandles(edge, { trackHistory: false }))
        },
      })
    }

    if (removeChanges.length) {
      const edgesToRestore = removeChanges.map((change) => change.edge)
      const idsToRemove = removeChanges.map((change) => change.edge.id)

      // Ghost out any handle that no longer has an edge attached to it.
      // excludeEdgeIds is passed because edges.value hasn't actually
      // dropped these ids yet at this point.
      edgesToRestore.forEach((edge) => revertHandlesForEdge(edge, idsToRemove))

      historyStore.addCommand({
        undo: () => {
          addEdges(edgesToRestore)
          edgesToRestore.forEach((edge) => reactivateEdgeHandles(edge, { trackHistory: false }))
        },
        redo: () => {
          removeEdges(idsToRemove)
          edgesToRestore.forEach((edge) => revertHandlesForEdge(edge, idsToRemove, { trackHistory: false }))
        },
      })
    }

    if (selectChanges.length) {
      historyStore.addCommand(createSelectCommand(selectChanges, findEdge))
    }

    applyEdgeChanges(changes)
  }

  return { onNodeChange, onEdgeChange }
}
