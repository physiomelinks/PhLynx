/**
 * Structural edits of the hierarchy. Pure: each takes the store's nodes and edges and gives them as they are after it,
 * or the problems that stop it.
 *   - makeUnique: a super instance gets its own copy of its super-module, the copy's exposed ports keeping their ids.
 *   - keepForOne: a super instance keeps its super-module to itself, every other super instance of it moving to a copy.
 *   - nestSelection: nodes of one scope go into a new super-module, one super instance of it standing in their place.
 *   - unnest: a super instance's children take its place.
 * Each leaves the model as it was: the expansion after it is the one before, but for model ids and flat names (see
 * modelIdMap). Each also gives `rewrite`, how a module's place changes: the store ids of the super instances it is inside
 * and its own, from the root down.
 *
 * New nodes come with the ids they keep (see utils/hierarchy nextNodeId); an edge that moves gets a new id, so the
 * caller can add every new node and edge before removing the old ones.
 */
import { buildSuperInstance, buildSupermoduleInterface } from '../import/buildWorkflow'
import { slotOf } from '../../utils/edges'
import { EXPOSURE_EDGE_TYPE, HANDLE_VARIANT } from '../../utils/constants'
import { buildGhostHandles, findMostCentralGhostHandle, getHandleId, normaliseHandleSlots } from '../../utils/handles'
import {
  findSupermoduleCycle,
  indexByScope,
  isModelEdge,
  isSuperInstance,
  isSupermoduleInterface,
  localIdOf,
  localNameProblem,
  MAX_NESTING_DEPTH,
  nextSequentialId,
  nextSupermoduleId,
  nodeIdOf,
  scopeOf,
  splitNodeId,
  supermoduleDependencies,
  supermoduleDepth,
  supermoduleOccurrences,
  supermodulesById,
  toLocalName,
} from '../../utils/hierarchy'
import { sanitiseName } from '../../utils/identifiers'
import { expandHierarchy, EXPANDED_ID_SEPARATOR, LOCAL_CONSTANTS_KEY } from './expand'
import { EXPOSED_PORT_ID_PREFIX, exposureEnds, exposureEntriesOf, indexExposures, nextExposedPortId, superInstancePorts } from './exposure'
import { asConstants, isLocalConstantRow, localConstantsOf, localConstantValue } from './localConstants'
import { LEVEL_SEPARATOR, SELF_ROLE } from './names'

const NODE_ID_PREFIX = 'dndnode_'
// What Vue Flow adds to nodes and edges as it draws them, never copied.
const RUNTIME_FIELDS = [
  'selected',
  'dragging',
  'resizing',
  'computedPosition',
  'handleBounds',
  'dimensions',
  'isParent',
  'events',
  'hidden',
  'initialized',
  'sourceNode',
  'targetNode',
  'sourceX',
  'sourceY',
  'targetX',
  'targetY',
]

/** @returns {*} A deep copy of plain data. */
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/** @returns {Object} A node or edge without what Vue Flow adds, copied, with some fields replaced. */
function copyItem(item, fields) {
  const plain = Object.fromEntries(Object.entries(item).filter(([field]) => !RUNTIME_FIELDS.includes(field)))
  return { ...clone(plain), ...fields }
}

/** @returns {{x: number, y: number}} A node's centre. */
function centreOf(node) {
  const width = node.dimensions?.width ?? node.width ?? 0
  const height = node.dimensions?.height ?? node.height ?? 0
  return { x: (node.position?.x ?? 0) + width / 2, y: (node.position?.y ?? 0) + height / 2 }
}

/** @returns {{x: number, y: number}} The mean of the nodes' centres. */
function centroidOf(nodes) {
  const centres = nodes.map(centreOf)
  const mean = (axis) => centres.reduce((sum, centre) => sum + centre[axis], 0) / Math.max(1, centres.length)
  return { x: mean('x'), y: mean('y') }
}

/**
 * Hands out new edge ids, `<source>--<target>` as a drawn connection's, then `--2`, `--3`, … past those taken.
 *
 * @param {Array} edges - Every edge in the store, whose ids stay taken.
 * @returns {(source: string, target: string) => string}
 */
function edgeIdAllocator(edges) {
  const taken = new Set(edges.map((edge) => edge.id))
  return (source, target) => {
    const base = `${source}--${target}`
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}--${n}`
    taken.add(id)
    return id
  }
}

/**
 * Hands out new local ids in a scope, past every one it has and every one handed out.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {string|null} scope
 * @returns {() => string} The next node id in the scope.
 */
function nodeIdAllocator(nodes, scope) {
  const taken = scope
    ? nodes.filter((node) => scopeOf(node) === scope && !isSupermoduleInterface(node)).map(localIdOf)
    : nodes.map((node) => node.id)
  return () => {
    const localId = nextSequentialId(taken, NODE_ID_PREFIX)
    taken.push(localId)
    return nodeIdOf(scope, localId)
  }
}

/** @returns {() => string} Hands out exposed port ids past every one the store names (see nextExposedPortId). */
function exposedPortIdAllocator(nodes, edges) {
  let next = Number(nextExposedPortId(nodes, edges).slice(EXPOSED_PORT_ID_PREFIX.length))
  return () => `${EXPOSED_PORT_ID_PREFIX}${next++}`
}

/**
 * Makes a name one names inside a super-module may have (see localNameProblem), and free among `taken`, which it then
 * joins.
 *
 * @param {string} name
 * @param {Set<string>} taken
 * @param {Object} [options]
 * @param {string|null} [options.scope] - Where it goes: at the root, a name is kept as it is.
 * @returns {string}
 */
function claimName(name, taken, { scope = null } = {}) {
  const base = !scope || !localNameProblem(name, { scope }) ? name : toLocalName(sanitiseName(name))
  let free = base
  for (let n = 2; taken.has(free); n++) free = `${base}_${n}`
  taken.add(free)
  return free
}

/** @returns {Array} A super-module's children, in expansion order: its submoduleOrder, then the rest in store order. */
function childrenInOrder(nodes, smId) {
  const members = nodes.filter((node) => scopeOf(node) === smId && !isSupermoduleInterface(node))
  const order = supermodulesById(nodes).get(smId)?.data?.supermodule?.submoduleOrder ?? []
  const byLocalId = new Map(members.map((node) => [localIdOf(node), node]))
  return [...new Set([...order.map((localId) => byLocalId.get(localId)).filter(Boolean), ...members])]
}

/**
 * Turns a handle of a node's handles on, for an edge to attach to: one on a side active but unused, else the most central
 * ghost there, else a new one after those on that side.
 *
 * @param {Array} handles - The node's handles, changed in place.
 * @param {string} side
 * @param {Set<string>} [used] - The handle ids its edges use; without it, no active handle is taken.
 * @returns {string} Its handle id.
 */
function claimHandle(handles, side, used) {
  const unused = used && handles.find((handle) => handle.side === side && handle.variant !== HANDLE_VARIANT.GHOST && !used.has(getHandleId(handle)))
  if (unused) return getHandleId(unused)
  const ghost = findMostCentralGhostHandle(side, handles)
  if (ghost) {
    ghost.variant = HANDLE_VARIANT.DEFAULT
    return getHandleId(ghost)
  }
  const slotIndex = handles.filter((handle) => handle.side === side).length
  const handle = { uid: crypto.randomUUID(), side, name: '', slotIndex, variant: HANDLE_VARIANT.DEFAULT }
  handles.push(handle)
  return getHandleId(handle)
}

/** @returns {string|undefined} The side a node's handle is on. */
const sideOf = (node, handleId) => node?.data?.handles?.find((handle) => getHandleId(handle) === handleId)?.side

/** @returns {string[]} The handles some edges use at a node. */
const handlesUsedAt = (edges, id) =>
  edges.flatMap((edge) => [edge.source === id && edge.sourceHandle, edge.target === id && edge.targetHandle]).filter(Boolean)

/**
 * Gives every node an edit touches one handle per edge, after it: the nodes at the edges it made or removed, and its
 * copies.
 *   - An edge made on a handle another edge at that node uses moves to one of its own on the same side (see claimHandle).
 *   - A handle the edges before used and those after don't becomes a ghost.
 *   - Each node's slots are normalised, the active handles centred on each side.
 *
 * @param {Array} nodes - The store after the edit; each node whose handles change is copied, its handles with it.
 * @param {Array} edgesBefore
 * @param {Array} edgesAfter
 * @param {Array} created - The edges the edit made, among edgesAfter, whose handles are changed in place.
 * @param {Map<string, string>} [originOf] - Each copy's id to the id of the node it copies.
 * @returns {Array} The nodes, those whose handles change replaced.
 */
function spreadHandles(nodes, edgesBefore, edgesAfter, created, originOf = new Map()) {
  const kept = new Set(edgesAfter.map((edge) => edge.id))
  const removed = edgesBefore.filter((edge) => !kept.has(edge.id))
  const touched = new Set([...originOf.keys(), ...[...created, ...removed].flatMap((edge) => [edge.source, edge.target])])
  const nodeById = new Map()
  for (const node of nodes) {
    if (touched.has(node.id) && node.data?.handles) nodeById.set(node.id, { ...node, data: { ...node.data, handles: clone(node.data.handles) } })
  }

  const uses = new Map([...nodeById.keys()].map((id) => [id, new Map()]))
  for (const id of nodeById.keys()) for (const handleId of handlesUsedAt(edgesAfter, id)) uses.get(id).set(handleId, (uses.get(id).get(handleId) ?? 0) + 1)
  for (const edge of created) {
    for (const end of ['source', 'target']) {
      const [node, handleId] = [nodeById.get(edge[end]), edge[`${end}Handle`]]
      const count = node && uses.get(node.id)
      if (!handleId || !(count?.get(handleId) > 1)) continue
      const side = sideOf(node, handleId) ?? (end === 'source' ? 'right' : 'left')
      const used = new Set([...count].filter(([, n]) => n > 0).map(([id]) => id))
      const own = claimHandle(node.data.handles, side, used)
      count.set(handleId, count.get(handleId) - 1)
      count.set(own, (count.get(own) ?? 0) + 1)
      edge[`${end}Handle`] = own
    }
  }

  for (const node of nodeById.values()) {
    const before = new Set(handlesUsedAt(edgesBefore, originOf.get(node.id) ?? node.id))
    const after = uses.get(node.id)
    for (const handle of node.data.handles) {
      const id = getHandleId(handle)
      if (before.has(id) && !(after.get(id) > 0)) handle.variant = HANDLE_VARIANT.GHOST
    }
    node.data.handles = normaliseHandleSlots(node.data.handles)
  }
  // A node whose handles come out as they went in stays as it was.
  return nodes.map((node) => {
    const copy = nodeById.get(node.id)
    return copy && JSON.stringify(copy.data.handles) !== JSON.stringify(node.data.handles) ? copy : node
  })
}

/**
 * Rewrites the override keys of every super instance whose keys pass through a scope: where a key's path of local ids
 * reaches it, `rewriteAt` gives the rest of the path as it becomes, null when the key goes, or `{entries}` when it
 * becomes several keys, each with its own patches.
 *
 * @param {Array} nodes - The store before the edit.
 * @param {string} scope - A super-module's id.
 * @param {(segments: string[], patches: Object) => string[]|null|{entries: Array<[string[], Object]>}} rewriteAt
 * @param {Set<string>} [skip] - Super instances left alone.
 * @returns {Map<string, Object>} Each super instance whose overrides change, to its new overrides.
 */
function rewriteOverrideKeys(nodes, scope, rewriteAt, skip = new Set()) {
  const byScope = indexByScope(nodes)
  const childOf = (smId, localId) => (byScope.get(smId) ?? []).find((node) => !isSupermoduleInterface(node) && localIdOf(node) === localId)
  const changed = new Map()
  for (const node of nodes) {
    if (!isSuperInstance(node) || skip.has(node.id) || !Object.keys(node.data?.overrides ?? {}).length) continue
    let isChanged = false
    const next = {}
    for (const [key, patches] of Object.entries(node.data.overrides)) {
      const segments = key.split(EXPANDED_ID_SEPARATOR)
      let result = segments
      let within = node.data.smId
      for (let i = 0; i < segments.length && segments[i] !== LOCAL_CONSTANTS_KEY; i++) {
        if (within === scope) {
          const rest = rewriteAt(segments.slice(i), patches)
          const prefix = segments.slice(0, i)
          result = !rest || Array.isArray(rest) ? rest && [...prefix, ...rest] : { entries: rest.entries.map(([part, set]) => [[...prefix, ...part], set]) }
          break
        }
        const child = childOf(within, segments[i])
        if (!isSuperInstance(child)) break
        within = child.data.smId
      }
      if (!result) {
        isChanged = true
        continue
      }
      // A key may become several, each with patches of its own.
      const entries = Array.isArray(result) ? [[result, patches]] : result.entries
      if (entries.length !== 1) isChanged = true
      for (const [segmentsOut, patchesOut] of entries) {
        const newKey = segmentsOut.join(EXPANDED_ID_SEPARATOR)
        if (newKey !== key) isChanged = true
        next[newKey] = { ...next[newKey], ...clone(patchesOut) }
      }
    }
    if (isChanged) changed.set(node.id, next)
  }
  return changed
}

/**
 * Replaces some nodes of a list: those listed go, and the nodes given take the place of the first of them.
 *
 * @param {Array} nodes
 * @param {Set<string>} removed - Ids.
 * @param {Array} inPlace - The nodes put where the first removed was; at the end when none was there.
 * @returns {Array}
 */
function replaceNodes(nodes, removed, inPlace) {
  const at = nodes.findIndex((node) => removed.has(node.id))
  const kept = nodes.filter((node) => !removed.has(node.id))
  const before = at < 0 ? kept.length : nodes.slice(0, at).filter((node) => !removed.has(node.id)).length
  return [...kept.slice(0, before), ...inPlace, ...kept.slice(before)]
}

/**
 * Applies data changes to some nodes of a list.
 *
 * @param {Array} nodes
 * @param {Map<string, Object>} changes - Node id to the data fields it gets.
 * @returns {Array}
 */
const withData = (nodes, changes) =>
  nodes.map((node) => (changes.has(node.id) ? { ...node, data: { ...node.data, ...changes.get(node.id) } } : node))

/**
 * Finds where each model node goes in an edit: expands the store before and after, and pairs each module with the one
 * its place (see `rewrite`) becomes.
 *
 * @param {{nodes: Array, edges: Array}} before
 * @param {{nodes: Array, edges: Array}} after
 * @param {(chain: string[]) => string[]} rewrite - A module's place before, its super instances' and its own store ids from
 *   the root down, to its place after.
 * @returns {{idMap: Map<string, string>, nameOf: (id: string) => string|undefined}} Each model id that changes to its
 *   new one, and the names of the model after.
 */
export function modelIdMap(before, after, rewrite) {
  const from = expandHierarchy(before.nodes, before.edges)
  const to = expandHierarchy(after.nodes, after.edges)
  const placeOf = (origin) => [...origin.instanceChain, origin.mainId]
  const byPlace = new Map(to.nodes.map((node) => [placeOf(to.origin.get(node.id)).join('\0'), node.id]))
  const idMap = new Map()
  for (const node of from.nodes) {
    const id = byPlace.get(rewrite(placeOf(from.origin.get(node.id))).join('\0'))
    if (id !== undefined && id !== node.id) idMap.set(node.id, id)
  }
  return { idMap, nameOf: to.nameOf }
}

/**
 * Why a structural edit's result can't be kept: a super-module that would contain itself, or nest too deep.
 *
 * @param {Array} nodes - The store after it.
 * @returns {string|null}
 */
function structureProblem(nodes) {
  const graph = supermoduleDependencies(nodes)
  const cycle = findSupermoduleCycle(graph)
  if (cycle) {
    const names = supermodulesById(nodes)
    return `That would make super-module "${names.get(cycle[0])?.data?.supermodule?.name ?? cycle[0]}" contain itself.`
  }
  if ([...graph.keys()].some((smId) => supermoduleDepth(graph, smId) === Infinity)) {
    return `That would nest super instances deeper than ${MAX_NESTING_DEPTH} levels.`
  }
  return null
}

/** @returns {Object} A failed edit: the store as it is, and why. */
const refused = (nodes, edges, problem) => ({ nodes, edges, problems: [problem], rewrite: (chain) => chain })

/**
 * Lists the super-modules whose naming is 'preserve' that occur more than once in a store: their children keep their own
 * flat names only while they occur once, so each must switch to 'prefixed' (see withPrefixedNaming).
 *
 * @param {Array} nodes - Every node in the store, or as a change would leave it.
 * @returns {string[]} Their ids.
 */
export function preserveConflicts(nodes) {
  const occurrences = supermoduleOccurrences(nodes)
  return [...supermodulesById(nodes).values()]
    .filter((node) => node.data?.supermodule?.naming === 'preserve' && (occurrences.get(node.id) ?? 0) > 1)
    .map((node) => node.id)
}

/**
 * Switches super-modules' naming to 'prefixed', so their children's flat names take their super instances' names.
 *
 * @param {Array} nodes
 * @param {string[]} smIds
 * @returns {Array} The nodes, those super-modules' interfaces changed.
 */
export function withPrefixedNaming(nodes, smIds) {
  const ids = new Set(smIds)
  return nodes.map((node) =>
    ids.has(node.id) && isSupermoduleInterface(node) ? { ...node, data: { ...node.data, supermodule: { ...node.data.supermodule, naming: 'prefixed' } } } : node
  )
}

/**
 * Lists the flat names that differ between two stores, module by module (by model id), as SED-ML and PMR references
 * name them.
 *
 * @param {Array} before - Every node in the store.
 * @param {Array} after - The nodes as a change leaves them.
 * @returns {Array<{from: string, to: string}>}
 */
export function flatNameChanges(before, after) {
  const from = expandHierarchy(before, [])
  const to = expandHierarchy(after, [])
  return from.nodes.flatMap((node) => {
    const [was, is] = [from.nameOf(node.id), to.nameOf(node.id)]
    return is !== undefined && is !== was ? [{ from: was, to: is }] : []
  })
}

/**
 * Gives one super instance its own copy of its super-module: the interface node, every child (each keeping its local id,
 * in the copy's scope), the edges inside and the exposure edges, each exposed port keeping its id, so the super instance's
 * couplings still name its ports. The super instance then uses the copy; nothing else changes. Super-modules nested inside
 * are shared still. A copy of a super-module whose naming is 'preserve' is 'prefixed', as its children's own names are
 * the original's.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {string} superInstanceId
 * @param {Object} [options]
 * @param {string} [options.name] - The copy's name; its super-module's, made unique, by default.
 * @returns {{nodes: Array, edges: Array, problems: string[], rewrite: Function, smId?: string}} `smId` the copy's.
 */
export function makeUnique(nodes, edges, superInstanceId, { name } = {}) {
  const superInstance = nodes.find((node) => node.id === superInstanceId)
  if (!isSuperInstance(superInstance)) return refused(nodes, edges, 'That is not a super instance.')
  const smId = superInstance.data.smId
  const supermodule = supermodulesById(nodes).get(smId)
  if (!supermodule) return refused(nodes, edges, `Super instance "${superInstance.data.name}" has no super-module.`)

  const copyId = nextSupermoduleId(nodes)
  const names = new Set([...supermodulesById(nodes).values()].map((node) => node.data?.supermodule?.name))
  const copyName = name ?? claimName(supermodule.data.supermodule.name, names, { scope: copyId })
  const copies = new Map([[smId, copyItem(supermodule, { id: copyId })]])
  copies.get(smId).data = {
    ...copies.get(smId).data,
    scope: copyId,
    localId: copyId,
    supermodule: { ...copies.get(smId).data.supermodule, name: copyName, ca: null, source: null, naming: 'prefixed' },
  }
  for (const child of nodes.filter((node) => scopeOf(node) === smId && !isSupermoduleInterface(node))) {
    const id = nodeIdOf(copyId, localIdOf(child))
    copies.set(child.id, copyItem(child, { id, data: { ...clone(child.data), scope: copyId, localId: localIdOf(child) } }))
  }

  const nextEdgeId = edgeIdAllocator(edges)
  const added = []
  for (const edge of edges) {
    if (!copies.has(edge.source) || !copies.has(edge.target)) continue
    const [source, target] = [copies.get(edge.source).id, copies.get(edge.target).id]
    added.push(copyItem(edge, { id: nextEdgeId(source, target), source, target }))
  }

  const after = {
    nodes: [...withData(nodes, new Map([[superInstanceId, { smId: copyId }]])), ...copies.values()],
    edges: [...edges, ...added],
  }
  const childIds = new Map([...copies].map(([oldId, copy]) => [oldId, copy.id]))
  const rewrite = (chain) => {
    const at = chain.indexOf(superInstanceId)
    if (at < 0 || at + 1 >= chain.length) return chain
    return [...chain.slice(0, at + 1), childIds.get(chain[at + 1]) ?? chain[at + 1], ...chain.slice(at + 2)]
  }
  return { ...after, problems: [], rewrite, smId: copyId }
}

/**
 * Gives one super instance its super-module to itself, in place: every other super instance of it moves to a copy (see
 * makeUnique), which takes the super-module's name, circulatory_autogen identity and library source; the one keeps
 * the super-module, renamed and no longer the library's, so every id inside stays. With no other super instance, it is only
 * renamed. Super-modules nested inside are shared still.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {string} superInstanceId
 * @returns {{nodes: Array, edges: Array, problems: string[], rewrite: Function, smId?: string}} `smId` the copy's, or
 *   undefined when there was no other super instance.
 */
export function keepForOne(nodes, edges, superInstanceId) {
  const superInstance = nodes.find((node) => node.id === superInstanceId)
  if (!isSuperInstance(superInstance)) return refused(nodes, edges, 'That is not a super instance.')
  const smId = superInstance.data.smId
  const definition = supermodulesById(nodes).get(smId)?.data?.supermodule
  if (!definition) return refused(nodes, edges, `Super instance "${superInstance.data.name}" has no super-module.`)

  const names = new Set([...supermodulesById(nodes).values()].map((node) => node.data?.supermodule?.name))
  const own = { ...definition, name: claimName(definition.name, names, { scope: smId }), ca: null, source: null }
  const others = nodes.filter((node) => isSuperInstance(node) && node.data.smId === smId && node.id !== superInstanceId)
  if (!others.length) return { nodes: withData(nodes, new Map([[smId, { supermodule: own }]])), edges, problems: [], rewrite: (chain) => chain }

  const copy = makeUnique(nodes, edges, others[0].id, { name: definition.name })
  const copied = copy.nodes.find((node) => node.id === copy.smId).data.supermodule
  const changes = new Map([
    [smId, { supermodule: own }],
    [copy.smId, { supermodule: { ...copied, ca: definition.ca ?? null, source: definition.source ?? null } }],
    ...others.slice(1).map((node) => [node.id, { smId: copy.smId }]),
  ])
  // Inside each super instance moved, a module is the copy's.
  const moved = new Set(others.map((node) => node.id))
  const copyIdOf = new Map(
    nodes.filter((node) => scopeOf(node) === smId && !isSupermoduleInterface(node)).map((node) => [node.id, nodeIdOf(copy.smId, localIdOf(node))])
  )
  const rewrite = (chain) => chain.map((id, i) => (i > 0 && moved.has(chain[i - 1]) ? (copyIdOf.get(id) ?? id) : id))
  return { nodes: withData(copy.nodes, changes), edges: copy.edges, problems: [], rewrite, smId: copy.smId }
}

/**
 * Why some canvas nodes can't be nested, or null when they can: none at all, an interface node among them, or nodes
 * of more than one scope.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {string[]} ids
 * @returns {string|null}
 */
export function nestProblem(nodes, ids) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const selected = ids.map((id) => nodeById.get(id))
  if (!selected.length || selected.some((node) => !node)) return 'Select the nodes to nest.'
  if (selected.some(isSupermoduleInterface)) return 'A super-module’s interface node can’t be nested.'
  if (new Set(selected.map(scopeOf)).size > 1) return 'The nodes to nest must all be in one scope.'
  // Its super-module's local constants bind only its own children.
  const bound = selected.find((node) => !isSuperInstance(node) && (node.data?.variables ?? []).some(isLocalConstantRow))
  if (bound) return `"${bound.data.name}" uses a local constant of its super-module, which binds only the super-module’s own modules: make it a constant first.`
  return null
}

/**
 * Nests nodes of one scope into a new super-module, and puts one super instance of it where they were, at their centroid.
 *
 * - Each node moves into the new super-module's scope: a new id, its local id kept, and a name its rules allow. Its
 *   rows move with it, so its values stay its own.
 * - The edges between them move with them.
 * - An edge the selection cuts becomes two: an exposure edge from the node inside to the interface, exposing the
 *   node's ports its couplings use, and an edge between the node outside and the super instance, whose couplings name
 *   those exposed ports in the same slots. A port several edges use is exposed once. Exposed ports are numbered, and
 *   ordered, as the edges cut come.
 * - An exposure edge of the scope's own interface from a node nested exposes it on the new super-module too, and the
 *   super instance then exposes it, keeping its id, so the scope's super instances are unchanged.
 * - Override keys passing through a node nested pass through the super instance now.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {string[]} ids - The nodes to nest.
 * @param {Object} options
 * @param {string} options.name - The super-module's and the super instance's name.
 * @param {{x: number, y: number}} [options.position] - Where the super instance goes; centred on the nodes by default.
 * @returns {{nodes: Array, edges: Array, problems: string[], rewrite: Function, smId?: string, superInstanceId?: string}}
 */
export function nestSelection(nodes, edges, ids, { name, position } = {}) {
  const problem = nestProblem(nodes, ids)
  if (problem) return refused(nodes, edges, problem)
  const trimmed = (name ?? '').trim()
  const nameProblem = localNameProblem(trimmed, { superInstance: true })
  if (nameProblem) return refused(nodes, edges, nameProblem)
  if ([...supermodulesById(nodes).values()].some((node) => node.data?.supermodule?.name === trimmed)) {
    return refused(nodes, edges, `A super-module is already called "${trimmed}".`)
  }

  const moved = new Set(ids)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const scope = scopeOf(nodeById.get(ids[0]))
  if (nodes.some((node) => scopeOf(node) === scope && !moved.has(node.id) && node.data?.name === trimmed)) {
    return refused(nodes, edges, `"${trimmed}" is already used here.`)
  }
  const ordered = (scope ? childrenInOrder(nodes, scope) : nodes.filter((node) => scopeOf(node) === null)).filter((node) => moved.has(node.id))

  const smId = nextSupermoduleId(nodes)
  const superInstanceId = nodeIdAllocator(nodes, scope)()
  const superInstanceLocalId = splitNodeId(superInstanceId).localId

  // The nodes nested, in their new scope.
  const names = new Set()
  const copies = new Map()
  for (const node of ordered) {
    const id = nodeIdOf(smId, localIdOf(node))
    const data = { ...clone(node.data), scope: smId, localId: localIdOf(node), name: claimName(node.data?.name ?? localIdOf(node), names, { scope: smId }) }
    copies.set(node.id, copyItem(node, { id, data }))
  }

  const nextEdgeId = edgeIdAllocator(edges)
  const nextXp = exposedPortIdAllocator(nodes, edges)
  const inner = []
  const boundary = []
  const scopeExposures = []
  for (const edge of edges) {
    const [isSource, isTarget] = [moved.has(edge.source), moved.has(edge.target)]
    if (!isSource && !isTarget) continue
    if (!isModelEdge(edge)) {
      // Exposure edges inside a super instance nested go nowhere; one to the scope's own interface is re-exposed.
      if (exposureEnds(edge, nodeById)?.smId === scope) scopeExposures.push(edge)
      continue
    }
    if (isSource && isTarget) {
      const [source, target] = [copies.get(edge.source).id, copies.get(edge.target).id]
      inner.push(copyItem(edge, { id: nextEdgeId(source, target), source, target }))
    } else {
      boundary.push(edge)
    }
  }

  // Exposed ports, one for each port of a node nested that the boundary uses, in the order the boundary uses them.
  const exposedByKey = new Map()
  const exposedOf = new Map() // node id → its entries
  const expose = (node, alias, label) => {
    const key = `${node.id}\0${alias.via != null ? `via:${alias.via}` : `${alias.portType}:${alias.label}#${alias.slot}`}`
    if (!exposedByKey.has(key)) {
      const entry = { id: nextXp(), alias, order: exposedByKey.size, ...(label && { label }) }
      exposedByKey.set(key, entry)
      if (!exposedOf.has(node.id)) exposedOf.set(node.id, [])
      exposedOf.get(node.id).push(entry)
    }
    return exposedByKey.get(key).id
  }
  const aliasOf = (node, port, slot) =>
    isSuperInstance(node)
      ? { via: port.exposedPortId }
      : { portType: port.portType, label: port.label, slot: slotOf(node.data?.ports ?? [], port, slot) }

  const allEdges = [...boundary, ...scopeExposures].sort((a, b) => edges.indexOf(a) - edges.indexOf(b))
  const boundaryPlans = []
  const scopeEntries = []
  for (const edge of allEdges) {
    if (isModelEdge(edge)) {
      const side = moved.has(edge.source) ? 'source' : 'target'
      const inside = nodeById.get(edge[side])
      const couplings = (edge.data?.couplings ?? []).map((coupling) => ({
        coupling,
        exposedPortId: expose(inside, aliasOf(inside, coupling[`${side}Port`], coupling[`${side}Slot`])),
      }))
      boundaryPlans.push({ edge, side, inside, couplings })
    } else {
      const { child } = exposureEnds(edge, nodeById)
      for (const entry of exposureEntriesOf(edge)) {
        const alias = entry.alias?.via != null ? { via: entry.alias.via } : { portType: entry.alias.portType, label: entry.alias.label, slot: entry.alias.slot ?? 0 }
        scopeEntries.push({ edge, entry, via: expose(child, alias) })
      }
    }
  }

  // The new super-module: its interface, left of the nodes nested, and its exposure edges.
  const left = Math.min(...ordered.map((node) => node.position?.x ?? 0))
  const interfaceNode = buildSupermoduleInterface(
    smId,
    { name: trimmed, submoduleOrder: ordered.map(localIdOf) },
    { x: left - 300, y: centroidOf(ordered).y }
  )
  const exposureEdges = [...exposedOf].map(([oldId, entries]) => {
    const child = copies.get(oldId)
    const firstUse = allEdges.find((edge) => edge.source === oldId || edge.target === oldId)
    const childHandle = firstUse && (firstUse.source === oldId ? firstUse.sourceHandle : firstUse.targetHandle)
    return {
      id: nextEdgeId(child.id, smId),
      type: EXPOSURE_EDGE_TYPE,
      source: child.id,
      target: smId,
      ...(childHandle && { sourceHandle: childHandle }),
      targetHandle: claimHandle(interfaceNode.data.handles, 'right'),
      data: { exposed: entries },
    }
  })

  // The super instance, with its ports as the new super-module exposes them.
  const inside = [...nodes.filter((node) => !moved.has(node.id)), interfaceNode, ...copies.values()]
  const insideEdges = [...edges, ...inner, ...exposureEdges]
  const ports = superInstancePorts(inside, insideEdges, smId)
  const handles = buildGhostHandles()
  // Centred on the nodes' centroid, as big as they are on average.
  const centroid = centroidOf(ordered)
  const half = (axis) => ordered.reduce((sum, node) => sum + (node.dimensions?.[axis] ?? 0), 0) / ordered.length / 2
  const at = position ?? { x: centroid.x - half('width'), y: centroid.y - half('height') }
  const superInstance = buildSuperInstance(superInstanceId, trimmed, smId, { scope, ports, handles, position: { ...at } })

  const slotOn = (port) => ports.filter((other) => other.portType === port.portType && other.label === port.label).indexOf(port)
  // An edge coupling nothing stands for no connection, so it goes. Edges from one node outside, the same way, become
  // one, as a connection drawn between two nodes is (their couplings in the order the edges came).
  const merged = new Map()
  for (const plan of boundaryPlans.filter(({ couplings }) => couplings.length)) {
    const key = `${plan.side}\0${plan.side === 'source' ? plan.edge.target : plan.edge.source}`
    if (merged.has(key)) merged.get(key).couplings.push(...plan.couplings)
    else merged.set(key, { ...plan, couplings: [...plan.couplings] })
  }
  const outerEdges = [...merged.values()].map(({ edge, side, inside: node, couplings }) => {
    const handleOf = side === 'source' ? edge.sourceHandle : edge.targetHandle
    const handleSide = sideOf(node, handleOf) ?? (side === 'source' ? 'right' : 'left')
    const ends = { source: edge.source, target: edge.target, [side]: superInstanceId }
    return copyItem(edge, {
      id: nextEdgeId(ends.source, ends.target),
      ...ends,
      [`${side}Handle`]: claimHandle(handles, handleSide),
      data: {
        ...clone(edge.data),
        couplings: couplings.map(({ coupling, exposedPortId }) => {
          const port = ports.find((candidate) => candidate.exposedPortId === exposedPortId)
          return port ? { ...clone(coupling), [`${side}Port`]: clone(port), [`${side}Slot`]: slotOn(port) } : clone(coupling)
        }),
      },
    })
  })

  // The handles claimed on each side, in slot order, go to the neighbours in the order they are drawn, so edges don't cross.
  const bySide = new Map()
  for (const edge of outerEdges) {
    const end = edge.source === superInstanceId ? 'source' : 'target'
    const handleSide = sideOf(superInstance, edge[`${end}Handle`])
    if (!bySide.has(handleSide)) bySide.set(handleSide, [])
    bySide.get(handleSide).push({ edge, end, neighbour: nodeById.get(end === 'source' ? edge.target : edge.source) })
  }
  for (const [handleSide, entries] of bySide) {
    const axis = handleSide === 'top' || handleSide === 'bottom' ? 'x' : 'y'
    const slotOf = (id) => handles.find((handle) => getHandleId(handle) === id)?.slotIndex ?? 0
    const ids = entries.map(({ edge, end }) => edge[`${end}Handle`]).sort((a, b) => slotOf(a) - slotOf(b))
    entries.sort((a, b) => (a.neighbour?.position?.[axis] ?? 0) - (b.neighbour?.position?.[axis] ?? 0))
    entries.forEach(({ edge, end }, index) => (edge[`${end}Handle`] = ids[index]))
  }

  // The scope's own exposure edges from nodes nested now expose the super instance's ports, keeping their ids.
  const scopeExposureEdges = []
  if (scopeEntries.length) {
    const first = scopeEntries[0].edge
    const [interfaceEnd, childEnd] = first.source === scope ? ['source', 'target'] : ['target', 'source']
    scopeExposureEdges.push(
      copyItem(first, {
        id: nextEdgeId(superInstanceId, scope),
        source: superInstanceId,
        target: scope,
        sourceHandle: claimHandle(handles, sideOf(nodeById.get(first[childEnd]), first[`${childEnd}Handle`]) ?? 'bottom'),
        targetHandle: first[`${interfaceEnd}Handle`],
        data: { exposed: scopeEntries.map(({ entry, via }) => ({ ...clone(entry), alias: { via } })) },
      })
    )
  }

  // The scope's own order lists the super instance where the first node nested was.
  const changes = new Map()
  if (scope) {
    const movedLocalIds = new Set(ordered.map(localIdOf))
    const definition = supermodulesById(nodes).get(scope).data.supermodule
    let isPlaced = false
    const submoduleOrder = (definition.submoduleOrder ?? []).flatMap((localId) => {
      if (!movedLocalIds.has(localId)) return [localId]
      if (isPlaced) return []
      isPlaced = true
      return [superInstanceLocalId]
    })
    changes.set(scope, { supermodule: { ...definition, submoduleOrder } })
    for (const [id, overrides] of rewriteOverrideKeys(nodes, scope, (rest) => (movedLocalIds.has(rest[0]) ? [superInstanceLocalId, ...rest] : rest), moved)) {
      changes.set(id, { overrides })
    }
  }

  const newEdges = [...inner, ...exposureEdges, ...outerEdges, ...scopeExposureEdges]
  const removedEdges = new Set([...boundary, ...scopeExposures].map((edge) => edge.id))
  const afterEdges = [...edges.filter((edge) => !removedEdges.has(edge.id) && !moved.has(edge.source) && !moved.has(edge.target)), ...newEdges]
  const originOf = new Map([...copies].map(([oldId, copy]) => [copy.id, oldId]))
  const after = {
    nodes: spreadHandles([...withData(replaceNodes(nodes, moved, [superInstance]), changes), interfaceNode, ...copies.values()], edges, afterEdges, newEdges, originOf),
    edges: afterEdges,
  }
  const structural = structureProblem(after.nodes)
  if (structural) return refused(nodes, edges, structural)

  const rewrite = (chain) => {
    const at = chain.findIndex((id) => moved.has(id))
    return at < 0 ? chain : [...chain.slice(0, at), superInstanceId, copies.get(chain[at]).id, ...chain.slice(at + 1)]
  }
  return { ...after, problems: [], rewrite, smId, superInstanceId }
}

/**
 * Why a super instance can't be un-nested, or null when it can.
 *
 * @param {Array} nodes
 * @param {string} superInstanceId
 * @returns {string|null}
 */
export function unnestProblem(nodes, superInstanceId) {
  const superInstance = nodes.find((node) => node.id === superInstanceId)
  if (!isSuperInstance(superInstance)) return 'That is not a super instance.'
  const supermodule = supermodulesById(nodes).get(superInstance.data.smId)
  if (!supermodule) return `Super instance "${superInstance.data.name}" has no super-module.`
  return null
}

/**
 * Un-nests a super instance: its super-module's children take its place, as copies when other super instances use it still, so
 * those are unchanged.
 *
 * - Each child gets a new id in the super instance's scope, and its name prefixed with the super instance's (`heart__lv` at the
 *   root, so its flat name is kept; `heart_lv` inside a super-module, whose names can't hold `__`), unique there. Under
 *   'preserve' naming it takes its own name; a self leaf takes the super instance's name under 'prefixed', so its flat
 *   name is kept too, and becomes an ordinary module.
 * - The super instance's overrides are baked in: into a module's rows, or a nested super instance's own overrides, which they win
 *   over. Its super-module's local constants are baked into the rows bound to them, as constants with the values they
 *   have for it; an outer super instance's override of them becomes an override of each of those rows.
 * - The edges inside move up with them. An edge to the super instance becomes one edge to each child its couplings reach
 *   through the exposed ports, the couplings naming the child's own ports in the same slots. A coupling to a port its
 *   super-module no longer exposes goes (it couples nothing).
 * - An exposure edge of the scope's interface from the super instance exposes the children's ports themselves, keeping the
 *   exposed ports' ids.
 * - The super-module goes when no other super instance uses it.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {string} superInstanceId
 * @returns {{nodes: Array, edges: Array, problems: string[], rewrite: Function, droppedCouplings?: number,
 *   removedSupermodule?: boolean}}
 */
export function unnest(nodes, edges, superInstanceId) {
  const problem = unnestProblem(nodes, superInstanceId)
  if (problem) return refused(nodes, edges, problem)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const superInstance = nodeById.get(superInstanceId)
  const scope = scopeOf(superInstance)
  const smId = superInstance.data.smId
  const supermodule = supermodulesById(nodes).get(smId)
  const isShared = nodes.some((node) => isSuperInstance(node) && node.id !== superInstanceId && node.data.smId === smId)
  const children = childrenInOrder(nodes, smId)
  const overrides = superInstance.data.overrides ?? {}
  // Its local constants, with the values they have for it.
  const declared = new Map(localConstantsOf(supermodule).map((declaration) => [declaration.name, declaration]))
  const localValue = (name) => localConstantValue([superInstance], [localIdOf(superInstance)], name, declared.get(name).value)

  // The children, copied up into the super instance's scope.
  const nextId = nodeIdAllocator(nodes, scope)
  const names = new Set(nodes.filter((node) => scopeOf(node) === scope && node.id !== superInstanceId).map((node) => node.data?.name))
  const isPreserved = supermodule.data?.supermodule?.naming === 'preserve'
  const offset = (() => {
    const from = centroidOf(children)
    const to = centreOf(superInstance)
    return { x: to.x - from.x, y: to.y - from.y }
  })()
  const copies = new Map()
  for (const child of children) {
    const id = nextId()
    const ownName = isPreserved ? (child.data?.originalName ?? child.data?.name) : child.data?.name
    const joined = isPreserved
      ? ownName
      : child.data?.role === SELF_ROLE
        ? superInstance.data.name
        : `${superInstance.data.name}${scope ? '_' : LEVEL_SEPARATOR}${ownName}`
    // Out of its super-module, a self leaf is a module like any other, and its name its own.
    const { role: _role, originalName: _originalName, ...own } = clone(child.data)
    const data = { ...own, scope, localId: splitNodeId(id).localId, name: claimName(joined, names, { scope }) }
    const localId = localIdOf(child)
    if (isSuperInstance(child)) {
      const prefix = `${localId}${EXPANDED_ID_SEPARATOR}`
      const inner = clone(child.data.overrides ?? {})
      for (const [key, patches] of Object.entries(overrides)) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        inner[rest] = { ...inner[rest] }
        for (const [variable, patch] of Object.entries(patches)) inner[rest][variable] = { ...inner[rest][variable], ...clone(patch) }
      }
      data.overrides = inner
    } else {
      if (overrides[localId]) {
        data.variables = (data.variables ?? []).map((row) => (overrides[localId][row.name] ? { ...row, ...clone(overrides[localId][row.name]) } : row))
      }
      data.variables = asConstants(data.variables, (row) => (declared.has(row.name) ? localValue(row.name) : undefined))
    }
    const position = { x: (child.position?.x ?? 0) + offset.x, y: (child.position?.y ?? 0) + offset.y }
    copies.set(child.id, copyItem(child, { id, position, data }))
  }

  const nextEdgeId = edgeIdAllocator(edges)
  const inner = []
  for (const edge of edges) {
    if (!isModelEdge(edge) || !copies.has(edge.source) || !copies.has(edge.target)) continue
    const [source, target] = [copies.get(edge.source).id, copies.get(edge.target).id]
    inner.push(copyItem(edge, { id: nextEdgeId(source, target), source, target }))
  }

  // Each exposed port, to the child port it aliases.
  const exposed = new Map((indexExposures(nodes, edges).get(smId) ?? []).map((port) => [port.id, port]))
  const exposureHandleOf = new Map()
  for (const edge of edges) {
    const ends = exposureEnds(edge, nodeById)
    if (ends?.smId !== smId) continue
    exposureHandleOf.set(ends.child.id, edge.source === ends.child.id ? edge.sourceHandle : edge.targetHandle)
  }
  // One handle per edge restored at a child, on the side it met the super instance: the one its exposure edge used, if on
  // that side and still free, else a new one there.
  const exposureHandleUsed = new Set()
  const restoredHandle = (end, side) => {
    const exposureHandle = exposureHandleOf.get(end.childId)
    if (exposureHandle && !exposureHandleUsed.has(end.childId) && sideOf(end.copy, exposureHandle) === side) {
      exposureHandleUsed.add(end.childId)
      return exposureHandle
    }
    const handles = end.copy.data.handles ?? (end.copy.data.handles = buildGhostHandles())
    return claimHandle(handles, side)
  }
  const target = (exposedPortId) => {
    const port = exposed.get(exposedPortId)
    const copy = port && copies.get(port.childId)
    if (!copy) return null
    const group = (alias) => (copy.data.ports ?? []).filter((candidate) => candidate.portType === alias.portType && candidate.label === alias.label)
    if (port.alias.via != null) {
      const live = (copy.data.ports ?? []).find((candidate) => candidate.exposedPortId === port.alias.via)
      return live ? { copy, childId: port.childId, port: live, slot: group(live).indexOf(live), alias: { via: port.alias.via } } : null
    }
    const slot = port.alias.slot ?? 0
    const live = group(port.alias)[slot]
    return live ? { copy, childId: port.childId, port: live, slot, alias: { portType: port.alias.portType, label: port.alias.label, slot } } : null
  }

  // Each edge to the super instance, as edges to the children its couplings reach.
  let droppedCouplings = 0
  const outer = []
  const replaced = new Set()
  for (const edge of edges) {
    if (!isModelEdge(edge) || (edge.source !== superInstanceId && edge.target !== superInstanceId)) continue
    replaced.add(edge.id)
    const side = edge.source === superInstanceId ? 'source' : 'target'
    const byChild = new Map()
    for (const coupling of edge.data?.couplings ?? []) {
      const end = target(coupling[`${side}Port`]?.exposedPortId)
      if (!end) {
        droppedCouplings++
        continue
      }
      if (!byChild.has(end.copy.id)) byChild.set(end.copy.id, { end, couplings: [] })
      byChild.get(end.copy.id).couplings.push({ ...clone(coupling), [`${side}Port`]: clone(end.port), [`${side}Slot`]: end.slot })
    }
    for (const [copyId, { end, couplings }] of byChild) {
      const ends = { source: edge.source, target: edge.target, [side]: copyId }
      outer.push(
        copyItem(edge, {
          id: nextEdgeId(ends.source, ends.target),
          ...ends,
          [`${side}Handle`]: restoredHandle(end, sideOf(superInstance, edge[`${side}Handle`]) ?? 'left'),
          data: { ...clone(edge.data), couplings },
        })
      )
    }
  }

  // The scope's own exposure edges from the super instance now expose the children's ports, keeping their ids.
  const scopeExposures = []
  for (const edge of edges) {
    if (exposureEnds(edge, nodeById)?.child?.id !== superInstanceId) continue
    replaced.add(edge.id)
    const interfaceEnd = edge.source === scope ? 'source' : 'target'
    const byChild = new Map()
    for (const entry of exposureEntriesOf(edge)) {
      const end = target(entry.alias?.via)
      if (!end) continue
      if (!byChild.has(end.copy.id)) byChild.set(end.copy.id, { end, entries: [] })
      byChild.get(end.copy.id).entries.push({ ...clone(entry), alias: end.alias })
    }
    for (const [copyId, { end, entries }] of byChild) {
      scopeExposures.push({
        ...copyItem(edge, {}),
        id: nextEdgeId(copyId, scope),
        source: copyId,
        target: scope,
        sourceHandle: restoredHandle(end, sideOf(superInstance, edge[`${edge.source === scope ? 'target' : 'source'}Handle`]) ?? 'bottom'),
        targetHandle: edge[`${interfaceEnd}Handle`],
        data: { exposed: entries },
      })
    }
  }

  // The scope's order lists the children where the super instance was; override keys through it reach them directly.
  const changes = new Map()
  const newLocalIds = new Map(children.map((child) => [localIdOf(child), copies.get(child.id).data.localId]))
  if (scope) {
    const definition = supermodulesById(nodes).get(scope).data.supermodule
    const order = definition.submoduleOrder ?? []
    const submoduleOrder = order.includes(superInstance.data.localId)
      ? order.flatMap((localId) => (localId === superInstance.data.localId ? [...newLocalIds.values()] : [localId]))
      : order
    changes.set(scope, { supermodule: { ...definition, submoduleOrder } })
    // An outer override of its local constants sets each row bound to them.
    const bound = children.filter((child) => !isSuperInstance(child) && (child.data?.variables ?? []).some((row) => isLocalConstantRow(row) && declared.has(row.name)))
    const rewriteAt = (rest, patches) => {
      if (rest[0] !== superInstance.data.localId) return rest
      if (rest.length === 2 && rest[1] === LOCAL_CONSTANTS_KEY) {
        const entries = bound.flatMap((child) => {
          const set = Object.fromEntries(
            Object.entries(patches ?? {}).filter(([name]) => declared.has(name) && child.data.variables.some((row) => isLocalConstantRow(row) && row.name === name))
          )
          return Object.keys(set).length ? [[[newLocalIds.get(localIdOf(child))], set]] : []
        })
        return { entries }
      }
      // An outer override of a row bound to a local constant set nothing (the local constant won): it goes.
      const child = rest.length === 2 && bound.find((candidate) => localIdOf(candidate) === rest[1])
      if (child) {
        const kept = Object.fromEntries(Object.entries(patches ?? {}).filter(([name]) => !(declared.has(name) && child.data.variables.some((row) => isLocalConstantRow(row) && row.name === name))))
        return { entries: Object.keys(kept).length ? [[[newLocalIds.get(rest[1])], kept]] : [] }
      }
      return newLocalIds.has(rest[1]) ? [newLocalIds.get(rest[1]), ...rest.slice(2)] : null
    }
    for (const [id, next] of rewriteOverrideKeys(nodes, scope, rewriteAt, new Set([superInstanceId]))) changes.set(id, { overrides: next })
  }

  const removedNodes = new Set([superInstanceId])
  if (!isShared) {
    removedNodes.add(smId)
    for (const node of nodes) if (scopeOf(node) === smId) removedNodes.add(node.id)
  }
  const newEdges = [...inner, ...outer, ...scopeExposures]
  const afterEdges = [...edges.filter((edge) => !replaced.has(edge.id) && !removedNodes.has(edge.source) && !removedNodes.has(edge.target)), ...newEdges]
  const originOf = new Map([...copies].map(([oldId, copy]) => [copy.id, oldId]))
  const kept = replaceNodes(nodes, new Set([superInstanceId]), [...copies.values()]).filter((node) => !removedNodes.has(node.id))
  const after = { nodes: spreadHandles(withData(kept, changes), edges, afterEdges, newEdges, originOf), edges: afterEdges }
  const rewrite = (chain) => {
    const at = chain.indexOf(superInstanceId)
    if (at < 0 || at + 1 >= chain.length) return chain
    return [...chain.slice(0, at), copies.get(chain[at + 1])?.id ?? chain[at + 1], ...chain.slice(at + 2)]
  }
  return { ...after, problems: [], rewrite, droppedCouplings, removedSupermodule: !isShared }
}

/**
 * Gets the super-modules some nodes depend on, through their super instances and those inside them: each one's interface
 * node, its children and the edges inside it, its exposure edges among them.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {Array} edges - Every edge in the store.
 * @param {Array} from - The nodes whose dependencies are wanted.
 * @returns {{nodes: Array, edges: Array}} Copies, without what Vue Flow adds; empty when none is a super instance.
 */
export function supermoduleClosure(nodes, edges, from) {
  const interfaces = supermodulesById(nodes)
  const byScope = indexByScope(nodes)
  const smIds = new Set()
  const pending = from.filter(isSuperInstance).map((node) => node.data.smId)
  while (pending.length) {
    const smId = pending.pop()
    if (smIds.has(smId) || !interfaces.has(smId)) continue
    smIds.add(smId)
    for (const node of byScope.get(smId) ?? []) if (isSuperInstance(node)) pending.push(node.data.smId)
  }
  const members = nodes.filter((node) => smIds.has(node.id) || smIds.has(scopeOf(node)))
  const ids = new Set(members.map((node) => node.id))
  return {
    nodes: members.map((node) => copyItem(node, {})),
    edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => copyItem(edge, {})),
  }
}

/**
 * Describes a super-module by what makes it what it is: its definition, its children and its edges, by local id,
 * leaving out where things are drawn.
 *
 * @param {string} smId
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {string}
 */
function supermoduleSignature(smId, nodes, edges) {
  const members = nodes.filter((node) => node.id === smId || scopeOf(node) === smId)
  const localOf = new Map(members.map((node) => [node.id, isSupermoduleInterface(node) ? '' : localIdOf(node)]))
  const content = ({ handles: _handles, ...data }) => data
  return JSON.stringify({
    nodes: members.map((node) => [localOf.get(node.id), node.type, content(node.data ?? {})]).sort((a, b) => a[0].localeCompare(b[0])),
    edges: edges
      .filter((edge) => localOf.has(edge.source) && localOf.has(edge.target))
      .map((edge) => [localOf.get(edge.source), localOf.get(edge.target), edge.type ?? null, edge.data ?? null])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })
}

/**
 * Hashes what a super-module holds, as supermoduleSignature describes it, leaving out what isn't its structure: its
 * name, identity and source, the ports of the super instances inside, which follow what their super-modules expose, and
 * how a model edge is drawn. Equal hashes, the same super-module.
 *
 * @param {string} smId
 * @param {Array} nodes
 * @param {Array} edges
 * @param {Object} [options]
 * @param {boolean} [options.exposure=true] - Whether what it exposes counts; circulatory_autogen has no interface, so
 *   its identity doesn't follow it.
 * @returns {string} Eight hex digits.
 */
export function supermoduleContentHash(smId, nodes, edges, { exposure = true } = {}) {
  const structureOf = (node) => {
    if (node.id === smId) {
      const { name: _name, ca: _ca, source: _source, ...definition } = node.data?.supermodule ?? {}
      return { ...node, data: { ...node.data, supermodule: definition } }
    }
    return isSuperInstance(node) && scopeOf(node) === smId ? { ...node, data: { ...node.data, ports: undefined } } : node
  }
  const drawn = edges
    .filter((edge) => exposure || edge.type !== EXPOSURE_EDGE_TYPE)
    .map((edge) => (edge.type === EXPOSURE_EDGE_TYPE ? edge : { ...edge, type: null }))
  const text = supermoduleSignature(smId, nodes.map(structureOf), drawn)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

/**
 * Plans pasting super-modules copied with a selection (see supermoduleClosure): each one the workspace already has,
 * the same and with every one it uses the same, is reused; any other is added with a fresh id, its children's ids
 * and its name made unique, and the super instances inside it pointed at the copies.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {Array} edges - Every edge in the store.
 * @param {{nodes: Array, edges: Array}} closure
 * @returns {{nodes: Array, edges: Array, smIdMap: Map<string, string>}} The nodes and edges to add, and each copied
 *   super-module's id to the one pasted super instances use.
 */
export function planSupermodulePaste(nodes, edges, closure) {
  const copied = supermodulesById(closure.nodes)
  const graph = supermoduleDependencies(closure.nodes)
  const existing = supermodulesById(nodes)
  const smIdMap = new Map()
  const taken = [...nodes]
  const names = new Set([...existing.values()].map((node) => node.data?.supermodule?.name))
  const added = { nodes: [], edges: [] }
  const nextEdgeId = edgeIdAllocator([...edges, ...closure.edges])

  const visit = (smId, visiting = new Set()) => {
    if (smIdMap.has(smId) || visiting.has(smId) || !copied.has(smId)) return
    visiting.add(smId)
    for (const inner of graph.get(smId) ?? []) visit(inner, visiting)
    const depsReused = [...(graph.get(smId) ?? [])].every((inner) => !copied.has(inner) || smIdMap.get(inner) === inner)
    if (depsReused && existing.has(smId) && supermoduleSignature(smId, nodes, edges) === supermoduleSignature(smId, closure.nodes, closure.edges)) {
      smIdMap.set(smId, smId)
      return
    }
    const id = nextSupermoduleId(taken)
    smIdMap.set(smId, id)
    const members = closure.nodes.filter((node) => node.id === smId || scopeOf(node) === smId)
    const idOf = new Map(members.map((node) => [node.id, isSupermoduleInterface(node) ? id : nodeIdOf(id, localIdOf(node))]))
    for (const node of members) {
      const data = { ...clone(node.data), scope: id, localId: isSupermoduleInterface(node) ? id : localIdOf(node) }
      if (isSupermoduleInterface(node)) data.supermodule = { ...data.supermodule, name: claimName(data.supermodule?.name ?? id, names, { scope: id }) }
      if (isSuperInstance(node)) data.smId = smIdMap.get(node.data.smId) ?? node.data.smId
      const copy = copyItem(node, { id: idOf.get(node.id), data })
      taken.push(copy)
      added.nodes.push(copy)
    }
    for (const edge of closure.edges) {
      if (!idOf.has(edge.source) || !idOf.has(edge.target)) continue
      const [source, target] = [idOf.get(edge.source), idOf.get(edge.target)]
      added.edges.push(copyItem(edge, { id: nextEdgeId(source, target), source, target }))
    }
  }
  for (const smId of copied.keys()) visit(smId)
  return { ...added, smIdMap }
}
