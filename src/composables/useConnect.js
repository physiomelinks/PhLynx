import { useVueFlow } from '@vue-flow/core'
import { useExposure } from './useExposure'
import { useFlowHistoryFor } from './useFlowHistoryFor'
import { couplingProblems } from '../services/coupling/caReproducible'
import { exposedSlotKeys } from '../services/hierarchy/exposure'
import { FLOW_IDS } from '../utils/constants'
import { buildUsedPortKeys, checkAndClaimCouplings, resolvePortCouplings } from '../utils/edges'
import { getHandleUidFromHandleId } from '../utils/handles'
import { isSupermoduleInterface, scopeOf } from '../utils/hierarchy'
import { notify } from '../utils/notify'
import { escapeHtml } from '../utils/importBatch'
import { detachReactivity } from '../utils/reactivity'

/**
 * Registers the Vue Flow connect handler: validates a new connection, activates its handles,
 * asks before replacing an existing connection between the same instances, and adds the edge
 * with its resolved port couplings. A connection needing a port with no free slot is refused, as is one whose
 * couplings circulatory_autogen would pair otherwise (see couplingProblems), with why: the dialog couldn't make it
 * pair as CA does without the ports changed, which is the instance editor's to do.
 * A super instance connects like a module, through the ports its super-module exposes. Inside a
 * super-module, an exposed single-connection port is taken, by the connection from outside.
 *
 * A connection between a child of a super-module and its interface node makes an exposure edge,
 * which exposes nothing until its ports are picked (see useExposure), and couples nothing; one
 * that would repeat a child's exposure edge opens that edge instead.
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
 * @param {(edgeId: string, options: {isNew: boolean}) => void} [options.onExposureEdge] - Called with an exposure
 *   edge drawn, or the one a drawn connection would repeat, so its ports can be picked.
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
  onExposureEdge = null,
  flowId = FLOW_IDS.MAIN,
}) {
  const { addEdges, edges, findNode, nodes, onConnect, removeEdges } = useVueFlow(flowId)
  const historyStore = useFlowHistoryFor()
  const exposure = useExposure({ flowId, history: historyStore })

  /**
   * Draws an exposure edge for a connection to an interface node, or opens the child's one.
   *
   * @param {Object} connection
   */
  function connectExposure(connection) {
    const edge = exposure.buildExposureEdge(connection, edgeLineOptions)
    if (!edge) {
      notify.error({ title: 'Connection Not Made', message: 'Only a module or super instance inside a super-module connects to its interface.' })
      return
    }
    const childId = isSupermoduleInterface(findNode(connection.source)) ? connection.target : connection.source
    const existing = exposure.exposureEdgeOf(childId)
    if (existing) {
      onExposureEdge?.(existing.id, { isNew: false })
      return
    }
    confirmActivation()
    for (const [nodeId, handleId] of [
      [connection.source, connection.sourceHandle],
      [connection.target, connection.targetHandle],
    ]) {
      if (handleId) activateHandle(nodeId, getHandleUidFromHandleId(handleId), { trackHistory: false })
    }
    addEdges(edge)
    onExposureEdge?.(edge.id, { isNew: true })
  }

  onConnect(async (connection) => {
    const sourceNode = findNode(connection.source)
    const targetNode = findNode(connection.target)

    if (!sourceNode || !targetNode) return
    if (sourceNode === targetNode) return
    if (isSupermoduleInterface(sourceNode) || isSupermoduleInterface(targetNode)) {
      connectExposure(connection)
      return
    }

    const isExistingConnection = edges.value.find(
      (e) => e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle,
    )
    if (isExistingConnection) return

    const duplicate = edges.value.find((e) => e.source === connection.source && e.target === connection.target)

    const duplicateSnapshot = duplicate ? detachReactivity(duplicate) : null

    // Each repeated label takes its first slot no other edge holds; the edge this replaces holds none.
    const portsOf = (id) => findNode(id)?.data.ports ?? []
    const usedPortKeys = buildUsedPortKeys(edges.value.filter((e) => e !== duplicate), portsOf)
    const scope = scopeOf(sourceNode)
    if (scope) exposedSlotKeys(nodes.value, edges.value, scope).forEach((key) => usedPortKeys.add(key))
    const couplings = resolvePortCouplings(sourceNode.data.ports ?? [], targetNode.data.ports ?? [], {
      sourceId: connection.source,
      targetId: connection.target,
      usedPortKeys,
    })
    const nameOf = (id) => findNode(id)?.data.name ?? id
    const { valid, conflicts } = checkAndClaimCouplings(
      connection.source,
      connection.target,
      couplings,
      usedPortKeys,
      nameOf,
    )
    if (!valid) {
      notify.error({ title: 'Connection Not Made', message: conflicts.join(' ') })
      return
    }

    const edgeId = `${connection.source}--${connection.target}`
    const others = edges.value.filter((e) => e !== duplicate && e.id !== edgeId)
    let problems = []
    try {
      problems = couplingProblems(nodes.value, [...others, { ...connection, id: edgeId, data: { couplings } }], {
        edgeIds: [edgeId],
      })
    } catch (error) {
      // A model the check can't read blocks nothing, as in the dialog.
      console.warn('Could not check the couplings against CA:', error)
    }
    if (problems.length) {
      notify.error({
        title: 'Connection Not Made',
        message: [...new Set(problems.map((problem) => escapeHtml(problem.message)))].join('<br>'),
        duration: 8000,
      })
      return
    }

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

    const newEdge = {
      ...connection,
      ...edgeLineOptions,
      id: edgeId,
      data: {
        couplings,
      },
    }

    if (duplicate) {
      suppressedEdgeIds.add(newEdge.id)
      addEdges(newEdge)
      suppressedEdgeIds.delete(duplicateSnapshot.id)
      suppressedEdgeIds.delete(newEdge.id)

      historyStore.addCommand({
        type: 'replace-edge',
        scopes: [scope],
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
