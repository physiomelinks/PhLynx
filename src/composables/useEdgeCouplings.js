import { ref, computed } from 'vue'
import { TARGET_COMPATIBLE } from '../utils/constants'
import { detachReactivity } from '../utils/reactivity'
import { isSingleConnection } from '../utils/edges'
import { isCompatible, findPort } from '../utils/ports'
import { isMultiport } from '../utils/multiport'

export function useEdgeCouplings(props, askSwapIntent) {
  const localSrcPorts = ref([])
  const localTgtPorts = ref([])
  const localCouplings = ref([])
  const localSubgraph = ref(new Map())
  const portUsage = new Map()
  const takenElsewhereUids = ref(new Set())

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
    pruneInvalidConnections()
    autoConnect()
  }

  function evictForeignHandle(port, side) {
    const usage = portUsage.get(port._uid)
    if (!usage) return null

    const { edgeId } = usage
    const sibling = localSubgraph.value.get(edgeId)
    if (!sibling) return null

    const coupling = sibling.data?.couplings?.find(c => {
      const portToCheck = side === 'source' ? c.sourcePort : c.targetPort
      return portToCheck?.label === port.label &&
             portToCheck?.portType === port.portType &&
             JSON.stringify(portToCheck?.variables) === JSON.stringify(port.variables)
    })

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

    const newPort = {
      label: oldPort.label,
      portType: oldPort.portType,
      variables: oldPort.variables,
      multiportType: oldPort.multiportType,
      multiplyFactor: oldPort.multiplyFactor,
    }

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
    if (!sp || !tp || !sp.label || !tp.label) return couplings
    if (sp.label !== tp.label) return couplings
    if (!isCompatible(sp.portType, tp.portType)) return couplings
    if (couplings.some(c => c.srcUid === srcUid && c.tgtUid === tgtUid)) return couplings
    return [...couplings, { srcUid, tgtUid }]
  }

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

  function autoConnect() {
    for (const sp of localSrcPorts.value) {
      if (!sp.label || !sp.label.trim()) continue
      
      const srcUsedCount = localCouplings.value.filter(c => c.srcUid === sp._uid).length
      if (isSingleConnection(sp) && (srcUsedCount > 0 || takenElsewhereUids.value.has(sp._uid))) continue

      const compatibleTargets = localTgtPorts.value.filter(tp => {
        if (tp.label !== sp.label || !isCompatible(sp.portType, tp.portType)) return false
        
        const tgtUsedCount = localCouplings.value.filter(c => c.tgtUid === tp._uid).length
        if (isSingleConnection(tp) && (tgtUsedCount > 0 || takenElsewhereUids.value.has(tp._uid))) return false
        if (localCouplings.value.some(c => c.srcUid === sp._uid && c.tgtUid === tp._uid)) return false
        return true
      })

      for (const tp of compatibleTargets) {
        localCouplings.value.push({ srcUid: sp._uid, tgtUid: tp._uid })
        if (isSingleConnection(sp)) break
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
    portLookup,
    srcByUid,
    tgtByUid,
    connectedSrcUids,
    connectedTgtUids,
    initLocalState,
    evictHandle,
    swapConnections,
    connectPorts,
    deletePort,
    activateGhost,
    onPortConfigChange,
  }
}
