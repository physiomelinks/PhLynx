import { getHandleId, buildHandles, buildGhostHandles } from '../../utils/handles'
import { MAIN_NODE_TYPE, SOURCE_HANDLE_TYPE, TARGET_HANDLE_TYPE } from '../../utils/constants'
import { resolvePortCouplings, checkAndClaimCouplings } from '../../utils/edges'
import { getId as getNextNodeId } from '../../utils/nodes'
import { getPortVariables, reconcileRows } from '../math/reconcileRows'
import { isBlank } from '../../utils/variables'

/**
 * Builds an instance's variables from its math analysis, keeping the module's configured values
 * and filling the rest from the values taken out of its math.
 *
 * @param {Object} moduleData
 * @param {Object|null} mathAnalysis
 * @param {Map<string, string>} mathDefaults - From libraryStore.getMathDefaults.
 * @returns {Array} Parameter rows.
 */
function resolveInstanceVariables(moduleData, mathAnalysis, mathDefaults) {
  // A module's blank value means none was configured, so the math's default should fill it.
  const templateRows = (moduleData.variables ?? []).map((variable) =>
    isBlank(variable.value) ? { ...variable, value: null } : variable
  )
  if (mathAnalysis) {
    return reconcileRows(mathAnalysis, templateRows, {
      portVariables: getPortVariables(moduleData.ports),
      defaults: mathDefaults,
    })
  }
  return templateRows.map((variable) => ({
    ...variable,
    value: variable.value ?? mathDefaults.get(variable.name) ?? null,
  }))
}

export function buildInstance(
  nodeId,
  name,
  nodeType,
  moduleData,
  handles,
  position = null,
  mathAnalysis = null,
  mathDefaults = new Map()
) {
  const conditionalProperties = position 
    ? { position } 
    : { position: { x: 100, y: 100 }, style: { opacity: 0 } }

  return {
    id: nodeId,
    type: nodeType,
    ...conditionalProperties, 
    data: {
      name,
      mathRef: moduleData.mathRef,
      moduleRef: moduleData.moduleRef,
      variables: resolveInstanceVariables(moduleData, mathAnalysis, mathDefaults),
      ports: moduleData.ports,
      handles,
    },
  }
}

function buildInstances(instanceRefs, availableModules, getMathAnalysis, currentNodes, progressCallback, getMathDefaults) {
  const pendingInstances = []
  let nodeId = getNextNodeId(currentNodes.map((n) => n.id))

  instanceRefs.forEach((instanceRef, index) => {
    if (progressCallback) {
      progressCallback(index, instanceRefs.length, instanceRef.name)
    }

    const module = availableModules.get(`${instanceRef.module_type}:${instanceRef.module_subtype}`)
    if (!module) {
      console.warn(
        `No config found for module "${instanceRef.name}" ` +
          `(module_type: ${instanceRef.module_type}, module_subtype: ${instanceRef.module_subtype})`
      )
    }

    if (progressCallback && index === instanceRefs.length) {
      progressCallback(instanceRefs.length, instanceRefs.length, 'Building connections...')
    }

    const nodeType = MAIN_NODE_TYPE
    const ghostHandles = buildGhostHandles()
    const handles = buildHandles(instanceRef, ghostHandles)
    
    let position = null
    if (instanceRef.x !== undefined && instanceRef.y !== undefined) {
      position = { x: instanceRef.x, y: instanceRef.y }
    }

    const mathAnalysis = module ? getMathAnalysis?.(module.mathRef) ?? null : null
    const mathDefaults = (module && getMathDefaults?.(module.mathRef)) ?? new Map()
    pendingInstances.push(
      buildInstance(nodeId, instanceRef.name, nodeType, module, handles, position, mathAnalysis, mathDefaults)
    )

    nodeId = getNextNodeId([nodeId])
  })

  return pendingInstances
}

function buildEdges(instanceRefs, pendingInstances) {

  const pendingEdges = []

  const nodeMap = new Map(pendingInstances.map((n) => [n.data.name, n]))

  // Tracks consumed single-connection port label slots across all edges built so far.
  // Populated via checkAndClaimCouplings; see portCouplings.js for key format.
  const usedPortKeys = new Set()

  // For each target node, track how many times it has been connected to as a
  // target so far — this is its inp_modules ordinal index for the next edge.
  const targetInboundCount = new Map()

  instanceRefs.forEach((instanceRef) => {

    if (!instanceRef.out_instances) return

    const sourceNode = nodeMap.get(instanceRef.name)

    if (!sourceNode || sourceNode.data.error) return

    const targets = instanceRef.out_instances.split(' ').filter((t) => t.trim())
    targets.forEach((targetName, sourceIndex) => {
      const targetNode = nodeMap.get(targetName)
      if (!targetNode || targetNode.data.error) return

      const sourceHandle = sourceNode.data.handles.find(
        (p) => p.type === SOURCE_HANDLE_TYPE && p.name === targetName
      )

      const targetHandle = targetNode.data.handles.find(
        (p) => p.type === TARGET_HANDLE_TYPE && p.name === instanceRef.name
      )

      if (!sourceHandle || !targetHandle) {
        console.warn(
          `[buildEdges] Could not find matching handles between "${instanceRef.name}" and "${targetName}" — skipping.`
        )
        return
      }

      // how many times this target node has already been connected
      // to as a target. 
      const targetIndex = targetInboundCount.get(targetName) ?? 0

      // Resolve the specific port couplings for this conduit edge, taking
      // ordinal position into account for repeated same-label slots.
      const couplings = resolvePortCouplings(
        sourceNode.data.ports ?? [],
        targetNode.data.ports ?? [],
        sourceIndex,
        targetIndex,
      )

      if (couplings.length === 0) {
        console.warn(
          `[buildEdges] No compatible port label matches between "${instanceRef.name}" and "${targetName}" — conduit edge skipped.`
        )
        return
      }

      // Enforce the non-multiport single-connection constraint.
      // All-or-nothing: if any coupling violates it, the whole conduit is rejected.
      const { valid, conflicts } = checkAndClaimCouplings(
        instanceRef.name,
        targetName,
        couplings,
        usedPortKeys
      )

      if (!valid) {
        console.warn(
          `[buildEdges] Conduit "${instanceRef.name}" -> "${targetName}" rejected:\n` +
            conflicts.map((c) => `  • ${c}`).join('\n')
        )
        return
      }

      // Increment the target's inbound count only after a successful edge
      targetInboundCount.set(targetName, targetIndex + 1)

      pendingEdges.push({
        id: `${sourceNode.id}--${targetNode.id}`,
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: getHandleId(sourceHandle),
        targetHandle: getHandleId(targetHandle),
        data: {
          couplings,
        },
      })
    })
  })

  return pendingEdges
}

export function buildWorkflowGraph(
  instanceRefs,
  availableModules,
  getMathAnalysis,
  currentNodes,
  progressCallback = null,
  getMathDefaults = null
) {
  const pendingInstances = buildInstances(
    instanceRefs,
    availableModules,
    getMathAnalysis,
    currentNodes,
    progressCallback,
    getMathDefaults
  )
  const pendingEdges = buildEdges(instanceRefs, pendingInstances)
  return { pendingInstances, pendingEdges }
}
