/**
 * The model: the workspace's nodes and edges with every super instance expanded into its super-module's modules (see
 * services/hierarchy/expand.js). Simulation, export, SED-ML, protocols, sliders, plots, search and parameter import
 * read it; the canvas reads the store. A workspace without super instances is its own model: the same nodes and edges, in
 * the same order.
 *
 * One expansion per workspace, shared by every caller. It reads the nodes' ids, types and data and the edges' model
 * fields only, so moving, measuring or selecting nodes never recomputes it.
 */
import { computed, effectScope } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { resolveBoundaryValues } from '../services/export/boundaryValues'
import { expandHierarchy } from '../services/hierarchy/expand'
import { FLOW_IDS } from '../utils/constants'
import { hasHierarchy, scopeOf } from '../utils/hierarchy'

// A flow without nodes or edges, such as a stub of one, reads as empty.
const NONE = Object.freeze({ value: Object.freeze([]) })

// Each workspace's model, by its flow.
const graphs = new WeakMap()

/**
 * Gives the workspace's model, its problems, and the ways between its ids and the store's.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN] - The flow whose model to give; the workspace's by default.
 * @returns {{graph: import('vue').ComputedRef<Object>, modelNodes: import('vue').ComputedRef<Array>,
 *   modelEdges: import('vue').ComputedRef<Array>, errors: import('vue').ComputedRef<Array>,
 *   isHierarchical: import('vue').ComputedRef<boolean>, expandSelection: Function, modelIdOf: Function,
 *   mainIdOf: Function, rootIdOf: Function, findModelNode: Function, boundary: import('vue').ComputedRef<Object|null>}}
 *   `graph` is expandHierarchy's result; `errors` the problems builds report, none for a workspace without super
 *   instances, whose builds check it as before; `boundary` the model's resolveBoundaryValues, null when a malformed
 *   port stops it (export says why).
 */
export function useModelGraph(flowId = FLOW_IDS.MAIN) {
  const flow = useVueFlow(flowId)
  // Outside any component, so no component's unmounting stops it for the others.
  if (!graphs.has(flow)) graphs.set(flow, effectScope(true).run(() => createModelGraph(flow)))
  return graphs.get(flow)
}

/**
 * Builds a flow's model.
 *
 * @param {Object} flow - From useVueFlow.
 * @returns {ReturnType<typeof useModelGraph>}
 */
function createModelGraph(flow) {
  const nodes = flow.nodes ?? NONE
  const edges = flow.edges ?? NONE

  const isHierarchical = computed(() => hasHierarchy(nodes.value, edges.value))
  const graph = computed(() => {
    const expansion = expandHierarchy(nodes.value, edges.value)
    if (import.meta.env.DEV) assertModel(expansion, nodes.value, edges.value, isHierarchical.value)
    return expansion
  })
  const modelNodes = computed(() => graph.value.nodes)
  const modelEdges = computed(() => graph.value.edges)
  const errors = computed(() => (isHierarchical.value ? graph.value.errors : []))
  const nodeById = computed(() => new Map(graph.value.nodes.map((node) => [node.id, node])))
  // Resolved once per model, for every row of every node shown from it.
  const boundary = computed(() => {
    try {
      return resolveBoundaryValues(graph.value.nodes, graph.value.edges)
    } catch {
      return null
    }
  })
  // Each model node's id by where it comes from: the store's node and the super instances it is expanded through.
  const idByOrigin = computed(() => {
    const { nodes: expanded, origin } = graph.value
    return new Map(expanded.map((node) => [originKey(origin.get(node.id)), node.id]))
  })

  /**
   * Gets the model nodes some store nodes stand for: a module is itself, a super instance every module it expands to, and a
   * module inside a super-module its copy in each super instance of it, or only in the super instances `within` goes through.
   * Without super instances, the ids as they are.
   *
   * @param {Iterable<string>} mainIds - Store ids, such as the canvas selection.
   * @param {string[]|null} [within=null] - Super instances' store ids from the root down, as the canvas was entered through
   *   them: only copies expanded through them are given.
   * @returns {string[]} Model ids, in the model's order.
   */
  function expandSelection(mainIds, within = null) {
    const ids = [...mainIds]
    if (!isHierarchical.value) return ids
    const selected = new Set(ids)
    const { nodes: expanded, origin } = graph.value
    return expanded
      .map((node) => node.id)
      .filter((id) => {
        const from = origin.get(id)
        if (within?.some((instanceId, level) => from.instanceChain[level] !== instanceId)) return false
        return selected.has(from.mainId) || from.instanceChain.some((instanceId) => selected.has(instanceId))
      })
  }

  /**
   * Gets the model id of a store node, as expanded through some super instances.
   *
   * @param {string} mainId
   * @param {string[]} [instanceChain=[]] - The super instances' store ids, outermost first; none for a root module.
   * @returns {string|undefined}
   */
  const modelIdOf = (mainId, instanceChain = []) => idByOrigin.value.get(originKey({ mainId, instanceChain }))

  /**
   * Gets the store node a model node is expanded from.
   *
   * @param {string} modelId
   * @returns {string|undefined}
   */
  const mainIdOf = (modelId) => graph.value.origin.get(modelId)?.mainId

  /**
   * Gets the root node a model node belongs to: itself at the root, else the outermost super instance it is expanded
   * through.
   *
   * @param {string} modelId
   * @returns {string|undefined}
   */
  const rootIdOf = (modelId) => {
    const from = graph.value.origin.get(modelId)
    return from && (from.instanceChain[0] ?? from.mainId)
  }

  /**
   * Gets a model node.
   *
   * @param {string} modelId
   * @returns {Object|undefined}
   */
  const findModelNode = (modelId) => nodeById.value.get(modelId)

  return { graph, modelNodes, modelEdges, errors, isHierarchical, expandSelection, modelIdOf, mainIdOf, rootIdOf, findModelNode, boundary }
}

/**
 * Keys where a model node comes from.
 *
 * @param {{mainId: string, instanceChain: string[]}} from - Its origin.
 * @returns {string}
 */
const originKey = ({ mainId, instanceChain }) => [...instanceChain, mainId].join('\0')

/**
 * Checks what model consumers rely on, in development: a workspace without super instances expands to its own nodes and
 * edges, and no node of a super-module reaches the model.
 *
 * @param {Object} expansion - From expandHierarchy.
 * @param {Array} nodes - The store's.
 * @param {Array} edges - The store's.
 * @param {boolean} isHierarchical
 * @throws {Error} When either fails.
 */
function assertModel(expansion, nodes, edges, isHierarchical) {
  const isSame = (expanded, stored) => expanded.length === stored.length && expanded.every((item, i) => item === stored[i])
  if (!isHierarchical && !(isSame(expansion.nodes, nodes) && isSame(expansion.edges, edges))) {
    throw new Error('A workspace without super instances must expand to its own nodes and edges.')
  }
  const scoped = expansion.nodes.find((node) => scopeOf(node) !== null)
  if (scoped) throw new Error(`Node "${scoped.id}" of super-module "${scopeOf(scoped)}" reached the model.`)
}
