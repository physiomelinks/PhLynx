/**
 * The canvas level: which scope the canvas shows and how it was reached, from the root or editing a super-module on
 * its own. Nodes outside the scope shown are hidden (never saved); navigating is never an undo step.
 */
import { computed, effectScope, nextTick, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useActiveCanvas } from './useActiveCanvas'
import { useModelGraph } from './useModelGraph'
import { useSupermodules } from './useSupermodules'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { FLOW_IDS } from '../utils/constants'
import { isSuperInstance, isSupermoduleInterface, scopeOf } from '../utils/hierarchy'

// A flow without nodes or edges, such as a stub of one, reads as empty.
const NONE = Object.freeze({ value: Object.freeze([]) })
// The root's key among the remembered viewports.
const ROOT = Symbol('root')

// Each flow's level, shared by every caller.
const levels = new WeakMap()

/**
 * Gives a flow's canvas level.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @returns {ReturnType<typeof createCanvasLevel>}
 */
export function useCanvasLevel(flowId = FLOW_IDS.MAIN) {
  const flow = useVueFlow(flowId)
  // Outside any component, so no component's unmounting stops it for the others.
  if (!levels.has(flow)) levels.set(flow, effectScope(true).run(() => createCanvasLevel(flow, flowId)))
  return levels.get(flow)
}

/**
 * Sets each node's and edge's `hidden` for a scope shown: hidden unless in it, an exposure edge in its super-module's.
 * Only what changes is written, so a workspace without super-modules is left as it is. An interface node, the
 * super-module's only record, is also made undeletable, whatever a file said.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {string|null} scope
 * @param {Object} [options]
 * @param {boolean} [options.deselect=false] - Whether a node or edge hidden is also deselected.
 */
function applyVisibility(nodes, edges, scope, { deselect = false } = {}) {
  const scopeById = new Map()
  for (const node of nodes) {
    scopeById.set(node.id, scopeOf(node))
    setHidden(node, scopeOf(node) !== scope, deselect)
    if (isSupermoduleInterface(node) && node.deletable !== false) node.deletable = false
  }
  for (const edge of edges) {
    const edgeScope = scopeById.get(edge.source) ?? scopeById.get(edge.target) ?? null
    setHidden(edge, edgeScope !== scope, deselect)
  }
}

/** Writes an item's `hidden` where it changes. */
function setHidden(item, hidden, deselect) {
  if (!!item.hidden !== hidden) item.hidden = hidden
  if (hidden && deselect && item.selected) item.selected = false
}

/**
 * Builds a flow's canvas level.
 *
 * @param {Object} flow - From useVueFlow.
 * @param {string} flowId
 */
function createCanvasLevel(flow, flowId) {
  const { scope, selectedNodes } = useActiveCanvas(flowId)
  const model = useModelGraph(flowId)
  const { find: findSupermodule } = useSupermodules(flowId)
  const allNodes = () => (flow.nodes ?? flow.getNodes ?? NONE).value
  const allEdges = () => (flow.edges ?? flow.getEdges ?? NONE).value
  const findStoreNode = (id) => flow.findNode?.(id) ?? allNodes().find((node) => node.id === id)

  // The super-module edited on its own, or null when the canvas was reached from the root.
  const editedSupermodule = ref(null)
  // The super instances entered, outermost first: from the root, or from the edited super-module.
  const enteredIds = ref([])
  const viewports = new Map()
  let history = null
  let fitView = () => flow.fitView?.({ padding: 0.2 })
  // Bumped by each navigation, so a fit waiting for the last level's nodes to be measured gives up.
  let navigation = 0

  const isAtRoot = computed(() => scope.value === null)
  const isEditingSupermodule = computed(() => editedSupermodule.value !== null)
  // The super instances entered from the root, which pick one copy of each module shown; none while editing a super-module.
  const instancePath = computed(() => (isEditingSupermodule.value ? [] : [...enteredIds.value]))

  /**
   * The breadcrumb: the edited super-module, if any (instanceId null), then each super instance entered, as `{smId,
   * instanceId, name, supermoduleName, supermoduleLabel, count, occurrences}` (see SupermoduleEntry). Read from the
   * store, so a rename shows at once.
   */
  const path = computed(() => {
    const entry = (smId, instanceId, name) => {
      const supermodule = findSupermodule(smId)
      return {
        smId,
        instanceId,
        name,
        supermoduleName: supermodule?.name ?? smId,
        supermoduleLabel: supermodule?.label ?? smId,
        count: supermodule?.count ?? 0,
        occurrences: supermodule?.occurrences ?? 0,
      }
    }
    const edited = editedSupermodule.value
    const entries = edited ? [entry(edited, null, findSupermodule(edited)?.name ?? edited)] : []
    for (const id of enteredIds.value) {
      const node = findStoreNode(id)
      entries.push(entry(node?.data?.smId, id, node?.data?.name ?? id))
    }
    return entries
  })

  /** @returns {string|null} The scope a level shows. */
  const scopeOfLevel = (base, ids) => (ids.length ? (findStoreNode(ids.at(-1))?.data?.smId ?? null) : base)

  /**
   * Whether a level can be shown: its super-module exists, and each super instance entered is in the scope before it.
   *
   * @param {string|null} base
   * @param {string[]} ids
   * @returns {boolean}
   */
  function isValidLevel(base, ids) {
    if (base !== null && !findSupermodule(base)) return false
    let within = base
    for (const id of ids) {
      const node = findStoreNode(id)
      if (!isSuperInstance(node) || scopeOf(node) !== within || !findSupermodule(node.data.smId)) return false
      within = node.data.smId
    }
    return true
  }

  /** Hides what isn't in the scope shown, and shows what is; a node hidden is also deselected. */
  function syncVisibility() {
    applyVisibility(allNodes(), allEdges(), scope.value, { deselect: true })
  }

  /**
   * Sets `hidden` on a flow object's nodes and edges for the scope shown, before it is loaded, so the nodes of other
   * scopes are never drawn.
   *
   * @param {{nodes?: Array, edges?: Array}} flowObject - As fromObject takes; its nodes and edges are copied.
   * @returns {Object} The flow object, nodes and edges copied.
   */
  function withVisibility(flowObject) {
    const nodes = (flowObject.nodes ?? []).map((node) => ({ ...node }))
    const edges = (flowObject.edges ?? []).map((edge) => ({ ...edge }))
    applyVisibility(nodes, edges, scope.value)
    return { ...flowObject, nodes, edges }
  }

  /** @returns {boolean} Whether a node is in the scope shown. */
  const isShown = (node) => scopeOf(node) === scope.value

  // An edit can change the super-module of a super instance entered, as Make unique does and its undo puts back: the canvas
  // follows, showing the level's scope as it is now.
  watch(
    () => (isValidLevel(editedSupermodule.value, enteredIds.value) ? scopeOfLevel(editedSupermodule.value, enteredIds.value) : scope.value),
    (next) => {
      if (next === scope.value) return
      const follow = () => {
        scope.value = next
        syncVisibility()
      }
      const recorder = history ?? (flowId === FLOW_IDS.MAIN ? useFlowHistoryStore() : null)
      if (recorder) recorder.withoutHistory(follow)
      else follow()
    }
  )

  /** Deselects every node and edge, those off the canvas too. */
  function deselectAll() {
    for (const node of allNodes()) if (node.selected) node.selected = false
    for (const edge of allEdges()) if (edge.selected) edge.selected = false
    if (flow.nodesSelectionActive) flow.nodesSelectionActive.value = false
  }

  /** @returns {Object} The viewport now. */
  const currentViewport = () => {
    const { x, y, zoom } = flow.viewport?.value ?? flow.getViewport?.() ?? { x: 0, y: 0, zoom: 1 }
    return { x, y, zoom }
  }

  /** Shows a scope's remembered viewport, or fits its nodes once they are measured. */
  function showViewport(key) {
    const saved = viewports.get(key)
    if (saved) {
      flow.setViewport?.(saved)
      return
    }
    const token = navigation
    nextTick(() => {
      if (token !== navigation) return
      const shown = allNodes().filter(isShown)
      if (shown.every((node) => node.dimensions?.width && node.dimensions?.height)) {
        fitView()
        return
      }
      const listener = flow.onNodesInitialized?.(() => {
        listener.off()
        if (token === navigation) fitView()
      })
    })
  }

  /**
   * Shows a level: remembers this scope's viewport, deselects everything, shows the level's nodes and hides the rest,
   * and shows its viewport. Not an undo step.
   *
   * @param {string|null} base - The super-module edited on its own, or null from the root.
   * @param {string[]} ids - The super instances entered.
   * @param {Object} [options]
   * @param {boolean} [options.restoreViewport=true] - False when the caller moves the view itself.
   * @returns {boolean} Whether the level changed.
   */
  function navigate(base, ids, { restoreViewport = true } = {}) {
    const entered = enteredIds.value
    const isSame = ids.length === entered.length && ids.every((id, i) => id === entered[i])
    if (base === editedSupermodule.value && isSame) return false
    const go = () => {
      navigation++
      viewports.set(scope.value ?? ROOT, currentViewport())
      deselectAll()
      editedSupermodule.value = base
      enteredIds.value = [...ids]
      scope.value = scopeOfLevel(base, ids)
      syncVisibility()
      if (restoreViewport) showViewport(scope.value ?? ROOT)
    }
    const recorder = history ?? (flowId === FLOW_IDS.MAIN ? useFlowHistoryStore() : null)
    if (recorder) recorder.withoutHistory(go)
    else go()
    return true
  }

  /**
   * Opens a super instance on the canvas, which then shows its super-module's nodes.
   *
   * @param {string} superInstanceId - A super instance on the canvas.
   * @returns {boolean} Whether it was opened.
   */
  function enter(superInstanceId) {
    const node = findStoreNode(superInstanceId)
    if (!isSuperInstance(node) || !isShown(node) || !findSupermodule(node.data.smId)) return false
    if (path.value.some((entry) => entry.smId === node.data.smId)) return false
    return navigate(editedSupermodule.value, [...enteredIds.value, superInstanceId])
  }

  /**
   * Shows a super-module on its own, not through any one super instance of it.
   *
   * @param {string} smId
   * @returns {boolean} Whether it is shown.
   */
  function editSupermodule(smId) {
    if (!findSupermodule(smId)) return false
    return navigate(smId, [])
  }

  /**
   * Goes back to a breadcrumb entry: 0 is the root, n keeps the first n entries.
   *
   * @param {number} depth
   * @returns {boolean} Whether the level changed.
   */
  function exitTo(depth) {
    if (depth <= 0) return navigate(null, [])
    if (!editedSupermodule.value) return navigate(null, enteredIds.value.slice(0, depth))
    return navigate(editedSupermodule.value, enteredIds.value.slice(0, depth - 1))
  }

  /** Goes up one level. @returns {boolean} Whether it moved. */
  const exitOne = () => !isAtRoot.value && exitTo(path.value.length - 1)

  /**
   * Shows the scope a model node is in, entering the super instances it is expanded through from the root.
   *
   * @param {string[]} instanceChain - The super instances' store ids, outermost first (see useModelGraph's origin).
   * @param {Object} [options] - As navigate's.
   * @returns {boolean} Whether the level changed.
   */
  function showInstanceChain(instanceChain, options) {
    if (!isValidLevel(null, instanceChain)) return false
    return navigate(null, instanceChain, options)
  }

  /** Puts the canvas back at the root and forgets the viewports remembered, as a workspace is cleared or loaded. */
  function reset() {
    navigation++
    viewports.clear()
    editedSupermodule.value = null
    enteredIds.value = []
    scope.value = null
    syncVisibility()
  }

  /** @returns {Object} The root's viewport: the one now at the root, else the one it had when the canvas left it. */
  const rootViewport = () => (isAtRoot.value ? currentViewport() : (viewports.get(ROOT) ?? currentViewport()))

  /**
   * Where the canvas is, for history: the scope shown, the super-module edited on its own, and the super instances entered.
   *
   * @returns {{scope: string|null, supermodule: string|null, instancePath: string[]}}
   */
  const captureContext = () => ({
    scope: scope.value,
    supermodule: editedSupermodule.value,
    instancePath: [...enteredIds.value],
  })

  /**
   * Goes back to a captured level, or as near as the store still allows: the super-module on its own, else the root.
   *
   * @param {ReturnType<typeof captureContext>} context
   */
  function restoreContext(context) {
    if (!context) return
    if (isValidLevel(context.supermodule, context.instancePath)) navigate(context.supermodule, context.instancePath)
    else if (context.scope && findSupermodule(context.scope)) navigate(context.scope, [])
    else navigate(null, [])
  }

  /**
   * Records commands with where they were made, and has undo and redo go back there first, through this history.
   *
   * @param {Object} recorder - The workspace's history store.
   */
  function bindHistory(recorder) {
    history = recorder
    recorder.setContextHandlers?.({ capture: captureContext, restore: restoreContext })
  }

  /** @param {Function} fit - Fits the view to the nodes shown, as the workspace frames them. */
  const setFitView = (fit) => (fitView = fit)

  // Entered from the root, the canvas shows one copy of each module; edited on its own, a super-module shows them all.
  const within = () => (isEditingSupermodule.value ? null : enteredIds.value)

  /**
   * Gets the model nodes some canvas nodes stand for, through the super instances entered: a module once, a super instance every
   * module it expands to.
   *
   * @param {Iterable<string>} ids - Store ids of canvas nodes.
   * @returns {string[]} Model ids, in the model's order.
   */
  const modelIdsOf = (ids) => model.expandSelection([...ids], within())

  // The canvas selection as the model nodes it stands for.
  const selectedModelIds = computed(() => modelIdsOf(selectedNodes.value.map((node) => node.id)))

  /**
   * The store ids of the canvas nodes whose model nodes (see modelIdsOf) the shown results simulate, worked out once for
   * every card: each simulated model node's own node and the super instances it is expanded through, as entered.
   */
  const simulatedIds = computed(() => {
    const results = useSimulationResultsStore()
    const scopeNodeIds = results.results && results.scopeNodeIds
    if (!scopeNodeIds) return new Set()
    if (!model.isHierarchical.value) return new Set(scopeNodeIds)
    const entered = within()
    const ids = new Set()
    for (const modelId of scopeNodeIds) {
      const from = model.findModelNode(modelId) && model.graph.value.origin.get(modelId)
      if (!from || entered?.some((instanceId, level) => from.instanceChain[level] !== instanceId)) continue
      ids.add(from.mainId)
      from.instanceChain.forEach((instanceId) => ids.add(instanceId))
    }
    return ids
  })

  /**
   * Gets the canvas node a model node shows as at this level: itself, or the super instance on the canvas it is inside.
   *
   * @param {string} modelId
   * @returns {string|undefined} Undefined when it isn't at this level.
   */
  function canvasIdOf(modelId) {
    const from = model.graph?.value.origin.get(modelId)
    if (!from) return undefined
    const ids = [...from.instanceChain, from.mainId]
    const entered = enteredIds.value
    const matches = (start) => entered.every((id, i) => ids[start + i] === id)
    if (!editedSupermodule.value) return matches(0) ? ids[entered.length] : undefined
    // Edited on its own, the super-module's nodes show every super instance's copies.
    for (let start = 0; start < ids.length; start++) {
      const node = start > 0 ? findStoreNode(ids[start - 1]) : null
      const inEdited = start === 0 ? false : isSuperInstance(node) && node.data.smId === editedSupermodule.value
      if (inEdited && matches(start)) return ids[start + entered.length]
    }
    return undefined
  }

  return {
    scope,
    editedSupermodule,
    instancePath,
    isAtRoot,
    isEditingSupermodule,
    path,
    selectedModelIds,
    simulatedIds,
    enter,
    editSupermodule,
    exitTo,
    exitOne,
    showInstanceChain,
    reset,
    syncVisibility,
    withVisibility,
    isShown,
    rootViewport,
    captureContext,
    restoreContext,
    bindHistory,
    setFitView,
    modelIdsOf,
    canvasIdOf,
  }
}
