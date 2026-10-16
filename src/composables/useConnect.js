import { useVueFlow } from '@vue-flow/core'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useWorkspaceAppearanceStore } from '../stores/workspaceAppearanceStore'
import { FLOW_IDS } from '../utils/constants'
import { resolvePortCouplings, withEdgeAppearance } from '../utils/edges'
import { getHandleUidFromHandleId } from '../utils/handles'
import { detachReactivity } from '../utils/reactivity'

/**
 * Registers the Vue Flow connect handler: validates a new connection, activates its handles,
 * asks before replacing an existing connection between the same instances, and adds the edge
 * with its resolved port couplings. The edge takes the appearance of the one it replaces, or else
 * the workspace's default for new connections.
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
  flowId = FLOW_IDS.MAIN,
}) {
  const { addEdges, edges, findNode, onConnect, removeEdges } = useVueFlow(flowId)
  const historyStore = useFlowHistoryStore()
  const appearanceStore = useWorkspaceAppearanceStore()

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

    const newEdge = {
      ...connection,
      ...edgeLineOptions,
      id: `${connection.source}--${connection.target}`,
      data: withEdgeAppearance(
        { couplings },
        duplicateSnapshot ? duplicateSnapshot.data?.appearance : appearanceStore.newConnectionAppearance()
      ),
    }

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
  })
}
