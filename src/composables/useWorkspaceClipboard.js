import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { parseLayout } from 'cellml-text-editor'
import { useActiveCanvas } from './useActiveCanvas'
import { usePreservedNaming } from './usePreservedNaming'
import { useSupermodules } from './useSupermodules'
import { useLibraryStore } from '../stores/libraryStore'
import { planSupermodulePaste, supermoduleClosure } from '../services/hierarchy/operations'
import { separateNodeParameters } from '../services/workspaceMigrator'
import { FLOW_IDS } from '../utils/constants'
import { getId as getNextEdgeId } from '../utils/edges'
import {
  findSupermoduleCycle,
  isModelEdge,
  isSuperInstance,
  isSupermoduleInterface,
  splitNodeId,
  supermoduleDependencies,
  toLocalName,
} from '../utils/hierarchy'
import { generateUniqueInstanceName } from '../utils/nodes'
import { notify } from '../utils/notify'
import { detachReactivity } from '../utils/reactivity'

// A modal open anywhere, such as a confirm, which leaves focus on the canvas behind it.
const MODAL_SELECTOR = '.p-overlay-mask, [role="alertdialog"], [role="dialog"][aria-modal="true"]'

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
  if (typeof document !== 'undefined' && document.querySelector(MODAL_SELECTOR)) return true
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
 * clipboard together with the modules and maths it needs, and the super-modules its super instances depend on, so paste
 * also works in another window. Each acts on the canvas: paste puts nodes in the scope shown, with that scope's ids.
 * A super-module's interface node is never copied on its own. A super-module copied is reused where the workspace has
 * the same one, else pasted with fresh ids; a super instance pastes only where its super-module would not then contain
 * itself, and only after asking when it would change a super-module's preserved flat names (see usePreservedNaming).
 * A pasted module never keeps its original's preserved name.
 *
 * @param {Object} options
 * @param {import('vue').Ref<{x: number, y: number}>} options.mousePosition - Mouse position in screen pixels.
 * @param {import('vue').ComputedRef<string[]>} options.allNodeNames - Names of the nodes on the workspace.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @param {Function} [options.confirm] - The confirm dialog.
 * @returns {{ copySelection: Function, pasteSelection: Function, selectAllNodes: Function }}
 */
export function useWorkspaceClipboard({ mousePosition, allNodeNames, flowId = FLOW_IDS.MAIN, confirm = null }) {
  const { addEdges, addNodes, edges: storeEdges, nodes: storeNodes, getSelectedEdges, getSelectedNodes, screenToFlowCoordinate } = useVueFlow(flowId)
  const { scope, nodes: canvasNodes, selectedNodes, selectedEdges, nextNodeId } = useActiveCanvas(flowId)
  const { canPlace } = useSupermodules(flowId)
  const libraryStore = useLibraryStore()
  const preservedNaming = usePreservedNaming({ flowId, confirm })

  const clipboard = ref({ nodes: [], edges: [] })

  // Selects the nodes on the canvas, none off it.
  function selectAllNodes() {
    canvasNodes.value.forEach((node) => {
      node.selected = true
    })
  }

  const copySelection = async () => {
    const nodes = selectedNodes.value.filter((node) => !isSupermoduleInterface(node))
    const ids = new Set(nodes.map((node) => node.id))
    const edges = selectedEdges.value.filter((edge) => isModelEdge(edge) && ids.has(edge.source) && ids.has(edge.target))

    if (nodes.length === 0) return

    // The super-modules the super instances copied depend on, all the way down.
    const supermodules = supermoduleClosure(storeNodes.value, storeEdges.value, nodes)

    const storeSnapshot = {}
    for (const node of [...nodes, ...supermodules.nodes]) {
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
        moduleRef,
        module,
      }
    }

    const payload = {
      nodes: detachReactivity(nodes),
      edges: detachReactivity(edges),
      ...(supermodules.nodes.length && { supermodules }),
      storeSnapshot,
    }

    clipboard.value = payload

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload))
    } catch (err) {
      console.warn('Clipboard write failed', err)
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

    // The super-modules copied with it, each reused where the workspace has the same one, else added afresh.
    const into = scope.value
    const supermodules = sourceClipboard.supermodules
      ? planSupermodulePaste(detachReactivity(storeNodes.value), detachReactivity(storeEdges.value), sourceClipboard.supermodules)
      : { nodes: [], edges: [], smIdMap: new Map() }
    const smIdOf = (smId) => supermodules.smIdMap.get(smId) ?? smId

    // A super instance goes only where its super-module is, and where it makes no cycle.
    const placed = sourceClipboard.nodes
      .filter(isSuperInstance)
      .map((node) => ({ id: `pasted:${node.id}`, type: node.type, data: { scope: into, smId: smIdOf(node.data?.smId) } }))
    const added = new Set(supermodules.nodes.filter(isSupermoduleInterface).map((node) => node.id))
    const isCyclic = () => !!findSupermoduleCycle(supermoduleDependencies([...storeNodes.value, ...supermodules.nodes, ...placed]))
    const unplaceable = sourceClipboard.nodes.filter((node) => {
      if (!isSuperInstance(node)) return false
      const smId = smIdOf(node.data?.smId)
      return added.has(smId) ? into === smId : !canPlace(into, smId)
    })
    if (unplaceable.length || (into && placed.length && isCyclic())) {
      const names = (unplaceable.length ? unplaceable : sourceClipboard.nodes.filter(isSuperInstance)).map((node) => `"${node.data?.name ?? node.id}"`).join(', ')
      notify.warning({
        title: 'Not Pasted',
        items: [
          into
            ? `${names} can't go here: its super-module is missing, or would then contain itself.`
            : `${names} can't be pasted: its super-module is missing.`,
        ],
      })
      return
    }
    if (placed.length && !(await preservedNaming.allow([...storeNodes.value, ...supermodules.nodes, ...placed]))) return

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
    // Edge ids are unique across the whole store, not just the canvas.
    const edgeIdSet = [...storeEdges.value, ...supermodules.edges].map((e) => e.id)

    const namesSet = new Set()
    allNodeNames.value.forEach((name) => namesSet.add(name))

    clipboardNodes.forEach((node) => {
      if (isSupermoduleInterface(node)) return
      // The scope shown's next id, past those of the nodes pasted so far.
      const newId = nextNodeId(undefined, newNodes)
      idMap[node.id] = newId

      // Inside a super-module, names keep its rules (see utils/hierarchy localNameProblem).
      const name = into ? toLocalName(node.data.name) : node.data.name
      const finalName = generateUniqueInstanceName(name, namesSet)
      namesSet.add(finalName)

      // Create the new node with offset position. A copy is no self leaf, and its own name is its new one.
      const { originalName: _originalName, role: _role, ...data } = node.data
      newNodes.push({
        id: newId,
        type: node.type,
        data: {
          ...data,
          name: finalName,
          scope: into,
          localId: into ? splitNodeId(newId).localId : newId,
          ...(isSuperInstance(node) && { smId: smIdOf(node.data.smId) }),
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
      if (!isModelEdge(edge)) return
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

    // Clears the whole selection, off the canvas too.
    getSelectedNodes.value.forEach((n) => (n.selected = false))
    getSelectedEdges.value.forEach((e) => (e.selected = false))

    addNodes([...supermodules.nodes, ...newNodes])
    addEdges([...supermodules.edges, ...newEdges])
  }

  return { copySelection, pasteSelection, selectAllNodes }
}
