import { nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { annotatedCouplingsBetween } from '../services/annotations/couple'
import { useCouplingContext } from './useCouplingContext'
import { FLOW_IDS } from '../utils/constants'
import { resolvePortCouplings } from '../utils/edges'
import { getHandleUidFromHandleId } from '../utils/handles'
import { detachReactivity } from '../utils/reactivity'
import { notify } from '../utils/notify'

/**
 * Registers the Vue Flow connect handler: validates a new connection, activates its handles,
 * asks before replacing an existing connection between the same instances, and adds the edge
 * with its resolved port couplings. Between two nodes bound to ApiCoords with annotated math, the
 * matcher's suggested couplings are added too, with any ports they need, in the same undo step.
 *
 * @param {Object} options
 * @param {Set<string>} options.suppressedEdgeIds - Edge ids whose add/remove changes are not recorded.
 * @param {Function} options.confirm - Confirm dialog; resolves true to replace the existing edge.
 * @param {Object} options.edgeLineOptions - Default options merged into new edges.
 * @param {Function} options.confirmActivation - From useHandleManagement.
 * @param {Function} options.activateHandle - From useHandleManagement.
 * @param {Function} options.revertHandleIfUnused - From useHandleManagement.
 * @param {Function} options.revertHandlesForEdge - From useHandleManagement.
 * @param {Function} options.reactivateEdgeHandles - From useHandleManagement.
 * @param {Function} [options.recordEdit] - From useNodeDataHistory, to record the ports annotated couplings add.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 */
export function useConnect({
  suppressedEdgeIds,
  confirm,
  edgeLineOptions,
  confirmActivation,
  activateHandle,
  revertHandleIfUnused,
  revertHandlesForEdge,
  reactivateEdgeHandles,
  recordEdit,
  flowId = FLOW_IDS.MAIN,
}) {
  const { addEdges, edges, findNode, nodes, onConnect, removeEdges } = useVueFlow(flowId)
  const historyStore = useFlowHistoryStore()
  const libraryStore = useLibraryStore()
  const { ensureContext } = useCouplingContext()

  /** Whether a node is bound to an ApiCoord and its math has a sidecar. */
  const isAnnotatedNode = (node) => !!node.data?.apiCoord && !!libraryStore.getModuleAnnotations(node.data?.mathRef)

  /**
   * The matcher's couplings between two annotated nodes (see isAnnotatedNode), and the ports they add. A file
   * that fails to parse leaves the edge to its label couplings.
   *
   * @returns {Promise<ReturnType<typeof annotatedCouplingsBetween>|null>} Null when there are none.
   */
  async function annotatedCouplings(sourceNode, targetNode) {
    const allNodes = nodes?.value ?? [sourceNode, targetNode]
    try {
      const context = await ensureContext(allNodes)
      const result = annotatedCouplingsBetween(sourceNode, targetNode, allNodes, context)
      return result.couplings.length ? result : null
    } catch (error) {
      console.warn('Annotated couplings unavailable:', error)
      notify.warning({ message: `Couldn't read the annotations, so only labels coupled this edge: ${error.message}` })
      return null
    }
  }

  /**
   * Adds ports to nodes, as one recorded edit when recordEdit is given.
   *
   * @param {Map<string, Array<Object>>} addedPorts
   */
  async function addPorts(addedPorts) {
    const nodeIds = [...addedPorts.keys()].filter((id) => addedPorts.get(id).length)
    if (!nodeIds.length) return
    const apply = () =>
      nodeIds.forEach((id) => {
        const node = findNode(id)
        if (node) node.data = { ...node.data, ports: [...(node.data.ports ?? []), ...addedPorts.get(id)] }
      })
    if (recordEdit) await recordEdit({ type: 'add-annotated-ports', nodeIds, keys: ['ports'], apply })
    else apply()
  }

  onConnect(async (connection) => {
    const sourceNode = findNode(connection.source)
    const targetNode = findNode(connection.target)

    if (!sourceNode || !targetNode) return
    if (sourceNode === targetNode) return

    const isExistingConnection = edges.value.find(
      (e) => e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle,
    )
    if (isExistingConnection) return

    const duplicate = edges.value.find((e) => e.source === connection.source && e.target === connection.target)

    const duplicateSnapshot = duplicate ? detachReactivity(duplicate) : null

    const sourceHandleUid = connection.sourceHandle ? getHandleUidFromHandleId(connection.sourceHandle) : null
    const targetHandleUid = connection.targetHandle ? getHandleUidFromHandleId(connection.targetHandle) : null

    confirmActivation()

    if (sourceHandleUid) {
      activateHandle(connection.source, sourceHandleUid, {
        trackHistory: false,
      })
    }
    if (targetHandleUid) {
      activateHandle(connection.target, targetHandleUid, {
        trackHistory: false,
      })
    }

    if (duplicate) {
      const pendingEdge = {
        ...connection,
        id: `pending--${connection.source}--${connection.target}`,
        style: { strokeDasharray: '8 8', opacity: 0.4 }, // visually mark "unconfirmed"
      }

      suppressedEdgeIds.add(pendingEdge.id)
      addEdges(pendingEdge)

      const shouldReplace = await confirm({
        header: 'Connection already exists',
        message:
          'A connection already exists between these instances. Do you wish to replace it?\n\n' +
          'If you select Cancel, the new connection will be discarded and the existing connection will remain.',
        severity: 'warning',
        acceptLabel: 'Replace',
        rejectLabel: 'Cancel',
      })

      if (!shouldReplace) {
        removeEdges(pendingEdge.id)
        suppressedEdgeIds.delete(pendingEdge.id)
        if (sourceHandleUid)
          revertHandleIfUnused(connection.source, sourceHandleUid, {
            trackHistory: false,
          })
        if (targetHandleUid)
          revertHandleIfUnused(connection.target, targetHandleUid, {
            trackHistory: false,
          })
        return
      }

      suppressedEdgeIds.add(duplicateSnapshot.id)
      await revertHandlesForEdge(duplicateSnapshot, [duplicateSnapshot.id], {
        trackHistory: false,
      })
      removeEdges(duplicateSnapshot.id)
      removeEdges(pendingEdge.id)
      suppressedEdgeIds.delete(pendingEdge.id)
    }

    // Derive ordinal indices from the existing edge graph:
    //   sourceIndex = how many edges already leave from this source node
    //                 (i.e. this is the Nth output being connected)
    //   targetIndex = how many edges already arrive at this target node
    //                 (i.e. this is the Nth input being connected)
    // These mirror the positional semantics of out_modules / inp_modules.
    const sourceIndex = edges.value.filter((e) => e.source === connection.source).length
    const targetIndex = edges.value.filter((e) => e.target === connection.target).length

    // Resolve which port labels are coupled across this conduit, using ordinal
    // indices to select the correct slot when a label appears multiple times.
    const couplings = resolvePortCouplings(
      sourceNode.data.ports ?? [],
      targetNode.data.ports ?? [],
      sourceIndex,
      targetIndex,
    )

    // Annotated ports never couple by label: the matcher couples them, adding the ports it needs in one step
    // with the edge. Other pairs stay synchronous, as before annotations.
    const annotated =
      isAnnotatedNode(sourceNode) && isAnnotatedNode(targetNode)
        ? await annotatedCouplings(sourceNode, targetNode)
        : null
    if (annotated) couplings.push(...annotated.couplings)

    const newEdge = {
      ...connection,
      ...edgeLineOptions,
      id: `${connection.source}--${connection.target}`,
      data: {
        couplings,
      },
    }

    const isBatched = !!annotated?.addedPorts.size
    if (isBatched) historyStore.startBatch()
    try {
      if (isBatched) await addPorts(annotated.addedPorts)
      if (duplicate) {
        suppressedEdgeIds.add(newEdge.id)
        addEdges(newEdge)
        suppressedEdgeIds.delete(duplicateSnapshot.id)
        suppressedEdgeIds.delete(newEdge.id)

        historyStore.addCommand({
          type: 'replace-edge',
          async undo() {
            await revertHandlesForEdge(newEdge, [newEdge.id], {
              trackHistory: false,
            })
            removeEdges(newEdge.id)
            addEdges(duplicateSnapshot)
            await reactivateEdgeHandles(duplicateSnapshot, {
              trackHistory: false,
            })
          },
          async redo() {
            await revertHandlesForEdge(duplicateSnapshot, [duplicateSnapshot.id], { trackHistory: false })
            removeEdges(duplicateSnapshot.id)
            addEdges(newEdge)
            await reactivateEdgeHandles(newEdge, { trackHistory: false })
          },
        })
      } else {
        addEdges(newEdge)
      }
    } finally {
      // A failed edit still closes the batch, so later edits aren't swallowed into it.
      if (isBatched) {
        await nextTick()
        historyStore.endBatch()
      }
    }
  })
}
