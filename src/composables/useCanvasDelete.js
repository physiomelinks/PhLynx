/**
 * Deletes canvas nodes as one undo step, first asking about what the deletion would break: ports a super-module
 * exposes from a node, or through an exposure edge, and the connections to them in every super instance, or a super-module
 * left without super instances. What it breaks goes in the same step: the couplings to the ports un-exposed (an edge left
 * with none too), the overrides of what is removed, and the sliders, plots, sweeps and inspection variables of every
 * copy of a node removed from a super-module.
 */
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useActiveCanvas } from './useActiveCanvas'
import { describeUnexposeImpact, useExposure } from './useExposure'
import { useFlowHistoryFor } from './useFlowHistoryFor'
import { useHandleManagement } from './useHandleManagement'
import { useSupermodules } from './useSupermodules'
import { FLOW_IDS } from '../utils/constants'

/**
 * Gives a way to delete canvas nodes that asks first where Vue Flow's Delete key can't.
 *
 * @param {Object} options
 * @param {(options: Object) => Promise<boolean|null>} options.confirm - From useConfirmDialog: true to accept, false
 *   to reject, null when closed without an answer.
 * @param {Object} [options.history] - The undo stack; the nearest provided one by default.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @returns {{selectionNeedsAsking: import('vue').ComputedRef<boolean>, deleteNodes: Function,
 *   deleteSelection: Function}}
 */
export function useCanvasDelete({ confirm, history = useFlowHistoryFor(), flowId = FLOW_IDS.MAIN }) {
  const { removeNodes, removeEdges, findNode, findEdge } = useVueFlow(flowId)
  const { selectedNodes, selectedEdges } = useActiveCanvas(flowId)
  const { orphanedBy, exposedBy, find, deleteSupermodule } = useSupermodules(flowId)
  // A connection the cascade removes gives its handles back, as one deleted by hand does.
  const exposure = useExposure({ flowId, history, handles: useHandleManagement({ history }) })

  // Whether deleting the canvas selection needs asking first, or breaks what Vue Flow's Delete key would leave behind,
  // so the workspace turns that key off.
  // Read on every render, so nothing selected answers at once, and the copies removed are found without planning the rest.
  const selectionNeedsAsking = computed(() => {
    const ids = selectedNodes.value.map((node) => node.id)
    const edgeIds = selectedEdges.value.map((edge) => edge.id)
    if (!ids.length && !edgeIds.length) return false
    return orphanedBy(ids).length > 0 || exposedBy(ids, edgeIds).length > 0 || exposure.deadModelIdsOf(ids).size > 0
  })

  const nameOf = (smId) => `'${find(smId)?.name ?? smId}'`

  /**
   * Asks whether to delete what un-exposes ports, and with them the connections to them.
   *
   * @param {ReturnType<typeof exposedBy>} exposures
   * @param {ReturnType<typeof exposure.planRemoval>} plan
   * @returns {Promise<boolean|null>}
   */
  function askToBreakExposures(exposures, plan) {
    const lines = exposures.map(
      ({ smId, nodeName, portLabel }) => `• '${nodeName}' (port '${portLabel}' of ${nameOf(smId)})`
    )
    const impact = describeUnexposeImpact(plan)
    return confirm({
      header: 'Delete Exposed Nodes?',
      message:
        `Deleting this un-exposes ports of a super-module:\n${lines.join('\n')}\n` +
        (impact ? `${impact} Their couplings to those ports are removed, and a connection left with none goes too.` : 'No connection uses them.'),
      severity: 'warning',
      acceptLabel: 'Delete anyway',
      rejectLabel: 'Cancel',
    })
  }

  /**
   * Asks whether super-modules left without super instances go too.
   *
   * @param {string[]} smIds
   * @returns {Promise<boolean|null>}
   */
  function askToDeleteSupermodules(smIds) {
    const names = smIds.map(nameOf).join(', ')
    const one = smIds.length === 1
    return confirm({
      header: one ? 'Delete Super-module Too?' : 'Delete Super-modules Too?',
      message:
        `No other super instance uses the super-module${one ? '' : 's'} ${names}. ` +
        `Delete ${one ? 'it' : 'them'} as well, or keep ${one ? 'it' : 'them'} in the palette to place again?`,
      severity: 'warning',
      acceptLabel: one ? 'Delete super-module' : 'Delete super-modules',
      rejectLabel: one ? 'Keep super-module' : 'Keep super-modules',
    })
  }

  /**
   * Deletes canvas nodes and edges as one undo step, once the user agrees to break exposed ports and says whether
   * super-modules left without super instances go too. Closing a question without an answer deletes nothing. What changed
   * while a question was open is checked again, so only what still exists is deleted.
   *
   * @param {string[]} nodeIds
   * @param {string[]} [edgeIds=[]]
   */
  async function deleteNodes(nodeIds, edgeIds = []) {
    const exposures = exposedBy(nodeIds, edgeIds)
    if (exposures.length && !(await askToBreakExposures(exposures, exposure.planRemoval(nodeIds, edgeIds)))) return
    const orphaned = orphanedBy(nodeIds)
    const answer = orphaned.length > 0 ? await askToDeleteSupermodules(orphaned) : false
    if (answer == null) return

    const nodesLeft = nodeIds.filter((id) => findNode(id))
    const edgesLeft = edgeIds.filter((id) => findEdge(id))
    const stillOrphaned = answer ? orphanedBy(nodesLeft).filter((smId) => orphaned.includes(smId)) : []
    if (!nodesLeft.length && !edgesLeft.length) return
    history.startBatch()
    try {
      await exposure.applyRemoval(exposure.planRemoval(nodesLeft, edgesLeft))
      if (nodesLeft.length) removeNodes(nodesLeft)
      if (edgesLeft.length) removeEdges(edgesLeft)
      stillOrphaned.forEach(deleteSupermodule)
    } finally {
      history.endBatch()
    }
  }

  /** Deletes the canvas selection, as the Delete key does. */
  const deleteSelection = () =>
    deleteNodes(
      selectedNodes.value.map((node) => node.id),
      selectedEdges.value.map((edge) => edge.id)
    )

  return { selectionNeedsAsking, deleteNodes, deleteSelection }
}
