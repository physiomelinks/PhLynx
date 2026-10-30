import { computed, nextTick, onScopeDispose, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useAnnotationStore } from '../stores/annotationStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useCouplingContext } from './useCouplingContext'
import { coordOf, isLocatedNode, portsForCouplings } from '../services/annotations/couple'
import {
  groupPairs,
  instanceQuantities,
  pairQuantities,
  resolveFacing,
  suggestionKey,
} from '../services/annotations/match'
import { FLOW_IDS, edgeLineOptions as defaultEdgeLineOptions } from '../utils/constants'
import { findMostCentralGhostHandle, getHandleId } from '../utils/handles'
import { cyrb53 } from '../utils/misc'
import { samePort } from '../utils/portIdentity'
import { facingSides, nodeRect, sidesByPreference } from '../utils/suggestionGeometry'

/**
 * The key a dismissed suggestion is kept under: its nodes' ApiCoord subjects, so it stays dismissed when the
 * instances are re-created from the same instance file, else their node ids.
 *
 * @param {{ sourceName: string, targetName: string }} suggestion - Names are node ids.
 * @param {(id: string) => Object|undefined} findNode
 * @returns {string}
 */
export function dismissKeyOf(suggestion, findNode) {
  const subjectOf = (id) => findNode(id)?.data?.apiCoord?.subject || id
  return suggestionKey(subjectOf(suggestion.sourceName), subjectOf(suggestion.targetName))
}

/**
 * Keeps the coupling suggestions in the suggestion store up to date with the workspace, and accepts or dismisses
 * them.
 *
 * Suggestions are derived, never saved or put in history: they are recomputed (debounced) from the bound nodes,
 * their sidecars, held-constant overlays, the edges' couplings and the dismissed keys. While an undo or redo runs,
 * recomputing waits and then runs once, so undoing an accept brings its suggestion back. Each node's quantities
 * are cached, and only new or changed nodes are paired against the rest.
 *
 * @param {Object} [options]
 * @param {Function} options.activateHandle - From useHandleManagement.
 * @param {Function} options.recordEdit - From useNodeDataHistory.
 * @param {Object} [options.edgeLineOptions] - Merged into accepted edges.
 * @param {number} [options.delay=150] - Debounce, in ms.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @returns {{ refresh: () => Promise<void>, accept: (suggestion: Object) => Promise<boolean>,
 *   acceptAll: () => Promise<number>, dismiss: (suggestion: Object) => void, dismissAll: () => void,
 *   restoreDismissed: () => void,
 *   lastRun: { full: boolean, paired: Array<string> }|null }}
 */
export function useCouplingSuggestions({
  activateHandle,
  recordEdit,
  edgeLineOptions = defaultEdgeLineOptions,
  delay = 150,
  flowId = FLOW_IDS.MAIN,
} = {}) {
  const { nodes, edges, findNode, addEdges } = useVueFlow(flowId)
  const annotationStore = useAnnotationStore()
  const libraryStore = useLibraryStore()
  const historyStore = useFlowHistoryStore()
  const suggestionStore = useSuggestionStore()
  const { ensureContext } = useCouplingContext()

  // name -> { coord, sidecar, held, quantities }, plus the pairs found, for pairing only what changed.
  let cache = null
  let runId = 0
  let timer = null
  let isWaitingForUndo = false
  const state = { lastRun: null }

  // Instance files by identity: a changed file is a new object.
  const sourceIds = new WeakMap()
  let nextSourceId = 0
  const sourceId = (source) => {
    if (!sourceIds.has(source)) sourceIds.set(source, ++nextSourceId)
    return sourceIds.get(source)
  }

  /** What the suggestions depend on, as text; empty when no node is bound, so nothing else is read. */
  const signature = computed(() => {
    const bound = nodes.value.filter((node) => node.data?.apiCoord?.coordIri)
    if (!bound.length || !annotationStore.instanceSources.length) return ''
    const hashes = new Map()
    const sidecarHash = (mathRef) => {
      if (!hashes.has(mathRef)) {
        const text = libraryStore.getModuleAnnotations(mathRef)
        hashes.set(mathRef, text ? cyrb53(text) : 0)
      }
      return hashes.get(mathRef)
    }
    const parts = bound.map(({ id, data }) =>
      [
        id,
        data.name,
        data.mathRef,
        data.apiCoord.coordIri,
        data.annotationOverlay?.heldConstant ? 1 : 0,
        sidecarHash(data.mathRef),
      ].join('|'),
    )
    for (const edge of edges.value) {
      const couplings = (edge.data?.couplings ?? []).map(
        ({ sourcePort, targetPort }) => `${sourcePort?.variables?.join(',')}>${targetPort?.variables?.join(',')}`,
      )
      parts.push(`${edge.id}|${edge.source}|${edge.target}|${couplings.join(';')}`)
    }
    parts.push(annotationStore.instanceSources.map(sourceId).join(','))
    parts.push([...annotationStore.dismissedSuggestions].join(','))
    return parts.join('\n')
  })

  function clear() {
    cache = null
    state.lastRun = null
    if (suggestionStore.suggestions.length || suggestionStore.conflicts.length || suggestionStore.dismissed.length) {
      suggestionStore.setSuggestions([])
    }
  }

  /** Recomputes the suggestions now, unless an undo or redo is running (then once it ends). */
  async function refresh() {
    clearTimeout(timer)
    timer = null
    if (historyStore.isUndoRedoing) {
      isWaitingForUndo = true
      return
    }
    const run = ++runId
    if (!signature.value) return clear()

    const candidates = nodes.value.filter(
      (node) => node.data?.apiCoord?.coordIri && libraryStore.getModuleAnnotations(node.data.mathRef),
    )
    if (!candidates.length) return clear()
    let context
    try {
      context = await ensureContext(candidates)
    } catch (error) {
      console.warn('Coupling suggestions unavailable:', error)
      return clear()
    }
    if (run !== runId) return
    if (historyStore.isUndoRedoing) {
      isWaitingForUndo = true
      return
    }
    compute(context)
  }

  /** Pairs the located nodes, reusing the cached quantities and pairs of unchanged nodes. */
  function compute(context) {
    const located = nodes.value.filter((node) => isLocatedNode(node, context))
    if (!located.length) return clear()
    const instances = located.map((node) => ({
      name: node.id,
      label: node.data.name ?? node.id,
      coord: coordOf(node, context),
      sidecar: context.sidecarFor(node.data.mathRef),
      held: !!node.data.annotationOverlay?.heldConstant,
    }))
    const byName = new Map(instances.map((instance) => [instance.name, instance]))
    // What a basolateral facet faces depends on every lyph, so a change there re-pairs everything.
    const facing = instances
      .filter((instance) => instance.coord.kind === 'lyph' && instance.coord.coalescedWith?.length)
      .map((instance) => `${instance.name}|${instance.label}`)
      .join(',')
    const full = !cache || cache.facing !== facing || cache.sources !== annotationStore.instanceSources

    const entries = new Map()
    const changed = new Set()
    for (const instance of instances) {
      const previous = full ? null : cache.entries.get(instance.name)
      if (
        previous &&
        previous.coord === instance.coord &&
        previous.sidecar === instance.sidecar &&
        previous.held === instance.held
      ) {
        entries.set(instance.name, previous)
        continue
      }
      changed.add(instance.name)
      entries.set(instance.name, {
        coord: instance.coord,
        sidecar: instance.sidecar,
        held: instance.held,
        quantities: instanceQuantities(instance, context, instance.held),
      })
    }

    const isKept = (name) => entries.has(name) && !changed.has(name)
    let pairs = []
    let conflicts = []
    if (!full) {
      pairs = cache.pairs.filter((pair) => isKept(pair.outer.instance) && isKept(pair.inner.instance))
      conflicts = cache.conflicts.filter((conflict) => isKept(conflict.a.instance) && isKept(conflict.b.instance))
    }
    if (changed.size) {
      const quantities = resolveFacing(
        [...entries.values()].flatMap((entry) => entry.quantities),
        instances,
      )
      const found = pairQuantities(quantities, full ? {} : { involving: changed })
      pairs = [...pairs, ...found.pairs]
      conflicts = [...conflicts, ...found.conflicts]
    }
    cache = { entries, pairs, conflicts, facing, sources: annotationStore.instanceSources }
    state.lastRun = { full, paired: [...changed] }

    const dismissedKeys = annotationStore.dismissedSuggestions
    const all = groupPairs(pairs, byName, { existingEdges: edges.value }).map((suggestion) => ({
      ...suggestion,
      dismissKey: dismissKeyOf(suggestion, findNode),
    }))
    suggestionStore.setSuggestions(
      all.filter((suggestion) => !dismissedKeys.has(suggestion.dismissKey)),
      conflicts,
      all.filter((suggestion) => dismissedKeys.has(suggestion.dismissKey)),
    )
  }

  function schedule() {
    if (historyStore.isUndoRedoing) {
      isWaitingForUndo = true
      return
    }
    clearTimeout(timer)
    timer = setTimeout(refresh, delay)
  }

  watch(signature, schedule, { immediate: true })
  watch(
    () => historyStore.isUndoRedoing,
    (isRunning) => {
      if (isRunning || !isWaitingForUndo) return
      isWaitingForUndo = false
      schedule()
    },
  )
  onScopeDispose(() => clearTimeout(timer))

  /** A free ghost handle on a node, on the given side if it has one, else the nearest side that does. */
  function freeHandle(node, side) {
    for (const candidate of sidesByPreference(side)) {
      const handle = findMostCentralGhostHandle(candidate, node.data.handles ?? [])
      if (handle) return handle
    }
    return null
  }

  /**
   * Accepts one suggestion inside the caller's batch: adds the ports it needs to both nodes as one recorded edit,
   * then merges its couplings into an edge already joining the nodes, or adds an edge on free ghost handles on
   * their facing sides.
   *
   * @param {Object} suggestion
   * @param {{ skipAmbiguous?: boolean }} [options]
   * @returns {Promise<boolean>} Whether anything was accepted.
   */
  async function acceptInBatch(suggestion, { skipAmbiguous = false } = {}) {
    const sourceNode = findNode(suggestion.sourceName)
    const targetNode = findNode(suggestion.targetName)
    if (!sourceNode || !targetNode) return false
    const wanted = skipAmbiguous ? suggestion.couplings.filter((coupling) => !coupling.ambiguous) : suggestion.couplings
    if (!wanted.length) return false

    const existing = edges.value.find(
      (edge) =>
        (edge.source === sourceNode.id && edge.target === targetNode.id) ||
        (edge.source === targetNode.id && edge.target === sourceNode.id),
    )
    const isReversed = !!existing && existing.source !== sourceNode.id
    const [edgeSource, edgeTarget] = isReversed ? [targetNode, sourceNode] : [sourceNode, targetNode]
    const oriented = wanted.map((coupling) =>
      isReversed ? { source: coupling.target, target: coupling.source } : coupling,
    )
    const { couplings, addedPorts } = portsForCouplings(edgeSource, edgeTarget, oriented)

    const nodeIds = [edgeSource.id, edgeTarget.id]
    await recordEdit({
      type: 'accept-suggestion',
      nodeIds,
      keys: ['ports'],
      edgeIds: existing ? [existing.id] : [],
      apply: () => {
        for (const id of nodeIds) {
          const added = addedPorts.get(id)
          const node = findNode(id)
          if (node && added?.length) node.data = { ...node.data, ports: [...(node.data.ports ?? []), ...added] }
        }
        if (existing) {
          const current = existing.data?.couplings ?? []
          const fresh = couplings.filter(
            (coupling) =>
              !current.some(
                (other) =>
                  samePort(other.sourcePort, coupling.sourcePort) && samePort(other.targetPort, coupling.targetPort),
              ),
          )
          existing.data = { ...existing.data, couplings: [...current, ...fresh] }
        }
      },
    })
    if (existing) return true

    const { sourceSide, targetSide } = facingSides(nodeRect(edgeSource), nodeRect(edgeTarget))
    const sourceHandle = freeHandle(edgeSource, sourceSide)
    const targetHandle = freeHandle(edgeTarget, targetSide)
    // Activated untracked: the edge's own history step reverts them to ghosts on undo and back on redo.
    if (sourceHandle) await activateHandle(edgeSource.id, sourceHandle.uid, { trackHistory: false })
    if (targetHandle) await activateHandle(edgeTarget.id, targetHandle.uid, { trackHistory: false })
    addEdges({
      ...edgeLineOptions,
      id: `${edgeSource.id}--${edgeTarget.id}`,
      source: edgeSource.id,
      target: edgeTarget.id,
      ...(sourceHandle ? { sourceHandle: getHandleId(sourceHandle) } : {}),
      ...(targetHandle ? { targetHandle: getHandleId(targetHandle) } : {}),
      data: { couplings },
    })
    return true
  }

  /**
   * Runs accepts as one undo step.
   *
   * @param {Array<Object>} suggestions
   * @param {{ skipAmbiguous?: boolean }} options
   * @returns {Promise<number>} How many were accepted.
   */
  async function acceptAsOneStep(suggestions, options) {
    if (!suggestions.length) return 0
    suggestionStore.remove(suggestions.map((suggestion) => suggestion.key))
    let accepted = 0
    historyStore.startBatch()
    try {
      for (const suggestion of suggestions) {
        if (await acceptInBatch(suggestion, options)) accepted += 1
      }
    } finally {
      // The edge changes land on the next tick; a failed accept still closes the batch.
      await nextTick()
      historyStore.endBatch()
      schedule()
    }
    return accepted
  }

  /**
   * Accepts a suggestion, ambiguous couplings included, as one undo step.
   *
   * @param {Object} suggestion
   * @returns {Promise<boolean>}
   */
  async function accept(suggestion) {
    return (await acceptAsOneStep([suggestion], {})) > 0
  }

  /**
   * Accepts every suggestion as one undo step, leaving out ambiguous couplings for the user to choose.
   *
   * @returns {Promise<number>} How many suggestions were accepted.
   */
  async function acceptAll() {
    return acceptAsOneStep([...suggestionStore.suggestions], { skipAmbiguous: true })
  }

  /**
   * Dismisses a suggestion. Not undoable; the dismissed key is saved with the workspace.
   *
   * @param {Object} suggestion
   */
  function dismiss(suggestion) {
    suggestionStore.remove([suggestion.key])
    annotationStore.dismissSuggestion(suggestion.dismissKey ?? dismissKeyOf(suggestion, findNode))
  }

  function dismissAll() {
    const suggestions = [...suggestionStore.suggestions]
    suggestionStore.remove(suggestions.map((suggestion) => suggestion.key))
    suggestions.forEach((suggestion) =>
      annotationStore.dismissSuggestion(suggestion.dismissKey ?? dismissKeyOf(suggestion, findNode)),
    )
  }

  /** Brings back the dismissed suggestions that apply to the workspace. Not undoable, as dismissing is not. */
  function restoreDismissed() {
    suggestionStore.dismissed.forEach((suggestion) => annotationStore.restoreSuggestion(suggestion.dismissKey))
  }

  return {
    refresh,
    accept,
    acceptAll,
    dismiss,
    dismissAll,
    restoreDismissed,
    get lastRun() {
      return state.lastRun
    },
  }
}
