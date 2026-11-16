/**
 * Edges between placed nodes with annotated ports couple through them: the matcher's couplings replace the edge's
 * manual ones, which are kept aside in data.manualCouplings (not drawn, exported or used) so they come back when an
 * end loses its annotated ports or its place. Edges at unplaced nodes keep their stored couplings. Pure: the caller
 * writes the results.
 */

import { findPort, isAnnotatedPort, samePort } from '../../utils/portIdentity.js'
import { annotatedMatches, couplingsFromMatches, isLocatedNode } from './couple.js'

const isManualCoupling = ({ sourcePort, targetPort }) => !isAnnotatedPort(sourcePort) && !isAnnotatedPort(targetPort)
const hasAnnotatedPorts = (node) => (node?.data?.ports ?? []).some(isAnnotatedPort)
const sameCoupling = (a, b) => samePort(a.sourcePort, b.sourcePort) && samePort(a.targetPort, b.targetPort)
const clone = (value) => JSON.parse(JSON.stringify(value))

/** The couplings with repeats left out, first kept. */
export function uniqueCouplings(couplings) {
  return couplings.filter((coupling, index) => couplings.findIndex((other) => sameCoupling(other, coupling)) === index)
}

/**
 * The matched couplings an edge between two nodes gets, in its direction, and the ports they need.
 *
 * @param {Object} sourceNode - The edge's source.
 * @param {Object} targetNode - The edge's target.
 * @param {Object} options
 * @param {Array<Object>} options.nodes - Every workspace node, placed or not.
 * @param {Object} options.context - From buildCouplingContext.
 * @param {Array<Object>} [options.matches] - From annotatedMatches, to reuse across edges.
 * @returns {{ couplings: Array<{ sourcePort: Object, targetPort: Object }>, addedPorts: Map<string, Array<Object>> }}
 */
export function annotatedCouplingsForEdge(sourceNode, targetNode, { nodes, context, matches }) {
  return couplingsFromMatches(matches ?? annotatedMatches(nodes, context), sourceNode, targetNode)
}

/**
 * An edge's data with new couplings, without manualCouplings when there are none to keep.
 *
 * @param {Object} data - The edge's data.
 * @param {{ couplings: Array<Object>, manualCouplings?: Array<Object> }} after - From driveEdgesByAnnotations.
 * @returns {Object}
 */
export function withCouplings(data, { couplings, manualCouplings }) {
  const { manualCouplings: _previous, ...rest } = data ?? {}
  return { ...rest, couplings, ...(manualCouplings ? { manualCouplings } : {}) }
}

/**
 * Makes edges whose two ends are placed and have annotated ports couple through the matcher's couplings. Their
 * manual-port couplings move to data.manualCouplings; their annotated couplings stay, with the matcher's added. An
 * edge the matcher gives nothing keeps its manual couplings. An edge with stored manual couplings gets them back
 * once an end has no annotated ports or no place, or no annotated coupling is left. Idempotent.
 *
 * @param {Object} options
 * @param {Array<Object>} options.nodes - Workspace nodes.
 * @param {Array<Object>} options.edges - Workspace edges.
 * @param {Object} options.context - From buildCouplingContext.
 * @param {Set<string>|Array<string>} [options.edgeIds] - Only these edges; all by default.
 * @returns {{ edges: Array<Object>, ports: Map<string, Array<Object>>, changed: Array<{ edgeId: string,
 *   before: Object, after: { couplings: Array<Object>, manualCouplings?: Array<Object> },
 *   kind: 'switched'|'added'|'restored' }> }} The edges with the changed ones replaced, each node's ports where
 *   new annotated ports were added, and the changes: manual couplings moved aside, annotated ones added, or
 *   manual ones restored.
 */
export function driveEdgesByAnnotations({ nodes, edges, context, edgeIds }) {
  const only = edgeIds ? new Set(edgeIds) : null
  const working = new Map(nodes.map((node) => [node.id, node]))
  const ports = new Map()
  const changed = []
  let matches = null

  // Only couplings whose ports are still on both nodes: a save may have removed a stored coupling's port.
  const restore = (current, stored, source, target) => ({
    couplings: uniqueCouplings([...stored, ...current]).filter(
      ({ sourcePort, targetPort }) =>
        findPort(source.data?.ports ?? [], sourcePort) && findPort(target.data?.ports ?? [], targetPort)
    ),
  })

  const next = edges.map((edge) => {
    if (only && !only.has(edge.id)) return edge
    const source = working.get(edge.source)
    const target = working.get(edge.target)
    if (!source || !target) return edge
    const current = edge.data?.couplings ?? []
    const stored = edge.data?.manualCouplings

    let after = null
    let kind = null
    const isDriven = (node) => hasAnnotatedPorts(node) && isLocatedNode(node, context)
    if (!isDriven(source) || !isDriven(target)) {
      if (stored) [after, kind] = [restore(current, stored, source, target), 'restored']
    } else {
      matches ??= annotatedMatches(nodes, context)
      const manual = current.filter(isManualCoupling)
      const annotated = current.filter((coupling) => !isManualCoupling(coupling))
      const matched = annotatedCouplingsForEdge(source, target, { matches })
      const freshIndices = matched.couplings.flatMap((coupling, index) =>
        annotated.some((other) => sameCoupling(other, coupling)) ? [] : [index]
      )
      const fresh = freshIndices.map((index) => clone(matched.couplings[index]))
      if (!annotated.length && !fresh.length) {
        if (stored) [after, kind] = [restore(current, stored, source, target), 'restored']
      } else if (manual.length || fresh.length) {
        const kept = uniqueCouplings([...(stored ?? []), ...manual])
        after = { couplings: [...annotated, ...fresh], ...(kept.length ? { manualCouplings: kept } : {}) }
        kind = manual.length ? 'switched' : 'added'
        // Only the ports the fresh couplings use; the others are already on their nodes.
        for (const [node, side] of [[source, 'sourcePort'], [target, 'targetPort']]) {
          const added = (matched.addedPorts.get(node.id) ?? []).filter((port) =>
            fresh.some((coupling) => findPort([coupling[side]], port))
          )
          if (!added.length) continue
          const nodePorts = [...(node.data.ports ?? []), ...added.map(clone)]
          ports.set(node.id, nodePorts)
          working.set(node.id, { ...node, data: { ...node.data, ports: nodePorts } })
        }
      }
    }
    if (!after) return edge
    changed.push({
      edgeId: edge.id,
      before: { couplings: current, ...(stored ? { manualCouplings: stored } : {}) },
      after,
      kind,
    })
    return { ...edge, data: withCouplings(edge.data, after) }
  })
  return { edges: next, ports, changed }
}

/**
 * A summary of driven edges for a notification, or null when none switched to annotated ports.
 *
 * @param {ReturnType<typeof driveEdgesByAnnotations>['changed']} changed
 * @returns {string|null}
 */
export function drivenSummary(changed) {
  const switched = changed.filter((change) => change.kind === 'switched').length
  if (!switched) return null
  return `${switched} connection${switched === 1 ? '' : 's'} now use${switched === 1 ? 's' : ''} annotation ports.`
}
