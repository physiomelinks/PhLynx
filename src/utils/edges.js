import { getVariableMultiportTypes } from './config'


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
 *   any other truthy value   → multiport (unrestricted), including a
 *                              per-variable list such as ['sum', 'True']
 */
export function isSingleConnection(port) {
  const mp = port.multiportType
  if (Array.isArray(mp)) return false
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
 * the group size — matching the module array semantics.
 *
 * For labels that appear only once (the common case), the index is irrelevant
 * and that single entry is always selected.
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
    const [srcPortType, label] = groupKey.split('\x00')
    const validTargetTypes = TARGET_COMPATIBLE_TYPES[srcPortType]

    // Group matching target ports by (portType, label)
    const targetGroups = groupByTypeAndLabel(targetPorts, validTargetTypes)

    for (const [tgtGroupKey, tgtSlots] of targetGroups) {
      const [, tgtLabel] = tgtGroupKey.split('\x00')
      if (tgtLabel !== label) continue

      // Pick the correct slot by ordinal index, clamped to available slots
      const srcSlot = srcSlots[Math.min(sourceIndex, srcSlots.length - 1)]
      const tgtSlot = tgtSlots[Math.min(targetIndex, tgtSlots.length - 1)]

      couplings.push({ sourcePort: srcSlot, targetPort: tgtSlot })
    }
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

/**
 * Finds the node variables whose value comes through a connection, so a
 * parameter value set on them must not be emitted (as circulatory_autogen does:
 * a connected boundary_condition variable takes its value from the connection,
 * and a parameters-file value for it is only used while it is unconnected).
 *
 * A variable is connection-fed when it is:
 * - a boundary_condition variable (per its module config) directly coupled to
 *   another module's variable, including through a whole-port "True" or a
 *   per-variable "True" entry;
 * - the target of a Multiply port (it receives the scaled source variable);
 * - the summed variable of a whole-port Sum port that has a connection;
 * - a per-variable "sum" variable (always given a generated sum, 0 when unconnected).
 *
 * @param {Array} nodes  workspace nodes ({ id, data: { moduleRef, ports } })
 * @param {Array} edges  edges with resolved `data.couplings`
 * @param {Object} libraryStore  for the modules' variable types (availableModules)
 * @returns {Map<string, Set<string>>}  node id -> connection-fed variable names
 */
export function getConnectionFedVariables(nodes, edges, libraryStore) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const fed = new Map()
  const mark = (nodeId, varName) => {
    if (!varName) return
    if (!fed.has(nodeId)) fed.set(nodeId, new Set())
    fed.get(nodeId).add(varName)
  }
  const isBoundaryCondition = (nodeId, varName) => {
    const moduleRef = nodeById.get(nodeId)?.data?.moduleRef
    const module = libraryStore?.availableModules?.get(moduleRef)
    return module?.variables?.find((v) => v.name === varName)?.type === 'boundary_condition'
  }
  const markIfBoundaryCondition = (nodeId, varName) => {
    if (isBoundaryCondition(nodeId, varName)) mark(nodeId, varName)
  }

  // Per-variable "sum" variables always get an equation.
  for (const node of nodes) {
    for (const port of node.data?.ports ?? []) {
      const types = perVariableTypes(port)
      types?.forEach((type, i) => type === 'Sum' && mark(node.id, port.variables[i]))
    }
  }

  for (const edge of edges) {
    for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
      const srcVars = sourcePort.variables ?? []
      const tgtVars = targetPort.variables ?? []
      const srcTypes = perVariableTypes(sourcePort)
      const tgtTypes = perVariableTypes(targetPort)

      if (srcTypes || tgtTypes) {
        srcVars.forEach((srcVar, i) => {
          if (srcTypes?.[i] === 'Sum' || tgtTypes?.[i] === 'Sum') return // marked above
          markIfBoundaryCondition(edge.source, srcVar)
          markIfBoundaryCondition(edge.target, tgtVars[i])
        })
      } else if (sourcePort.multiportType === 'Multiply') {
        mark(edge.target, tgtVars[0])
      } else if (sourcePort.multiportType === 'Sum' || targetPort.multiportType === 'Sum') {
        if (sourcePort.multiportType === 'Sum') mark(edge.source, srcVars[0])
        if (targetPort.multiportType === 'Sum') mark(edge.target, tgtVars[0])
      } else {
        const n = Math.min(srcVars.length, tgtVars.length)
        for (let i = 0; i < n; i++) {
          markIfBoundaryCondition(edge.source, srcVars[i])
          markIfBoundaryCondition(edge.target, tgtVars[i])
        }
      }
    }
  }

  return fed
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
function perVariableTypes(port) {
  try {
    return getVariableMultiportTypes(port)
  } catch {
    return null // malformed lists are reported by generateFlattenedModel
  }
}

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
