import { useVueFlow } from '@vue-flow/core'
import { useWorkspaceAppearanceStore } from '../../stores/workspaceAppearanceStore'
import { FLOW_IDS, GHOST_NODE_TYPE } from '../../utils/constants'
import { generateUniqueInstanceName } from '../../utils/nodes'

// Helper to get the bounding width of the macro graph
function getGraphWidth(nodes) {
  if (!nodes.length) return 0

  // Find min X and max X (considering width)
  let minX = Infinity
  let maxX = -Infinity

  nodes.forEach((node) => {
    const x = node.position.x
    const w = node.dimensions?.width || node.width || 150 // Fallback width
    if (x < minX) minX = x
    if (x + w > maxX) maxX = x + w
  })

  return maxX - minX
}

function getId(i, idSet) {
  let num = 1
  while (true) {
    const candidateId = `macronode_${num}_iter_${i}`
    if (!idSet.has(candidateId)) {
      idSet.add(candidateId)
      return candidateId
    }
    num++
  }
}

export function useMacroGenerator() {
  const { addNodes, addEdges, getNodes } = useVueFlow(FLOW_IDS.MAIN)
  const appearanceStore = useWorkspaceAppearanceStore()

  /**
   * @param {Object} macroData - { flow: { nodes, edges, ... }, repeatCount: Number }
   * @param {Object} insertPosition - { x, y } where the first macro starts (e.g. center of screen)
   */
  const processMacroGeneration = (macroData, insertPosition = { x: 0, y: 0 }) => {
    const { flow, repeatCount } = macroData
    const sourceNodes = flow.nodes || []
    const sourceEdges = flow.edges || []

    if (sourceNodes.length === 0) return

    const realNodes = sourceNodes.filter((n) => n.type !== GHOST_NODE_TYPE)
    const ghostNodes = sourceNodes.filter((n) => n.type === GHOST_NODE_TYPE)

    const MACRO_WIDTH = getGraphWidth(sourceNodes)
    const MARGIN_X = 100 // Gap between iterations

    // We prepare arrays to batch-add everything at the end for performance
    const internalEdges = []
    const chainingEdges = [] // Edges connected to a ghost.

    sourceEdges.forEach((edge) => {
      const isTargetGhost = ghostNodes.find((g) => g.id === edge.target)
      if (isTargetGhost) {
        chainingEdges.push({
          ...edge,
          targetGhostId: edge.target, // Keep track of which ghost it hit.
        })
      } else {
        internalEdges.push(edge)
      }
    })

    const newNodes = []
    const newEdges = []

    const idSet = new Set() // To track unique IDs.
    const namesSet = new Set()
    getNodes.value.forEach((node) => {
      namesSet.add(node.data.name)
      if (node.id.startsWith('macronode_')) {
        idSet.add(node.id)
      }
    })

    const createdInstances = []
    for (let i = 0; i < repeatCount; i++) {
      const idMap = new Map() // Maps "Old ID" -> "New Unique ID" for this iteration.

      // Process nodes.
      realNodes.forEach((node) => {
        // Generate a unique ID.
        const newId = getId(i, idSet)
        idMap.set(node.id, newId)

        // Calculate shift.
        const xOffset = i * (MACRO_WIDTH + MARGIN_X)

        const finalName = generateUniqueInstanceName(node.data.name, namesSet)
        namesSet.add(finalName)

        newNodes.push({
          id: newId,
          data: {
            ...node.data,
            name: finalName,
          },
          type: node.type,
          position: {
            // Relocate relative to the insertion point.
            x: insertPosition.x + node.position.x + xOffset - (repeatCount * MACRO_WIDTH) / 2,
            y: insertPosition.y + node.position.y,
          },
          selected: true,
        })
      })

      createdInstances.push(idMap)

      internalEdges.forEach((edge) => {
        const newSource = idMap.get(edge.source)
        const newTarget = idMap.get(edge.target)

        // Only add edge if both source/target exist in this iteration.
        if (newSource && newTarget) {
          newEdges.push({
            ...edge,
            id: `edge_${newSource}_to_${newTarget}`,
            source: newSource,
            target: newTarget,
            selected: false,
          })
        }
      })
      if (i > 0) {
        const prevInstanceMap = createdInstances[i - 1]
        const currentInstanceMap = createdInstances[i]

        chainingEdges.forEach((chainEdge) => {
          // Find the Ghost Node this edge was pointing to.
          const ghostNode = ghostNodes.find((g) => g.id === chainEdge.targetGhostId)

          // Find who the Ghost was mimicking (e.g., Node A).
          const originalTargetId = ghostNode.data.targetNodeId

          // Connect:
          // Source: The node from Previous Iteration
          // Target: The node from Current Iteration (the one the Ghost mimicked)
          newEdges.push({
            id: `chain_${i}_${crypto.randomUUID()}`,
            source: prevInstanceMap.get(chainEdge.source), // Source from Prev
            sourceHandle: chainEdge.sourceHandle,
            target: currentInstanceMap.get(originalTargetId), // Target from Curr
            targetHandle: chainEdge.targetHandle,
          })
        })
      }
    }

    // Batch add nodes and edges to the Main Flow.
    addNodes(newNodes)
    addEdges(appearanceStore.withConnectionDefaults(newEdges))
  }

  return { processMacroGeneration }
}
