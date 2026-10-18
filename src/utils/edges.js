
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
 * - Port type compatibility (source → target), as circulatory_autogen (CA)
 *   pairs them (see SOURCE_PORT_TYPES and TARGET_PORT_TYPES in ports.js):
 *     exit_ports    → entrance_ports | general_ports
 *     general_ports → entrance_ports | general_ports
 *   (an entrance port never starts a coupling, and an exit port never ends one)
 *
 * Slot assignment
 * ---------------
 * A label may appear more than once under one portType (e.g. a module with two
 * exit "vessel_port"s). Each occurrence is a slot, identified by its index in
 * that (portType, label) group. As CA does, a coupling looks through a label's
 * ports as one group, a source's exit before its general ports and a target's
 * entrance before its general ports, and takes the first slot that is
 * multiport or not yet held by another edge, so slots depend on which edges
 * already exist, not on any edge's position:
 *
 *   exit vessel_ports [s0, s1]; connect A, then B  ->  A s0, B s1
 *   then delete A, connect C                      ->  C s0 (B keeps s1)
 *
 * Couplings record the chosen indices as sourceSlot / targetSlot; read them
 * through slotOf, which also finds the slots of couplings saved before these
 * existed.
 *
 * A slot is held as source and as target apart, as a general port can be
 * either: one edge leaving through a general slot leaves it free for one edge
 * arriving.
 *
 * CA takes the first free slot the same way as it connects the module array's
 * rows in order (export orders them to match, see services/export/caOrder.js).
 * It couples every label two modules share; a vessel_port pairs one source
 * slot with one target slot, any other label every free source slot with the
 * target's first free slot. CA gives a heart's entrance vessel_ports by place
 * in its inp_vessels instead. services/coupling/caReproducible.js lists the
 * couplings CA's order can't reproduce; where none matches, the export gives
 * the coupled slots labels of their own (services/export/caPairing.js).
 *
 * Non-multiport constraint
 * ------------------------
 * A port with multiport === 'None' (Python None serialised as a string,
 * used as the default in buildPorts when multi_port is absent) may only
 * participate in ONE conduit edge as source and ONE as target across the
 * entire graph (only a general port can be both). Any other truthy
 * value for multiport means the port is unrestricted.
 */

import { SOURCE_PORT_TYPES, TARGET_PORT_TYPES, VESSEL_PORT } from './ports'

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
 * Gets the slot a coupling's port is in: its index in its (portType, label) group. A recorded slot holds while the
 * port there still matches; otherwise the port is found by identity and then by variables, as for a coupling saved
 * before slots were recorded or whose node's ports have changed since.
 *
 * @param {Array|null} ports - The node's ports.
 * @param {Object} port - The coupling's port on that node.
 * @param {number} [slot] - The coupling's recorded sourceSlot or targetSlot.
 * @returns {number} The port's index in its group; failing that, the recorded slot, or -1 when none is recorded.
 */
export function slotOf(ports, port, slot) {
  return findSlot(ports, port, slot).slot
}

/**
 * Resolves the port-label couplings for ONE conduit edge, as CA pairs them: every label both ends share, each side's
 * ports of a label as one group (see caSlotGroups). A vessel_port pairs one source slot with one target slot; any other
 * label pairs each free source slot with the target's one slot, or only the first while that slot takes one
 * connection. Each side takes its group's first slot that is multiport or not in usedPortKeys, though a slot the
 * edge's stored couplings name comes first while it is free. When every slot is held it takes the first, which
 * checkAndClaimCouplings then rejects. Without usedPortKeys, each group's first slot is taken.
 *
 * @param {Array} sourcePorts - node.data.ports of the source node.
 * @param {Array} targetPorts - node.data.ports of the target node.
 * @param {Object} [options]
 * @param {string} [options.sourceId] - The source node's id, as in usedPortKeys.
 * @param {string} [options.targetId] - The target node's id.
 * @param {Set<string>} [options.usedPortKeys] - Slots other edges hold (see buildUsedPortKeys); not changed.
 * @param {Array} [options.stored] - The edge's current couplings, whose slots it keeps while they are free.
 * @returns {Array<{ sourcePort: Object, targetPort: Object, sourceSlot: number, targetSlot: number }>}
 */
export function resolvePortCouplings(
  sourcePorts,
  targetPorts,
  { sourceId, targetId, usedPortKeys = new Set(), stored = [] } = {}
) {
  const couplings = []
  // The place in a group of the slot a stored coupling of the label names, or -1.
  const storedPlace = (side, ports, group, label) => {
    for (const coupling of stored) {
      const port = coupling[`${side}Port`]
      if (port?.label !== label) continue
      const slot = slotOf(ports, port, coupling[`${side}Slot`])
      const place = group.findIndex((entry) => entry.port.portType === port.portType && entry.slot === slot)
      if (place !== -1) return place
    }
    return -1
  }
  const targetGroups = caSlotGroups(targetPorts, TARGET_PORT_TYPES)

  for (const [label, sources] of caSlotGroups(sourcePorts, SOURCE_PORT_TYPES)) {
    const targets = targetGroups.get(label)
    if (!targets) continue
    const target = targets[pickSlot(targetId, 'in', targets, usedPortKeys, storedPlace('target', targetPorts, targets, label))]
    const first = pickSlot(sourceId, 'out', sources, usedPortKeys, storedPlace('source', sourcePorts, sources, label))
    const pairsMany = label !== VESSEL_PORT && !isSingleConnection(target.port)
    const others = pairsMany ? sources.filter((entry, place) => place !== first && isFree(sourceId, 'out', entry, usedPortKeys)) : []
    for (const source of [sources[first], ...others]) {
      couplings.push({ sourcePort: source.port, targetPort: target.port, sourceSlot: source.slot, targetSlot: target.slot })
    }
  }

  return couplings
}

/**
 * Groups a node's ports of some types by label, as CA does: each group in the order of the types, then of the ports,
 * and the groups in the order of their first port in that order.
 *
 * @param {Array} ports
 * @param {ReadonlyArray<string>} portTypes - SOURCE_PORT_TYPES or TARGET_PORT_TYPES (see ports.js).
 * @returns {Map<string, Array<{ port: Object, slot: number }>>} Label to its ports, each with its slot: its index in
 *   its (portType, label) group.
 */
export function caSlotGroups(ports, portTypes) {
  const groups = new Map()
  for (const portType of portTypes) {
    const counts = new Map()
    for (const port of ports ?? []) {
      if (port.portType !== portType) continue
      const slot = counts.get(port.label) ?? 0
      counts.set(port.label, slot + 1)
      if (!groups.has(port.label)) groups.set(port.label, [])
      groups.get(port.label).push({ port, slot })
    }
  }
  return groups
}

/**
 * Resolves the couplings of some edges against the slots every other edge holds. Each keeps the slots its stored
 * couplings name while they are free, so no edge takes a slot another holds; the rest take the first free slot, in
 * edge order. A coupling with no free slot is left out. Pure: neither the edges nor the nodes are changed.
 *
 * @param {Array} nodes - Workspace nodes.
 * @param {Array} edges - Workspace edges.
 * @param {Function} shouldResolve - (edge) => whether to resolve that edge.
 * @param {Object} [options]
 * @param {Map<string, Array>} [options.ports] - Ports to use in place of a node's own, by node id.
 * @param {Array<string>} [options.conflicts] - Collects a message for each coupling left out.
 * @returns {Map<string, Array>} Each resolved edge's id to its couplings; an edge whose node is missing is left out.
 */
export function resolveEdgeCouplings(nodes, edges, shouldResolve, { ports = new Map(), conflicts = [] } = {}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const portsOf = (id) => ports.get(id) ?? (nodeById.has(id) ? nodeById.get(id).data?.ports ?? [] : null)
  const nameOf = (id) => nodeById.get(id)?.data?.name ?? id

  const resolving = edges.filter((edge) => shouldResolve(edge) && portsOf(edge.source) && portsOf(edge.target))
  const held = buildUsedPortKeys(edges.filter((edge) => !resolving.includes(edge)), portsOf)
  // The slots each resolving edge holds now, kept from the edges resolved before it. A slot held only by its recorded
  // index, its port gone, gives way to an edge whose port is still found there.
  const ends = new Map(resolving.map((edge) => [edge.id, heldEnds(edge, portsOf)]))
  const found = new Set([...ends.values()].flat().filter((end) => end.found).map((end) => end.key))
  const reserved = new Map(
    [...ends].map(([id, list]) => [id, new Set(list.filter((end) => end.found || !found.has(end.key)).map((end) => end.key))])
  )

  const couplings = new Map()
  for (const edge of resolving) {
    reserved.delete(edge.id)
    const used = new Set([held, ...reserved.values()].flatMap((keys) => [...keys]))
    const resolved = resolvePortCouplings(portsOf(edge.source), portsOf(edge.target), {
      sourceId: edge.source,
      targetId: edge.target,
      usedPortKeys: used,
      stored: edge.data?.couplings ?? [],
    })
    const messages = new Set()
    const kept = resolved.filter((coupling) => {
      const taken = takenEnds(edge.source, edge.target, coupling, used, nameOf)
      taken.forEach((message) => messages.add(`${nameOf(edge.source)} → ${nameOf(edge.target)}: ${message}`))
      return !taken.length
    })
    conflicts.push(...messages)
    checkAndClaimCouplings(edge.source, edge.target, kept, held)
    couplings.set(edge.id, kept)
  }
  return couplings
}

/**
 * Recomputes the couplings of every edge touching a node, as they would be with the given ports for that node (see
 * resolveEdgeCouplings). Pure: neither the edges nor the nodes are changed.
 *
 * @param {string} nodeId
 * @param {Array} ports - The node's ports.
 * @param {Array} nodes - Workspace nodes, for the other end's ports.
 * @param {Array} edges - Workspace edges.
 * @param {Array<string>} [conflicts] - Collects a message for each coupling left out as no slot is free.
 * @returns {Map<string, Array>} Each touching edge's id to its couplings; an edge whose other node is missing is left out.
 */
export function previewCouplings(nodeId, ports, nodes, edges, conflicts = []) {
  const touches = (edge) => edge.source === nodeId || edge.target === nodeId
  return resolveEdgeCouplings(nodes, edges, touches, { ports: new Map([[nodeId, ports]]), conflicts })
}

/**
 * Checks whether adding a new conduit (with the given resolved couplings) would
 * violate the non-multiport single-connection constraint, and if not, marks those
 * port slots as consumed.
 *
 * The constraint is per slot on a specific node: once a single-connection slot on
 * node A is coupled via any edge, no further edge may also couple it on the
 * same side (source or target). As
 * resolvePortCouplings takes the first free slot, a conflict means the group has
 * no free slot.
 *
 * All-or-nothing: either all couplings are free (success, usedPortKeys updated)
 * or at least one is already consumed (failure, usedPortKeys NOT modified).
 *
 * @param {string} sourceNodeId
 * @param {string} targetNodeId
 * @param {Array}  couplings     output of resolvePortCouplings()
 * @param {Set}    usedPortKeys  mutable Set, updated in-place on success
 * @param {Function} [nameOf]    node id to the name conflicts give
 * @returns {{ valid: boolean, conflicts: Array<string> }}
 */
export function checkAndClaimCouplings(sourceNodeId, targetNodeId, couplings, usedPortKeys, nameOf = (id) => id) {
  const conflicts = [
    ...new Set(couplings.flatMap((coupling) => takenEnds(sourceNodeId, targetNodeId, coupling, usedPortKeys, nameOf))),
  ]
  if (conflicts.length === 0) {
    couplings.forEach((coupling) =>
      singleEnds(sourceNodeId, targetNodeId, coupling).forEach(({ key }) => usedPortKeys.add(key))
    )
  }
  return { valid: conflicts.length === 0, conflicts }
}

/**
 * Builds the Set of already-consumed single-connection slot keys from the
 * existing edges in the graph. Call this before validating a new connection.
 *
 * @param {Array} edges  VueFlow edges array (each must have edge.data.couplings)
 * @param {Function} [portsOf]  node id to its ports, to find the slots of couplings saved without them (see slotOf)
 * @returns {Set<string>}
 */
export function buildUsedPortKeys(edges, portsOf = () => []) {
  return new Set(edges.flatMap((edge) => heldEnds(edge, portsOf).map((end) => end.key)))
}

// --- Internal helpers --------------------------------------------------------

/**
 * Finds the slot a coupling's port is in (see slotOf), and whether the port was found there rather than the slot
 * taken from its recorded index.
 *
 * @param {Array|null} ports
 * @param {Object} port
 * @param {number} [slot]
 * @returns {{ slot: number, found: boolean }}
 */
function findSlot(ports, port, slot) {
  const group = (ports ?? []).filter((p) => p.portType === port?.portType && p.label === port?.label)
  const variables = JSON.stringify(port?.variables ?? [])
  // A super instance's port is the exposed port it names, whatever its variables.
  const matches = (p) =>
    !!p && (p === port || (port?.exposedPortId != null ? p.exposedPortId === port.exposedPortId : JSON.stringify(p.variables ?? []) === variables))
  const isRecorded = Number.isInteger(slot) && slot >= 0
  if (isRecorded && matches(group[slot])) return { slot, found: true }
  const index = group.indexOf(port) !== -1 ? group.indexOf(port) : group.findIndex(matches)
  return index !== -1 || !isRecorded ? { slot: index, found: index !== -1 } : { slot, found: false }
}

/**
 * Lists the single-connection slots an edge's stored couplings hold.
 *
 * @param {Object} edge
 * @param {Function} portsOf - node id to its ports.
 * @returns {Array<{ key: string, found: boolean }>} found: whether the port is still in that slot (see findSlot).
 */
function heldEnds(edge, portsOf) {
  return (edge.data?.couplings ?? []).flatMap(({ sourcePort, targetPort, sourceSlot, targetSlot }) =>
    [
      [edge.source, 'out', sourcePort, sourceSlot],
      [edge.target, 'in', targetPort, targetSlot],
    ]
      .filter(([, , port]) => isSingleConnection(port))
      .map(([nodeId, role, port, recorded]) => {
        const { slot, found } = findSlot(portsOf(nodeId), port, recorded)
        return { key: portKey(nodeId, role, port, slot), found }
      })
  )
}

/**
 * Picks a group's slot: the preferred one while it is free, else the first free one, else the first.
 *
 * @param {string} nodeId
 * @param {string} role - 'out' for the edge's source end, 'in' for its target end.
 * @param {Array<{ port: Object, slot: number }>} group - From caSlotGroups.
 * @param {Set<string>} usedPortKeys
 * @param {number} preferred - A place in the group, or -1 for none.
 * @returns {number} A place in the group.
 */
function pickSlot(nodeId, role, group, usedPortKeys, preferred) {
  const free = (place) => isFree(nodeId, role, group[place], usedPortKeys)
  if (preferred >= 0 && preferred < group.length && free(preferred)) return preferred
  return Math.max(group.findIndex((_, place) => free(place)), 0)
}

/**
 * Whether a slot is multiport or held by no other edge.
 *
 * @param {string} nodeId
 * @param {string} role
 * @param {{ port: Object, slot: number }} entry
 * @param {Set<string>} usedPortKeys
 * @returns {boolean}
 */
function isFree(nodeId, role, { port, slot }, usedPortKeys) {
  return !isSingleConnection(port) || !usedPortKeys.has(portKey(nodeId, role, port, slot))
}

/**
 * Lists a coupling's single-connection ends, with their slot keys.
 *
 * @param {string} sourceNodeId
 * @param {string} targetNodeId
 * @param {Object} coupling
 * @returns {Array<{ nodeId: string, port: Object, key: string }>}
 */
function singleEnds(sourceNodeId, targetNodeId, { sourcePort, targetPort, sourceSlot = 0, targetSlot = 0 }) {
  return [
    [sourceNodeId, 'out', sourcePort, sourceSlot],
    [targetNodeId, 'in', targetPort, targetSlot],
  ]
    .filter(([, , port]) => isSingleConnection(port))
    .map(([nodeId, role, port, slot]) => ({ nodeId, port, key: portKey(nodeId, role, port, slot) }))
}

/**
 * Describes each single-connection end of a coupling whose slot is already held.
 *
 * @param {string} sourceNodeId
 * @param {string} targetNodeId
 * @param {Object} coupling
 * @param {Set<string>} usedPortKeys
 * @param {Function} nameOf - Node id to the name to give.
 * @returns {Array<string>}
 */
function takenEnds(sourceNodeId, targetNodeId, coupling, usedPortKeys, nameOf) {
  return singleEnds(sourceNodeId, targetNodeId, coupling)
    .filter(({ key }) => usedPortKeys.has(key))
    .map(
      ({ nodeId, port }) =>
        `"${nameOf(nodeId)}" has no free "${port.label}" slot (${port.portType}): each takes one connection, and all are taken.`
    )
}

/**
 * Canonical key identifying one slot on one node, as the source ('out') or target ('in') end of an edge.
 *
 * Format: "{nodeId}:{role}:{portType}:{label}:{slot}", where slot is the index of the
 * port within its (portType, label) group.
 */
export function portKey(nodeId, role, port, slot) {
  return `${nodeId}:${role}:${port.portType}:${port.label}:${slot}`
}
