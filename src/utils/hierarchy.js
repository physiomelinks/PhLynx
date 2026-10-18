/**
 * Scopes, ids and names of nested nodes (super-modules and their super instances). Pure.
 *
 * Every node lives in one store. A node's data.scope is null at the root, otherwise the id of the super-module whose
 * children it is one of. A nested node's id is `<smId>~<localId>`; a root node's id is its localId, so flat workspaces
 * keep their ids. A super-module's interface node has the super-module's id, and is in its own scope.
 */
import { EXPOSURE_EDGE_TYPE, SUPER_INSTANCE_NODE_TYPE, SUPERMODULE_INTERFACE_NODE_TYPE } from './constants'

/** Joins a super-module id and a local id into a nested node's id. */
export const SCOPE_SEPARATOR = '~'
/** The deepest nesting expanded, as circulatory_autogen's _MAX_DEPTH. */
export const MAX_NESTING_DEPTH = 64
/** The prefix of a new super-module's id. */
export const SUPERMODULE_ID_PREFIX = 'sm_'

const NODE_ID_PREFIX = 'dndnode_'

/** @returns {string|null} The node's scope: null at the root. */
export const scopeOf = (node) => node?.data?.scope ?? null

/** @returns {boolean} Whether the node is a super instance (an instance of a super-module). */
export const isSuperInstance = (node) => node?.type === SUPER_INSTANCE_NODE_TYPE

/**
 * Gives the ports a confirmed connection dialog writes back to its ends: none to a super instance, whose ports come from
 * its super-module's exposures.
 *
 * @param {Array<[Object, Array]>} ends - Each end node with the ports the dialog left it.
 * @returns {Array<[string, Array]>} Each node id to write, with its ports.
 */
export const connectionPortWrites = (ends) => ends.filter(([node]) => node && !isSuperInstance(node)).map(([node, ports]) => [node.id, ports])

/** @returns {boolean} Whether the node is a super-module's interface node. */
export const isSupermoduleInterface = (node) => node?.type === SUPERMODULE_INTERFACE_NODE_TYPE

/** @returns {boolean} Whether an edge is part of the model; exposure edges are drawn only. */
export const isModelEdge = (edge) => edge?.type !== EXPOSURE_EDGE_TYPE

/**
 * Whether the store holds any hierarchy: a super instance, a super-module's node or an exposure edge. Without one, its
 * nodes and edges are the model as they are.
 *
 * @param {Array} nodes
 * @param {Array} [edges=[]]
 * @returns {boolean}
 */
export function hasHierarchy(nodes, edges = []) {
  return nodes.some((node) => scopeOf(node) !== null || isSuperInstance(node)) || edges.some((edge) => !isModelEdge(edge))
}

/**
 * Why an edge breaks the scope rule, or null when it doesn't: an edge joins two nodes of one scope, and only an
 * exposure edge ends at an interface node. An end missing from the store is left to the edge's other checks.
 *
 * @param {Object} edge
 * @param {Map<string, Object>} nodeById
 * @returns {string|null}
 */
export function edgeScopeProblem(edge, nodeById) {
  const ends = [nodeById.get(edge.source), nodeById.get(edge.target)]
  if (ends.some((node) => !node)) return null
  const [source, target] = ends
  if (scopeOf(source) !== scopeOf(target)) {
    return `Edge "${edge.id}" joins "${source.id}" and "${target.id}", which are in different scopes.`
  }
  if (isModelEdge(edge) && ends.some(isSupermoduleInterface)) {
    return `Edge "${edge.id}" ends at an interface node, which only exposure edges can.`
  }
  return null
}

/**
 * Gets a node's local id: its id within its scope.
 *
 * @param {Object} node
 * @returns {string}
 */
export function localIdOf(node) {
  if (node?.data?.localId != null) return node.data.localId
  const scope = scopeOf(node)
  if (!scope || isSupermoduleInterface(node)) return node.id
  return node.id.startsWith(`${scope}${SCOPE_SEPARATOR}`) ? node.id.slice(scope.length + 1) : node.id
}

/**
 * Builds a node's id from its scope and local id.
 *
 * @param {string|null} scope
 * @param {string} localId
 * @returns {string}
 */
export function nodeIdOf(scope, localId) {
  return scope ? `${scope}${SCOPE_SEPARATOR}${localId}` : localId
}

/**
 * Splits a node id into its scope and local id.
 *
 * @param {string} id
 * @returns {{ scope: string|null, localId: string }}
 */
export function splitNodeId(id) {
  const index = id.indexOf(SCOPE_SEPARATOR)
  return index < 0 ? { scope: null, localId: id } : { scope: id.slice(0, index), localId: id.slice(index + 1) }
}

/**
 * Gets the next id of a sequence, `<prefix><n>` one past the highest n among the ids (see utils/nodes.js getId).
 *
 * @param {Iterable<string>} ids
 * @param {string} [prefix='dndnode_']
 * @returns {string}
 */
export function nextSequentialId(ids, prefix = NODE_ID_PREFIX) {
  let maxId = -1
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue
    const numPart = parseInt(id.split('_')[1], 10)
    if (!isNaN(numPart) && numPart > maxId) maxId = numPart
  }
  return `${prefix}${maxId + 1}`
}

/**
 * Gets the id for a new node in a scope: today's id at the root, `<smId>~<localId>` inside a super-module, its local
 * id the next among that scope's.
 *
 * @param {string|null} scope
 * @param {Array} nodes - Every node in the store.
 * @param {string} [prefix='dndnode_']
 * @returns {string}
 */
export function nextNodeId(scope, nodes, prefix = NODE_ID_PREFIX) {
  if (!scope) return nextSequentialId(nodes.map((node) => node.id), prefix)
  const localIds = nodes.filter((node) => scopeOf(node) === scope && !isSupermoduleInterface(node)).map(localIdOf)
  return nodeIdOf(scope, nextSequentialId(localIds, prefix))
}

/**
 * Gets the id for a new super-module, which is also its interface node's id and its scope.
 *
 * @param {Array} nodes - Every node in the store.
 * @returns {string}
 */
export function nextSupermoduleId(nodes) {
  return nextSequentialId(
    nodes.map((node) => node.id),
    SUPERMODULE_ID_PREFIX
  )
}

/**
 * Indexes nodes by scope, keeping their order.
 *
 * @param {Array} nodes
 * @returns {Map<string|null, Array>} Each scope's nodes; the root's under null.
 */
export function indexByScope(nodes) {
  const index = new Map([[null, []]])
  for (const node of nodes) {
    const scope = scopeOf(node)
    if (!index.has(scope)) index.set(scope, [])
    index.get(scope).push(node)
  }
  return index
}

/**
 * Indexes the super-modules' interface nodes by super-module id.
 *
 * @param {Array} nodes
 * @returns {Map<string, Object>}
 */
export function supermodulesById(nodes) {
  return new Map(nodes.filter(isSupermoduleInterface).map((node) => [node.id, node]))
}

/**
 * Why an id can't be used, or null when it can. Ids never contain `/` (the separator of expanded ids) or `::` (of
 * `nodeId::variable` keys); `~` only separates a nested node's scope from its local id.
 *
 * @param {string} id
 * @param {string|null} [scope=null] - The node's scope.
 * @param {Object} [options]
 * @param {boolean} [options.isInterface=false] - Whether the node is its scope's interface node, whose id is the scope.
 * @returns {string|null}
 */
export function nodeIdProblem(id, scope = null, { isInterface = false } = {}) {
  if (typeof id !== 'string' || !id) return 'An id must be a non-empty string.'
  if (id.includes('/')) return `Id "${id}" contains "/".`
  if (id.includes('::')) return `Id "${id}" contains "::".`
  if (!scope || isInterface) {
    if (id.includes(SCOPE_SEPARATOR)) return `Id "${id}" contains "${SCOPE_SEPARATOR}" outside a super-module.`
    if (isInterface && id !== scope) return `Interface node "${id}" is not in its own scope "${scope}".`
    return null
  }
  const { scope: idScope, localId } = splitNodeId(id)
  if (idScope !== scope) return `Id "${id}" does not start with its scope "${scope}${SCOPE_SEPARATOR}".`
  if (!localId || localId.includes(SCOPE_SEPARATOR)) return `Id "${id}" needs one local id after "${scope}${SCOPE_SEPARATOR}".`
  return null
}

/**
 * Fills in a node's data.scope and data.localId where its data lacks them, as a node made by code that doesn't set
 * them has: the scope it is added to (an interface node's own), and the local id its id gives. Fields it has are kept,
 * so a node whose id doesn't match its scope, as one made with a root id inside a super-module, still fails
 * assertNodeId.
 *
 * @param {Object} node
 * @param {string|null} scope - The scope it is added to.
 * @returns {Object} Its data, a copy where a field was filled in.
 */
export function withScopeFields(node, scope) {
  const data = node.data ?? {}
  if (data.scope !== undefined && data.localId != null) return data
  const isInterface = isSupermoduleInterface(node)
  const filledScope = data.scope !== undefined ? data.scope : isInterface ? node.id : scope
  const localId = data.localId ?? (isInterface || !filledScope ? node.id : splitNodeId(node.id).localId)
  return { ...data, scope: filledScope, localId }
}

/**
 * Throws when a node's id breaks the id rules (see nodeIdProblem), or doesn't match its scope and local id.
 *
 * @param {Object} node
 * @throws {Error}
 */
export function assertNodeId(node) {
  const scope = scopeOf(node)
  const problem = nodeIdProblem(node.id, scope, { isInterface: isSupermoduleInterface(node) })
  if (problem) throw new Error(problem)
  if (node.data?.localId != null && nodeIdOf(isSupermoduleInterface(node) ? null : scope, node.data.localId) !== node.id) {
    throw new Error(`Id "${node.id}" does not match its local id "${node.data.localId}".`)
  }
}

// What an id may not hold outside a super-module (see nodeIdProblem).
const UNSAFE_IN_IDS = /\/|::|~/g

/**
 * Gives an id that is free, adding `_<n>` to it until it is, and takes it.
 *
 * @param {string} id
 * @param {Set<string>} taken - Ids in use; the one given is added.
 * @returns {string}
 */
function claimId(id, taken) {
  let free = id
  for (let n = 2; taken.has(free); n++) free = `${id}_${n}`
  taken.add(free)
  return free
}

/**
 * Rewrites root node ids that break the id rules (see nodeIdProblem), as older files and snapshots may hold: each
 * `/`, `::` or `~` becomes `_`, and the edges that end at them follow. A root edge's id holding those is rewritten too,
 * so no root edge reads as an expanded one. Nodes inside super-modules, and the edges that end at them or at an
 * interface node (whose `${source}--${target}` ids hold `~`), are left alone, their ids set when they were made.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {{nodes: Array, edges: Array, idMap: Map<string, string>, edgeIdMap: Map<string, string>}} The nodes and
 *   edges (the arrays given when nothing changed), and each rewritten node and edge id's new id.
 */
export function rewriteUnsafeIds(nodes, edges) {
  const atRoot = (node) => scopeOf(node) === null && !isSupermoduleInterface(node)
  const isUnsafe = (node) => atRoot(node) && nodeIdProblem(node.id) !== null
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  // An end missing from the nodes counts as a root one.
  const endAtRoot = (id) => !nodeById.has(id) || atRoot(nodeById.get(id))
  const isUnsafeEdge = (edge) =>
    typeof edge.id === 'string' &&
    endAtRoot(edge.source) &&
    endAtRoot(edge.target) &&
    edge.id.replace(UNSAFE_IN_IDS, '') !== edge.id
  const idMap = new Map()
  const edgeIdMap = new Map()
  if (!nodes.some(isUnsafe) && !edges.some(isUnsafeEdge)) return { nodes, edges, idMap, edgeIdMap }

  const safeText = (id) => String(id ?? '').replace(UNSAFE_IN_IDS, '_') || 'node'
  const takenNodeIds = new Set(nodes.filter((node) => !isUnsafe(node)).map((node) => node.id))
  for (const node of nodes) if (isUnsafe(node)) idMap.set(node.id, claimId(safeText(node.id), takenNodeIds))
  const takenEdgeIds = new Set(edges.filter((edge) => !isUnsafeEdge(edge)).map((edge) => edge.id))
  for (const edge of edges) if (isUnsafeEdge(edge)) edgeIdMap.set(edge.id, claimId(safeText(edge.id), takenEdgeIds))

  const renamed = (id) => idMap.get(id) ?? id
  return {
    nodes: nodes.map((node) => {
      if (!idMap.has(node.id)) return node
      const data = node.data?.localId != null ? { ...node.data, localId: idMap.get(node.id) } : node.data
      return { ...node, id: idMap.get(node.id), ...(data && { data }) }
    }),
    edges: edges.map((edge) =>
      edgeIdMap.has(edge.id) || idMap.has(edge.source) || idMap.has(edge.target)
        ? { ...edge, id: edgeIdMap.get(edge.id) ?? edge.id, source: renamed(edge.source), target: renamed(edge.target) }
        : edge
    ),
    idMap,
    edgeIdMap,
  }
}

// Kept out of names inside super-modules (and of super instance names): path, scope, key and override separators, and the
// level separator of flat names.
const RESERVED_IN_NAMES = ['/', SCOPE_SEPARATOR, '::', '@', '__']

/**
 * Why a node name can't be used, or null when it can. Inside a super-module, and for every super instance (whose name
 * prefixes its children's flat names), a name may not contain `/`, `~`, `::`, `@` or `__`, nor start or end with `_`,
 * so flat names split back into paths. A root module keeps today's rules.
 *
 * @param {string} name
 * @param {Object} [options]
 * @param {string|null} [options.scope=null] - The scope the node is in.
 * @param {boolean} [options.superInstance=false] - Whether the node is a super instance.
 * @returns {string|null}
 */
export function localNameProblem(name, { scope = null, superInstance = false } = {}) {
  if (!scope && !superInstance) return null
  if (!name) return 'A name is needed.'
  const reserved = RESERVED_IN_NAMES.find((text) => name.includes(text))
  if (reserved) return `"${name}" contains "${reserved}", which names inside super-modules can't.`
  if (name.startsWith('_') || name.endsWith('_')) return `"${name}" starts or ends with "_", which names inside super-modules can't.`
  return null
}

/**
 * Makes a sanitised name one localNameProblem accepts, for a name made up rather than typed, such as a dropped
 * module's: each run of `_` becomes one, and leading and trailing `_` go.
 *
 * @param {string} name - Sanitised (see utils/identifiers sanitiseName).
 * @param {string} [fallback='module'] - The name when nothing is left.
 * @returns {string}
 */
export function toLocalName(name, fallback = 'module') {
  return (name ?? '').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '') || fallback
}

/**
 * Lists the super-modules each super-module uses directly, through the super instances among its children.
 *
 * @param {Array} nodes
 * @returns {Map<string, Set<string>>} Every super-module's id to the ids it uses, missing ones included.
 */
export function supermoduleDependencies(nodes) {
  const graph = new Map([...supermodulesById(nodes).keys()].map((id) => [id, new Set()]))
  for (const node of nodes) {
    const scope = scopeOf(node)
    if (scope && isSuperInstance(node) && graph.has(scope)) graph.get(scope).add(node.data.smId)
  }
  return graph
}

/**
 * Counts each super-module's occurrences in the model: how many copies of it the root expands to, through every
 * super instance of it and of the super-modules holding those. One used by a super-module the root uses twice occurs twice.
 *
 * @param {Array} nodes
 * @returns {Map<string, number>} Every super-module's id to its count; 0 for one the root never reaches.
 */
export function supermoduleOccurrences(nodes) {
  const superInstancesOf = new Map()
  for (const node of nodes) {
    if (!isSuperInstance(node)) continue
    if (!superInstancesOf.has(node.data?.smId)) superInstancesOf.set(node.data?.smId, [])
    superInstancesOf.get(node.data?.smId).push(node)
  }
  const memo = new Map([[null, 1]])
  const visiting = new Set()
  const countOf = (scope) => {
    if (memo.has(scope)) return memo.get(scope)
    // A cycle never reaches the root.
    if (visiting.has(scope)) return 0
    visiting.add(scope)
    const count = (superInstancesOf.get(scope) ?? []).reduce((sum, node) => sum + countOf(scopeOf(node)), 0)
    visiting.delete(scope)
    memo.set(scope, count)
    return count
  }
  return new Map([...supermodulesById(nodes).keys()].map((id) => [id, countOf(id)]))
}

/**
 * Finds a cycle among super-modules, each using the next and the last the first.
 *
 * @param {Map<string, Set<string>>} graph - From supermoduleDependencies.
 * @returns {string[]|null} The cycle's super-module ids, or null when there is none.
 */
export function findSupermoduleCycle(graph) {
  const state = new Map() // id → 'visiting' | 'done'
  const stack = []
  const visit = (id) => {
    if (state.get(id) === 'done' || !graph.has(id)) return null
    if (state.get(id) === 'visiting') return stack.slice(stack.indexOf(id))
    state.set(id, 'visiting')
    stack.push(id)
    for (const next of graph.get(id)) {
      const cycle = visit(next)
      if (cycle) return cycle
    }
    stack.pop()
    state.set(id, 'done')
    return null
  }
  for (const id of graph.keys()) {
    const cycle = visit(id)
    if (cycle) return cycle
  }
  return null
}

/**
 * Whether one super-module uses another, directly or through others.
 *
 * @param {Map<string, Set<string>>} graph - From supermoduleDependencies.
 * @param {string} smId
 * @param {string} otherId
 * @returns {boolean}
 */
export function supermoduleUses(graph, smId, otherId) {
  const seen = new Set()
  const pending = [...(graph.get(smId) ?? [])]
  while (pending.length) {
    const id = pending.pop()
    if (id === otherId) return true
    if (seen.has(id)) continue
    seen.add(id)
    pending.push(...(graph.get(id) ?? []))
  }
  return false
}

/**
 * Whether a super instance of one super-module can be placed in a scope without making a cycle: never in the super-module
 * itself, nor in one it uses.
 *
 * @param {Map<string, Set<string>>} graph - From supermoduleDependencies.
 * @param {string|null} scope - Where the super instance would go.
 * @param {string} smId - Its super-module.
 * @returns {boolean}
 */
export function canPlaceSuperInstance(graph, scope, smId) {
  return !scope || (scope !== smId && !supermoduleUses(graph, smId, scope))
}

/**
 * Gets how deep a super-module nests: 1 for one with no super instances.
 *
 * @param {Map<string, Set<string>>} graph - From supermoduleDependencies.
 * @param {string} smId
 * @returns {number} Infinity when it is in a cycle or nests deeper than MAX_NESTING_DEPTH.
 */
export function supermoduleDepth(graph, smId) {
  const memo = new Map()
  const visiting = new Set()
  const depthOf = (id) => {
    if (memo.has(id)) return memo.get(id)
    if (visiting.has(id)) return Infinity
    visiting.add(id)
    let deepest = 0
    for (const next of graph.get(id) ?? []) deepest = Math.max(deepest, depthOf(next))
    visiting.delete(id)
    memo.set(id, deepest + 1)
    return deepest + 1
  }
  const depth = depthOf(smId)
  return depth > MAX_NESTING_DEPTH ? Infinity : depth
}

/**
 * Gets the super instance Enter opens: the one selected node, when it is a super instance, and Enter was pressed on the
 * canvas itself (or nothing focused), not on a field, button or menu.
 *
 * @param {KeyboardEvent} event
 * @param {Array} selectedNodes - The canvas selection.
 * @param {Element|null} canvasEl - The canvas's element.
 * @returns {string|null} Its id; null when Enter opens nothing.
 */
export function superInstanceToEnter(event, selectedNodes, canvasEl) {
  if (event.key !== 'Enter' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null
  const target = event.target
  const onCanvas = target === target?.ownerDocument?.body || !!canvasEl?.contains(target)
  if (!onCanvas || target.closest?.('input, textarea, select, button, a, [role="button"], [role="menu"], [contenteditable="true"]')) return null
  return selectedNodes.length === 1 && isSuperInstance(selectedNodes[0]) ? selectedNodes[0].id : null
}
