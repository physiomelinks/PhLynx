import { useVueFlow } from '@vue-flow/core'
import { confirmDrivenStores } from '../services/export/drivenStores'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { linkCouplings } from '../services/bioView/links'
import { FLOW_IDS } from '../utils/constants'
import { facingSides, nodeRect } from '../utils/edgeGeometry'
import { resolvePortCouplings } from '../utils/edges'
import { freeHandle, getHandleId, getHandleUidFromHandleId } from '../utils/handles'
import { detachReactivity } from '../utils/reactivity'

/**
 * Registers the Vue Flow connect handler: validates a new connection, activates its handles,
 * asks before replacing an existing connection between the same instances, and adds the edge
 * with its resolved port couplings, after asking about each CellDL store they would set from
 * elsewhere (see confirmDrivenStores). Gives connectNodes, which joins two nodes the same way without a handle
 * drag.
 *
 * @param {Object} options
 * @param {Set<string>} options.suppressedEdgeIds - Edge ids whose add/remove changes are not recorded.
 * @param {Function} options.confirm - Confirm dialog; resolves true to replace the existing edge, or drive a store.
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
  const { addEdges, edges, nodes, findNode, onConnect, removeEdges } = useVueFlow(flowId)
  const historyStore = useFlowHistoryStore()
  const libraryStore = useLibraryStore()

  /**
   * The couplings an edge from one node to another gets by label, picking each label's slot by how many edges the
   * nodes already have (see resolvePortCouplings).
   */
  function labelCouplings(source, target) {
    // The Nth edge out of the source and into the target, as in out_modules / inp_modules.
    const sourceIndex = edges.value.filter((e) => e.source === source.id).length
    const targetIndex = edges.value.filter((e) => e.target === target.id).length
    return resolvePortCouplings(source.data?.ports ?? [], target.data?.ports ?? [], sourceIndex, targetIndex)
  }

  /** A node as linkCouplings reads it. */
  const nodeEnd = (node) => ({ id: node.id, ports: node.data?.ports ?? [] })

  /**
   * Joins two nodes that aren't joined yet, on free handles on the sides facing each other, the way round that
   * couples more ports (the given way on a tie); an edge nothing couples is left empty. With a link kind, the
   * edge runs the given way and couples as the link does (see linkCouplings), and is marked placement-made
   * (data.placement). Asks about each CellDL store the
   * couplings would set from elsewhere, as a handle drag does, and adds nothing when one is declined. Run it
   * inside a history batch to make it part of one undo step.
   *
   * @param {{source: string, target: string}} pair - Node ids.
   * @param {{couplings?: 'labels'|'none', link?: 'flow'|'across'|'exchange'}} [options] - 'none' adds the edge
   *   with no couplings.
   * @returns {Promise<Object|null>} The edge added, or null when the nodes are missing or already joined, or a
   *   store was declined.
   */
  async function connectNodes({ source, target }, { couplings: mode = 'labels', link } = {}) {
    const first = findNode(source)
    const second = findNode(target)
    if (!first || !second || first === second) return null
    const isJoined = edges.value.some(
      (e) => (e.source === source && e.target === target) || (e.source === target && e.target === source)
    )
    if (isJoined) return null

    const byLink = !!link && mode === 'labels'
    const given = byLink
      ? linkCouplings(nodeEnd(first), nodeEnd(second), link, edges.value)
      : mode === 'labels'
        ? labelCouplings(first, second)
        : []
    let chosen = { from: first, to: second, couplings: given }
    if (mode === 'labels' && !byLink) {
      const reversed = labelCouplings(second, first)
      if (reversed.length > given.length) chosen = { from: second, to: first, couplings: reversed }
    }

    const { from, to } = chosen
    const edge = {
      ...edgeLineOptions,
      id: `${from.id}--${to.id}`,
      source: from.id,
      target: to.id,
      // A placement edge says so, so a later move can take it away again (see isPlacementEdge).
      data: { couplings: chosen.couplings, ...(link ? { placement: link } : {}) },
    }
    const marked = await confirmDrivenStores({
      nodes: nodes.value,
      edges: [...edges.value, edge],
      edgeIds: new Set([edge.id]),
      libraryStore,
      confirm,
    })
    if (!marked) return null
    if (marked.has(edge.id)) edge.data = { ...edge.data, couplings: marked.get(edge.id) }

    const { sourceSide, targetSide } = facingSides(nodeRect(from), nodeRect(to))
    const sourceHandle = freeHandle(from, sourceSide)
    const targetHandle = freeHandle(to, targetSide)
    // Activated untracked: the edge's own history step reverts them to ghosts on undo and back on redo.
    if (sourceHandle) await activateHandle(from.id, sourceHandle.uid, { trackHistory: false })
    if (targetHandle) await activateHandle(to.id, targetHandle.uid, { trackHistory: false })
    if (sourceHandle) edge.sourceHandle = getHandleId(sourceHandle)
    if (targetHandle) edge.targetHandle = getHandleId(targetHandle)
    addEdges(edge)
    return edge
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

    /** Leaves the canvas as it was: no new edge, and its handles back as they were. */
    const discard = (pendingEdge) => {
      if (pendingEdge) {
        removeEdges(pendingEdge.id)
        suppressedEdgeIds.delete(pendingEdge.id)
      }
      if (sourceHandleUid)
        revertHandleIfUnused(connection.source, sourceHandleUid, {
          trackHistory: false,
        })
      if (targetHandleUid)
        revertHandleIfUnused(connection.target, targetHandleUid, {
          trackHistory: false,
        })
    }

    let pendingEdge = null
    if (duplicate) {
      pendingEdge = {
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
        discard(pendingEdge)
        return
      }
    }

    // The edges the new one joins: a replaced edge and the pending one go.
    const otherEdges = edges.value.filter((e) => e.id !== duplicateSnapshot?.id && e.id !== pendingEdge?.id)

    // Derive ordinal indices from the existing edge graph:
    //   sourceIndex = how many edges already leave from this source node
    //                 (i.e. this is the Nth output being connected)
    //   targetIndex = how many edges already arrive at this target node
    //                 (i.e. this is the Nth input being connected)
    // These mirror the positional semantics of out_modules / inp_modules.
    const sourceIndex = otherEdges.filter((e) => e.source === connection.source).length
    const targetIndex = otherEdges.filter((e) => e.target === connection.target).length

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
      // Drawn by hand, so a physiology view move never takes it away (see isPlacementEdge).
      data: {
        couplings,
        placement: false,
      },
    }

    // Declining to drive a store leaves the connection unmade, so the edge and its couplings are added as one step.
    const marked = await confirmDrivenStores({
      nodes: nodes.value,
      edges: [...otherEdges, newEdge],
      edgeIds: new Set([newEdge.id]),
      libraryStore,
      confirm,
    })
    if (!marked) {
      discard(pendingEdge)
      return
    }
    if (marked.has(newEdge.id)) newEdge.data = { ...newEdge.data, couplings: marked.get(newEdge.id) }

    if (duplicate) {
      suppressedEdgeIds.add(duplicateSnapshot.id)
      await revertHandlesForEdge(duplicateSnapshot, [duplicateSnapshot.id], {
        trackHistory: false,
      })
      removeEdges(duplicateSnapshot.id)
      removeEdges(pendingEdge.id)
      suppressedEdgeIds.delete(pendingEdge.id)

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

  return { connectNodes }
}
