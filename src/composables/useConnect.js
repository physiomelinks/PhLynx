import { nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { confirmDrivenStores } from '../services/export/drivenStores'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { annotatedCouplingsBetween, placesOf } from '../services/annotations/couple'
import { linkCouplings } from '../services/bioView/links'
import { useCouplingContext } from './useCouplingContext'
import { FLOW_IDS } from '../utils/constants'
import { facingSides, nodeRect } from '../utils/edgeGeometry'
import { resolvePortCouplings } from '../utils/edges'
import { freeHandle, getHandleId, getHandleUidFromHandleId } from '../utils/handles'
import { detachReactivity } from '../utils/reactivity'
import { notify } from '../utils/notify'

/**
 * Registers the Vue Flow connect handler: validates a new connection, activates its handles,
 * asks before replacing an existing connection between the same instances, and adds the edge
 * with its resolved port couplings, after asking about each CellDL store they would set from
 * elsewhere (see confirmDrivenStores). Between two placed nodes with annotated math, the matcher's couplings are
 * added too, with any ports they need, in the same undo step. Gives connectNodes, which joins two nodes the same
 * way without a handle drag.
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
  const { addEdges, edges, nodes, findNode, onConnect, removeEdges } = useVueFlow(flowId)
  const historyStore = useFlowHistoryStore()
  const libraryStore = useLibraryStore()
  const { getContext, ensureContext } = useCouplingContext()

  /** Whether a node's math has a side-car and the node is placed (see isLocatedNode). */
  const isAnnotatedNode = (node) =>
    !!libraryStore.getModuleAnnotations(node.data?.mathRef) && placesOf(node, getContext(nodes.value)).length > 0

  /**
   * The matcher's couplings between two annotated nodes (see isAnnotatedNode), and the ports they add. A file
   * that fails to parse leaves the edge to its label couplings.
   *
   * @returns {Promise<ReturnType<typeof annotatedCouplingsBetween>|null>} Null when there are none, or either node
   *   is not annotated.
   */
  async function annotatedCouplings(sourceNode, targetNode) {
    if (!isAnnotatedNode(sourceNode) || !isAnnotatedNode(targetNode)) return null
    const allNodes = nodes.value
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

  /**
   * The couplings an edge from one node to another gets: by label, picking each label's slot by how many edges
   * the nodes already have (see resolvePortCouplings), and, between annotated nodes, the matcher's, with the ports
   * those add. Annotated ports never couple by label. The matcher is awaited first, so the slots and ports are
   * read as they are once it settles.
   *
   * @param {Object} sourceNode
   * @param {Object} targetNode
   * @param {Array<Object>} [otherEdges] - The edges the new one joins; every edge by default.
   * @returns {Promise<{couplings: Array<Object>, addedPorts: Map<string, Array<Object>>}>}
   */
  async function couplingsFor(sourceNode, targetNode, otherEdges = null) {
    const annotated = await annotatedCouplings(sourceNode, targetNode)
    const source = findNode(sourceNode.id) ?? sourceNode
    const target = findNode(targetNode.id) ?? targetNode
    const joined = otherEdges ?? edges.value
    // The Nth edge out of the source and into the target, as in out_modules / inp_modules.
    const sourceIndex = joined.filter((e) => e.source === source.id).length
    const targetIndex = joined.filter((e) => e.target === target.id).length
    const addedPorts = annotated?.addedPorts ?? new Map()
    // With the annotated ports this edge adds, which hide a node's manual ones.
    const portsOf = (node) => [...(node.data?.ports ?? []), ...(addedPorts.get(node.id) ?? [])]
    const couplings = resolvePortCouplings(portsOf(source), portsOf(target), sourceIndex, targetIndex)
    if (annotated) couplings.push(...annotated.couplings)
    return { couplings, addedPorts }
  }

  /** A node as linkCouplings reads it. */
  const nodeEnd = (node) => ({ id: node.id, ports: node.data?.ports ?? [] })

  /**
   * Joins two nodes that aren't joined yet, on free handles on the sides facing each other, the way round that
   * couples more ports (the given way on a tie); an edge nothing couples is left empty. With a link kind, the
   * edge runs the given way and couples as the link does (see linkCouplings), unless both nodes are annotated,
   * which the matcher couples instead, and is marked placement-made (data.placement). Asks about each CellDL store the
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

    const none = { couplings: [], addedPorts: new Map() }
    const byLink = !!link && mode === 'labels' && !(isAnnotatedNode(first) && isAnnotatedNode(second))
    const given = byLink
      ? { couplings: linkCouplings(nodeEnd(first), nodeEnd(second), link, edges.value), addedPorts: new Map() }
      : mode === 'labels'
        ? await couplingsFor(first, second)
        : none
    let chosen = { from: first, to: second, ...given }
    if (mode === 'labels' && !byLink) {
      const reversed = await couplingsFor(second, first)
      if (reversed.couplings.length > given.couplings.length) chosen = { from: second, to: first, ...reversed }
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
    await addPorts(chosen.addedPorts)

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

    // Resolve which port labels are coupled across this conduit, using ordinal indices (how many edges already
    // leave the source and arrive at the target, as in out_modules / inp_modules) to select the correct slot when a
    // label appears multiple times; between annotated nodes, the matcher's couplings too.
    const { couplings, addedPorts } = await couplingsFor(sourceNode, targetNode, otherEdges)

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

    const isBatched = !!addedPorts.size
    if (isBatched) historyStore.startBatch()
    try {
      if (isBatched) await addPorts(addedPorts)
      await addConnection(newEdge, duplicateSnapshot, pendingEdge)
    } finally {
      // A failed edit still closes the batch, so later edits aren't swallowed into it.
      if (isBatched) {
        await nextTick()
        historyStore.endBatch()
      }
    }
  })

  /**
   * Adds a new connection's edge, in place of the edge it replaces, if any, as one step.
   *
   * @param {Object} newEdge
   * @param {Object|null} duplicateSnapshot - The edge it replaces.
   * @param {Object|null} pendingEdge - The marker drawn while the replacement was asked about.
   */
  async function addConnection(newEdge, duplicateSnapshot, pendingEdge) {
    if (duplicateSnapshot) {
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
  }

  return { connectNodes }
}
