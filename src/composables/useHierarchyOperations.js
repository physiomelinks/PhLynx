/**
 * Structural edits of the hierarchy on the workspace (see services/hierarchy/operations.js): Make unique, Nest
 * selection and Un-nest; and keeping a super-module for one super instance, as a command for the edit guard. Each is one undo step: the new nodes and edges are added before the old ones are removed, so
 * no global constant a moved node uses is cleaned up, and the sliders, plots, sweeps and inspection variables of the
 * modules moved follow them to their new model ids.
 */
import { useVueFlow } from '@vue-flow/core'

import { useFlowHistoryFor } from './useFlowHistoryFor'
import { prefixedNamingMessage } from './usePreservedNaming'
import { useSupermodules } from './useSupermodules'
import { flatNameChanges, keepForOne, makeUnique, modelIdMap, nestProblem, nestSelection, unnest, unnestProblem } from '../services/hierarchy/operations'
import { remapNodeKeys } from '../services/hierarchy/remapKeys'
import { FLOW_IDS } from '../utils/constants'
import { isSuperInstance } from '../utils/hierarchy'
import { detachReactivity } from '../utils/reactivity'

// A flow without nodes or edges, such as a stub of one, reads as empty.
const NONE = Object.freeze({ value: Object.freeze([]) })

/** @returns {Promise<void>} Resolves once the changes queued now, and those they queue, have run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** @returns {boolean} Whether two plain values are the same, as saved. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// The fields of an edge kept in place that an edit may change.
const EDGE_FIELDS = ['data', 'sourceHandle', 'targetHandle']

/**
 * Gives the structural edits of a flow's hierarchy.
 *
 * @param {Object} [options]
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @param {Object} [options.history] - The undo stack; the nearest provided one by default.
 * @param {Function} [options.confirm] - The confirm dialog, which asks before Make unique changes preserved flat names.
 * @returns {{canMakeUnique: Function, makeUniqueSuperInstance: Function, nestProblemOf: Function, nest: Function,
 *   unnestProblemOf: Function, unnestSuperInstance: Function, keepForOneCommand: Function}}
 */
export function useHierarchyOperations({ flowId = FLOW_IDS.MAIN, history = useFlowHistoryFor(), confirm = null } = {}) {
  const flow = useVueFlow(flowId)
  const { find } = useSupermodules(flowId)
  const allNodes = () => (flow.nodes ?? flow.getNodes ?? NONE).value
  const allEdges = () => (flow.edges ?? flow.getEdges ?? NONE).value
  const store = () => ({ nodes: detachReactivity(allNodes()), edges: detachReactivity(allEdges()) })

  /**
   * Compares an edit's result with the store it was planned on: the data of nodes and edges it keeps that changes,
   * what it adds and removes, the model ids that change, and how to write the kept ones' data either side.
   *
   * @param {{nodes: Array, edges: Array}} before
   * @param {Object} result - From an operation.
   */
  function diff(before, result) {
    const { idMap, nameOf } = modelIdMap(before, result, result.rewrite)
    const nodeBefore = new Map(before.nodes.map((node) => [node.id, node]))
    const edgeBefore = new Map(before.edges.map((edge) => [edge.id, edge]))
    const nodeIds = new Set(result.nodes.map((node) => node.id))
    const edgeIds = new Set(result.edges.map((edge) => edge.id))

    const nodeData = result.nodes
      .filter((node) => nodeBefore.has(node.id) && !same(node.data, nodeBefore.get(node.id).data))
      .map((node) => ({ id: node.id, before: detachReactivity(nodeBefore.get(node.id).data), after: detachReactivity(node.data) }))
    const pick = (edge) => Object.fromEntries(EDGE_FIELDS.map((field) => [field, edge[field] === undefined ? null : detachReactivity(edge[field])]))
    const edgeFields = result.edges
      .filter((edge) => edgeBefore.has(edge.id) && !same(pick(edge), pick(edgeBefore.get(edge.id))))
      .map((edge) => ({ id: edge.id, before: pick(edgeBefore.get(edge.id)), after: pick(edge) }))

    const write = (side) => {
      for (const change of nodeData) {
        const node = flow.findNode(change.id)
        if (node) node.data = detachReactivity(change[side])
      }
      for (const change of edgeFields) {
        const edge = flow.findEdge(change.id)
        if (!edge) continue
        for (const [field, value] of Object.entries(change[side])) {
          if (value === null) delete edge[field]
          else edge[field] = detachReactivity(value)
        }
      }
    }
    return {
      idMap,
      nameOf,
      write,
      addedNodes: result.nodes.filter((node) => !nodeBefore.has(node.id)),
      addedEdges: result.edges.filter((edge) => !edgeBefore.has(edge.id)),
      removedNodes: before.nodes.filter((node) => !nodeIds.has(node.id)),
      removedEdges: before.edges.filter((edge) => !edgeIds.has(edge.id)),
    }
  }

  /** Removes nodes, a super-module's interface node (which can't be deleted from the canvas) too. */
  const removeNodes = (ids) =>
    flow.removeNodes(
      ids.map((id) => {
        const node = flow.findNode(id)
        return node?.deletable === false ? { ...node, deletable: true } : id
      })
    )

  /**
   * Makes an edit's result the store's, as one undo step: the data of nodes and edges it keeps written, its new nodes
   * and edges added, then the old ones removed, and the keyed stores following the modules moved.
   *
   * @param {string} type - The undo step's.
   * @param {{nodes: Array, edges: Array}} before - The store the edit was planned on.
   * @param {Object} result - From an operation.
   * @returns {Promise<{done: boolean, problems: string[]}>}
   */
  async function apply(type, before, result) {
    if (result.problems.length) return { done: false, problems: result.problems }
    const { idMap, nameOf, write, addedNodes, addedEdges, removedNodes, removedEdges } = diff(before, result)
    let keys = null
    history.startBatch()
    try {
      await history.executeAndAddCommand({
        type,
        redo: () => {
          write('after')
          if (keys) keys.restore('after')
          else keys = remapNodeKeys(idMap, nameOf)
        },
        undo: () => {
          write('before')
          keys?.restore('before')
        },
      })
      if (addedNodes.length) flow.addNodes(detachReactivity(addedNodes))
      if (addedEdges.length) flow.addEdges(detachReactivity(addedEdges))
      if (removedNodes.length) removeNodes(removedNodes.map((node) => node.id))
      const edgesLeft = removedEdges.map((edge) => edge.id).filter((id) => flow.findEdge(id))
      if (edgesLeft.length) flow.removeEdges(edgesLeft)
      // An edge removed ghosts its handles a tick later; those changes are part of this step too.
      await settle()
    } finally {
      history.endBatch()
    }
    return { done: true, problems: [], result }
  }

  /**
   * Gives an edit as one command that records nothing itself, for a caller that runs it unrecorded (see historyStore
   * setGate): planned on the store as it is when first run, then applied whole either way.
   *
   * @param {string} type
   * @param {(before: {nodes: Array, edges: Array}) => Object} plan - Gives an operation's result for the store.
   * @returns {{type: string, redo: Function, undo: Function}}
   * @throws {Error} When first run, if the edit can't be made.
   */
  function commandOf(type, plan) {
    let change = null
    let keys = null
    return {
      type,
      redo: () => {
        if (!change) {
          const before = store()
          const result = plan(before)
          if (result.problems.length) throw new Error(result.problems.join(' '))
          change = diff(before, result)
        }
        const { idMap, nameOf, write, addedNodes, addedEdges, removedNodes, removedEdges } = change
        write('after')
        if (addedNodes.length) flow.addNodes(detachReactivity(addedNodes))
        if (addedEdges.length) flow.addEdges(detachReactivity(addedEdges))
        if (removedEdges.length) flow.removeEdges(removedEdges.map((edge) => edge.id))
        if (removedNodes.length) removeNodes(removedNodes.map((node) => node.id))
        if (keys) keys.restore('after')
        else keys = remapNodeKeys(idMap, nameOf)
      },
      undo: () => {
        if (!change) return
        const { write, addedNodes, addedEdges, removedNodes, removedEdges } = change
        if (addedEdges.length) flow.removeEdges(addedEdges.map((edge) => edge.id))
        if (addedNodes.length) removeNodes(addedNodes.map((node) => node.id))
        if (removedNodes.length) flow.addNodes(detachReactivity(removedNodes))
        if (removedEdges.length) flow.addEdges(detachReactivity(removedEdges))
        write('before')
        keys?.restore('before')
      },
    }
  }

  /**
   * Whether a super instance's super-module has more than one copy in the model, so making it unique changes anything.
   *
   * @param {Object|string} superInstance - The node or its id.
   * @returns {boolean}
   */
  function canMakeUnique(superInstance) {
    const node = typeof superInstance === 'string' ? flow.findNode(superInstance) : superInstance
    return isSuperInstance(node) && (find(node.data.smId)?.occurrences ?? 0) > 1
  }

  /**
   * Gives a super instance its own copy of its super-module (see operations.js makeUnique). A copy of one keeping its
   * components' own names is named after its super instance, so it asks first, listing the flat names that change.
   *
   * @param {string} superInstanceId
   * @returns {Promise<{done: boolean, problems: string[]}>}
   */
  async function makeUniqueSuperInstance(superInstanceId) {
    const before = store()
    const result = makeUnique(before.nodes, before.edges, superInstanceId)
    const changes = result.problems.length ? [] : flatNameChanges(before.nodes, result.nodes)
    if (changes.length && confirm) {
      const name = find(flow.findNode(superInstanceId)?.data?.smId)?.name ?? ''
      const answer = await confirm({
        header: 'Flat Names Will Change',
        message: prefixedNamingMessage([name], changes),
        severity: 'warning',
        acceptLabel: 'Make Unique',
        rejectLabel: 'Cancel',
      })
      if (answer !== true) return { done: false, problems: [] }
    }
    return apply('make-unique', before, result)
  }

  /** @returns {string|null} Why some nodes can't be nested (see operations.js nestProblem). */
  const nestProblemOf = (ids) => nestProblem(allNodes(), ids)

  /**
   * Nests nodes into a new super-module, with one super instance of it in their place (see operations.js nestSelection).
   *
   * @param {string[]} ids
   * @param {string} name - The super-module's and the super instance's.
   * @returns {Promise<{done: boolean, problems: string[], result?: Object}>} `result.superInstanceId` the new super instance's.
   */
  function nest(ids, name) {
    const before = store()
    return apply('nest-selection', before, nestSelection(before.nodes, before.edges, ids, { name }))
  }

  /** @returns {string|null} Why a super instance can't be un-nested (see operations.js unnestProblem). */
  const unnestProblemOf = (superInstanceId) => unnestProblem(allNodes(), superInstanceId)

  /**
   * Un-nests a super instance: its super-module's children take its place (see operations.js unnest).
   *
   * @param {string} superInstanceId
   * @returns {Promise<{done: boolean, problems: string[], result?: Object}>}
   */
  function unnestSuperInstance(superInstanceId) {
    const before = store()
    return apply('unnest', before, unnest(before.nodes, before.edges, superInstanceId))
  }

  /**
   * Gives a super instance its super-module to itself, the others moving to a copy (see operations.js keepForOne), as a
   * command that records nothing itself (see commandOf).
   *
   * @param {string} superInstanceId
   * @returns {{type: string, redo: Function, undo: Function}}
   */
  const keepForOneCommand = (superInstanceId) =>
    commandOf('keep-for-one', (before) => keepForOne(before.nodes, before.edges, superInstanceId))

  return { canMakeUnique, makeUniqueSuperInstance, nestProblemOf, nest, unnestProblemOf, unnestSuperInstance, keepForOneCommand }
}
