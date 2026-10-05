import { useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { getPortVariables, reconcileRows } from '../services/math/reconcileRows'
import { FLOW_IDS } from '../utils/constants'
import { resolvePortCouplings } from '../utils/edges'
import { useNodeDataHistory } from './useNodeDataHistory'

const NODE_KEYS = ['name', 'variables', 'ports', 'mathRef']

/**
 * Checks whether two math entries (see libraryStore.getMathEntry) hold the same math, defaults and layout.
 *
 * @param {Object|null} entry
 * @param {Object|null} otherEntry
 * @returns {boolean}
 */
function isSameMathEntry(entry, otherEntry) {
  const serialise = (value) => value && JSON.stringify([value.math, [...value.defaults], value.layout])
  return serialise(entry) === serialise(otherEntry)
}

/**
 * Applies an instance editor save to the workspace as one canvas undo step.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @returns {Object} saveInstanceEdit.
 */
export function useInstanceSave(flowId = FLOW_IDS.MAIN) {
  const { nodes, edges, findNode, updateNodeData } = useVueFlow(flowId)
  const libraryStore = useLibraryStore()
  const { recordEdit, findIncidentEdgeIds } = useNodeDataHistory(flowId)

  /**
   * Rebuilds a node's rows from its math, keeping their values. A row the math newly needs starts
   * blank: the math's defaults only seed new instances.
   *
   * @param {Object} node
   * @param {string} mathRef - The math the node now uses.
   */
  function updateVariablesFromMath(node, mathRef) {
    const analysis = libraryStore.getMathAnalysis(mathRef)
    if (!analysis) return
    node.data.variables = reconcileRows(analysis, node.data.variables ?? [], {
      portVariables: getPortVariables(node.data.ports),
    })
  }

  /**
   * Drops ports that carry a variable the node no longer has.
   *
   * @param {Object} node
   */
  function cleanPorts(node) {
    const validVariables = new Set(node.data.variables.map((v) => v.name))
    node.data.ports = node.data.ports.filter((port) => (port.variables || []).every((v) => validVariables.has(v)))
  }

  /**
   * Recomputes couplings on every edge touching a node from the current ports. Call it after
   * changing ports on one or more nodes.
   *
   * @param {string} nodeId
   */
  function recomputeEdgeCouplings(nodeId) {
    const outgoing = edges.value.filter((e) => e.source === nodeId)
    outgoing.forEach((edge) => {
      const sourceNode = findNode(edge.source)
      const targetNode = findNode(edge.target)
      if (!sourceNode || !targetNode) return

      const sourceIndex = outgoing.indexOf(edge)
      const edgesIntoTarget = edges.value.filter((e) => e.target === edge.target)
      const targetIndex = edgesIntoTarget.indexOf(edge)

      edge.data = {
        ...edge.data,
        couplings: resolvePortCouplings(sourceNode.data.ports ?? [], targetNode.data.ports ?? [], sourceIndex, targetIndex),
      }
    })

    const incoming = edges.value.filter((e) => e.target === nodeId)
    incoming.forEach((edge) => {
      const sourceNode = findNode(edge.source)
      const targetNode = findNode(edge.target)
      if (!sourceNode || !targetNode) return

      const edgesFromSource = edges.value.filter((e) => e.source === edge.source)
      const sourceIndex = edgesFromSource.indexOf(edge)
      const targetIndex = incoming.indexOf(edge)

      edge.data = {
        ...edge.data,
        couplings: resolvePortCouplings(sourceNode.data.ports ?? [], targetNode.data.ports ?? [], sourceIndex, targetIndex),
      }
    })
  }

  /**
   * Writes a save to the library and the nodes: the edited node, the siblings it applies to, and
   * every other node whose math it changed.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   */
  function applySave({ id, name, variables, ports, mathRef, math, layout, isLayoutChanged, globalConstants, updateAll, siblings }) {
    // Keep the shared units and reference, so one node's fields don't replace them.
    globalConstants.forEach(({ name, value, units, data_reference, overwrite }) => {
      const shared = libraryStore.getGlobalConstant(name)
      libraryStore.assignGlobalConstant(name, value, shared?.units ?? units, shared?.data_reference ?? data_reference, !!overwrite)
    })
    if (math !== null) libraryStore.addMath(mathRef, math, true, layout)
    else if (isLayoutChanged) libraryStore.setMathLayout(mathRef, layout)

    updateNodeData(id, { name, variables, ports, mathRef })
    if (updateAll) siblings.forEach((siblingId) => updateNodeData(siblingId, { mathRef }))

    // The edited node's rows are already reconciled by the editor. Every other node on this math is
    // rebuilt here, ticked or not, since an overwrite in place changes their math too.
    cleanPorts(findNode(id))
    const otherNodes = nodes.value.filter((node) => node.id !== id && node.data?.mathRef === mathRef)
    otherNodes.forEach((node) => {
      updateVariablesFromMath(node, mathRef)
      cleanPorts(node)
    })

    recomputeEdgeCouplings(id)
    otherNodes.forEach((node) => recomputeEdgeCouplings(node.id))
  }

  /**
   * Applies an instance editor save as one undo step. Undo puts back the math only while it is still
   * what the save wrote, and keeps math a save created while any node still uses it.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {Promise<number>} How many nodes now use the saved math reference.
   */
  async function saveInstanceEdit(save) {
    const { id, mathRef, previousMathRef, math, isLayoutChanged, updateAll, siblings } = save
    const affectedIds = [
      ...new Set([
        id,
        ...(updateAll ? siblings : []),
        ...nodes.value.filter((node) => [mathRef, previousMathRef].includes(node.data?.mathRef)).map((node) => node.id),
      ]),
    ]
    const writtenMathRef = math !== null || isLayoutChanged ? mathRef : null
    const mathBefore = writtenMathRef && libraryStore.getMathEntry(writtenMathRef)
    let mathAfter = null

    const isUsed = (ref) => nodes.value.some((node) => node.data?.mathRef === ref)

    await recordEdit({
      type: 'edit-instance',
      nodeIds: affectedIds,
      keys: NODE_KEYS,
      edgeIds: findIncidentEdgeIds(affectedIds),
      apply: () => {
        applySave(save)
        mathAfter = writtenMathRef && libraryStore.getMathEntry(writtenMathRef)
      },
      library: writtenMathRef && {
        // Math a save created stays while another node uses it, so an undo may leave it in place.
        isAt: (side) => {
          const current = libraryStore.getMathEntry(writtenMathRef)
          if (side === 'after') return isSameMathEntry(current, mathAfter)
          return isSameMathEntry(current, mathBefore) || (!mathBefore && isSameMathEntry(current, mathAfter))
        },
        restore: (side) => {
          if (side === 'after') return libraryStore.restoreMathEntry(writtenMathRef, mathAfter)
          if (!mathBefore && isUsed(writtenMathRef)) return
          libraryStore.restoreMathEntry(writtenMathRef, mathBefore)
        },
      },
    })

    return 1 + (updateAll ? siblings.length : 0)
  }

  return { saveInstanceEdit }
}
