/**
 * Sidecar ports across workspace nodes: reconciles each node's ports with its math's sidecar and recomputes the
 * couplings of the edges touching them. Pure: the caller writes the results.
 */

import { isAnnotatedPort } from '../../utils/portIdentity.js'
import { previewCouplings } from '../../utils/edges.js'
import { isSidecarPort, reconcileAnnotatedPorts } from './ports.js'

const isAnnotatedCoupling = ({ sourcePort, targetPort }) => isAnnotatedPort(sourcePort) || isAnnotatedPort(targetPort)

/**
 * Reconciles the sidecar ports of some nodes and recomputes the couplings of every edge touching them.
 *
 * @param {Object} options
 * @param {Array<Object>} options.nodes - Workspace nodes, as they are before reconciling.
 * @param {Array<Object>} options.edges - Workspace edges.
 * @param {Array<string>} options.nodeIds - The nodes to reconcile.
 * @param {(mathRef: string) => Object|null|undefined} options.sidecarFor - A math's parsed sidecar, null when it
 *   has none, undefined to leave its nodes' ports as they are.
 * @param {Object} [options.context] - From buildCouplingContext, to re-check kept annotated couplings.
 * @param {Map<string, Array<{ before: Object, after: Object }>>} [options.portChanges] - Ports already replaced on
 *   some nodes, such as by the instance editor, so their couplings follow too.
 * @returns {{ ports: Map<string, Array<Object>>, couplings: Map<string, Array<Object>> }} The ports of each node
 *   that changed, and the couplings of each edge touching the nodes.
 */
export function reconcileNodePorts({ nodes, edges, nodeIds, sidecarFor, context, portChanges: earlierChanges }) {
  const ports = new Map()
  const portChanges = new Map(earlierChanges)
  for (const id of nodeIds) {
    const node = nodes.find((candidate) => candidate.id === id)
    const mathRef = node?.data?.mathRef
    const sidecar = mathRef ? sidecarFor(mathRef) : undefined
    if (sidecar === undefined) continue
    const variables = node.data.variables?.map((row) => row.name)
    const result = reconcileAnnotatedPorts(node.data.ports ?? [], sidecar, { mathRef, variables })
    if (!result.added.length && !result.removed.length && !result.changed.length) continue
    ports.set(id, result.ports)
    portChanges.set(id, [...(portChanges.get(id) ?? []), ...result.changed])
  }

  const reconciled = nodes.map((node) => (ports.has(node.id) ? { ...node, data: { ...node.data, ports: ports.get(node.id) } } : node))
  const couplings = new Map()
  for (const id of nodeIds) {
    const node = reconciled.find((candidate) => candidate.id === id)
    if (!node) continue
    const preview = previewCouplings(id, node.data?.ports ?? [], reconciled, edges, { context, portChanges })
    for (const [edgeId, edgeCouplings] of preview) couplings.set(edgeId, edgeCouplings)
  }
  return { ports, couplings }
}

/**
 * Pairs a node's sidecar ports before and after an edit by variable, where the edit changed them.
 *
 * @param {Array<Object>} before - The ports before.
 * @param {Array<Object>} after - The ports after.
 * @returns {Array<{ before: Object, after: Object }>}
 */
export function findSidecarPortChanges(before, after) {
  const afterPorts = (after ?? []).filter(isSidecarPort)
  return (before ?? []).filter(isSidecarPort).flatMap((port) => {
    const variable = port.variables?.[0] ?? port.annotation.variable
    const match = afterPorts.find((candidate) => (candidate.variables?.[0] ?? candidate.annotation.variable) === variable)
    return match && JSON.stringify(match.annotation) !== JSON.stringify(port.annotation) ? [{ before: port, after: match }] : []
  })
}

/**
 * Counts the annotated couplings that new couplings would drop from the edges.
 *
 * @param {Array<Object>} edges - Workspace edges, with their couplings as they are now.
 * @param {Map<string, Array<Object>>} couplings - Each edge's new couplings.
 * @returns {{ couplings: number, connections: number }} How many couplings go, and on how many edges.
 */
export function countDroppedCouplings(edges, couplings) {
  let dropped = 0
  let connections = 0
  for (const edge of edges) {
    if (!couplings.has(edge.id)) continue
    const before = (edge.data?.couplings ?? []).filter(isAnnotatedCoupling).length
    const after = couplings.get(edge.id).filter(isAnnotatedCoupling).length
    if (after >= before) continue
    dropped += before - after
    connections += 1
  }
  return { couplings: dropped, connections }
}
