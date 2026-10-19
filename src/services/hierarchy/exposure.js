/**
 * Exposure: which of its children's ports a super-module exposes, read from its exposure edges. Pure.
 *
 * An exposure edge joins a child of a super-module (a module or a super instance) and the super-module's interface node,
 * either way round. Handles only say where it is drawn; the edge's data says what it exposes:
 * `data.exposed = [{ id, alias, label?, order }]`, each entry one whole port of the child.
 *   - `alias`: `{portType, label, slot}`, the slot-th (portType, label) port of a module, or `{via}`, the exposed port
 *     `via` of a super instance, whose port it then is.
 *   - `id`: the exposed port's id, `xp_<n>`, never reused, which the couplings to its super instances name
 *     (`exposedPortId`).
 *   - `label`: what its super instances call it, the child port's label by default.
 *   - `order`: its place among the super-module's exposed ports, which sets the slot of each (portType, label) on
 *     its super instances and circulatory_autogen's per_submodule key order.
 *
 * A super-module's exposed ports are derived from its exposure edges (exposedPortsOf), never stored on their own: an
 * ExposedPort is `{id, alias: {child, portType?, label?, slot?, via?}, label?, order, edgeId, childId}`, `child` the
 * child's local id. Variables, multiport and multiply factor are always read from the child's port as it is now.
 */
import { buildUsedPortKeys, isSingleConnection, portKey } from '../../utils/edges'
import {
  indexByScope,
  isModelEdge,
  isSuperInstance,
  isSupermoduleInterface,
  localIdOf,
  MAX_NESTING_DEPTH,
  scopeOf,
} from '../../utils/hierarchy'

/** The prefix of an exposed port's id. */
export const EXPOSED_PORT_ID_PREFIX = 'xp_'

/** @returns {boolean} Whether an edge is an exposure edge. */
export const isExposureEdge = (edge) => !!edge && !isModelEdge(edge)

/** @returns {Array} The entries an exposure edge exposes. */
export const exposureEntriesOf = (edge) => (isExposureEdge(edge) ? (edge.data?.exposed ?? []) : [])

/**
 * Gets the ends of an exposure edge: the super-module whose interface it ends at, and the child it exposes.
 *
 * @param {Object} edge
 * @param {Map<string, Object>} nodeById
 * @returns {{smId: string, child: Object}|null} Null when it doesn't join a child and its super-module's interface.
 */
export function exposureEnds(edge, nodeById) {
  if (!isExposureEdge(edge)) return null
  const source = nodeById.get(edge.source)
  const target = nodeById.get(edge.target)
  const [sm, child] = isSupermoduleInterface(target) ? [target, source] : [source, target]
  if (!isSupermoduleInterface(sm) || !child || isSupermoduleInterface(child) || scopeOf(child) !== sm.id) return null
  return { smId: sm.id, child }
}

/** @returns {string} An alias's identity on its child: its via, or its (portType, label, slot). */
export const aliasKey = (alias) =>
  alias?.via != null ? `via:${alias.via}` : `${alias?.portType}:${alias?.label}#${alias?.slot ?? 0}`

/**
 * Indexes every super-module's exposed ports, each in its order: by `order`, then by where its edge and entry are.
 * An entry whose id an earlier one has is left out.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {Map<string, Array<Object>>} Super-module id to its ExposedPorts; none for one without.
 */
export function indexExposures(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const bySupermodule = new Map()
  edges.forEach((edge, edgeIndex) => {
    const ends = exposureEnds(edge, nodeById)
    if (!ends) return
    if (!bySupermodule.has(ends.smId)) bySupermodule.set(ends.smId, [])
    exposureEntriesOf(edge).forEach((entry, entryIndex) => {
      bySupermodule.get(ends.smId).push({
        id: entry.id,
        alias: { ...entry.alias, child: localIdOf(ends.child) },
        ...(entry.label && { label: entry.label }),
        order: Number.isFinite(entry.order) ? entry.order : Infinity,
        edgeId: edge.id,
        childId: ends.child.id,
        rank: [edgeIndex, entryIndex],
      })
    })
  })
  for (const [smId, ports] of bySupermodule) {
    ports.sort((a, b) => a.order - b.order || a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    const seen = new Set()
    bySupermodule.set(
      smId,
      ports.filter((port) => !seen.has(port.id) && seen.add(port.id)).map(({ rank: _rank, ...port }) => port)
    )
  }
  return bySupermodule
}

/**
 * Gets a super-module's exposed ports, in order (see indexExposures).
 *
 * @param {string} smId
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {Array<Object>}
 */
export const exposedPortsOf = (smId, nodes, edges) => indexExposures(nodes, edges).get(smId) ?? []

/**
 * Makes a resolver of exposed ports to the module ports they alias, through `via`.
 *
 * @param {Array} nodes
 * @param {Map<string, Array>} exposures - From indexExposures.
 * @returns {(smId: string, exposedPortId: string) => Object|null} The module port, a copy labelled as the exposed
 *   port is (outer label first), or null when it doesn't resolve.
 */
export function portResolver(nodes, exposures) {
  const byScope = indexByScope(nodes)
  const childOf = (smId, localId) =>
    (byScope.get(smId) ?? []).find((node) => !isSupermoduleInterface(node) && localIdOf(node) === localId)
  const resolve = (smId, exposedPortId, depth = 0) => {
    const exposed = (exposures.get(smId) ?? []).find((port) => port.id === exposedPortId)
    if (!exposed || depth > MAX_NESTING_DEPTH) return null
    const child = childOf(smId, exposed.alias.child)
    if (!child) return null
    if (isSuperInstance(child)) {
      const inner = exposed.alias.via != null && resolve(child.data.smId, exposed.alias.via, depth + 1)
      return inner ? { ...inner, label: exposed.label ?? inner.label } : null
    }
    const group = (child.data?.ports ?? []).filter((port) => port.portType === exposed.alias.portType && port.label === exposed.alias.label)
    const port = group[exposed.alias.slot ?? 0]
    return port ? { ...port, label: exposed.label ?? port.label } : null
  }
  return resolve
}

/**
 * Builds a super instance's ports from its super-module's exposed ports, in their order: each a copy of the module port it
 * aliases (through `via`), with the exposed port's id and label. An exposed port that doesn't resolve is left out.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {Array} edges - Every edge in the store.
 * @param {string} smId
 * @param {Map<string, Array>} [exposures] - From indexExposures, when already made.
 * @param {Function} [resolve] - From portResolver over the same nodes and exposures, when already made.
 * @returns {Array}
 */
export function superInstancePorts(nodes, edges, smId, exposures = indexExposures(nodes, edges), resolve = portResolver(nodes, exposures)) {
  return (exposures.get(smId) ?? []).flatMap((exposed) => {
    const port = resolve(smId, exposed.id)
    return port ? [{ ...port, exposedPortId: exposed.id }] : []
  })
}

/**
 * Gets the next exposed port id: one past the highest `xp_<n>` anything names, an exposed port, a via or a coupling, so
 * an id a coupling still names is never given to another port.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {string}
 */
export function nextExposedPortId(nodes, edges) {
  let highest = -1
  const take = (id) => {
    if (typeof id !== 'string' || !id.startsWith(EXPOSED_PORT_ID_PREFIX)) return
    const n = Number(id.slice(EXPOSED_PORT_ID_PREFIX.length))
    if (Number.isInteger(n) && n > highest) highest = n
  }
  for (const edge of edges) {
    for (const entry of exposureEntriesOf(edge)) {
      take(entry.id)
      take(entry.alias?.via)
    }
    for (const coupling of edge.data?.couplings ?? []) {
      take(coupling.sourcePort?.exposedPortId)
      take(coupling.targetPort?.exposedPortId)
    }
  }
  for (const node of nodes) {
    for (const port of node.data?.ports ?? []) take(port.exposedPortId)
    for (const id of node.data?.broken ?? []) take(id)
  }
  return `${EXPOSED_PORT_ID_PREFIX}${highest + 1}`
}

/**
 * Lists the slots of a scope's children that edges inside it hold, as buildUsedPortKeys keys.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {string} scope
 * @returns {Set<string>}
 */
function heldInside(nodes, edges, scope) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const inside = edges.filter((edge) => isModelEdge(edge) && scopeOf(nodeById.get(edge.source)) === scope)
  return buildUsedPortKeys(inside, (id) => nodeById.get(id)?.data?.ports ?? [])
}

/**
 * Lists the slots a super-module's exposed single-connection ports hold on its children, as buildUsedPortKeys keys,
 * both ways: a connection from outside takes the port, so an edge inside may not.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {string} smId
 * @returns {Set<string>}
 */
export function exposedSlotKeys(nodes, edges, smId) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const keys = new Set()
  for (const exposed of exposedPortsOf(smId, nodes, edges)) {
    const child = nodeById.get(exposed.childId)
    const ports = child?.data?.ports ?? []
    const port = exposed.alias.via != null
      ? ports.find((candidate) => candidate.exposedPortId === exposed.alias.via)
      : ports.filter((candidate) => candidate.portType === exposed.alias.portType && candidate.label === exposed.alias.label)[exposed.alias.slot ?? 0]
    if (!port || !isSingleConnection(port)) continue
    const slot = ports.filter((candidate) => candidate.portType === port.portType && candidate.label === port.label).indexOf(port)
    keys.add(portKey(child.id, 'in', port, slot))
    keys.add(portKey(child.id, 'out', port, slot))
  }
  return keys
}

/**
 * Lists the ports of an exposure edge's child that can be exposed, one row each, for the Expose Ports dialog: a
 * module's own ports, or a super instance's (each then exposed through `via`). A single-connection port an edge inside the
 * super-module already holds can't be exposed, unless it already is.
 *
 * @param {Object} edge - An exposure edge.
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {Array<{key: string, alias: Object, port: Object, slot: number, exposedPortId: string|null,
 *   label: string|null, order: number|null, disabled: boolean, reason: string|null}>} In the child's port order.
 *   `exposedPortId`, `label` and `order` are the entry exposing it now, if any.
 */
export function exposablePorts(edge, nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const ends = exposureEnds(edge, nodeById)
  if (!ends) return []
  const { child, smId } = ends
  const entries = new Map(exposureEntriesOf(edge).map((entry) => [aliasKey(entry.alias), entry]))
  const held = heldInside(nodes, edges, smId)
  const ports = child.data?.ports ?? []
  return ports.map((port) => {
    const slot = ports.filter((other) => other.portType === port.portType && other.label === port.label).indexOf(port)
    const alias = isSuperInstance(child) ? { via: port.exposedPortId } : { portType: port.portType, label: port.label, slot }
    const key = aliasKey(alias)
    const entry = entries.get(key)
    const isHeld = isSingleConnection(port) && ['in', 'out'].some((role) => held.has(portKey(child.id, role, port, slot)))
    const disabled = isHeld && !entry
    return {
      key,
      alias,
      port,
      slot,
      exposedPortId: entry?.id ?? null,
      label: entry?.label ?? null,
      order: Number.isFinite(entry?.order) ? entry.order : null,
      disabled,
      reason: disabled ? `"${port.label}" takes one connection, and a connection inside the super-module already has it.` : null,
    }
  })
}

/**
 * Plans what an exposure edge exposes, as the Expose Ports dialog saves it: the rows ticked, in the order shown. A row
 * exposed already keeps its id; a new one gets the next free id. The rows take the order places the edge's entries had,
 * in their new order, and new rows come after every exposed port.
 *
 * @param {Object} edge - An exposure edge.
 * @param {Array<{key: string, label?: string|null}>} rows - The rows to expose, in order (see exposablePorts), each
 *   with its own label, if any.
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {{entries: Array, removedIds: string[], problems: string[]}} The edge's new entries; the ids it no longer
 *   exposes; and why it can't be saved, when it can't (then `entries` is the edge's own).
 */
export function planExposure(edge, rows, nodes, edges) {
  const options = new Map(exposablePorts(edge, nodes, edges).map((option) => [option.key, option]))
  const current = exposureEntriesOf(edge)
  const problems = []
  const seen = new Set()
  for (const row of rows) {
    const option = options.get(row.key)
    if (!option) problems.push(`The child has no port "${row.key}".`)
    else if (seen.has(row.key)) problems.push(`"${option.port.label}" (slot ${option.slot}) is exposed twice.`)
    else if (option.disabled) problems.push(option.reason)
    seen.add(row.key)
  }
  if (problems.length) return { entries: current, removedIds: [], problems }

  const byKey = new Map(current.map((entry) => [aliasKey(entry.alias), entry]))
  const kept = rows.filter((row) => byKey.has(row.key))
  const places = kept.map((row) => byKey.get(row.key).order).filter(Number.isFinite).sort((a, b) => a - b)
  const smId = exposureEnds(edge, new Map(nodes.map((node) => [node.id, node]))).smId
  let next = Math.max(-1, ...exposedPortsOf(smId, nodes, edges).map((port) => port.order).filter(Number.isFinite)) + 1
  let nextId = Number(nextExposedPortId(nodes, edges).slice(EXPOSED_PORT_ID_PREFIX.length))

  const entries = rows.map((row) => {
    const existing = byKey.get(row.key)
    // A row given no label keeps the one it has; an empty one goes back to the child port's.
    const label = (row.label === undefined ? existing?.label : row.label)?.trim() || null
    const order = existing && places.length ? places.shift() : next++
    return {
      id: existing?.id ?? `${EXPOSED_PORT_ID_PREFIX}${nextId++}`,
      alias: { ...options.get(row.key).alias },
      ...(label && label !== options.get(row.key).port.label && { label }),
      order,
    }
  })
  const keptIds = new Set(entries.map((entry) => entry.id))
  return { entries, removedIds: current.map((entry) => entry.id).filter((id) => !keptIds.has(id)), problems }
}

/**
 * Plans a super-module's exposed ports in a new order: each entry's order its place in the list. Ports left out of
 * the list keep their place after the ones listed.
 *
 * @param {string} smId
 * @param {string[]} orderedIds - Exposed port ids, in their new order.
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {Map<string, Array>} Each exposure edge whose entries change, to its new entries.
 */
export function planReorder(smId, orderedIds, nodes, edges) {
  const ports = exposedPortsOf(smId, nodes, edges)
  const listed = orderedIds.filter((id) => ports.some((port) => port.id === id))
  const ordered = [...listed, ...ports.map((port) => port.id).filter((id) => !listed.includes(id))]
  const place = new Map(ordered.map((id, index) => [id, index]))
  return changedEntries(smId, nodes, edges, (entry) => (place.get(entry.id) === entry.order ? entry : { ...entry, order: place.get(entry.id) }))
}

/**
 * Plans a new label for an exposed port: what its super instances call it. An empty label, or the child port's own, goes
 * back to the child port's.
 *
 * @param {string} smId
 * @param {string} exposedPortId
 * @param {string|null} label
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {Map<string, Array>} The exposure edge whose entries change, to its new entries.
 */
export function planRelabel(smId, exposedPortId, label, nodes, edges) {
  const trimmed = label?.trim() || null
  return changedEntries(smId, nodes, edges, (entry) => {
    if (entry.id !== exposedPortId) return entry
    const { label: _label, ...rest } = entry
    const own = entry.alias?.via == null ? entry.alias?.label : null
    return trimmed && trimmed !== own ? { ...rest, label: trimmed } : rest
  })
}

/**
 * Maps a super-module's exposure entries, keeping the edges whose entries change.
 *
 * @returns {Map<string, Array>}
 */
function changedEntries(smId, nodes, edges, map) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const changed = new Map()
  for (const edge of edges) {
    if (exposureEnds(edge, nodeById)?.smId !== smId) continue
    const entries = exposureEntriesOf(edge)
    const next = entries.map(map)
    if (next.some((entry, i) => entry !== entries[i])) changed.set(edge.id, next)
  }
  return changed
}

/**
 * Plans what un-exposing ports, or removing nodes, does to the connections across the workspace: every coupling to a
 * port that goes is trimmed, an edge left with none removed, and an outer super-module's port exposing one of them
 * through `via` goes too, and so on outwards. Removing a child inside a super-module un-exposes its ports, and its
 * super instances' overrides of it, and of what is inside it, go.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {Object} change
 * @param {Map<string, Iterable<string>>} [change.unexposed] - Super-module id to the exposed port ids un-exposed.
 * @param {Iterable<string>} [change.removedNodeIds] - Nodes removed (their edges with them).
 * @param {Iterable<string>} [change.removedEdgeIds] - Edges removed; an exposure edge's ports are un-exposed.
 * @returns {{couplings: Map<string, Array>, removeEdgeIds: string[], exposures: Map<string, Array>,
 *   overrides: Map<string, Object>, unexposed: Map<string, Set<string>>, connections: number, couplingCount: number,
 *   super instances: string[], isEmpty: boolean}} The edges' new couplings; the edges left with none; the exposure edges'
 *   new entries; the super instances' new overrides; every port un-exposed, by super-module; how many edges lose
 *   couplings, how many couplings go, and the super instances they are on.
 */
export function planUnexpose(nodes, edges, { unexposed: given = new Map(), removedNodeIds = [], removedEdgeIds = [] } = {}) {
  const unexposed = new Map([...given].map(([smId, ids]) => [smId, new Set(ids)]))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const removedNodes = new Set(removedNodeIds)
  const removedEdges = new Set(removedEdgeIds)
  const isGone = (edge) => removedEdges.has(edge.id) || removedNodes.has(edge.source) || removedNodes.has(edge.target)
  const exposuresOf = new Map() // edge id → its entries as planned
  const entriesOf = (edge) => (exposuresOf.has(edge.id) ? exposuresOf.get(edge.id) : exposureEntriesOf(edge))

  const pending = []
  const all = new Map()
  const unexpose = (smId, ids) => {
    if (!all.has(smId)) all.set(smId, new Set())
    const fresh = [...ids].filter((id) => !all.get(smId).has(id))
    fresh.forEach((id) => all.get(smId).add(id))
    if (fresh.length) pending.push([smId, new Set(fresh)])
  }
  for (const [smId, ids] of unexposed) unexpose(smId, ids)
  for (const edge of edges) {
    const ends = exposureEnds(edge, nodeById)
    if (ends && isGone(edge)) unexpose(ends.smId, exposureEntriesOf(edge).map((entry) => entry.id))
  }
  // Un-exposed by an edge that stays: that edge's entries lose them.
  for (const [smId, ids] of unexposed) {
    for (const edge of edges) {
      if (isGone(edge) || exposureEnds(edge, nodeById)?.smId !== smId) continue
      const entries = entriesOf(edge)
      if (entries.some((entry) => ids.has(entry.id))) exposuresOf.set(edge.id, entries.filter((entry) => !ids.has(entry.id)))
    }
  }

  const couplingsOf = new Map()
  const superInstances = new Set()
  let couplingCount = 0
  while (pending.length) {
    const [smId, ids] = pending.shift()
    for (const instance of nodes) {
      if (!isSuperInstance(instance) || instance.data.smId !== smId || removedNodes.has(instance.id)) continue
      for (const edge of edges) {
        if (isGone(edge) || !isModelEdge(edge) || (edge.source !== instance.id && edge.target !== instance.id)) continue
        const couplings = couplingsOf.get(edge.id) ?? edge.data?.couplings ?? []
        const named = (coupling, side) => edge[side] === instance.id && ids.has(coupling[`${side}Port`]?.exposedPortId)
        const kept = couplings.filter((coupling) => !named(coupling, 'source') && !named(coupling, 'target'))
        if (kept.length === couplings.length) continue
        couplingCount += couplings.length - kept.length
        superInstances.add(instance.id)
        couplingsOf.set(edge.id, kept)
      }
      // An outer super-module exposing one of them through this super instance loses that port too.
      const outer = scopeOf(instance)
      if (!outer) continue
      for (const edge of edges) {
        if (isGone(edge) || exposureEnds(edge, nodeById)?.child !== instance) continue
        const entries = entriesOf(edge)
        const dead = entries.filter((entry) => ids.has(entry.alias?.via))
        if (!dead.length) continue
        exposuresOf.set(edge.id, entries.filter((entry) => !dead.includes(entry)))
        unexpose(outer, dead.map((entry) => entry.id))
      }
    }
  }

  const removeEdgeIds = [...couplingsOf].filter(([, couplings]) => !couplings.length).map(([id]) => id)
  for (const id of removeEdgeIds) couplingsOf.delete(id)
  const overrides = planOverrideRemoval(nodes, removedNodes)
  return {
    couplings: couplingsOf,
    removeEdgeIds,
    exposures: exposuresOf,
    overrides,
    unexposed: all,
    connections: couplingsOf.size + removeEdgeIds.length,
    couplingCount,
    superInstances: [...superInstances],
    isEmpty: !couplingsOf.size && !removeEdgeIds.length && !exposuresOf.size && !overrides.size,
  }
}

/**
 * Plans the overrides removing nodes inside super-modules leaves setting nothing: every super instance's override whose
 * local id path goes through a removed node.
 *
 * @param {Array} nodes
 * @param {Set<string>} removed - Node ids.
 * @returns {Map<string, Object>} Each super instance whose overrides change, to its new overrides.
 */
export function planOverrideRemoval(nodes, removed) {
  const changed = new Map()
  if (!removed.size) return changed
  const byScope = indexByScope(nodes)
  const childOf = (scope, localId) => (byScope.get(scope) ?? []).find((node) => !isSupermoduleInterface(node) && localIdOf(node) === localId)
  const throughRemoved = (smId, key) => {
    let scope = smId
    for (const segment of key.split('/')) {
      if (segment === '@') return false
      const child = childOf(scope, segment)
      if (!child) return false
      if (removed.has(child.id)) return true
      if (!isSuperInstance(child)) return false
      scope = child.data.smId
    }
    return false
  }
  for (const node of nodes) {
    if (!isSuperInstance(node) || removed.has(node.id)) continue
    const overrides = node.data?.overrides ?? {}
    const dead = Object.keys(overrides).filter((key) => throughRemoved(node.data.smId, key))
    if (dead.length) changed.set(node.id, Object.fromEntries(Object.entries(overrides).filter(([key]) => !dead.includes(key))))
  }
  return changed
}

/**
 * Works out every super instance's materialised ports from its super-module's exposed ports, and rebinds the couplings to
 * them: a coupling naming an exposed port gets the port as it is now, and its slot, and is otherwise left as it is,
 * never re-paired. A coupling whose exposed port is gone keeps its port and is listed in its super instance's `broken`.
 * Only what differs from the store is given.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {{nodes: Map<string, {ports?: Array, broken?: string[]|undefined}>, couplings: Map<string, Array>}}
 *   Each super instance's changed data fields (`broken` undefined when none is), and each edge's rebound couplings.
 */
export function materialiseSuperInstances(nodes, edges) {
  const changedNodes = new Map()
  const changedCouplings = new Map()
  const superInstances = nodes.filter(isSuperInstance)
  if (!superInstances.length) return { nodes: changedNodes, couplings: changedCouplings }

  const exposures = indexExposures(nodes, edges)
  // One resolver for the call, and each super-module's ports resolved once; each super instance gets its own copies.
  const resolve = portResolver(nodes, exposures)
  const portsBySm = new Map()
  const portsOf = (smId) => {
    if (!portsBySm.has(smId)) portsBySm.set(smId, superInstancePorts(nodes, edges, smId, exposures, resolve))
    return portsBySm.get(smId).map((port) => ({ ...port }))
  }
  const portsById = new Map(superInstances.map((node) => [node.id, portsOf(node.data.smId)]))
  const broken = new Map(superInstances.map((node) => [node.id, new Set()]))

  for (const edge of edges) {
    if (!isModelEdge(edge) || !(portsById.has(edge.source) || portsById.has(edge.target))) continue
    const couplings = edge.data?.couplings ?? []
    let isChanged = false
    const rebound = couplings.map((coupling) => {
      let next = coupling
      for (const side of ['source', 'target']) {
        const ports = portsById.get(edge[side])
        const port = coupling[`${side}Port`]
        if (!ports || port?.exposedPortId == null) continue
        const live = ports.find((candidate) => candidate.exposedPortId === port.exposedPortId)
        if (!live) {
          broken.get(edge[side]).add(port.exposedPortId)
          continue
        }
        const slot = ports.filter((candidate) => candidate.portType === live.portType && candidate.label === live.label).indexOf(live)
        if (same(port, live) && coupling[`${side}Slot`] === slot) continue
        next = { ...next, [`${side}Port`]: live, [`${side}Slot`]: slot }
      }
      if (next !== coupling) isChanged = true
      return next
    })
    if (isChanged) changedCouplings.set(edge.id, rebound)
  }

  for (const node of superInstances) {
    const fields = {}
    const ports = portsById.get(node.id)
    if (!same(node.data?.ports ?? [], ports)) fields.ports = ports
    const brokenIds = [...broken.get(node.id)].sort()
    const current = node.data?.broken ?? []
    if (!same(current, brokenIds)) fields.broken = brokenIds.length ? brokenIds : undefined
    if (Object.keys(fields).length) changedNodes.set(node.id, fields)
  }
  return { nodes: changedNodes, couplings: changedCouplings }
}

/** @returns {boolean} Whether two plain values are the same, as saved. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Whether an edge has a coupling to a super instance port its super-module no longer exposes (see materialiseSuperInstances).
 *
 * @param {Object} edge
 * @param {Map<string, Object>} nodeById
 * @returns {boolean}
 */
export function isBrokenEdge(edge, nodeById) {
  if (!isModelEdge(edge)) return false
  return (edge.data?.couplings ?? []).some((coupling) =>
    ['source', 'target'].some((side) => {
      const broken = nodeById.get(edge[side])?.data?.broken
      return !!broken?.length && broken.includes(coupling[`${side}Port`]?.exposedPortId)
    })
  )
}
