import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { parseLayout } from 'cellml-text-editor'
import { useLibraryStore } from '../stores/libraryStore'
import { separateNodeParameters } from '../services/workspaceMigrator'
import { FLOW_IDS } from '../utils/constants'
import { getId as getNextEdgeId } from '../utils/edges'
import { getId as getNextNodeId, generateUniqueInstanceName } from '../utils/nodes'
import { detachReactivity } from '../utils/reactivity'
import { withoutApiCoord } from '../services/annotations/nodeData'
import { reconcileNodePorts } from '../services/annotations/reconcileNodes'

/**
 * Whether a workspace keyboard shortcut should be left alone: the user is typing in an input, a dialog is
 * open (shortcuts would act on the workspace behind it), or focus is inside a CodeMirror editor, which edits
 * in a focusable div rather than an INPUT/TEXTAREA.
 *
 * @param {KeyboardEvent} event
 * @param {boolean} dialogOpen
 * @returns {boolean}
 */
export function shouldIgnoreShortcut(event, dialogOpen) {
  if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return true
  if (dialogOpen) return true
  if (event.target.closest('.cm-editor')) return true
  return false
}

/**
 * Centre of the bounding box of the nodes' centres.
 *
 * @param {Object[]} nodes - Nodes with `position` and `dimensions`.
 * @returns {{ x: number, y: number }}
 */
const getBoundingCenter = (nodes) => {
  if (nodes.length === 0) return { x: 0, y: 0 }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity

  nodes.forEach((n) => {
    const pos = {
      x: n.position.x + n.dimensions.width / 2,
      y: n.position.y + n.dimensions.height / 2,
    }
    if (pos.x < minX) minX = pos.x
    if (pos.y < minY) minY = pos.y
    if (pos.x > maxX) maxX = pos.x
    if (pos.y > maxY) maxY = pos.y
  })

  return {
    x: minX + (maxX - minX) / 2,
    y: minY + (maxY - minY) / 2,
  }
}

/**
 * Copy, paste and select-all for the workspace. Copy keeps the selection in memory and on the system
 * clipboard together with the modules and maths it needs, so paste also works in another window.
 *
 * @param {Object} options
 * @param {import('vue').Ref<{x: number, y: number}>} options.mousePosition - Mouse position in screen pixels.
 * @param {import('vue').ComputedRef<string[]>} options.allNodeNames - Names of the nodes on the workspace.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @returns {{ copySelection: Function, pasteSelection: Function, selectAllNodes: Function }}
 */
export function useWorkspaceClipboard({ mousePosition, allNodeNames, flowId = FLOW_IDS.MAIN }) {
  const { addEdges, addNodes, edges, getSelectedEdges, getSelectedNodes, nodes, screenToFlowCoordinate } =
    useVueFlow(flowId)
  const libraryStore = useLibraryStore()

  const clipboard = ref({ nodes: [], edges: [] })

  function selectAllNodes() {
    nodes.value.forEach((node) => {
      node.selected = true
    })
  }

  const copySelection = async () => {
    const nodes = getSelectedNodes.value
    const edges = getSelectedEdges.value

    if (nodes.length === 0) return

    const storeSnapshot = {}
    for (const node of nodes) {
      const { moduleRef, mathRef } = node.data
      if (!moduleRef || !mathRef) continue

      if (!libraryStore.availableMath.has(mathRef) || !libraryStore.availableModules.has(moduleRef)) continue
      const math = libraryStore.availableMath.get(mathRef)
      const module = libraryStore.availableModules.get(moduleRef)
      if (!math || !module) continue

      const key = `${moduleRef}::${mathRef}`
      if (storeSnapshot[key]) {
        continue
      }

      storeSnapshot[key] = {
        mathRef,
        math,
        layout: libraryStore.getMathLayout(mathRef),
        annotations: libraryStore.getModuleAnnotations(mathRef),
        moduleRef,
        module,
      }
    }

    const payload = {
      nodes: detachReactivity(nodes),
      edges: detachReactivity(edges),
      storeSnapshot,
    }

    clipboard.value = payload

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload))
    } catch (err) {
      console.warn('Clipboard write failed', err)
    }
  }

  /**
   * Gives pasted nodes the sidecar ports of their math's sidecar here, and moves the pasted edges' couplings onto
   * them. Nodes on math without a sidecar keep their ports.
   *
   * @param {Array<Object>} newNodes - Changed in place.
   * @param {Array<Object>} newEdges - Changed in place.
   */
  async function reconcilePastedPorts(newNodes, newEdges) {
    const mathRefs = [...new Set(newNodes.map((node) => node.data?.mathRef))].filter(
      (mathRef) => mathRef && libraryStore.getModuleAnnotations(mathRef) !== null
    )
    if (!mathRefs.length) return
    const parsed = new Map(
      await Promise.all(mathRefs.map(async (mathRef) => [mathRef, await libraryStore.ensureModuleAnnotations(mathRef)]))
    )
    const { ports, couplings } = reconcileNodePorts({
      nodes: [...nodes.value, ...newNodes],
      edges: [...edges.value, ...newEdges],
      nodeIds: newNodes.map((node) => node.id),
      sidecarFor: (mathRef) => parsed.get(mathRef) ?? undefined,
    })
    for (const node of newNodes) {
      if (ports.has(node.id)) node.data = { ...node.data, ports: ports.get(node.id) }
    }
    for (const edge of newEdges) {
      if ((ports.has(edge.source) || ports.has(edge.target)) && couplings.has(edge.id)) {
        edge.data = { ...edge.data, couplings: couplings.get(edge.id) }
      }
    }
  }

  const pasteSelection = async (atMouse = false) => {
    let sourceClipboard = clipboard.value

    // Try reading from system clipboard (for cross-window paste)
    try {
      const text = await navigator.clipboard.readText()
      const parsed = JSON.parse(text)
      if (parsed?.nodes && parsed?.edges) {
        sourceClipboard = parsed
      }
    } catch (err) {
      // Ignore clipboard read errors
    }

    if (!sourceClipboard.nodes || sourceClipboard.nodes.length === 0) return

    // Nodes copied from an older version keep values in their math; they move into the rows here.
    const clipboardMath = Object.values(sourceClipboard.storeSnapshot ?? {}).map((entry) => [
      entry.mathRef,
      entry.math,
    ])
    const clipboardNodes = separateNodeParameters(sourceClipboard.nodes, clipboardMath).nodes

    if (sourceClipboard.storeSnapshot) {
      for (const entry of Object.values(sourceClipboard.storeSnapshot)) {
        if (!libraryStore.availableModules.has(entry.moduleRef)) {
          libraryStore.addModule(entry.module)
        }
        if (!libraryStore.availableMath.has(entry.mathRef)) {
          // Clipboard text can come from anywhere, so the layout is checked like a saved one.
          const layout = entry.layout ? parseLayout(JSON.stringify(entry.layout)) : null
          libraryStore.addMath(entry.mathRef, entry.math, true, layout)
          if (typeof entry.annotations === 'string') libraryStore.setModuleAnnotations(entry.mathRef, entry.annotations)
        }
      }
    }

    const newNodes = []
    const newEdges = []

    let dx = 50
    let dy = 50

    if (atMouse) {
      // Convert screen mouse pixels to graph coordinates (handling zoom/pan)
      const mouseFlowPos = screenToFlowCoordinate(mousePosition.value)
      const clipboardCenter = getBoundingCenter(sourceClipboard.nodes)

      // Calculate difference to move center -> mouse
      dx = mouseFlowPos.x - clipboardCenter.x
      dy = mouseFlowPos.y - clipboardCenter.y
    }

    const idMap = {}
    const nodeIdSet = nodes.value.map((n) => n.id)
    const edgeIdSet = edges.value.map((e) => e.id)

    const namesSet = new Set()
    allNodeNames.value.forEach((name) => namesSet.add(name))

    clipboardNodes.forEach((node) => {
      const newId = getNextNodeId(nodeIdSet)
      idMap[node.id] = newId
      nodeIdSet.push(newId)

      const finalName = generateUniqueInstanceName(node.data.name, namesSet)
      namesSet.add(finalName)

      // Create the new node with offset position. A copy is unlocated: two instances at one ApiCoord would conflict.
      newNodes.push({
        id: newId,
        type: node.type,
        data: {
          ...withoutApiCoord(node.data),
          name: finalName,
        },
        position: {
          x: node.position.x + dx,
          y: node.position.y + dy,
        },
        // Reset selection state so we focus on the new copy.
        selected: true,
      })
    })

    sourceClipboard.edges.forEach((edge) => {
      const newSource = idMap[edge.source]
      const newTarget = idMap[edge.target]

      // If both endpoints exist in our new set, recreate the connection.
      if (newSource && newTarget) {
        const newEdgeId = getNextEdgeId(edgeIdSet)
        edgeIdSet.push(newEdgeId)

        newEdges.push({
          ...edge,
          id: newEdgeId,
          source: newSource,
          target: newTarget,
          selected: true,
        })
      }
    })

    await reconcilePastedPorts(newNodes, newEdges)

    getSelectedNodes.value.forEach((n) => (n.selected = false))
    getSelectedEdges.value.forEach((e) => (e.selected = false))

    addNodes(newNodes)
    addEdges(newEdges)
  }

  return { copySelection, pasteSelection, selectAllNodes }
}
