/**
 * Guards the split between the model and the canvas: what simulates, exports or searches the model reads
 * useModelGraph(), whose nodes have every super instance expanded, never the store's nodes or edges. Every place in src/
 * that reads the store is listed below, as a canvas use or a model use that is safe as it is, with why. A read is
 * `nodes.value`, `edges.value`, `getNodes.value` or `getEdges.value`; the flow got by `useVueFlow(FLOW_IDS.MAIN)`,
 * `useVueFlow()` or `useVueFlow(flowId)` (both the workspace's, in it); or a destructure from useVueFlow that renames
 * its nodes or edges, flagged where it renames them, as the alias's own reads aren't matched.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.resolve(process.cwd(), 'src')
const SOURCE_FILE = /\.(js|mjs|ts|vue)$/
const PATTERNS = [
  /(?<![\w$])(?:nodes|edges|getNodes|getEdges)\.value\b/g,
  /useVueFlow\(\s*(?:FLOW_IDS\.MAIN\s*|[A-Za-z_$][\w$]*\s*)?\)/g,
  /(?<![\w$])(?:nodes|edges|getNodes|getEdges)\s*:\s*[A-Za-z_$][\w$]*[^{}]*\}\s*=\s*useVueFlow\(/g,
]

const MACRO = 'The macro builder’s own flow (FLOW_IDS.MACRO), not the workspace.'

/**
 * The places that may read the store's nodes. `line` is part of the line, matching `count` lines (one by default);
 * an entry without one covers its whole file.
 *
 * @type {Array<{file: string, line?: string, count?: number, use: 'canvas'|'model-safe', reason: string}>}
 */
const ALLOWED = [
  { file: 'src/composables/useModelGraph.js', use: 'model-safe', reason: 'The model graph expands the store.' },
  { file: 'src/composables/useActiveCanvas.js', use: 'canvas', reason: 'The canvas filters the store to the scope shown.' },
  { file: 'src/composables/useCanvasLevel.js', use: 'canvas', reason: 'Hides what is off the canvas, in every scope, and deselects it.' },
  {
    file: 'src/composables/useSupermodules.js',
    use: 'model-safe',
    reason: 'Reads the super-modules’ records and counts their super instances, each store node once, and adds super instances.',
  },
  {
    file: 'src/composables/useModelWriter.js',
    line: 'useVueFlow(FLOW_IDS.MAIN)',
    use: 'model-safe',
    reason: 'Writes a module’s values to its node, or as an override on the super instance it is inside, found through the model.',
  },
  {
    file: 'src/composables/useModelWriter.js',
    line: 'listOverrides(superInstanceId, nodes.value)',
    use: 'model-safe',
    reason: 'A super instance’s own overrides, resolved against the super-modules’ nodes, each once.',
  },
  {
    file: 'src/composables/useModelWriter.js',
    line: 'planRetypeBinding(nodes.value',
    use: 'model-safe',
    reason: 'Finds the super instances’ overrides of a row a write binds to a local constant, each store node once.',
  },
  {
    file: 'src/composables/useInstanceSave.js',
    line: 'planRetypeBinding(nodes.value',
    use: 'model-safe',
    reason: 'Finds the super instances’ overrides of a row a save binds to a local constant, each store node once.',
  },
  {
    file: 'src/composables/useSuperInstanceSync.js',
    line: 'useVueFlow(flowId)',
    use: 'model-safe',
    reason: 'Materialises every super instance’s ports from its super-module’s exposure edges, each store node once.',
  },
  {
    file: 'src/composables/useHierarchyOperations.js',
    line: 'useVueFlow(flowId)',
    use: 'model-safe',
    reason: 'Nests, un-nests and makes unique across every scope, each store node and edge once, keeping the model it expands to.',
  },
  {
    file: 'src/composables/usePreservedNaming.js',
    line: 'useVueFlow(flowId)',
    use: 'model-safe',
    reason: 'Counts each super-module’s occurrences, and compares the flat names it expands to, each store node once.',
  },
  {
    file: 'src/composables/useLocalConstants.js',
    use: 'model-safe',
    reason: 'Reads and writes a super-module’s local constants, the rows bound to them and the overrides of them, each store node once.',
  },
  {
    file: 'src/composables/useExposure.js',
    line: 'useVueFlow(flowId)',
    count: 2,
    use: 'model-safe',
    reason:
      'Reads and writes exposure edges and the couplings to super instances, each store edge once, in every scope; names the children exposed ports are on.',
  },

  // The canvas: what it shows, selects, lays out and edits as nodes. What reads only what is shown reads
  // useActiveCanvas() instead; these read the whole store, or the flow's actions.
  { file: 'src/views/WorkspaceArea.vue', line: '} = useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'The workspace’s own flow.' },
  { file: 'src/main.js', line: 'useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'Creates the workspace’s flow outside any component, so it lasts as long as the app.' },
  { file: 'src/views/WorkspaceArea.vue', line: 'const somethingAvailable', use: 'canvas', reason: 'Whether there is anything to save, clear or lay out.' },
  { file: 'src/views/WorkspaceArea.vue', line: 'for (const node of nodes.value)', use: 'canvas', reason: 'Normalises the ports of loaded nodes.' },
  { file: 'src/views/WorkspaceArea.vue', line: 'resolveEdgeCouplings(nodes.value', use: 'canvas', reason: 'Repairs loaded edges without couplings.' },
  {
    file: 'src/views/WorkspaceArea.vue',
    line: 'storeGraph: () => ({ nodes: nodes.value',
    use: 'model-safe',
    reason: 'The native circulatory_autogen export writes the super-modules themselves, checked against the model they expand to.',
  },
  { file: 'src/components/ContextSidebar.vue', line: 'useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'Whether a box selection is under way, and the local constants of the shown node’s super-module.' },
  { file: 'src/components/LocalConstantsPanel.vue', line: 'useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'The selected interface node’s local constants.' },
  { file: 'src/components/NodeColourPanel.vue', line: 'useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'Colours the canvas nodes selected (useActiveCanvas).' },
  { file: 'src/components/InstanceEditorDialog.vue', line: 'const nameOf', use: 'canvas', reason: 'Names the canvas neighbours a port connects to.' },
  { file: 'src/composables/useSelectionAutoRun.js', line: 'useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'Whether a box selection is under way.' },
  { file: 'src/composables/useCellmlDrop.js', line: 'if (nodes.value.length > 0)', use: 'canvas', reason: 'Whether a dropped graph would join an occupied canvas.' },
  { file: 'src/composables/useCellmlDrop.js', line: 'const existingIds', use: 'canvas', reason: 'Ids the restored nodes must not take.' },
  { file: 'src/composables/useClearWorkspace.js', line: 'const oldNodes = nodes.value', use: 'canvas', reason: 'Keeps the whole store to undo a clear.' },
  { file: 'src/composables/useClearWorkspace.js', line: 'nodes.value = oldNodes', use: 'canvas', reason: 'Restores the whole store.' },
  { file: 'src/composables/useClearWorkspace.js', line: 'nodes.value = []', use: 'canvas', reason: 'Clears the whole store.' },
  { file: 'src/composables/useHandleManagement.js', line: 'getNodes.value.find', count: 3, use: 'canvas', reason: 'The handles of canvas nodes.' },
  { file: 'src/composables/useInstanceSave.js', line: 'previewCouplings(nodeId', use: 'canvas', reason: 'Recouples a node’s own edges when its ports change.' },
  { file: 'src/composables/useWorkspaceSaveLoad.js', line: 'label: `Nodes:', use: 'canvas', reason: 'Counts what a save holds, for tracking.' },
  { file: 'src/services/generate/generateWorkflow.js', line: 'useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'Adds a generated macro to the canvas.' },
  { file: 'src/services/generate/generateWorkflow.js', line: 'getNodes.value.forEach', use: 'canvas', reason: 'Ids the generated nodes must not take, unique across the store.' },
  { file: 'src/components/MacroBuilderDialog.vue', line: 'nodes.value', count: 4, use: 'canvas', reason: MACRO },
  { file: 'src/components/MacroBuilderDialog.vue', line: 'edges.value', count: 2, use: 'canvas', reason: MACRO },

  // The canvas's edges and the flow by default or by parameter, the workspace's in it.
  { file: 'src/views/WorkspaceArea.vue', line: 'for (const edge of edges.value)', count: 2, use: 'canvas', reason: 'Indexes the canvas edges by node, and repairs loaded edges without couplings.' },
  { file: 'src/components/CouplingEdge.vue', line: '= useVueFlow()', use: 'canvas', reason: 'Finds its end nodes, to flag couplings to ports a super instance no longer exposes.' },
  { file: 'src/components/ExposureEdge.vue', line: '= useVueFlow()', use: 'canvas', reason: 'The ends of its drawn exposure edge, whose child names the ports it exposes.' },
  { file: 'src/components/SuperInstancePanel.vue', line: 'useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'The canvas edges into the selected super instance, for its broken couplings.' },
  { file: 'src/components/SuperInstancePanel.vue', line: 'return edges.value.flatMap', use: 'canvas', reason: 'The canvas edges into the selected super instance, for its broken couplings.' },
  { file: 'src/components/HelperLines.vue', line: '= useVueFlow()', use: 'canvas', reason: 'The viewport the helper lines are drawn over.' },
  { file: 'src/components/InstanceEditorDialog.vue', line: '= useVueFlow()', use: 'canvas', reason: 'The flow the edited node is in.' },
  { file: 'src/components/InstanceEditorDialog.vue', line: 'const byId = (id) => nodes.value', use: 'canvas', reason: 'The edited node’s super-module, for the local constants its rows can be bound to.' },
  { file: 'src/components/InstanceEditorDialog.vue', line: 'if (!modelId) return { nodeId: props.id, edges: edges.value', use: 'canvas', reason: 'Outside a super instance, its ports’ connections are the canvas edges, as stored.' },
  { file: 'src/components/InstanceEditorDialog.vue', line: 'const scope = scopeOf(nodes.value.find', use: 'canvas', reason: 'The super-module the edited node is a child of, edited on its own.' },
  { file: 'src/components/InstanceEditorDialog.vue', line: 'return exposedPortsOf(scope, nodes.value', use: 'canvas', reason: 'The ports that super-module exposes, from its exposure edges, each stored once.' },
  { file: 'src/composables/useEdgeCouplings.js', line: 'useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'The exposure edges saying which ports of a super-module are exposed.' },
  { file: 'src/composables/useNodeChrome.js', line: '= useVueFlow()', use: 'canvas', reason: 'The flow the node card is drawn in.' },
  { file: 'src/composables/useNodeHandles.js', line: '= useVueFlow()', use: 'canvas', reason: 'The flow the node\'s handles are drawn in.' },
  { file: 'src/composables/useNodeHandles.js', line: 'const connectedEdges', use: 'canvas', reason: 'The edges on a handle being removed.' },
  { file: 'src/components/LibraryArea.vue', line: 'useVueFlow(FLOW_IDS.MAIN)', use: 'canvas', reason: 'The workspace\'s flow, whose super-modules the library deletes.' },
  {
    file: 'src/components/LibraryArea.vue',
    line: 'const held = flow.nodes.value',
    use: 'model-safe',
    reason: 'Counts what a super-module holds, each store node once, for the question before deleting it.',
  },
  { file: 'src/composables/useCanvasDelete.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'The flow canvas nodes are deleted from.' },
  { file: 'src/composables/useRevealModelNode.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'Finds the canvas node a revealed model node shows as, to centre on it once measured.' },
  { file: 'src/composables/useCellmlDrop.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'The flow a CellML file is dropped on.' },
  { file: 'src/composables/useClearWorkspace.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'The flow it clears.' },
  { file: 'src/composables/useClearWorkspace.js', line: 'const oldEdges = edges.value', use: 'canvas', reason: 'Keeps the whole store to undo a clear.' },
  { file: 'src/composables/useClearWorkspace.js', line: 'edges.value = oldEdges', use: 'canvas', reason: 'Restores the whole store.' },
  { file: 'src/composables/useClearWorkspace.js', line: 'edges.value = []', use: 'canvas', reason: 'Clears the whole store.' },
  { file: 'src/composables/useConnect.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'The flow connections are drawn in.' },
  { file: 'src/composables/useConnect.js', line: 'edges.value.find', count: 2, use: 'canvas', reason: 'Whether a drawn connection repeats one.' },
  { file: 'src/composables/useConnect.js', line: 'buildUsedPortKeys(edges.value', use: 'canvas', reason: 'The slots the canvas edges hold.' },
  { file: 'src/composables/useConnect.js', line: 'exposedSlotKeys(nodes.value', use: 'canvas', reason: 'The slots exposed ports take inside the super-module shown.' },
  { file: 'src/composables/useDnD.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'The flow modules are dropped on.' },
  { file: 'src/composables/useFlowHistory.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'The flow whose changes are undone.' },
  { file: 'src/composables/useFlowHistory.js', line: '// excludeEdgeIds', use: 'canvas', reason: 'A comment.' },
  { file: 'src/composables/useHandleManagement.js', line: '= useVueFlow()', use: 'canvas', reason: 'The flow whose handles it manages.' },
  { file: 'src/composables/useHandleManagement.js', line: '`edges.value`', use: 'canvas', reason: 'A comment.' },
  { file: 'src/composables/useHandleManagement.js', line: 'const hasEdge = edges.value', use: 'canvas', reason: 'Whether a canvas edge holds a handle.' },
  { file: 'src/composables/useHandleManagement.js', line: 'removed from edges.value', use: 'canvas', reason: 'A comment.' },
  { file: 'src/composables/useInstanceSave.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'The flow a save applies to.' },
  { file: 'src/composables/useInstanceSave.js', line: 'edges.value.forEach', use: 'canvas', reason: 'Recouples a node’s own edges when its ports change.' },
  { file: 'src/composables/useLoadFromCellml.js', line: 'nodes: currentNodes', use: 'canvas', reason: 'Ids and names the imported nodes must not take.' },
  { file: 'src/composables/useLoadFromInstanceArray.js', line: '= useVueFlow()', use: 'canvas', reason: 'The flow the module array replaces.' },
  { file: 'src/composables/useNodeDataHistory.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'The flow whose node edits are undone.' },
  { file: 'src/composables/useNodeDataHistory.js', line: 'return edges.value.filter', use: 'canvas', reason: 'The edges an edit to some nodes may recouple.' },
  { file: 'src/composables/useWorkflowLayout.js', line: '= useVueFlow()', use: 'canvas', reason: 'Lays out the canvas.' },
  { file: 'src/composables/useWorkspaceClipboard.js', line: 'useVueFlow(flowId)', use: 'canvas', reason: 'The flow it copies from and pastes to, with the super-modules copied super instances depend on.' },

  // Safe for the model as they are: each store node once, as stored, which is what they need.
  {
    file: 'src/components/InstanceEditorDialog.vue',
    line: 'const canvasNodes',
    use: 'model-safe',
    reason: 'The canvas with the edit applied, expanded before its values are resolved.',
  },
  {
    file: 'src/components/InstanceEditorDialog.vue',
    line: 'previewCouplings(props.id',
    use: 'model-safe',
    reason: 'The canvas edges recoupled as a save would, expanded before its values are resolved.',
  },
  {
    file: 'src/components/InstanceEditorDialog.vue',
    line: 'const canvasEdges',
    use: 'model-safe',
    reason: 'The canvas edges recoupled as a save would, expanded before its values are resolved.',
  },
  {
    file: 'src/components/InstanceEditorDialog.vue',
    line: 'return nodes.value.filter',
    use: 'model-safe',
    reason: 'The nodes a save switches to the new math, each written once; the count shown is the model’s.',
  },
  {
    file: 'src/composables/useInstanceSave.js',
    line: 'const otherNodes',
    use: 'model-safe',
    reason: 'Rebuilds every node on the saved math, once each.',
  },
  {
    file: 'src/composables/useInstanceSave.js',
    line: 'const isUsed',
    count: 2,
    use: 'model-safe',
    reason: 'Whether any node, super-modules’ included, still uses a module or math.',
  },
  {
    file: 'src/composables/useInstanceSave.js',
    line: '...nodes.value.filter',
    use: 'model-safe',
    reason: 'The nodes a save’s undo step records.',
  },
  {
    file: 'src/composables/useFlowHistory.js',
    line: 'const remainingNodes',
    use: 'model-safe',
    reason: 'Global constants still used by any node, super-modules’ included.',
  },
  {
    file: 'src/composables/useNodeDataHistory.js',
    line: 'return nodes.value.some',
    use: 'model-safe',
    reason: 'Whether any node, super-modules’ included, still uses a global constant.',
  },
]

/**
 * Lists the source files under a directory.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function listSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSources(full)
    return SOURCE_FILE.test(entry.name) ? [full] : []
  })
}

/**
 * Finds where a text reads the store's nodes.
 *
 * @param {string} text
 * @returns {Array<{line: number, text: string}>} One per line, its number from 1.
 */
function findReads(text) {
  const lines = text.split('\n')
  const found = new Set()
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(text.slice(0, match.index).split('\n').length)
  }
  return [...found].sort((a, b) => a - b).map((line) => ({ line, text: lines[line - 1].trim() }))
}

/** Every read in src/, as `{file, line, text}`, file relative to the repository. */
const reads = listSources(SRC).flatMap((file) =>
  findReads(fs.readFileSync(file, 'utf8')).map((read) => ({ file: path.relative(process.cwd(), file).split(path.sep).join('/'), ...read }))
)

const covers = (entry, read) => entry.file === read.file && (!entry.line || read.text.includes(entry.line))

describe('the store’s nodes', () => {
  it('are found however they are read', () => {
    const text = [
      'const a = nodes.value',
      'const b = getNodes.value.length',
      'useVueFlow(',
      '  FLOW_IDS.MAIN',
      ')',
      'const c = modelNodes.value',
      'const d = useVueFlow(FLOW_IDS.MACRO)',
      'const e = edges.value',
      'const f = getEdges.value',
      'const { findNode } = useVueFlow()',
      'const { addNodes } = useVueFlow(flowId)',
      'const {',
      '  nodes: current,',
      '} = useVueFlow(FLOW_IDS.MAIN)',
      'const g = { nodes: modelNodes }',
    ].join('\n')
    expect(findReads(text).map(({ line }) => line)).toEqual([1, 2, 3, 8, 9, 10, 11, 13, 14])
  })

  it('are read in src/ only where the allow-list says, as model consumers read useModelGraph()', () => {
    const unlisted = reads.filter((read) => !ALLOWED.some((entry) => covers(entry, read)))
    expect(unlisted.map(({ file, line, text }) => `${file}:${line}: ${text}`)).toEqual([])
  })

  it('are listed once a line, each entry where it says', () => {
    const claimedTwice = reads.filter((read) => ALLOWED.filter((entry) => covers(entry, read)).length > 1)
    expect(claimedTwice.map(({ file, line }) => `${file}:${line}`)).toEqual([])
    for (const entry of ALLOWED.filter((candidate) => candidate.line)) {
      const count = reads.filter((read) => covers(entry, read)).length
      expect(count, `${entry.file}: "${entry.line}"`).toBe(entry.count ?? 1)
    }
    const files = new Set(reads.map((read) => read.file))
    expect(ALLOWED.filter((entry) => !files.has(entry.file)).map((entry) => entry.file)).toEqual([])
  })

  it('are listed with what they are for, and why', () => {
    for (const entry of ALLOWED) {
      expect(['canvas', 'model-safe'], entry.file).toContain(entry.use)
      expect(entry.reason, entry.file).toMatch(/\S/)
    }
  })
})

// Vue Flow's selection and its Delete key take in nodes off the canvas, so only what is on it is ever selected: these
// are the places that select, each with why what it selects is on the canvas. Deselecting is always safe.
const SELECTS = /\.selected\s*=\s*(?!\s*false\b)|addSelectedNodes\(\s*\[/g
const ALLOWED_SELECTS = [
  { file: 'src/composables/useWorkspaceClipboard.js', line: 'node.selected = true', reason: 'Select-all selects the canvas nodes.' },
  { file: 'src/composables/useFlowHistory.js', line: 'item.selected = s.', count: 2, reason: 'Selection steps, never recorded.' },
  { file: 'src/views/WorkspaceArea.vue', line: 'addSelectedNodes([findNode(id)]', reason: 'The canvas node whose menu was opened.' },
  { file: 'src/views/WorkspaceArea.vue', line: '.selected = true)', count: 2, reason: 'Puts back the selection an image export took off.' },
  { file: 'src/components/dialogs/CreateInspectionModule.vue', line: 'row.selected =', count: 2, reason: 'Table rows, not nodes.' },
]

describe('the selection', () => {
  const selects = listSources(SRC).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n')
    const found = new Set([...text.matchAll(SELECTS)].map((match) => text.slice(0, match.index).split('\n').length))
    const relative = path.relative(process.cwd(), file).split(path.sep).join('/')
    return [...found].map((line) => ({ file: relative, line, text: lines[line - 1].trim() }))
  })

  it('takes in only canvas nodes: everything that selects is listed', () => {
    const unlisted = selects.filter((read) => !ALLOWED_SELECTS.some((entry) => covers(entry, read)))
    expect(unlisted.map(({ file, line, text }) => `${file}:${line}: ${text}`)).toEqual([])
    for (const entry of ALLOWED_SELECTS) {
      expect(selects.filter((read) => covers(entry, read)).length, `${entry.file}: "${entry.line}"`).toBe(entry.count ?? 1)
    }
  })
})
