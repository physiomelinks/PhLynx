
/**
 * edges.js
 *
 * Utilities for resolving which port labels are coupled across a conduit edge,
 * and for enforcing the non-multiport single-connection constraint.
 *
 * Core concepts
 * -------------
 * - A conduit edge is a single VueFlow edge between two module nodes.
 * - The CellML variable connections implied by a conduit are determined by
 *   matching port labels between the two nodes with compatible portTypes.
 * - Port type compatibility (source → target):
 *     exit_ports    → entrance_ports | general_ports
 *     general_ports → entrance_ports | exit_ports | general_ports
 *   (entrance_ports on the source side cannot initiate a coupling)
 *
 * Positional (ordinal) slot assignment
 * -------------------------------------
 * When a label appears more than once under the same portType (e.g. a heart
 * module with three entrance "vessel_port" slots), the Nth occurrence is
 * assigned to the Nth neighbour in the space-separated module list:
 *
 *   out_modules:  "a_0 a_1"          <- a_0 is index 0, a_1 is index 1
 *   exit vessel_ports: [slot0, slot1] <-  slot0 couples to a_0, slot1 to a_1
 *
 * The same logic applies on the target side via inp_modules.
 *
 * resolvePortCouplings therefore needs both indices so it can pick the correct
 * occurrence of each repeated label.
 *
 * Non-multiport constraint
 * ------------------------
 * A port with multiport === 'None' (Python None serialised as a string,
 * used as the default in buildPorts when multi_port is absent) may only
 * participate in ONE conduit edge across the entire graph. Any other truthy
 * value for multiport means the port is unrestricted.
 */

import { findPort, isAnnotatedPort, portDisplayName, portIdentity } from './portIdentity'

/** portTypes that may appear on the source (outgoing) side of a coupling. */
const SOURCE_COMPATIBLE_TYPES = new Set(['exit_ports', 'general_ports'])

/** Valid target portTypes for each source portType. */
const TARGET_COMPATIBLE_TYPES = {
  exit_ports: new Set(['entrance_ports', 'general_ports']),
  general_ports: new Set(['entrance_ports', 'exit_ports', 'general_ports']),
}

/**
 * Generates a unique edge ID.
 *
 * @returns {string} Unique edge ID.
 */
export function getId(edgeIds, prefix = 'edge_') {
  // Find the highest existing ID
  let maxId = -1
  edgeIds.forEach((edgeId) => {
    if (edgeId.startsWith(prefix)) {
      const numPart = parseInt(edgeId.split('_')[1], 10)
      if (!isNaN(numPart) && numPart > maxId) {
        maxId = numPart
      }
    }
  })

  // Return the next ID in the sequence
  return `${prefix}${maxId + 1}`
}

/**
 * Returns true when a portLabel entry is single-connection (non-multiport).
 *
 * buildPorts sets multiportType to `p.multi_port ?? 'None'`, so:
 *   'None'               → single-connection (Python None serialised as string)
 *   null / undefined / false → single-connection (absent or falsy)
 *   any other truthy value   → multiport (unrestricted)
 */
export function isSingleConnection(port) {
  const mp = port.multiportType
  return !mp || mp === 'None'
}

/**
 * Resolves the port-label couplings for ONE specific conduit edge.
 *
 * For each compatible (source portType, target portType, label) group, the
 * correct occurrence is selected by ordinal index:
 *   - sourceIndex: position of the target module instance in the source's out_modules list
 *   - targetIndex: position of the source module instance in the target's inp_modules list
 *
 * Within each (portType, label) group on a given side, occurrences are ordered
 * as they appear in ports (which mirrors the config file order). The Nth
 * occurrence is selected by index, clamped to the last slot if the index exceeds
 * the group size — matching the instance array semantics.
 *
 * For labels that appear only once (the common case), the index is irrelevant
 * and that single entry is always selected.
 *
 * Annotated ports are skipped: they couple by annotation, never by label.
 *
 * @param {Array}  sourcePorts node.data.ports of the source node
 * @param {Array}  targetPorts  node.data.ports of the target node
 * @param {number} sourceIndex  position of target in source's out_instances (0-based)
 * @param {number} targetIndex  position of source in target's inp_instances (0-based)
 * @returns {Array<{ sourcePortLabel: Object, targetPortLabel: Object }>}
 */
export function resolvePortCouplings(
  sourcePorts,
  targetPorts,
  sourceIndex = 0,
  targetIndex = 0
) {
  const couplings = []

  // Group source ports by (portType, label) — preserving config order
  const sourceGroups = groupByTypeAndLabel(sourcePorts, SOURCE_COMPATIBLE_TYPES)

  for (const [groupKey, srcSlots] of sourceGroups) {
    const [srcPortType, identity] = groupKey.split('\x00')
    const validTargetTypes = TARGET_COMPATIBLE_TYPES[srcPortType]

    // Group matching target ports by (portType, label)
    const targetGroups = groupByTypeAndLabel(targetPorts, validTargetTypes)

    for (const [tgtGroupKey, tgtSlots] of targetGroups) {
      const [, tgtIdentity] = tgtGroupKey.split('\x00')
      if (tgtIdentity !== identity) continue

      // Pick the correct slot by ordinal index, clamped to available slots
      const srcSlot = srcSlots[Math.min(sourceIndex, srcSlots.length - 1)]
      const tgtSlot = tgtSlots[Math.min(targetIndex, tgtSlots.length - 1)]

      couplings.push({ sourcePort: srcSlot, targetPort: tgtSlot })
    }
  }

  return couplings
}

/**
 * Recomputes the couplings of every edge touching a node, as they would be with the given ports for that node.
 * Each edge picks its slots by its position among the edges sharing its source and its target (see
 * resolvePortCouplings). A coupling with an annotated port is kept while both its ports are still there, since
 * labels can't recreate it. Pure: neither the edges nor the nodes are changed.
 *
 * @param {string} nodeId
 * @param {Array} ports - The node's ports.
 * @param {Array} nodes - Workspace nodes, for the other end's ports.
 * @param {Array} edges - Workspace edges.
 * @returns {Map<string, Array>} Each touching edge's id to its couplings; an edge whose other node is missing is left out.
 */
export function previewCouplings(nodeId, ports, nodes, edges) {
  const portsOf = (id) => {
    if (id === nodeId) return ports
    const node = nodes.find((candidate) => candidate.id === id)
    return node && (node.data?.ports ?? [])
  }
  const couplings = new Map()
  for (const edge of edges) {
    if (edge.source !== nodeId && edge.target !== nodeId) continue
    const sourcePorts = portsOf(edge.source)
    const targetPorts = portsOf(edge.target)
    if (!sourcePorts || !targetPorts) continue
    const sourceIndex = edges.filter((e) => e.source === edge.source).indexOf(edge)
    const targetIndex = edges.filter((e) => e.target === edge.target).indexOf(edge)
    const kept = (edge.data?.couplings ?? []).flatMap(({ sourcePort, targetPort }) => {
      if (!isAnnotatedPort(sourcePort) && !isAnnotatedPort(targetPort)) return []
      const source = findPort(sourcePorts, sourcePort)
      const target = findPort(targetPorts, targetPort)
      return source && target ? [{ sourcePort: source, targetPort: target }] : []
    })
    couplings.set(edge.id, [...resolvePortCouplings(sourcePorts, targetPorts, sourceIndex, targetIndex), ...kept])
  }
  return couplings
}

/**
 * Checks whether adding a new conduit (with the given resolved couplings) would
 * violate the non-multiport single-connection constraint, and if not, marks those
 * port labels as consumed.
 *
 * The constraint is per port-label slot on a specific node: once a specific
 * portLabel occurrence on node A is coupled via any edge, no further edge may
 * also couple that same slot. The same label on a different node is unaffected.
 *
 * All-or-nothing: either all couplings are free (success, usedPortKeys updated)
 * or at least one is already consumed (failure, usedPortKeys NOT modified).
 *
 * @param {string} sourceNodeName
 * @param {string} targetNodeName
 * @param {Array}  couplings     output of resolvePortCouplings()
 * @param {Set}    usedPortKeys  mutable Set, updated in-place on success
 * @returns {{ valid: boolean, conflicts: Array<string> }}
 */
export function checkAndClaimCouplings(sourceNodeId, targetNodeId, couplings, usedPortKeys) {
  const conflicts = []
  const toMark = []

  for (const { sourcePort, targetPort } of couplings) {
    if (isSingleConnection(sourcePort)) {
      const key = portKey(sourceNodeId, sourcePort)
      if (usedPortKeys.has(key)) {
        conflicts.push(
          `"${portDisplayName(sourcePort)}" (${sourcePort.portType}) on "${sourceNodeId}" ` +
            `is non-multiport and already has a connection.`
        )
      } else {
        toMark.push(key)
      }
    }

    if (isSingleConnection(targetPort)) {
      const key = portKey(targetNodeId, targetPort)
      if (usedPortKeys.has(key)) {
        conflicts.push(
          `"${portDisplayName(targetPort)}" (${targetPort.portType}) on "${targetNodeId}" ` +
            `is non-multiport and already has a connection.`
        )
      } else {
        toMark.push(key)
      }
    }
  }

  if (conflicts.length === 0) {
    toMark.forEach((k) => usedPortKeys.add(k))
  }

  return { valid: conflicts.length === 0, conflicts }
}

/**
 * Builds the Set of already-consumed single-connection port keys from the
 * existing edges in the graph. Call this before validating a new connection.
 *
 * @param {Array} edges  VueFlow edges array (each must have edge.data.couplings)
 * @returns {Set<string>}
 */
export function buildUsedPortKeys(edges) {
  const used = new Set()
  for (const edge of edges) {
    const couplings = edge.data?.couplings ?? []
    for (const { sourcePort, targetPort } of couplings) {
      if (isSingleConnection(sourcePort)) used.add(portKey(edge.source, sourcePort))
      if (isSingleConnection(targetPort)) used.add(portKey(edge.target, targetPort))
    }
  }
  return used
}

// --- Internal helpers --------------------------------------------------------

/**
 * Groups unannotated port entries by a composite key of `portType\x00identity` (see portIdentity), but only
 * for portTypes that are in the allowedTypes set. Preserves config-file order
 * within each group (which defines slot assignment).
 *
 * @param {Array}  portLabels
 * @param {Set}    allowedTypes
 * @returns {Map<string, Array>}  key: "portType\x00identity", value: ordered array of portLabel entries
 */
function groupByTypeAndLabel(portLabels, allowedTypes) {
  const groups = new Map()
  for (const pl of portLabels) {
    if (!allowedTypes.has(pl.portType) || isAnnotatedPort(pl)) continue
    const key = `${pl.portType}\x00${portIdentity(pl)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(pl)
  }
  return groups
}

/**
 * Canonical key identifying one specific port slot on one specific node: its type and identity (see
 * portIdentity), and for an unannotated port its variables, which tell same-label slots apart.
 *
 * Format: "{nodeId}:{portType}:{identity}" plus ":{variables}" for an unannotated port.
 */
function portKey(nodeId, port) {
  const key = `${nodeId}:${port.portType}:${portIdentity(port)}`
  return isAnnotatedPort(port) ? key : `${key}:${JSON.stringify(port.variables ?? [])}`
}
