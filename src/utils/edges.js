
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

import { findPort } from './ports'

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
 * Only single-connection slots are picked by index. Every multiport slot in a
 * group takes part on every edge, so a Sum couples to each same-label multiport
 * slot on the other node, whichever way the edge points. A single-connection
 * slot couples at most once. Ports couple only with the same number of
 * variables, which the export pairs one by one; a port without variables yet
 * or without a label couples to nothing.
 *
 * A single-connection slot the edge's stored couplings name is kept, so a slot
 * the user chose in the edge dialog survives later saves. Otherwise the slot at
 * the ordinal index is taken while no other edge holds it, then the first one
 * free; with every slot held, that side couples nothing.
 *
 * This is the one rule for every coupling: edge creation, import, the instance
 * editor's save, and the edge dialog, so the dialog shows what export applies.
 *
 * @param {Array}  sourcePorts node.data.ports of the source node
 * @param {Array}  targetPorts  node.data.ports of the target node
 * @param {number} sourceIndex  position of target in source's out_instances (0-based)
 * @param {number} targetIndex  position of source in target's inp_instances (0-based)
 * @param {Object} [options]
 * @param {Array} [options.stored] - The edge's current couplings, whose single-connection slots it keeps.
 * @param {Set<Object>} [options.held] - Single-connection ports of either node other edges couple (see heldPorts).
 * @returns {Array<{ sourcePortLabel: Object, targetPortLabel: Object }>}
 */
export function resolvePortCouplings(
  sourcePorts,
  targetPorts,
  sourceIndex = 0,
  targetIndex = 0,
  { stored = [], held = new Set() } = {}
) {
  const couplings = []

  // Group source ports by (portType, label) — preserving config order
  const sourceGroups = groupByTypeAndLabel(sourcePorts, SOURCE_COMPATIBLE_TYPES)

  for (const [groupKey, srcSlots] of sourceGroups) {
    const [srcPortType, label] = groupKey.split('\x00')
    if (!label.trim()) continue
    const validTargetTypes = TARGET_COMPATIBLE_TYPES[srcPortType]

    // Group matching target ports by (portType, label)
    const targetGroups = groupByTypeAndLabel(targetPorts, validTargetTypes)

    for (const [tgtGroupKey, tgtSlots] of targetGroups) {
      const [, tgtLabel] = tgtGroupKey.split('\x00')
      if (tgtLabel !== label) continue

      const used = new Set()
      const srcPicked = slotsOnEdge(srcSlots, sourceIndex, chosenSlot(srcSlots, stored.map((c) => c.sourcePort)), held)
      const tgtPicked = slotsOnEdge(tgtSlots, targetIndex, chosenSlot(tgtSlots, stored.map((c) => c.targetPort)), held)
      for (const srcSlot of srcPicked) {
        for (const tgtSlot of tgtPicked) {
          if (used.has(srcSlot) || used.has(tgtSlot)) continue
          const count = variableCount(srcSlot)
          if (!count || count !== variableCount(tgtSlot)) continue
          couplings.push({ sourcePort: srcSlot, targetPort: tgtSlot })
          if (isSingleConnection(srcSlot)) used.add(srcSlot)
          if (isSingleConnection(tgtSlot)) used.add(tgtSlot)
        }
      }
    }
  }

  return couplings
}

/**
 * The slots of one (portType, label) group that take part on an edge: every multiport slot, and one
 * single-connection slot: the chosen one, else the one at the edge's ordinal index (clamped to the last)
 * while it is free, else the first free one.
 *
 * @param {Array} slots - The group's ports, in config order.
 * @param {number} index - The edge's ordinal index on this side.
 * @param {Object|null} chosen - The slot the edge's stored couplings name (see chosenSlot).
 * @param {Set<Object>} held - Single-connection ports other edges couple.
 * @returns {Array}
 */
function slotsOnEdge(slots, index, chosen, held) {
  const single = slots.filter(isSingleConnection)
  const ordinal = single[Math.min(index, single.length - 1)]
  const picked = chosen ?? (ordinal && !held.has(ordinal) ? ordinal : single.find((slot) => !held.has(slot)))
  return slots.filter((slot) => !isSingleConnection(slot) || slot === picked)
}

/**
 * The single-connection slot of a group that an edge's stored couplings name, or null.
 *
 * @param {Array} slots - The group's ports.
 * @param {Array} storedPorts - One end of each of the edge's stored couplings.
 * @returns {Object|null}
 */
function chosenSlot(slots, storedPorts) {
  for (const stored of storedPorts) {
    const port = matchPort(slots, stored)
    if (port && isSingleConnection(port)) return port
  }
  return null
}

/**
 * Finds the port a stored coupling end refers to, by its `_uid` and otherwise by label, type and variables.
 *
 * @param {Array} ports
 * @param {Object} stored - A coupling's sourcePort or targetPort.
 * @returns {Object|null}
 */
function matchPort(ports, stored) {
  if (!stored) return null
  return (stored._uid && ports.find((port) => port._uid === stored._uid)) || findPort(ports, stored)
}

/**
 * The single-connection ports of a node that edges other than one couple, as either end.
 *
 * @param {string} nodeId
 * @param {Array} ports - The node's ports.
 * @param {Array} edges - Workspace edges.
 * @param {string} edgeId - The edge to leave out.
 * @returns {Set<Object>} Ports from `ports`.
 */
export function heldPorts(nodeId, ports, edges, edgeId) {
  const held = new Set()
  for (const edge of edges) {
    if (edge.id === edgeId) continue
    for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
      const end = edge.source === nodeId ? sourcePort : edge.target === nodeId ? targetPort : null
      const port = matchPort(ports, end)
      if (port && isSingleConnection(port)) held.add(port)
    }
  }
  return held
}

/** The number of variables a port pairs. */
const variableCount = (port) => (port.variables ?? []).length

/**
 * An edge's ordinal indices: its position among the edges sharing its source, and among those sharing its target.
 *
 * @param {Object} edge
 * @param {Array} edges - Workspace edges, in canvas order.
 * @returns {{ sourceIndex: number, targetIndex: number }}
 */
export function edgeOrdinals(edge, edges) {
  return {
    sourceIndex: edges.filter((e) => e.source === edge.source).findIndex((e) => e.id === edge.id),
    targetIndex: edges.filter((e) => e.target === edge.target).findIndex((e) => e.id === edge.id),
  }
}

/**
 * Recomputes the couplings of every edge touching a node, as they would be with the given ports for that node.
 * Each edge keeps the single-connection slots its couplings name, and otherwise picks its slots by its position
 * among the edges sharing its source and its target, past those other edges hold (see resolvePortCouplings).
 * Pure: neither the edges nor the nodes are changed.
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
    const { sourceIndex, targetIndex } = edgeOrdinals(edge, edges)
    const held = new Set([...heldPorts(edge.source, sourcePorts, edges, edge.id), ...heldPorts(edge.target, targetPorts, edges, edge.id)])
    const stored = edge.data?.couplings ?? []
    const resolved = resolvePortCouplings(sourcePorts, targetPorts, sourceIndex, targetIndex, { stored, held })
    couplings.set(edge.id, carryDrivesState(stored, resolved))
  }
  return couplings
}

/**
 * Whether two couplings join the same ports, by type and label, and, unless `byLabel`, the same variables.
 *
 * @param {Object} a
 * @param {Object} b
 * @param {boolean} [byLabel] - Ignore the variables, as a save may have renamed them.
 * @returns {boolean}
 */
export function isSameCoupling(a, b, byLabel = false) {
  const same = (x, y) =>
    x?.portType === y?.portType &&
    x?.label === y?.label &&
    (byLabel || JSON.stringify(x?.variables ?? []) === JSON.stringify(y?.variables ?? []))
  return same(a.sourcePort, b.sourcePort) && same(a.targetPort, b.targetPort)
}

/**
 * Keeps the `drivesState` mark of couplings that recomputing them from the ports left in place (see
 * resolveBoundaryValues). A coupling whose variables changed loses it, so driving what it now joins is asked again.
 *
 * @param {Array} previous - The couplings before.
 * @param {Array} next - The recomputed couplings.
 * @param {Object} [options]
 * @param {boolean} [options.byLabel] - Match by port alone, for `previous` already confirmed under the old names.
 * @returns {Array} `next`, its couplings marked as before; the same array when none was.
 */
export function carryDrivesState(previous, next, { byLabel = false } = {}) {
  const marked = previous.filter((coupling) => coupling.drivesState)
  if (!marked.length) return next
  return next.map((coupling) =>
    !coupling.drivesState && marked.some((old) => isSameCoupling(old, coupling, byLabel))
      ? { ...coupling, drivesState: true }
      : coupling
  )
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
          `"${sourcePort.label}" (${sourcePort.portType}) on "${sourceNodeId}" ` +
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
          `"${targetPort.label}" (${targetPort.portType}) on "${targetNodeId}" ` +
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
 * Groups portLabel entries by a composite key of `portType\x00label`, but only
 * for portTypes that are in the allowedTypes set. Preserves config-file order
 * within each group (which defines slot assignment).
 *
 * @param {Array}  portLabels
 * @param {Set}    allowedTypes
 * @returns {Map<string, Array>}  key: "portType\x00label", value: ordered array of portLabel entries
 */
function groupByTypeAndLabel(portLabels, allowedTypes) {
  const groups = new Map()
  for (const pl of portLabels) {
    if (!allowedTypes.has(pl.portType)) continue
    const key = `${pl.portType}\x00${pl.label}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(pl)
  }
  return groups
}

/**
 * Canonical key identifying one specific portLabel slot on one specific node.
 * Uses object identity (via the portLabel object reference) to distinguish
 * multiple occurrences of the same label on the same node.
 *
 * Format: "{nodeId}:{portType}:{label}:{slotIndex}"
 * The slotIndex is the position of this portLabel within its (portType, label) group.
 */
function portKey(nodeId, port) {
  // The portLabel object itself is unique per slot — we use its variables array
  // serialised as a tiebreaker to distinguish same-label slots on the same node.
  return `${nodeId}:${port.portType}:${port.label}:${JSON.stringify(port.variables ?? [])}`
}
