/**
 * Exposing a super-module's children's ports on its interface, through exposure edges (see
 * services/hierarchy/exposure.js), and what un-exposing them does across the workspace. The Expose Ports dialog, the
 * interface node's sidebar, connecting and deleting read it.
 *
 * Each change is one undo step. Un-exposing a port that connections to its super instances use asks first; on yes, those
 * couplings go in the same step (an edge left with none with them), and so does an outer super-module's port exposing
 * it through `via`.
 */
import { computed, effectScope } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useFlowHistoryFor } from './useFlowHistoryFor'
import { useModelGraph } from './useModelGraph'
import { useSuperInstanceSync } from './useSuperInstanceSync'
import { useSupermodules } from './useSupermodules'
import {
  exposablePorts,
  exposureEnds,
  indexExposures,
  portResolver,
  isExposureEdge,
  planExposure,
  planRelabel,
  planReorder,
  planUnexpose,
} from '../services/hierarchy/exposure'
import { dropKeys } from '../services/hierarchy/remapKeys'
import { EXPOSURE_EDGE_TYPE, FLOW_IDS, PORT_TYPE_OPTIONS } from '../utils/constants'
import { isSupermoduleInterface, scopeOf } from '../utils/hierarchy'
import { detachReactivity } from '../utils/reactivity'

// A flow without nodes or edges, such as a stub of one, reads as empty.
const NONE = Object.freeze({ value: Object.freeze([]) })

/**
 * Words what un-exposing ports, or removing nodes, does to connections (see planUnexpose).
 *
 * @param {ReturnType<typeof planUnexpose>} plan
 * @returns {string} Empty when it changes no connection.
 */
export function describeUnexposeImpact(plan) {
  if (!plan.connections) return ''
  const connections = plan.connections === 1 ? '1 connection' : `${plan.connections} connections`
  const superInstances = plan.superInstances.length === 1 ? '1 super instance' : `${plan.superInstances.length} super instances`
  return `This affects ${connections} in ${superInstances}.`
}

/**
 * Names the child an exposed port is on: its node's name, else the local id its alias names. For a port exposed `via`
 * a nested super instance, that super instance; the breadcrumb gives the deeper context.
 *
 * @param {Object} exposed - An ExposedPort (see exposure.js indexExposures).
 * @param {Map<string, Object>} nodeById
 * @returns {string}
 */
const ownerNameOf = (exposed, nodeById) => nodeById.get(exposed.childId)?.data?.name ?? exposed.alias.child

/**
 * Maps a super-module's exposed ports to the children they are on, so two of the same name read apart.
 *
 * @param {Array} nodes
 * @param {Array<Object>} exposedPorts - The super-module's ExposedPorts (see exposure.js indexExposures).
 * @returns {Map<string, string>} Exposed port id to its owner's name.
 */
export function exposedPortOwners(nodes, exposedPorts) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return new Map(exposedPorts.map((exposed) => [exposed.id, ownerNameOf(exposed, nodeById)]))
}

/**
 * Words an exposed port with its owner, as `<owner> · <label>`; the label alone without one.
 *
 * @param {string|null|undefined} owner
 * @param {string} label
 * @returns {string}
 */
export const ownedLabel = (owner, label) => (owner ? `${owner} · ${label}` : label)

/**
 * Gives a port type's one-letter badge, as the port type select shows it: I, O or G.
 *
 * @param {string} portType - e.g. `entrance_ports`.
 * @returns {string} `?` for an unknown type.
 */
export const portTypeLetter = (portType) => PORT_TYPE_OPTIONS.find((option) => option.value === portType)?.label ?? '?'

/**
 * Names a port type in a word: `entrance_ports` → `entrance`.
 *
 * @param {string} portType
 * @returns {string}
 */
export const portTypeName = (portType) => (portType ?? '').replace(/_ports$/, '')

/**
 * Numbers ports that share a label, so two of the same name read apart: each one's 1-based index among those with its
 * label, null for a label used once.
 *
 * @param {Array<{label: string}>} ports
 * @returns {Array<number|null>} Aligned with ports.
 */
export function duplicateIndex(ports) {
  const counts = new Map()
  for (const port of ports) counts.set(port.label, (counts.get(port.label) ?? 0) + 1)
  const seen = new Map()
  return ports.map((port) => {
    if (counts.get(port.label) < 2) return null
    const index = (seen.get(port.label) ?? 0) + 1
    seen.set(port.label, index)
    return index
  })
}

/**
 * Words an exposed port for its tooltip, as `<owner> · <type> · <variables>`, leaving out what it lacks.
 *
 * @param {string|null|undefined} owner
 * @param {{portType?: string, variables?: string[]}} port
 * @returns {string}
 */
export const describeExposedPort = (owner, port) =>
  [owner, portTypeName(port.portType), (port.variables ?? []).join(', ')].filter(Boolean).join(' · ')

/**
 * Gives a flow's lookup of the children super-modules' exposed ports are on (see exposedPortOwners), for the canvas and
 * the connection dialog to show beside their labels.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @returns {(smId: string) => Map<string, string>} Exposed port id to its owner's name; empty for an unknown smId.
 */
export function useExposedPortOwners(flowId = FLOW_IDS.MAIN) {
  const flow = useVueFlow(flowId)
  // Outside any component, so no component's unmounting stops it for the others.
  if (!portOwners.has(flow)) portOwners.set(flow, effectScope(true).run(() => createPortOwners(flow, flowId)))
  return portOwners.get(flow)
}

// Each flow's lookup of exposed ports' owners, shared by every card and dialog.
const portOwners = new WeakMap()

/**
 * Builds a flow's lookup of exposed ports' owners: every super-module's at once, from one index of the nodes.
 *
 * @param {Object} flow - From useVueFlow.
 * @param {string} flowId
 * @returns {(smId: string) => Map<string, string>}
 */
function createPortOwners(flow, flowId) {
  const { exposures } = useSupermodules(flowId)
  const ownersBySm = computed(() => {
    const nodeById = new Map((flow.nodes ?? NONE).value.map((node) => [node.id, node]))
    return new Map([...exposures.value].map(([smId, exposed]) => [smId, new Map(exposed.map((port) => [port.id, ownerNameOf(port, nodeById)]))]))
  })
  return (smId) => ownersBySm.value.get(smId) ?? new Map()
}

/**
 * Gives the ways to expose and un-expose ports.
 *
 * @param {Object} [options]
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @param {Object} [options.history] - The undo stack; the nearest provided one by default.
 * @param {Object} [options.handles] - From useHandleManagement: `revertHandlesForEdge` and `reactivateEdgeHandles`,
 *   to ghost the handles of an edge removed and bring them back on undo.
 * @returns {ReturnType<typeof createExposure>}
 */
export function useExposure({ flowId = FLOW_IDS.MAIN, history = useFlowHistoryFor(), handles = null } = {}) {
  return createExposure(useVueFlow(flowId), flowId, history, handles)
}

/**
 * Builds the ways to expose ports for a flow.
 */
function createExposure(flow, flowId, history, handles) {
  const allNodes = () => (flow.nodes ?? flow.getNodes ?? NONE).value
  const allEdges = () => (flow.edges ?? flow.getEdges ?? NONE).value
  const { sync } = useSuperInstanceSync(flowId)
  const model = useModelGraph(flowId)
  const nodeIndex = () => new Map(allNodes().map((node) => [node.id, node]))

  /**
   * Finds the exposure edge joining a child to its super-module's interface.
   *
   * @param {string} childId
   * @returns {Object|undefined}
   */
  const exposureEdgeOf = (childId) => {
    const nodeById = nodeIndex()
    return allEdges().find((edge) => exposureEnds(edge, nodeById)?.child.id === childId)
  }

  /**
   * Gets what the Expose Ports dialog lists for an exposure edge: its child, its super-module, and a row for each of
   * the child's ports (see exposure.js exposablePorts), those exposed now selected, in their order.
   *
   * @param {string} edgeId
   * @returns {{child: Object, smId: string, rows: Array, selected: Array}|null} Null for an edge that isn't one.
   */
  function exposureDialogOf(edgeId) {
    const edge = flow.findEdge(edgeId)
    const ends = edge && exposureEnds(edge, nodeIndex())
    if (!ends) return null
    const rows = exposablePorts(edge, allNodes(), allEdges())
    const selected = rows.filter((row) => row.exposedPortId).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    return { child: ends.child, smId: ends.smId, rows, selected }
  }

  /**
   * Lists a super-module's exposed ports for its interface's sidebar, in order: each with the port its super instances get
   * (label, port type, variables, multiport), the child it is on, and whether it still resolves.
   *
   * @param {string} smId
   * @returns {Array<{id: string, label: string|null, ownLabel: string|null, childId: string, childName: string,
   *   edgeId: string, via: string|null, port: Object|null}>} `label` its own label, if it has one; `port` null for one
   *   that no longer resolves.
   */
  function exposedPortListOf(smId) {
    const nodes = allNodes()
    const exposures = indexExposures(nodes, allEdges())
    const resolve = portResolver(nodes, exposures)
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    return (exposures.get(smId) ?? []).map((exposed) => ({
      id: exposed.id,
      label: exposed.label ?? null,
      ownLabel: exposed.alias.label ?? null,
      childId: exposed.childId,
      childName: ownerNameOf(exposed, nodeById),
      edgeId: exposed.edgeId,
      via: exposed.alias.via ?? null,
      port: resolve(smId, exposed.id),
    }))
  }

  /**
   * Builds the exposure edge a connection between a child and its super-module's interface makes. It exposes nothing
   * until its ports are picked.
   *
   * @param {{source: string, target: string, sourceHandle?: string, targetHandle?: string}} connection
   * @param {Object} [edgeOptions] - Merged in, as other new edges' line options are.
   * @returns {Object|null} Null when the connection doesn't join a child and its interface.
   */
  function buildExposureEdge(connection, edgeOptions = {}) {
    const edge = { ...connection, ...edgeOptions, type: EXPOSURE_EDGE_TYPE }
    if (!exposureEnds(edge, nodeIndex())) return null
    return { ...edge, id: `${connection.source}--${connection.target}`, data: { exposed: [] } }
  }

  /**
   * Makes a change to the store as one undo step: exposure entries, couplings and overrides written, edges removed,
   * and the keys of model nodes that go dropped. Undo and redo bring the super instances back in step.
   *
   * @param {Object} change
   * @param {string} change.type
   * @param {Map<string, Array>} [change.exposures] - Exposure edges' new entries.
   * @param {Map<string, Array>} [change.couplings] - Edges' new couplings.
   * @param {string[]} [change.removeEdgeIds]
   * @param {Map<string, Object>} [change.overrides] - Super instances' new overrides.
   * @param {(modelId: string) => boolean} [change.isDeadKey] - Model ids whose keys go.
   * @returns {Promise<void>}
   */
  async function commit({ type, exposures = new Map(), couplings = new Map(), removeEdgeIds = [], overrides = new Map(), isDeadKey = null }) {
    const edgeData = new Map()
    const put = (id, field, value) => {
      const edge = flow.findEdge(id)
      if (!edge) return
      const entry = edgeData.get(id) ?? { before: detachReactivity(edge.data ?? {}), after: { ...detachReactivity(edge.data ?? {}) } }
      entry.after[field] = detachReactivity(value)
      edgeData.set(id, entry)
    }
    exposures.forEach((entries, id) => put(id, 'exposed', entries))
    couplings.forEach((list, id) => put(id, 'couplings', list))
    const removed = removeEdgeIds.map((id) => flow.findEdge(id)).filter(Boolean).map(detachReactivity)
    const nodeData = new Map(
      [...overrides]
        .filter(([id]) => flow.findNode(id))
        .map(([id, after]) => [id, { before: detachReactivity(flow.findNode(id).data.overrides ?? {}), after: detachReactivity(after) }])
    )
    let keys = null
    let isFirst = true

    const writeEdges = (side) => {
      for (const [id, data] of edgeData) {
        const edge = flow.findEdge(id)
        if (edge) edge.data = detachReactivity(data[side])
      }
    }
    const writeNodes = (side) => {
      for (const [id, data] of nodeData) if (flow.findNode(id)) flow.updateNodeData(id, { overrides: detachReactivity(data[side]) })
    }
    const removedIds = removed.map((edge) => edge.id)
    // The scopes whose structure this changes: the exposure edges' super-module, and where couplings change.
    const scopes = [...new Set([...edgeData.keys(), ...removedIds].map((id) => scopeOf(flow.findNode(flow.findEdge(id)?.source))))]

    await history.executeAndAddCommand({
      type,
      scopes,
      redo: async () => {
        writeEdges('after')
        writeNodes('after')
        if (isFirst) keys = isDeadKey ? dropKeys(isDeadKey) : null
        else keys?.restore('after')
        isFirst = false
        if (removedIds.length) {
          for (const edge of removed) await handles?.revertHandlesForEdge?.(edge, removedIds, { trackHistory: false })
          flow.removeEdges(removedIds)
        }
        sync()
      },
      undo: async () => {
        if (removed.length) {
          flow.addEdges(detachReactivity(removed))
          for (const edge of removed) await handles?.reactivateEdgeHandles?.(edge, { trackHistory: false })
        }
        writeNodes('before')
        writeEdges('before')
        keys?.restore('before')
        sync()
      },
    })
  }

  /**
   * Asks whether to go ahead with what un-exposing does to connections; nothing to ask when it changes none.
   *
   * @param {ReturnType<typeof planUnexpose>} plan
   * @param {Function|null} confirm - From useConfirmDialog.
   * @returns {Promise<boolean>}
   */
  async function confirmImpact(plan, confirm) {
    if (!plan.connections) return true
    if (!confirm) return false
    const answer = await confirm({
      header: 'Un-expose Ports?',
      message: `${describeUnexposeImpact(plan)} Their couplings to the ports un-exposed are removed, and a connection left with none goes too.`,
      severity: 'warning',
      acceptLabel: 'Un-expose',
      rejectLabel: 'Cancel',
    })
    return answer === true
  }

  /**
   * Saves what an exposure edge exposes, as the Expose Ports dialog does: the rows ticked, in order, each with an
   * optional label (see exposure.js planExposure). Un-exposing ports connections use asks first.
   *
   * @param {string} edgeId
   * @param {Array<{key: string, label?: string|null}>} rows
   * @param {Object} [options]
   * @param {Function} [options.confirm] - From useConfirmDialog; without it, nothing connections use is un-exposed.
   * @returns {Promise<{saved: boolean, problems: string[]}>}
   */
  async function saveExposure(edgeId, rows, { confirm = null } = {}) {
    const edge = flow.findEdge(edgeId)
    const ends = edge && exposureEnds(edge, nodeIndex())
    if (!ends) return { saved: false, problems: ['That is not an exposure edge.'] }
    const nodes = allNodes()
    const edges = allEdges()
    const plan = planExposure(edge, rows, nodes, edges)
    if (plan.problems.length) return { saved: false, problems: plan.problems }

    const impact = planUnexpose(nodes, edges, { unexposed: new Map([[ends.smId, plan.removedIds]]) })
    if (!(await confirmImpact(impact, confirm))) return { saved: false, problems: [] }
    const exposures = new Map(impact.exposures)
    exposures.set(edgeId, plan.entries)
    await commit({ type: 'expose-ports', ...impact, exposures })
    return { saved: true, problems: [] }
  }

  /**
   * Un-exposes ports of a super-module, asking first when connections use them.
   *
   * @param {string} smId
   * @param {string[]} exposedPortIds
   * @param {Object} [options] - As saveExposure's.
   * @returns {Promise<boolean>} Whether they were un-exposed.
   */
  async function unexposePorts(smId, exposedPortIds, { confirm = null } = {}) {
    const impact = planUnexpose(allNodes(), allEdges(), { unexposed: new Map([[smId, exposedPortIds]]) })
    if (impact.isEmpty || !(await confirmImpact(impact, confirm))) return false
    await commit({ type: 'unexpose-ports', ...impact })
    return true
  }

  /**
   * Puts a super-module's exposed ports in a new order, which sets their slots and circulatory_autogen's key order.
   *
   * @param {string} smId
   * @param {string[]} orderedIds - Exposed port ids.
   * @returns {Promise<boolean>} Whether anything moved.
   */
  async function reorderExposedPorts(smId, orderedIds) {
    const exposures = planReorder(smId, orderedIds, allNodes(), allEdges())
    if (!exposures.size) return false
    await commit({ type: 'reorder-exposed-ports', exposures })
    return true
  }

  /**
   * Gives an exposed port its own label on the super-module's super instances; empty for the child port's.
   *
   * @param {string} smId
   * @param {string} exposedPortId
   * @param {string|null} label
   * @returns {Promise<boolean>} Whether it changed.
   */
  async function relabelExposedPort(smId, exposedPortId, label) {
    const exposures = planRelabel(smId, exposedPortId, label, allNodes(), allEdges())
    if (!exposures.size) return false
    await commit({ type: 'relabel-exposed-port', exposures })
    return true
  }

  /**
   * Gets the model ids of every copy of the nodes inside super-modules some nodes removed are, whose keys go with them.
   *
   * @param {string[]} nodeIds
   * @returns {Set<string>}
   */
  function deadModelIdsOf(nodeIds) {
    const nodeById = nodeIndex()
    const inside = nodeIds.filter((id) => scopeOf(nodeById.get(id)) !== null && !isSupermoduleInterface(nodeById.get(id)))
    return new Set(inside.length ? model.expandSelection(inside) : [])
  }

  /**
   * Plans what removing nodes and edges does beyond them (see exposure.js planUnexpose): the ports they un-expose, the
   * connections those take, the overrides they orphan, and, for nodes inside super-modules, the model ids of every copy
   * of them, whose keys go.
   *
   * @param {string[]} nodeIds
   * @param {string[]} [edgeIds=[]]
   * @returns {ReturnType<typeof planUnexpose> & {deadModelIds: Set<string>}}
   */
  function planRemoval(nodeIds, edgeIds = []) {
    const deadModelIds = deadModelIdsOf(nodeIds)
    const exposureEdgeIds = edgeIds.filter((id) => isExposureEdge(flow.findEdge(id)))
    return { ...planUnexpose(allNodes(), allEdges(), { removedNodeIds: nodeIds, removedEdgeIds: exposureEdgeIds }), deadModelIds }
  }

  /**
   * Makes what removing nodes and edges does beyond them (see planRemoval), as one undo step, for the caller to remove
   * them after, in the same batch.
   *
   * @param {ReturnType<typeof planRemoval>} plan
   * @returns {Promise<boolean>} Whether anything changed.
   */
  async function applyRemoval(plan) {
    if (plan.isEmpty && !plan.deadModelIds.size) return false
    const isDeadKey = plan.deadModelIds.size ? (id) => plan.deadModelIds.has(id) : null
    await commit({ type: 'remove-exposed', ...plan, isDeadKey })
    return true
  }

  return {
    exposureEdgeOf,
    exposureDialogOf,
    exposedPortListOf,
    buildExposureEdge,
    saveExposure,
    unexposePorts,
    reorderExposedPorts,
    relabelExposedPort,
    deadModelIdsOf,
    planRemoval,
    applyRemoval,
  }
}
