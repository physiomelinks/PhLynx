/**
 * The OMEX flow snapshot (flow-snapshot.json): the workspace's nodes, edges, math and global constants, which an
 * archive is loaded back from.
 *
 * A snapshot's snapshotKind says what its nodes are. A whole-model snapshot is 'hierarchical': the store as it is,
 * every super-module, super instance and exposure edge included, so it loads back as the workspace was. A snapshot of part
 * of the model is 'flat': the expanded model narrowed to that part, every module at the root under its flat name, its
 * id rewritten without '/' (see utils/hierarchy.js rewriteUnsafeIds), since a part may hold only some of a super instance's
 * modules and so no whole super-module. Without super instances a part is the store's nodes narrowed, as before 1.3.0.
 */
import { buildInstance } from './import/buildWorkflow'
import { expandHierarchy, EXPANDED_ID_SEPARATOR, isNestedModelId } from './hierarchy/expand'
import { scopeFlowObject } from './simulation/scopedModel'
import { withoutHidden } from './workspaceFile'
import {
  HANDLE_VARIANT,
  NUM_GHOST_HANDLES_LEFT_RIGHT,
  NUM_GHOST_HANDLES_TOP_BOT,
  PHLYNX_PROJECT_VERSION,
  SOURCE_HANDLE_TYPE,
  SUPER_INSTANCE_NODE_TYPE,
  SUPERMODULE_INTERFACE_NODE_TYPE,
  TARGET_HANDLE_TYPE,
} from '../utils/constants'
import {
  buildGhostHandles,
  findMostCentralGhostHandle,
  getHandleId,
  normaliseHandleSlots,
  withHierarchyHandles,
} from '../utils/handles'
import { hasHierarchy, rewriteUnsafeIds, scopeOf } from '../utils/hierarchy'
import { cyrb53 } from '../utils/misc'
import { applyParameterValues } from '../utils/parameters'

export const FLOW_SNAPSHOT_ID = 'phlynx-flow-snapshot'

/** What a snapshot's nodes are (see the module comment). */
export const SNAPSHOT_KIND = Object.freeze({ HIERARCHICAL: 'hierarchical', FLAT: 'flat' })

// Node types a snapshot keeps as they are; every other node is rebuilt as a module.
const VERBATIM_TYPES = new Set([SUPER_INSTANCE_NODE_TYPE, SUPERMODULE_INTERFACE_NODE_TYPE])

/**
 * Picks the nodes and edges a snapshot holds.
 *
 * @param {{nodes: Array, edges: Array}} flow - Vue Flow `toObject()` output, without `hidden`.
 * @param {string[]|null} [nodeIds=null] - The model ids of the part snapshotted (a scope's nodeIds), or null for the
 *   whole model.
 * @returns {{kind: string, nodes: Array, edges: Array}}
 */
export function snapshotFlow(flow, nodeIds = null) {
  const whole = { kind: SNAPSHOT_KIND.HIERARCHICAL, nodes: flow.nodes, edges: flow.edges }
  if (!nodeIds) return whole
  const selected = new Set(nodeIds)
  // Without hierarchy the model ids are the store's.
  const expansion = hasHierarchy(flow.nodes, flow.edges) ? expandHierarchy(flow.nodes, flow.edges) : null
  if ((expansion?.nodes ?? flow.nodes).every((node) => selected.has(node.id))) return whole
  if (!expansion) {
    const { nodes, edges } = scopeFlowObject(flow, nodeIds)
    return { kind: SNAPSHOT_KIND.FLAT, nodes, edges }
  }
  return { kind: SNAPSHOT_KIND.FLAT, ...flatPart(flow, expansion, selected) }
}

/**
 * Hashes what a snapshot holds of the model, not its envelope (id, version, kind), so a later format leaves the hash
 * of an unchanged model as it was.
 *
 * @param {Object} snapshot - From buildFlowSnapshot.
 * @returns {number}
 */
export function hashFlowSnapshot({ nodeData, edges, mathLibrary, globalParameters }) {
  return cyrb53(JSON.stringify({ nodeData, edges, mathLibrary, globalParameters }))
}

/**
 * Builds a flow snapshot.
 *
 * @param {{nodes: Array, edges: Array}} flow - Vue Flow `toObject()` output.
 * @param {Object} options
 * @param {string[]|null} [options.nodeIds=null] - As snapshotFlow's.
 * @param {Object} options.library - libraryStore: the math each module uses, and the global constants.
 * @returns {Object} The snapshot, as flow-snapshot.json holds it.
 */
export function buildFlowSnapshot(flow, { nodeIds = null, library }) {
  const { kind, nodes, edges } = snapshotFlow(withoutHidden(flow), nodeIds)
  const mathLibrary = new Map()

  const nodeData = nodes.map((node) => {
    const { handles, ...restData } = node.data ?? {}
    const slimNode = {
      id: node.id,
      // A module's ghost handles are rebuilt on restore; a super instance's or interface node's data is kept as it is.
      data: VERBATIM_TYPES.has(node.type)
        ? { ...node.data }
        : { ...restData, handles: handles?.filter((handle) => handle.variant !== HANDLE_VARIANT.GHOST) ?? [] },
      position: node.position,
      dimensions: node.dimensions,
      type: node.type,
    }

    const mathRef = slimNode.data.mathRef
    const mathText = mathRef && library.availableMath.get(mathRef)
    if (mathText) {
      const baseHash = library.getMathHashByRef(mathRef) ?? library.createMathHash(mathText)
      let mathHash = baseHash
      let collisionIndex = 1
      while (mathLibrary.has(mathHash) && mathLibrary.get(mathHash) !== mathText) mathHash = `${baseHash}_${collisionIndex++}`
      mathLibrary.set(mathHash, mathText)
      slimNode.data.mathHash = mathHash
    }
    return slimNode
  })

  return {
    id: FLOW_SNAPSHOT_ID,
    version: PHLYNX_PROJECT_VERSION,
    snapshotKind: kind,
    nodeData,
    edges,
    mathLibrary: Object.fromEntries([...mathLibrary.entries()].sort(([a], [b]) => a.localeCompare(b))),
    globalParameters: Array.from(library.globalVariables.entries()),
  }
}

/**
 * Narrows the expanded model to some of its nodes and the edges between them, as root modules: a module inside a
 * super instance keeps its flat name and its rows as overridden, stands where it would inside its super instances, each
 * offset by the one outside it, and is joined by its edges' handles or, for an edge that met a super instance, a handle
 * of its own.
 *
 * @param {{nodes: Array, edges: Array}} flow
 * @param {ReturnType<typeof expandHierarchy>} expansion
 * @param {Set<string>} selected - Model ids.
 * @returns {{nodes: Array, edges: Array}}
 */
function flatPart(flow, expansion, selected) {
  const storeNodeById = new Map(flow.nodes.map((node) => [node.id, node]))
  const storeEdgeById = new Map(flow.edges.map((edge) => [edge.id, edge]))

  const nodes = expansion.nodes
    .filter((node) => selected.has(node.id))
    .map((node) => {
      // Copied, as handleFor may give a module a handle.
      if (!isNestedModelId(node.id)) return node.data?.handles ? { ...node, data: { ...node.data, handles: [...node.data.handles] } } : node
      const { mainId, instanceChain } = expansion.origin.get(node.id)
      // Each super instance's position is within the one outside it, so every level's adds up.
      const position = [...instanceChain, mainId].reduce(
        (sum, id) => {
          const at = storeNodeById.get(id)?.position ?? { x: 0, y: 0 }
          return { x: sum.x + at.x, y: sum.y + at.y }
        },
        { x: 0, y: 0 }
      )
      return {
        id: node.id,
        type: node.type,
        position,
        data: { ...node.data, scope: null, localId: node.id, handles: [...(node.data.handles ?? [])] },
      }
    })
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  const edges = expansion.edges
    .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
    .map((edge) => {
      if (!isNestedModelId(edge.id) && storeEdgeById.get(edge.id) === edge) return edge
      const stored = storeEdgeById.get(expansion.origin.get(edge.id)?.edgeId) ?? {}
      return {
        ...stored,
        ...edge,
        sourceHandle: edge.sourceHandle ?? handleFor(nodeById.get(edge.source), SOURCE_HANDLE_TYPE),
        targetHandle: edge.targetHandle ?? handleFor(nodeById.get(edge.target), TARGET_HANDLE_TYPE),
      }
    })

  const { nodes: renamed, edges: rewired } = rewriteUnsafeIds(markHandles(nodes, edges), edges)
  return { nodes: renamed, edges: rewired }
}

/**
 * Gets the id of a handle an edge can end at on a module: one of its handles of that type, or else its most central
 * ghost on the side that type is drawn on, made that type (markHandles shows it).
 *
 * @param {Object|undefined} node - A flat part's node; its handles may be changed.
 * @param {string} type - SOURCE_HANDLE_TYPE or TARGET_HANDLE_TYPE.
 * @returns {string|undefined}
 */
function handleFor(node, type) {
  const handles = node?.data?.handles ?? []
  const own = handles.find((handle) => handle.variant !== HANDLE_VARIANT.GHOST && handle.type === type)
  if (own) return getHandleId(own)
  const ghost = findMostCentralGhostHandle(type === SOURCE_HANDLE_TYPE ? 'right' : 'left', handles)
  if (!ghost) return undefined
  node.data.handles = handles.map((handle) => (handle === ghost ? { ...handle, type } : handle))
  return getHandleId(ghost)
}

/**
 * Shows the handles the edges end at and turns the others into ghosts, as an unused handle is.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {Array} The nodes, copied where a handle changed.
 */
function markHandles(nodes, edges) {
  const used = new Set(edges.flatMap((edge) => [`${edge.source}::${edge.sourceHandle}`, `${edge.target}::${edge.targetHandle}`]))
  return nodes.map((node) => {
    if (!node.data?.handles) return node
    let changed = false
    const handles = node.data.handles.map((handle) => {
      const variant = used.has(`${node.id}::${getHandleId(handle)}`)
        ? handle.variant === HANDLE_VARIANT.GHOST
          ? HANDLE_VARIANT.DEFAULT
          : handle.variant
        : HANDLE_VARIANT.GHOST
      if (variant === handle.variant) return handle
      changed = true
      return { ...handle, variant }
    })
    return changed ? { ...node, data: { ...node.data, handles } } : node
  })
}

/**
 * Rebuilds a snapshot's nodes and edges for the workspace. A module is rebuilt as a dropped one is, keeping its scope
 * and local id, with ghost handles filled in; a super instance or interface node keeps its data as it is, given ghost
 * handles when it has none. A parameter the
 * archive's CellML gives a root module is set on its row; one it gives a module inside a super instance, where it differs,
 * becomes an override on the outermost super instance, so the super-module's other super instances keep theirs.
 *
 * @param {{nodeData: Array, edges: Array}} snapshot
 * @param {Object} [options]
 * @param {Object<string, Array<{name: string, value: string}>>} [options.parameterData={}] - The CellML's parameters
 *   by module flat name (see loadParametersFromCellML).
 * @param {(node: Object) => Object} [options.prepareNode] - Resolves a module's math before it is rebuilt.
 * @returns {{nodes: Array, edges: Array, nodeNameToIdMap: Map<string, string>,
 *   skippedParameters: Array<{nodeName: string, name: string}>}} nodeNameToIdMap: each model node's id by its flat
 *   name and its path, as the expansion resolves them (idOf), for the archive's simulation settings.
 */
export function restoreFlowSnapshot(snapshot, { parameterData = {}, prepareNode = (node) => node } = {}) {
  const flow = withoutHidden({ nodes: snapshot.nodeData, edges: snapshot.edges })
  const { nodes: snapshotNodes, edges } = rewriteUnsafeIds(flow.nodes, flow.edges)
  const skippedParameters = []

  const nodes = snapshotNodes.map((snapshotNode) => {
    if (VERBATIM_TYPES.has(snapshotNode.type)) {
      const { id, type, position, data } = withHierarchyHandles(snapshotNode)
      return { id, type, position, data: { ...data }, ...(type === SUPERMODULE_INTERFACE_NODE_TYPE && { deletable: false }) }
    }
    let node = { ...snapshotNode, data: { ...snapshotNode.data } }
    const values = scopeOf(node) === null && parameterData[node.data.name]
    if (values) {
      const result = applyParameterValues(node.data.variables, (name) => values.find((p) => p.name.trimEnd() === name))
      node.data.variables = result.variables
      skippedParameters.push(...result.skipped.map((name) => ({ nodeName: node.data.name, name })))
    }
    node = prepareNode(node)
    const handles = normaliseHandleSlots([
      ...node.data.handles,
      ...buildGhostHandles(NUM_GHOST_HANDLES_TOP_BOT, NUM_GHOST_HANDLES_LEFT_RIGHT, node.data.handles),
    ])
    const built = buildInstance(node.id, node.data.name, node.type, node.data, handles, node.position)
    for (const key of ['scope', 'localId']) if (key in node.data) built.data[key] = node.data[key]
    return built
  })

  const expansion = expandHierarchy(nodes, edges)
  if (hasHierarchy(nodes, edges)) skippedParameters.push(...overrideNestedParameters(nodes, expansion, parameterData))
  const nodeNameToIdMap = new Map()
  for (const { id } of expansion.nodes) {
    for (const name of [expansion.nameOf(id), expansion.pathOf(id)]) {
      if (name !== undefined && !nodeNameToIdMap.has(name)) nodeNameToIdMap.set(name, expansion.idOf(name))
    }
  }
  return { nodes, edges, nodeNameToIdMap, skippedParameters }
}

/**
 * Sets the CellML's values for modules inside super instances as overrides on their outermost super instances, where they
 * differ from the values the expansion gives.
 *
 * @param {Array} nodes - Rebuilt; the outermost super instances' overrides are replaced.
 * @param {ReturnType<typeof expandHierarchy>} expansion
 * @param {Object<string, Array<{name: string, value: string}>>} parameterData
 * @returns {Array<{nodeName: string, name: string}>} The computed rows the CellML gave values, left as they were.
 */
function overrideNestedParameters(nodes, expansion, parameterData) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const skipped = []
  const sameValue = (a, b) => {
    const [x, y] = [String(a ?? '').trim(), String(b ?? '').trim()]
    return x === y || (x !== '' && y !== '' && Number(x) === Number(y))
  }
  for (const leaf of expansion.nodes) {
    const values = isNestedModelId(leaf.id) && parameterData[leaf.data.name]
    if (!values) continue
    const result = applyParameterValues(leaf.data.variables, (name) => values.find((p) => p.name.trimEnd() === name))
    skipped.push(...result.skipped.map((name) => ({ nodeName: leaf.data.name, name })))
    const outer = nodeById.get(expansion.origin.get(leaf.id).instanceChain[0])
    const key = leaf.id.split(EXPANDED_ID_SEPARATOR).slice(1).join(EXPANDED_ID_SEPARATOR)
    result.variables.forEach((row, index) => {
      if (sameValue(row.value, leaf.data.variables[index].value)) return
      const overrides = outer.data.overrides ?? {}
      outer.data.overrides = { ...overrides, [key]: { ...overrides[key], [row.name]: { ...overrides[key]?.[row.name], value: row.value } } }
    })
  }
  return skipped
}
