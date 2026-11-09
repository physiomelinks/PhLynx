import { useVueFlow } from '@vue-flow/core'
import { driveEdgesByAnnotations, withCouplings } from '../services/annotations/edgeCouplings'
import { isAnnotatedPort } from '../utils/portIdentity'
import { FLOW_IDS } from '../utils/constants'
import { useCouplingContext } from './useCouplingContext'

/**
 * Makes workspace edges between nodes with annotated ports couple through them (see driveEdgesByAnnotations).
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @returns {{ driveEdgesNow: Function, prepareDriving: Function, findNodesToDrive: Function }}
 */
export function useAnnotationDrivenEdges(flowId = FLOW_IDS.MAIN) {
  const { nodes, edges } = useVueFlow(flowId)
  const findNode = (id) => nodes.value.find((node) => node.id === id)
  const { getContext, ensureContext } = useCouplingContext()

  const hasAnnotatedPorts = (id) => (findNode(id)?.data?.ports ?? []).some(isAnnotatedPort)
  const needsDriving = (edge) =>
    !!edge.data?.manualCouplings || (hasAnnotatedPorts(edge.source) && hasAnnotatedPorts(edge.target))

  /**
   * Drives the edges now, writing their couplings and any ports they add. Synchronous, so it can run inside a
   * recorded edit.
   *
   * @param {Object} [options]
   * @param {Object} [options.context] - From buildCouplingContext; by default from what is already parsed.
   * @param {Array<string>} [options.edgeIds] - Only these edges; all by default.
   * @returns {ReturnType<typeof driveEdgesByAnnotations>['changed']}
   */
  function driveEdgesNow({ context, edgeIds } = {}) {
    const wanted = edges.value.filter((edge) => (!edgeIds || edgeIds.includes(edge.id)) && needsDriving(edge))
    if (!wanted.length) return []
    const { ports, changed } = driveEdgesByAnnotations({
      nodes: nodes.value,
      edges: wanted,
      context: context ?? getContext(nodes.value),
    })
    ports.forEach((nodePorts, id) => {
      const node = findNode(id)
      if (node) node.data = { ...node.data, ports: nodePorts }
    })
    const changes = new Map(changed.map((change) => [change.edgeId, change.after]))
    for (const edge of edges.value) {
      if (changes.has(edge.id)) edge.data = withCouplings(edge.data, changes.get(edge.id))
    }
    return changed
  }

  /**
   * Parses what driving needs (see useCouplingContext), so driveEdgesNow can run synchronously afterwards. A file
   * that fails to parse leaves its edges as they are.
   *
   * @returns {Promise<void>}
   */
  async function prepareDriving() {
    try {
      await ensureContext(nodes.value)
    } catch (error) {
      console.warn('Annotated couplings unavailable:', error)
    }
  }

  /**
   * The nodes driving some edges may change: the edges' ends.
   *
   * @param {Array<string>} edgeIds
   * @returns {Array<string>}
   */
  function findNodesToDrive(edgeIds) {
    const ids = new Set(edgeIds)
    return [...new Set(edges.value.filter((edge) => ids.has(edge.id)).flatMap((edge) => [edge.source, edge.target]))]
  }

  return { driveEdgesNow, prepareDriving, findNodesToDrive }
}
