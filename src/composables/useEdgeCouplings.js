import { ref, computed, watch, getCurrentScope, onScopeDispose } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { FLOW_IDS } from '../utils/constants'
import { detachReactivity } from '../utils/reactivity'
import { caSlotGroups, isSingleConnection, portKey, slotOf } from '../utils/edges'
import { scopeOf } from '../utils/hierarchy'
import { exposedSlotKeys } from '../services/hierarchy/exposure'
import { isCompatible, findPort, SOURCE_PORT_TYPES, TARGET_PORT_TYPES, variableCount, VESSEL_PORT } from '../utils/ports'
import { couplingProblems, pairingRefusal } from '../services/coupling/caReproducible'
import { isMultiport } from '../utils/multiport'

// How long the dialog waits after an edit before checking its couplings again, so typing doesn't re-expand the model.
export const PROBLEM_DELAY_MS = 150

export function useEdgeCouplings(props, askSwapIntent) {
  const localSrcPorts = ref([])
  const localTgtPorts = ref([])
  const localCouplings = ref([])
  const localSubgraph = ref(new Map())
  const portUsage = new Map()
  const takenElsewhereUids = ref(new Set())
  // What CA would pair otherwise with the couplings and ports as they are here (see couplingProblems), each with the
  // local ports it is on.
  const problems = ref([])
  // Why the last pairing tried here was refused, or null.
  const refusal = ref(null)
  let initialised = false
  let problemTimer = null
  // The single-connection ports a super-module exposes, held from outside it: never evicted, as no edge here holds them.
  const exposedUids = new Set()
  // The workspace, whose exposure edges say which of a super-module's ports are exposed.
  const workspace = useVueFlow(FLOW_IDS.MAIN)

  // Fast lookup Map to avoid sequential linear lookups
  const portLookup = computed(() => {
    const map = new Map()
    localSrcPorts.value.forEach(p => map.set(p._uid, { port: p, side: 'source' }))
    localTgtPorts.value.forEach(p => map.set(p._uid, { port: p, side: 'target' }))
    return map
  })

  const srcByUid = (uid) => portLookup.value.get(uid)?.port
  const tgtByUid = (uid) => portLookup.value.get(uid)?.port

  const connectedSrcUids = computed(() => new Set(localCouplings.value.map(c => c.srcUid)))
  const connectedTgtUids = computed(() => new Set(localCouplings.value.map(c => c.tgtUid)))

  function stampUids(nodeId, labels) {
    return (labels || []).map((p) => ({
      ...p,
      _uid: p._uid || `${nodeId}_${crypto.randomUUID()}`,
    }))
  }

  /** Marks taken the ports sibling edges hold, and those exposed. */
  const refreshTaken = () => {
    takenElsewhereUids.value = new Set([...portUsage.keys(), ...exposedUids])
  }

  function indexSiblingPorts() {
    portUsage.clear()
    const activeEdgeId = props.activeEdge?.id

    for (const [edgeId, edge] of localSubgraph.value) {
      if (edgeId === activeEdgeId) continue

      for (const { sourcePort, targetPort } of (edge.data?.couplings || [])) {
        if (edge.source === props.sourceNode.id) {
          const sp = findPort(localSrcPorts.value, sourcePort)
          if (sp) portUsage.set(sp._uid, { edgeId, portLabel: sourcePort })
        }
        if (edge.target === props.sourceNode.id) {
          const sp = findPort(localSrcPorts.value, targetPort)
          if (sp) portUsage.set(sp._uid, { edgeId, portLabel: targetPort })
        }
        if (edge.target === props.targetNode.id) {
          const tp = findPort(localTgtPorts.value, targetPort)
          if (tp) portUsage.set(tp._uid, { edgeId, portLabel: targetPort })
        }
        if (edge.source === props.targetNode.id) {
          const tp = findPort(localTgtPorts.value, sourcePort)
          if (tp) portUsage.set(tp._uid, { edgeId, portLabel: sourcePort })
        }
      }
    }
    indexExposedPorts()
    refreshTaken()
  }

  /** Records the ends' single-connection ports their super-module exposes, which a connection from outside takes. */
  function indexExposedPorts() {
    exposedUids.clear()
    const nodes = workspace.nodes?.value ?? []
    const edges = workspace.edges?.value ?? []
    const ends = [[props.sourceNode, localSrcPorts.value], [props.targetNode, localTgtPorts.value]]
    for (const [node, ports] of ends) {
      const scope = scopeOf(node)
      if (!scope) continue
      const held = exposedSlotKeys(nodes, edges, scope)
      for (const port of ports) {
        if (held.has(portKey(node.id, 'in', port, slotOf(ports, port)))) exposedUids.add(port._uid)
      }
    }
  }

  function initLocalState() {
    localSrcPorts.value = stampUids(
      props.sourceNode.id,
      detachReactivity(props.sourceNode?.data?.ports || [])
    )
    localTgtPorts.value = stampUids(
      props.targetNode.id,
      detachReactivity(props.targetNode?.data?.ports || [])
    )

    localSubgraph.value = new Map(
      [...(props.subgraph || [])].map(([edgeId, edge]) => [
        edgeId,
        detachReactivity(edge),
      ])
    )

    const activeEdgeSnapshot = localSubgraph.value.get(props.activeEdge?.id)
    const rawCouplings = activeEdgeSnapshot?.data?.couplings || []
    localCouplings.value = rawCouplings.flatMap(({ sourcePort, targetPort }) => {
      const src = findPort(localSrcPorts.value, sourcePort)
      const tgt = findPort(localTgtPorts.value, targetPort)
      return src && tgt ? [{ srcUid: src._uid, tgtUid: tgt._uid }] : []
    })

    indexSiblingPorts()
    pruneInvalidConnections()
    autoConnect()
    refusal.value = null
    initialised = true
    evaluateProblems()
  }

  function evictForeignHandle(port, side) {
    const usage = portUsage.get(port._uid)
    if (!usage) return null

    const { edgeId } = usage
    const sibling = localSubgraph.value.get(edgeId)
    if (!sibling) return null

    const coupling = sibling.data?.couplings?.find(c => {
      const portToCheck = side === 'source' ? c.sourcePort : c.targetPort
      // A super instance's port is the exposed port it names: two may share a label and variables.
      if (port.exposedPortId != null) return portToCheck?.exposedPortId === port.exposedPortId
      return portToCheck?.label === port.label &&
             portToCheck?.portType === port.portType &&
             JSON.stringify(portToCheck?.variables) === JSON.stringify(port.variables)
    })

    const partnerPortLabel = side === 'source' ? coupling?.targetPort : coupling?.sourcePort
    const partnerSlot = side === 'source' ? coupling?.targetSlot : coupling?.sourceSlot
    const partnerPort = side === 'source'
      ? findPort(localTgtPorts.value, partnerPortLabel)
      : findPort(localSrcPorts.value, partnerPortLabel)

    sibling.data = {
      ...sibling.data,
      couplings: sibling.data.couplings.filter(c => c !== coupling),
    }
    portUsage.delete(port._uid)

    return { partnerUid: partnerPort?._uid ?? null, partnerPort, partnerSlot, edgeId }
  }

  async function evictHandle(port, nodeUid, side, newCouplings) {
    if (exposedUids.has(nodeUid)) return null
    if (isSingleConnection(port)) {
      const localConn = newCouplings.find(c => (side === 'source' ? c.srcUid : c.tgtUid) === nodeUid)
      if (localConn) {
        const intent = await askSwapIntent(false)
        if (intent === 'cancel') return null
        newCouplings = newCouplings.filter(c => c !== localConn)
      } else if (takenElsewhereUids.value.has(nodeUid)) {
        const intent = await askSwapIntent(false)
        if (intent === 'cancel') return null
        evictForeignHandle(port, side)
      }
    }
    return newCouplings
  }

  async function swapConnections(port, oldUid, newUid, side, couplings) {
    const localConn = couplings.find((c) => (side === 'source' ? c.srcUid : c.tgtUid) === newUid)
    
    if (exposedUids.has(newUid)) return null
    if (!localConn) {
      if (isSingleConnection(port) && takenElsewhereUids.value.has(newUid)) {
        const intent = await askSwapIntent(true)
        if (intent === 'cancel') return null
        const result = evictForeignHandle(port, side)
        refreshTaken()
        if (result && intent === 'swap') {
          const { partnerPort, partnerSlot, edgeId } = result
          const oldPort = side === 'target' ? tgtByUid(oldUid) : srcByUid(oldUid)
          if (oldPort) rehomeForeignHandle(oldPort, partnerPort, partnerSlot, edgeId, side)
          refreshTaken()
        }
      }
      return couplings
    }

    if (!isSingleConnection(port)) {
      return couplings
    }

    const intent = await askSwapIntent(true)
    if (intent === 'cancel') return null

    const next = couplings.filter(c => c !== localConn)
    if (intent === 'overwrite') return next

    const swapSrcUid = side === 'target' ? localConn.srcUid : oldUid
    const swapTgtUid = side === 'target' ? oldUid : localConn.tgtUid
    
    return connectPorts(swapSrcUid, swapTgtUid, next)
  }

  function rehomeForeignHandle(oldPort, partnerPort, partnerSlot, edgeId, side) {
    const sibling = localSubgraph.value.get(edgeId)
    if (!sibling) return

    const newPort = {
      label: oldPort.label,
      portType: oldPort.portType,
      variables: oldPort.variables,
      multiportType: oldPort.multiportType,
      multiplyFactor: oldPort.multiplyFactor,
    }

    const slot = slotOf(side === 'source' ? localSrcPorts.value : localTgtPorts.value, oldPort)
    const newCoupling = side === 'source'
      ? { sourcePort: newPort, targetPort: partnerPort, sourceSlot: slot, targetSlot: partnerSlot }
      : { sourcePort: partnerPort, targetPort: newPort, sourceSlot: partnerSlot, targetSlot: slot }

    sibling.data = {
      ...sibling.data,
      couplings: [...(sibling.data?.couplings || []), newCoupling],
    }

    portUsage.set(oldPort._uid, { edgeId, ports: newPort })
  }

  /**
   * Says why CA can't pair two local ports on this edge beside its other couplings (see pairingRefusal); a port being
   * added, without variables yet, may pair.
   *
   * @param {string} srcUid
   * @param {string} tgtUid
   * @param {Array<{srcUid: string, tgtUid: string}>} couplings
   * @returns {string|null}
   */
  function refusalOf(srcUid, tgtUid, couplings) {
    const others = couplings
      .filter(c => !(c.srcUid === srcUid && c.tgtUid === tgtUid))
      .map(c => ({ sourcePort: srcByUid(c.srcUid), targetPort: tgtByUid(c.tgtUid) }))
    return pairingRefusal(srcByUid(srcUid), tgtByUid(tgtUid), others, { allowEmpty: true })
  }

  function connectPorts(srcUid, tgtUid, couplings) {
    const sp = srcByUid(srcUid)
    const tp = tgtByUid(tgtUid)
    if (!sp || !tp || !sp.label || !tp.label) return couplings
    if (sp.label !== tp.label) return couplings
    if (couplings.some(c => c.srcUid === srcUid && c.tgtUid === tgtUid)) return couplings
    const reason = refusalOf(srcUid, tgtUid, couplings)
    refusal.value = reason
    if (reason) return couplings
    return [...couplings, { srcUid, tgtUid }]
  }

  /**
   * Says why CA can't pair two local ports dragged together, before any port is evicted for them: beside the edge's
   * couplings but those it would replace, the pair being moved and those of a single-connection end.
   *
   * @param {string} srcUid
   * @param {string} tgtUid
   * @param {{srcUid: string, tgtUid: string}} [moving] - The coupling a drag moves, if any.
   * @returns {string|null}
   */
  function connectRefusal(srcUid, tgtUid, moving = null) {
    const sp = srcByUid(srcUid)
    const tp = tgtByUid(tgtUid)
    if (!sp || !tp) return null
    const kept = localCouplings.value.filter(
      (c) =>
        !(moving && c.srcUid === moving.srcUid && c.tgtUid === moving.tgtUid) &&
        !(isSingleConnection(sp) && c.srcUid === srcUid) &&
        !(isSingleConnection(tp) && c.tgtUid === tgtUid)
    )
    return refusalOf(srcUid, tgtUid, kept)
  }

  /** A coupling as the edge stores it, between two local ports. */
  function storedCoupling(sp, tp) {
    const stored = (port) => ({
      portType: port.portType,
      label: port.label,
      variables: port.variables,
      multiportType: port.multiportType,
      multiplyFactor: port.multiplyFactor,
      // A super instance's port is the exposed port it names, so it rebinds by id (see exposure.js)
      ...(port.exposedPortId != null && { exposedPortId: port.exposedPortId }),
    })
    return {
      sourcePort: stored(sp),
      targetPort: stored(tp),
      sourceSlot: slotOf(localSrcPorts.value, sp),
      targetSlot: slotOf(localTgtPorts.value, tp),
    }
  }

  /** @returns {Array} The edge's couplings as it would store them, in the order of localCouplings. */
  function pendingCouplings() {
    return localCouplings.value.map((c) => storedCoupling(srcByUid(c.srcUid), tgtByUid(c.tgtUid)))
  }

  /**
   * Checks the edge's couplings as they are here against CA's pairing (see couplingProblems): the workspace with the
   * ends' ports, this edge's couplings and the sibling edges' as edited here. Each problem gives the local ports it is
   * on: a coupling's two, or a label's on both ends when it concerns no one coupling of this edge.
   */
  function evaluateProblems() {
    clearTimeout(problemTimer)
    const activeId = props.activeEdge?.id
    if (!activeId || !props.sourceNode || !props.targetNode) {
      problems.value = []
      return
    }
    const couplings = pendingCouplings()
    const ends = new Map([[props.sourceNode.id, localSrcPorts.value], [props.targetNode.id, localTgtPorts.value]])
    const nodeById = new Map((workspace.nodes?.value ?? []).map((node) => [node.id, node]))
    for (const node of [props.sourceNode, props.targetNode]) if (!nodeById.has(node.id)) nodeById.set(node.id, node)
    const nodes = [...nodeById.values()].map((node) =>
      ends.has(node.id) ? { ...node, data: { ...node.data, ports: ends.get(node.id) } } : node
    )
    const edgeById = new Map((workspace.edges?.value ?? []).map((edge) => [edge.id, edge]))
    for (const [id, edge] of localSubgraph.value) edgeById.set(id, edge)
    const active = edgeById.get(activeId) ?? props.activeEdge
    edgeById.set(activeId, { ...active, data: { ...active.data, couplings } })

    const labelUids = (label) => [
      ...(caSlotGroups(localSrcPorts.value, SOURCE_PORT_TYPES).get(label) ?? []),
      ...(caSlotGroups(localTgtPorts.value, TARGET_PORT_TYPES).get(label) ?? []),
    ].map(({ port }) => port._uid)
    let found
    try {
      // Problems on other edges only count where the edit makes them: the workspace as stored is the baseline.
      const baseline = { nodes: [...nodeById.values()], edges: workspace.edges?.value ?? [] }
      found = couplingProblems(nodes, [...edgeById.values()], { edgeIds: [activeId], baseline })
    } catch (error) {
      // A model the check can't read, such as one mid-edit, blocks nothing.
      console.warn('Could not check the couplings against CA:', error)
      found = []
    }
    problems.value = found.map((problem) => {
      const pair = problem.coupling ? localCouplings.value[couplings.indexOf(problem.coupling)] : null
      const uids = pair ? [pair.srcUid, pair.tgtUid] : problem.edgeId === activeId && problem.label != null ? labelUids(problem.label) : []
      return { ...problem, uids, pair: pair ?? null }
    })
  }

  // Checks again a moment after the couplings or ports change here.
  watch(
    () => [localCouplings.value, localSrcPorts.value, localTgtPorts.value, localSubgraph.value],
    () => {
      if (!initialised) return
      clearTimeout(problemTimer)
      problemTimer = setTimeout(evaluateProblems, PROBLEM_DELAY_MS)
    },
    { deep: true }
  )
  if (getCurrentScope()) onScopeDispose(() => clearTimeout(problemTimer))

  function pruneInvalidConnections() {
    localCouplings.value = localCouplings.value.filter(c => {
      const sp = srcByUid(c.srcUid)
      const tp = tgtByUid(c.tgtUid)
      return sp && tp && sp.label === tp.label && isCompatible(sp.portType, tp.portType)
    })

    pruneSingleConnectionSide(localSrcPorts.value, 'source')
    pruneSingleConnectionSide(localTgtPorts.value, 'target')
  }

  function pruneSingleConnectionSide(ports, side) {
    const uidKey = side === 'source' ? 'srcUid' : 'tgtUid'
    for (const port of ports) {
      if (!isSingleConnection(port)) continue
      if (takenElsewhereUids.value.has(port._uid)) {
        localCouplings.value = localCouplings.value.filter(c => c[uidKey] !== port._uid)
      } else {
        const mine = localCouplings.value.filter(c => c[uidKey] === port._uid)
        if (mine.length > 1) {
          localCouplings.value = localCouplings.value.filter(c => c[uidKey] !== port._uid || c === mine[0])
        }
      }
    }
  }

  /**
   * Couples each label both ends share and the edge leaves uncoupled, as CA would (see resolvePortCouplings): each
   * side's first free slot in CA's group order, exit or entrance before general; a vessel_port one slot to one, any
   * other label each free source slot into the target's slot while that takes more than one. Ports with different
   * numbers of variables are left for the user.
   */
  function autoConnect() {
    const isFree = (port, uidKey) =>
      !isSingleConnection(port) ||
      !(takenElsewhereUids.value.has(port._uid) || localCouplings.value.some(c => c[uidKey] === port._uid))
    const coupled = new Set(localCouplings.value.map(c => srcByUid(c.srcUid)?.label))
    const targetGroups = caSlotGroups(localTgtPorts.value, TARGET_PORT_TYPES)

    for (const [label, sources] of caSlotGroups(localSrcPorts.value, SOURCE_PORT_TYPES)) {
      if (!label || !label.trim() || coupled.has(label) || !targetGroups.has(label)) continue
      const target = targetGroups.get(label).find(({ port }) => isFree(port, 'tgtUid'))?.port
      const free = sources.map(({ port }) => port).filter(port => isFree(port, 'srcUid'))
      if (!target || !free.length) continue
      const pairsMany = label !== VESSEL_PORT && !isSingleConnection(target)
      for (const sp of pairsMany ? free : free.slice(0, 1)) {
        if (variableCount(sp) !== variableCount(target)) continue
        localCouplings.value.push({ srcUid: sp._uid, tgtUid: target._uid })
      }
    }
  }

  function deletePort(uid, side) {
    if (side === 'source') {
      localSrcPorts.value = localSrcPorts.value.filter(p => p._uid !== uid)
      localCouplings.value = localCouplings.value.filter(c => c.srcUid !== uid)
    } else {
      localTgtPorts.value = localTgtPorts.value.filter(p => p._uid !== uid)
      localCouplings.value = localCouplings.value.filter(c => c.tgtUid !== uid)
    }
  }

  function activateGhost(side, inferFrom = null) {
    const uid = `new_${side}_${crypto.randomUUID()}`
    let portType = 'general_ports'

    if (side === 'target') {
      portType = inferFrom?.portType === 'exit_ports' ? 'entrance_ports' : 'general_ports'
    } else if (side === 'source') {
      portType = inferFrom?.portType === 'entrance_ports' ? 'exit_ports' : 'general_ports'
    } else {
      return
    }

    const entry = {
      _uid: uid,
      portType,
      label: inferFrom?.label ?? '',
      variables: [],           
      // Multiport like its partner, its variables True until chosen: the partner's per-variable types don't fit.
      multiportType: inferFrom && isMultiport(inferFrom) ? 'True' : 'None',
    }

    if (side === 'source') {
      localSrcPorts.value.push(entry)
    } else {
      localTgtPorts.value.push(entry)
    }
  }

  function onPortConfigChange() {
    pruneInvalidConnections()
    autoConnect()
  }

  return {
    localSrcPorts,
    localTgtPorts,
    localCouplings,
    localSubgraph,
    takenElsewhereUids,
    problems,
    refusal,
    portLookup,
    srcByUid,
    tgtByUid,
    connectedSrcUids,
    connectedTgtUids,
    initLocalState,
    evictHandle,
    swapConnections,
    connectPorts,
    connectRefusal,
    pendingCouplings,
    evaluateProblems,
    deletePort,
    activateGhost,
    onPortConfigChange,
  }
}
