import { nextTick, toValue } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useAnnotationStore } from '../stores/annotationStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useNodeDataHistory } from './useNodeDataHistory'
import { parseApiCoords } from '../services/annotations/apicoord'
import { buildCouplingContext } from '../services/annotations/couple'
import { reconcileAnnotatedPorts } from '../services/annotations/ports'
import { reconcileNodePorts } from '../services/annotations/reconcileNodes'
import { parseSidecar } from '../services/annotations/sidecar'
import {
  aggregatorVariables,
  asBoundaryConditions,
  attachedModules,
  holdAtZero,
  layoutByRank,
  matchSidecarToMath,
  planInstances,
  rdfFormatOf,
  readSidecarComponent,
  suppliedVariables,
} from '../services/annotations/generate'
import { buildInstance } from '../services/import/buildWorkflow'
import { FLOW_IDS, MAIN_NODE_TYPE, NUM_GHOST_HANDLES_LEFT_RIGHT, NUM_GHOST_HANDLES_TOP_BOT } from '../utils/constants'
import { buildGhostHandles } from '../utils/handles'
import { generateUniqueInstanceName, getId as getNextNodeId } from '../utils/nodes'
import { extractGlobalConstants } from '../utils/variables'

/**
 * Reads, plans and applies an "Apply annotations" import: module sidecars attach to library maths, and an
 * ApiCoord instance file places, names and binds the instances.
 *
 * @param {Object} [options]
 * @param {Object|import('vue').Ref<Object>} [options.fitViewParams] - Passed to fitView after applying.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @returns {{ readAnnotationFiles: Function, planRows: Function, applyAnnotations: Function }}
 */
export function useApplyAnnotations({ fitViewParams, flowId = FLOW_IDS.MAIN } = {}) {
  const { nodes, edges, addNodes, findNode, updateNodeData, fitView } = useVueFlow(flowId)
  const libraryStore = useLibraryStore()
  const annotationStore = useAnnotationStore()
  const historyStore = useFlowHistoryStore()
  const { recordEdit, findIncidentEdgeIds } = useNodeDataHistory(flowId)

  /**
   * Parses the import's files and matches each sidecar to library math.
   *
   * @param {Object} files
   * @param {Array<{ name: string, text: string }>} files.sidecarFiles
   * @param {{ name: string, text: string }} files.instanceFile
   * @returns {Promise<{ sidecars: Array<{ filename: string, text: string, component: Object|null,
   *   sidecar: Object|null, match: Object, error: string|null }>, instanceFile: { location: string,
   *   format: string, text: string }, apiCoords: Object, mathRefs: Array<string> }>}
   */
  async function readAnnotationFiles({ sidecarFiles = [], instanceFile }) {
    const mathRefs = [...libraryStore.availableMath.keys()].sort()
    const sidecars = await Promise.all(
      sidecarFiles.map(async ({ name, text }) => {
        let component = null
        let error = null
        try {
          component = await readSidecarComponent(text)
          if (!component) error = 'No single annotated component (uniprot, GO:0005886 or SBO:0000290) found.'
        } catch (parseError) {
          error = `Could not parse: ${parseError.message}`
        }
        const match = matchSidecarToMath(component, mathRefs)
        const sidecar = component
          ? await parseSidecar(text, {
              mathRef: component.mathRef,
              cellml: libraryStore.availableMath.get(match.mathRef ?? component.mathRef),
            })
          : null
        return { filename: name, text, component, sidecar, match, error }
      })
    )
    const format = rdfFormatOf(instanceFile.name)
    const apiCoords = await parseApiCoords(instanceFile.text, { format })
    return {
      sidecars,
      instanceFile: { location: instanceFile.name, format, text: instanceFile.text },
      apiCoords,
      mathRefs,
    }
  }

  /**
   * Plans the instances for the sidecars' chosen target maths.
   *
   * @param {Awaited<ReturnType<typeof readAnnotationFiles>>} prepared
   * @param {Map<string, string|null>|Object<string, string|null>} targets - Target math by sidecar filename.
   * @returns {ReturnType<typeof planInstances>}
   */
  function planRows(prepared, targets) {
    return planInstances({
      instances: prepared.apiCoords.instances,
      modules: attachedModules(prepared.sidecars, targets),
      nodes: nodes.value,
      sidecarFor: (mathRef) => libraryStore.getParsedModuleAnnotations(mathRef),
    })
  }

  /** The module a new instance of a math is built from: its default module, else its first. */
  function moduleFor(mathRef) {
    const modules = [...libraryStore.availableModules.values()].filter((module) => module.mathRef === mathRef)
    return modules.find((module) => module.moduleRef.endsWith(':default')) ?? modules[0] ?? null
  }

  /**
   * Gives existing nodes the sidecar ports of their math's newly stored sidecar, and recomputes the couplings of
   * the edges touching them.
   *
   * @param {Array<string>} nodeIds
   * @param {Map<string, Object|null>} parsed - Parsed sidecars by mathRef.
   */
  function reconcileStoredSidecars(nodeIds, parsed) {
    if (!nodeIds.length) return
    const sidecarFor = (mathRef) => parsed.get(mathRef)
    const context = buildCouplingContext({
      apiCoords: annotationStore.getApiCoords(),
      sidecarFor: (mathRef) => parsed.get(mathRef) ?? libraryStore.getParsedModuleAnnotations(mathRef),
      nodes: nodes.value,
    })
    const { ports, couplings } = reconcileNodePorts({ nodes: nodes.value, edges: edges.value, nodeIds, sidecarFor, context })
    ports.forEach((nodePorts, nodeId) => updateNodeData(nodeId, { ports: nodePorts }))
    edges.value.forEach((edge) => {
      if (couplings.has(edge.id)) edge.data = { ...edge.data, couplings: couplings.get(edge.id) }
    })
  }

  async function fitAfterRender() {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 50))
    fitView({ padding: 0.2, ...toValue(fitViewParams), duration: 400 })
  }

  /**
   * Applies a plan as one undo step: stores the sidecars and the instance file, adds the new instances in rank
   * columns (existing nodes stay put), binds new and existing nodes to their ApiCoords, holding the ticked
   * ones constant, and gives every node on a stored sidecar's math its sidecar ports. A new instance's annotated
   * readers and sums become boundary conditions, since ports supply them. Undo removes the instances, bindings and
   * ports; the stored files stay.
   *
   * @param {Awaited<ReturnType<typeof readAnnotationFiles>>} prepared
   * @param {Object} choices
   * @param {Map<string, string|null>|Object<string, string|null>} choices.targets - Target math by sidecar file.
   * @param {Array<Object>} choices.rows - From planRows, with the user's mathRef and heldConstant.
   * @returns {Promise<{ added: Array<string>, bound: Array<string>, skipped: Array<string>,
   *   unmatchedSidecars: Array<string> }>} Instance names, and the filenames of sidecars not stored.
   */
  async function applyAnnotations(prepared, { targets, rows }) {
    const modules = attachedModules(prepared.sidecars, targets)
    const storedRefs = new Set()
    for (const module of modules) {
      const { text } = prepared.sidecars.find((entry) => entry.filename === module.filename)
      if (libraryStore.getModuleAnnotations(module.mathRef) !== text) {
        libraryStore.setModuleAnnotations(module.mathRef, text)
        storedRefs.add(module.mathRef)
      }
    }
    const attached = new Set(modules.map((module) => module.filename))
    const unmatchedSidecars = prepared.sidecars.filter((entry) => !attached.has(entry.filename)).map((e) => e.filename)
    const stored = annotationStore.instanceSources.find(({ location }) => location === prepared.instanceFile.location)
    if (stored?.text !== prepared.instanceFile.text || stored?.format !== prepared.instanceFile.format) {
      annotationStore.addInstanceSource(prepared.instanceFile)
    }

    const mathRefs = [...new Set([...rows.map((row) => row.mathRef).filter(Boolean), ...storedRefs])]
    const [parsedEntries] = await Promise.all([
      Promise.all(mathRefs.map(async (mathRef) => [mathRef, await libraryStore.ensureModuleAnnotations(mathRef)])),
      annotationStore.ensureApiCoords(),
    ])
    const parsed = new Map(parsedEntries)
    const heldVariables = (mathRef) => aggregatorVariables(parsed.get(mathRef))

    const skipped = rows.filter((row) => !row.mathRef || (!row.nodeId && !moduleFor(row.mathRef))).map((r) => r.name)
    const toBind = rows.filter((row) => row.mathRef && row.nodeId && findNode(row.nodeId))
    const toAdd = rows.filter((row) => row.mathRef && !row.nodeId && moduleFor(row.mathRef))

    const positions = layoutByRank(toAdd, nodes.value)
    const names = new Set(nodes.value.map((node) => node.data?.name))
    let nodeId = getNextNodeId(nodes.value.map((node) => node.id))
    const newNodes = toAdd.map((row) => {
      const id = nodeId
      nodeId = getNextNodeId([nodeId])
      const name = generateUniqueInstanceName(row.name, names)
      names.add(name)
      const handles = buildGhostHandles(NUM_GHOST_HANDLES_TOP_BOT, NUM_GHOST_HANDLES_LEFT_RIGHT)
      const node = buildInstance(
        id,
        name,
        MAIN_NODE_TYPE,
        moduleFor(row.mathRef),
        handles,
        positions.get(row.name),
        libraryStore.getMathAnalysis(row.mathRef),
        libraryStore.getMathDefaults(row.mathRef)
      )
      node.data.apiCoord = { subject: row.subject, coordIri: row.coordIri, name: row.name }
      const sidecar = parsed.get(row.mathRef)
      if (sidecar) {
        const variables = node.data.variables.map((variable) => variable.name)
        node.data.ports = reconcileAnnotatedPorts(node.data.ports ?? [], sidecar, { mathRef: row.mathRef, variables }).ports
      }
      // What other instances supply through ports: their values are only fallbacks, so none is required.
      node.data.variables = asBoundaryConditions(node.data.variables, suppliedVariables(parsed.get(row.mathRef)))
      if (row.heldConstant) {
        node.data.annotationOverlay = { heldConstant: true }
        node.data.variables = holdAtZero(node.data.variables, heldVariables(row.mathRef))
      }
      return node
    })
    for (const node of newNodes) {
      for (const constant of extractGlobalConstants(node.data.variables)) {
        libraryStore.assignGlobalConstant(constant.name, constant.value, constant.units, constant.data_reference)
      }
    }

    const reconcileIds = nodes.value.filter((node) => storedRefs.has(node.data?.mathRef)).map((node) => node.id)
    const editIds = [...new Set([...toBind.map((row) => row.nodeId), ...reconcileIds])]

    historyStore.startBatch()
    try {
      if (newNodes.length) {
        addNodes(newNodes)
        // Placed where planned: the drop-centring of a lone added node must not rewrite this step.
        historyStore.lastChangeWasAddSetter(false)
      }
      if (editIds.length) {
        await recordEdit({
          type: 'apply-annotations',
          nodeIds: editIds,
          keys: ['apiCoord', 'annotationOverlay', 'variables', 'ports'],
          edgeIds: findIncidentEdgeIds(reconcileIds),
          apply: () => {
            for (const row of toBind) {
              const node = findNode(row.nodeId)
              const { annotationOverlay, ...data } = node.data
              const overlay = { ...annotationOverlay }
              const wasHeld = !!overlay.heldConstant
              if (row.heldConstant) overlay.heldConstant = true
              else delete overlay.heldConstant
              // Held: the sums are constant 0. Released: they are summed again, with 0 as the fallback.
              let variables = data.variables
              if (row.heldConstant) variables = holdAtZero(variables, heldVariables(data.mathRef))
              else if (wasHeld) variables = asBoundaryConditions(variables, heldVariables(data.mathRef))
              node.data = {
                ...data,
                apiCoord: { subject: row.subject, coordIri: row.coordIri, name: row.name },
                ...(Object.keys(overlay).length ? { annotationOverlay: overlay } : {}),
                variables,
              }
            }
            reconcileStoredSidecars(reconcileIds, parsed)
          },
        })
      }
      await nextTick()
    } finally {
      historyStore.endBatch()
    }
    if (newNodes.length) await fitAfterRender()

    return {
      added: toAdd.map((row) => row.name),
      bound: toBind.map((row) => row.name),
      skipped,
      unmatchedSidecars,
    }
  }

  return { readAnnotationFiles, planRows, applyAnnotations }
}
