import { ref, computed } from 'vue'
import { TARGET_COMPATIBLE } from '../utils/constants'
import { detachReactivity } from '../utils/reactivity'
import { carryDrivesState, comparableCouplings, isSingleConnection, resolvePortCouplings } from '../utils/edges'
import {
  canCouple,
  findPort,
  isAnnotatedPort,
  isCompatible,
  isHiddenPort,
  portDisplayName,
  portRef,
  samePort,
} from '../utils/ports'
import { notify } from '../utils/notify'
import { isMultiport } from '../utils/multiport'
import { mirrorAnnotation, mirroredPort } from '../services/annotations/couple'

/**
 * The edge dialog's local ports and couplings.
 *
 * @param {Object} props - sourceNode, targetNode, activeEdge, subgraph and ordinals.
 * @param {Function} askSwapIntent
 * @param {Object} [options]
 * @param {() => Object|undefined} [options.getContext] - The annotation context (see useCouplingContext); without
 *   one, annotated ports never couple.
 */
export function useEdgeCouplings(props, askSwapIntent, { getContext = () => undefined } = {}) {
  const localSrcPorts = ref([])
  const localTgtPorts = ref([])
  const localCouplings = ref([])
  const localSubgraph = ref(new Map())
  const portUsage = new Map()
  const takenElsewhereUids = ref(new Set())
  /** The payload as the dialog opened, couplings derived (see comparablePayload). */
  let openedPayload = null

  // Fast lookup Map to avoid sequential linear lookups
  const portLookup = computed(() => {
    const map = new Map()
    localSrcPorts.value.forEach(p => map.set(p._uid, { port: p, side: 'source' }))
    localTgtPorts.value.forEach(p => map.set(p._uid, { port: p, side: 'target' }))
    return map
  })

  const srcByUid = (uid) => portLookup.value.get(uid)?.port
  const tgtByUid = (uid) => portLookup.value.get(uid)?.port

  /** Whether a port is a manual one its side's annotated ports hide: kept, but never newly connected. */
  const isHidden = (port) => {
    const side = portLookup.value.get(port?._uid)?.side
    return !!side && isHiddenPort(port, side === 'source' ? localSrcPorts.value : localTgtPorts.value)
  }

  /** Whether a new connection may join a source port to a target port. */
  const canConnect = (sp, tp) =>
    !isHidden(sp) && !isHidden(tp) && canCouple(sp, props.sourceNode, tp, props.targetNode, getContext())

  /**
   * Whether a coupling may stay. One with an annotated port is kept while its port types fit, since only its
   * annotations, not its labels, made it; so is one through a hidden manual port while its labels still match.
   */
  const canKeep = (sp, tp) =>
    !!sp &&
    !!tp &&
    isCompatible(sp.portType, tp.portType) &&
    (isAnnotatedPort(sp) || isAnnotatedPort(tp) || canCouple(sp, props.sourceNode, tp, props.targetNode))

  const connectedSrcUids = computed(() => new Set(localCouplings.value.map(c => c.srcUid)))
  const connectedTgtUids = computed(() => new Set(localCouplings.value.map(c => c.tgtUid)))

  /** The ports a side lists: its active ones (see activePorts), and the hidden ones a coupling still uses. */
  const shownPorts = (ports, connected) => ports.filter((port) => !isHidden(port) || connected.has(port._uid))
  const visibleSrcPorts = computed(() => shownPorts(localSrcPorts.value, connectedSrcUids.value))
  const visibleTgtPorts = computed(() => shownPorts(localTgtPorts.value, connectedTgtUids.value))

  function stampUids(nodeId, labels) {
    return (labels || []).map((p) => ({
      ...p,
      _uid: p._uid || `${nodeId}_${crypto.randomUUID()}`,
    }))
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
    takenElsewhereUids.value = new Set(portUsage.keys())
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
    deriveCouplings()
    openedPayload = comparablePayload(buildPayload())
  }

  /**
   * Sets the edge's couplings to those its ports give (see resolvePortCouplings), the same as save and export
   * apply: the single-connection slots its couplings here name are kept, and those other edges hold are passed by.
   * Couplings with an annotated port, or through a hidden manual port, are kept while they still fit (see
   * canKeep), as labels can't recreate them. Call it after any change to the ports or the couplings.
   */
  function deriveCouplings() {
    const { sourceIndex = 0, targetIndex = 0 } = props.ordinals ?? {}
    const stored = localCouplings.value
      .map(({ srcUid, tgtUid }) => ({ sourcePort: srcByUid(srcUid), targetPort: tgtByUid(tgtUid) }))
      .filter(({ sourcePort, targetPort }) => sourcePort && targetPort)
    const held = new Set(
      [...localSrcPorts.value, ...localTgtPorts.value].filter((port) => takenElsewhereUids.value.has(port._uid))
    )
    const resolved = resolvePortCouplings(localSrcPorts.value, localTgtPorts.value, sourceIndex, targetIndex, {
      stored,
      held,
    })
    const kept = stored.filter(
      ({ sourcePort, targetPort }) =>
        (isAnnotatedPort(sourcePort) || isAnnotatedPort(targetPort) || isHidden(sourcePort) || isHidden(targetPort)) &&
        canKeep(sourcePort, targetPort)
    )
    localCouplings.value = [...resolved, ...kept].map(({ sourcePort, targetPort }) => ({
      srcUid: sourcePort._uid,
      tgtUid: targetPort._uid,
    }))
  }

  /**
   * The dialog's result: both nodes' ports, the edge's couplings and any sibling edges' changed couplings.
   *
   * @returns {{ sourceNodeId: string, targetNodeId: string, sourcePorts: Array, targetPorts: Array,
   *   couplings: Array, foreignCouplings: Object<string, Array> }}
   */
  function buildPayload() {
    const foreignCouplings = {}
    const activeEdgeId = props.activeEdge?.id
    for (const [edgeId, localEdge] of localSubgraph.value) {
      if (edgeId === activeEdgeId) continue
      const originalCouplings = props.subgraph?.get(edgeId)?.data?.couplings || []
      const localCouplingsArr = localEdge?.data?.couplings || []
      if (JSON.stringify(originalCouplings) !== JSON.stringify(localCouplingsArr)) {
        foreignCouplings[edgeId] = localCouplingsArr
      }
    }

    const couplings = localCouplings.value.map((c) => {
      const sp = srcByUid(c.srcUid)
      const tp = tgtByUid(c.tgtUid)
      return { sourcePort: { _uid: sp._uid, ...portRef(sp) }, targetPort: { _uid: tp._uid, ...portRef(tp) } }
    })

    return {
      sourceNodeId: props.sourceNode.id,
      targetNodeId: props.targetNode.id,
      sourcePorts: detachReactivity(localSrcPorts.value),
      targetPorts: detachReactivity(localTgtPorts.value),
      // A coupling already set to drive a store keeps doing so.
      couplings: carryDrivesState(props.activeEdge?.data?.couplings ?? [], couplings),
      foreignCouplings,
    }
  }

  /** Whether a payload leaves everything as the dialog opened, ports, couplings and siblings alike. */
  const isUnchanged = (payload) => openedPayload !== null && comparablePayload(payload) === openedPayload

  /**
   * Whether the couplings the edge stores differ from those derived when the dialog opened, e.g. from an older
   * save or ports whose variables changed since.
   */
  function storedDiffers() {
    if (openedPayload === null) return false
    const stored = props.activeEdge?.data?.couplings ?? []
    return JSON.stringify(comparableCouplings(stored)) !== JSON.parse(openedPayload).couplings
  }

  function evictForeignHandle(port, side) {
    const usage = portUsage.get(port._uid)
    if (!usage) return null

    const { edgeId } = usage
    const sibling = localSubgraph.value.get(edgeId)
    if (!sibling) return null

    const coupling = sibling.data?.couplings?.find(c => samePort(side === 'source' ? c.sourcePort : c.targetPort, port))

    const partnerPortLabel = side === 'source' ? coupling?.targetPort : coupling?.sourcePort
    const partnerPort = side === 'source'
      ? findPort(localTgtPorts.value, partnerPortLabel)
      : findPort(localSrcPorts.value, partnerPortLabel)

    sibling.data = {
      ...sibling.data,
      couplings: sibling.data.couplings.filter(c => c !== coupling),
    }
    portUsage.delete(port._uid)

    return { partnerUid: partnerPort?._uid ?? null, partnerPort, edgeId }
  }

  async function evictHandle(port, nodeUid, side, newCouplings) {
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
        takenElsewhereUids.value = new Set(portUsage.keys())
      }
    }
    return newCouplings
  }

  async function swapConnections(port, oldUid, newUid, side, couplings) {
    const localConn = couplings.find((c) => (side === 'source' ? c.srcUid : c.tgtUid) === newUid)
    
    if (!localConn) {
      if (isSingleConnection(port) && takenElsewhereUids.value.has(newUid)) {
        const intent = await askSwapIntent(true)
        if (intent === 'cancel') return null
        const result = evictForeignHandle(port, side)
        takenElsewhereUids.value = new Set(portUsage.keys())
        if (result && intent === 'swap') {
          const { partnerPort, edgeId } = result
          const oldPort = side === 'target' ? tgtByUid(oldUid) : srcByUid(oldUid)
          if (oldPort) rehomeForeignHandle(oldPort, partnerPort, edgeId, side)
          takenElsewhereUids.value = new Set(portUsage.keys())
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

  function rehomeForeignHandle(oldPort, partnerPort, edgeId, side) {
    const sibling = localSubgraph.value.get(edgeId)
    if (!sibling) return

    const newPort = portRef(oldPort)

    const newCoupling = side === 'source'
      ? { sourcePort: newPort, targetPort: partnerPort }
      : { sourcePort: partnerPort, targetPort: newPort }

    sibling.data = {
      ...sibling.data,
      couplings: [...(sibling.data?.couplings || []), newCoupling],
    }

    portUsage.set(oldPort._uid, { edgeId, ports: newPort })
  }

  function connectPorts(srcUid, tgtUid, couplings) {
    const sp = srcByUid(srcUid)
    const tp = tgtByUid(tgtUid)
    if (!canConnect(sp, tp)) return couplings
    if (couplings.some(c => c.srcUid === srcUid && c.tgtUid === tgtUid)) return couplings
    return [...couplings, { srcUid, tgtUid }]
  }

  function deletePort(uid, side) {
    if (side === 'source') {
      localSrcPorts.value = localSrcPorts.value.filter(p => p._uid !== uid)
    } else {
      localTgtPorts.value = localTgtPorts.value.filter(p => p._uid !== uid)
    }
    deriveCouplings()
  }

  /**
   * Adds a new port on one side, shaped to couple with a partner port on the other. A copy of an annotated
   * partner mirrors its annotation (see mirrorAnnotation), with no label and its variable left to pick.
   *
   * @param {'source'|'target'} side
   * @param {Object} [inferFrom] - The partner port.
   * @returns {Object|null} The new port, or null when none could be made.
   */
  function activateGhost(side, inferFrom = null) {
    const uid = `new_${side}_${crypto.randomUUID()}`
    let portType = 'general_ports'

    if (side === 'target') {
      portType = inferFrom?.portType === 'exit_ports' ? 'entrance_ports' : 'general_ports'
    } else if (side === 'source') {
      portType = inferFrom?.portType === 'entrance_ports' ? 'exit_ports' : 'general_ports'
    } else {
      return null
    }

    const [node, ports, partnerNode] =
      side === 'source'
        ? [props.sourceNode, localSrcPorts.value, props.targetNode]
        : [props.targetNode, localTgtPorts.value, props.sourceNode]
    const annotation = isAnnotatedPort(inferFrom)
      ? mirrorAnnotation(inferFrom, partnerNode, node, getContext(), ports)
      : null
    // Before the partner has a place (its side-car still parsing, or it is not placed) a copy would have no place
    // to couple at, ever, so none is made.
    if (isAnnotatedPort(inferFrom) && !annotation?.location && !annotation?.absoluteLocation) {
      notify.warning({ message: `"${portDisplayName(inferFrom)}" has no place yet, so it can't be copied.` })
      return null
    }
    // A manual port would be hidden at once by the node's annotated ports, and could never connect.
    if (!annotation && ports.some(isAnnotatedPort)) {
      notify.warning({ message: `${node.data?.name ?? 'This instance'} connects only through its annotation ports.` })
      return null
    }
    const entry = annotation
      ? { _uid: uid, ...mirroredPort(annotation, portType) }
      : {
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
    return entry
  }

  function onPortConfigChange() {
    deriveCouplings()
  }

  return {
    localSrcPorts,
    localTgtPorts,
    visibleSrcPorts,
    visibleTgtPorts,
    isHidden,
    localCouplings,
    localSubgraph,
    takenElsewhereUids,
    portLookup,
    srcByUid,
    tgtByUid,
    connectedSrcUids,
    connectedTgtUids,
    initLocalState,
    deriveCouplings,
    evictHandle,
    swapConnections,
    connectPorts,
    canConnect,
    canKeep,
    deletePort,
    activateGhost,
    onPortConfigChange,
    buildPayload,
    isUnchanged,
    storedDiffers,
  }
}

const withoutUid = (ports) => (ports ?? []).map(({ _uid, ...port }) => port)

/**
 * A payload as text for comparing: ports without their dialog uids, and couplings as comparableCouplings gives.
 *
 * @param {Object} payload - From buildPayload.
 * @returns {string}
 */
function comparablePayload(payload) {
  const foreign = Object.entries(payload.foreignCouplings ?? {})
    .map(([edgeId, couplings]) => [edgeId, comparableCouplings(couplings)])
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify({
    sourcePorts: JSON.stringify(withoutUid(payload.sourcePorts)),
    targetPorts: JSON.stringify(withoutUid(payload.targetPorts)),
    couplings: JSON.stringify(comparableCouplings(payload.couplings)),
    foreign: JSON.stringify(foreign),
  })
}
