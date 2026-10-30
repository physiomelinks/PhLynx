import { useVueFlow } from '@vue-flow/core'
import { useAnnotationStore } from '../stores/annotationStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { buildCouplingContext } from '../services/annotations/couple'
import { countDroppedCouplings, findSidecarPortChanges, reconcileNodePorts } from '../services/annotations/reconcileNodes'
import { parseSidecar } from '../services/annotations/sidecar'
import { renameSidecar } from '../services/annotations/sidecarEdit'
import { analyzeMathXml } from '../services/math/analyzeMath'
import { carryRenames } from '../services/math/carryRenames'
import { getPortVariables, reconcileRows } from '../services/math/reconcileRows'
import { getNodeSelections, replaceNodeSelections, setNodePlotVariables } from '../services/simulation/plotSelections'
import { FLOW_IDS, PROTECTED_MATH_REFS } from '../utils/constants'
import { detachReactivity } from '../utils/reactivity'
import { useNodeDataHistory } from './useNodeDataHistory'

const NODE_KEYS = ['name', 'variables', 'ports', 'mathRef', 'moduleRef']

/**
 * Checks whether two math entries (see libraryStore.getMathEntry) hold the same math, defaults and layout.
 *
 * @param {Object|null} entry
 * @param {Object|null} otherEntry
 * @returns {boolean}
 */
function isSameMathEntry(entry, otherEntry) {
  const serialise = (value) => value && JSON.stringify([value.math, [...value.defaults], value.layout])
  return serialise(entry) === serialise(otherEntry)
}

/**
 * Combines the library states an edit changes into one recordEdit `library` option.
 *
 * @param {Array<Object|null>} libraries - Each `{ isAt(side), restore(side) }`, or null when unchanged.
 * @returns {Object|null}
 */
function combineLibraries(libraries) {
  const changed = libraries.filter(Boolean)
  if (!changed.length) return null
  return {
    isAt: (side) => changed.every((library) => library.isAt(side)),
    restore: (side) => changed.forEach((library) => library.restore(side)),
  }
}

/**
 * Applies an instance editor save to the workspace as one canvas undo step.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @returns {Object} saveInstanceEdit and findDroppedCouplings.
 */
export function useInstanceSave(flowId = FLOW_IDS.MAIN) {
  const { nodes, edges, findNode, updateNodeData } = useVueFlow(flowId)
  const libraryStore = useLibraryStore()
  const annotationStore = useAnnotationStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const { recordEdit, findIncidentEdgeIds } = useNodeDataHistory(flowId)

  /**
   * Rebuilds a node's rows from its math, keeping their values. A row the math newly needs starts
   * blank: the math's defaults only seed new instances.
   *
   * @param {Object} node
   * @param {string} mathRef - The math the node now uses.
   */
  function updateVariablesFromMath(node, mathRef) {
    const analysis = libraryStore.getMathAnalysis(mathRef)
    if (!analysis) return
    node.data.variables = reconcileRows(analysis, node.data.variables ?? [], {
      portVariables: getPortVariables(node.data.ports),
    })
  }

  /**
   * Drops ports that carry a variable the node no longer has.
   *
   * @param {Object} node
   */
  function cleanPorts(node) {
    const validVariables = new Set(node.data.variables.map((v) => v.name))
    node.data.ports = node.data.ports.filter((port) => (port.variables || []).every((v) => validVariables.has(v)))
  }

  /**
   * Builds the coupling context a save re-checks kept annotated couplings with.
   *
   * @param {Function} sidecarFor - From prepareSidecars.
   * @param {Array<Object>} contextNodes - The nodes as the save leaves them.
   * @returns {Object} From buildCouplingContext.
   */
  function buildSaveContext(sidecarFor, contextNodes) {
    return buildCouplingContext({
      apiCoords: annotationStore.getApiCoords(),
      sidecarFor: (ref) => sidecarFor(ref) ?? libraryStore.getParsedModuleAnnotations(ref),
      nodes: contextNodes,
    })
  }

  /**
   * Reconciles the sidecar ports of the given nodes and recomputes the couplings of every edge touching them.
   *
   * @param {Array<string>} nodeIds
   * @param {Function} sidecarFor - From prepareSidecars.
   * @param {Map<string, Array<Object>>} portChanges - The edited node's sidecar ports the editor replaced.
   */
  function reconcileSavedNodes(nodeIds, sidecarFor, portChanges) {
    const { ports, couplings } = reconcileNodePorts({
      nodes: nodes.value,
      edges: edges.value,
      nodeIds,
      sidecarFor,
      context: buildSaveContext(sidecarFor, nodes.value),
      portChanges,
    })
    ports.forEach((nodePorts, nodeId) => updateNodeData(nodeId, { ports: nodePorts }))
    edges.value.forEach((edge) => {
      if (couplings.has(edge.id)) edge.data = { ...edge.data, couplings: couplings.get(edge.id) }
    })
  }

  /**
   * Checks whether a save writes math that no library module uses yet, such as a new component.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {boolean}
   */
  function isNewModuleSave({ mathRef, math }) {
    return math !== null && !PROTECTED_MATH_REFS.has(mathRef) && !libraryStore.availableCollections.has(mathRef)
  }

  /**
   * Writes a save to the library and the nodes: the edited node, the siblings it applies to, and
   * every other node whose math it changed. Math no module uses gets one, built from the saved node,
   * so it shows in the library.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @param {Array<string>} affectedIds - From findAffectedIds; their sidecar ports are reconciled.
   * @param {Function} sidecarFor - From prepareSidecars.
   * @returns {string|null} The ref of the module made for the math, if one was.
   */
  function applySave(save, affectedIds, sidecarFor) {
    const { id, name, variables, ports, mathRef, math, layout, isLayoutChanged, globalConstants, updateAll, siblings } = save
    // Keep the shared units and reference, so one node's fields don't replace them.
    globalConstants.forEach(({ name, value, units, data_reference, overwrite }) => {
      const shared = libraryStore.getGlobalConstant(name)
      libraryStore.assignGlobalConstant(name, value, shared?.units ?? units, shared?.data_reference ?? data_reference, !!overwrite)
    })
    const isNewModule = isNewModuleSave(save)
    if (math !== null) libraryStore.addMath(mathRef, math, true, layout)
    else if (isLayoutChanged) libraryStore.setMathLayout(mathRef, layout)
    const moduleRef = isNewModule ? libraryStore.createModuleForMath(mathRef, detachReactivity({ ports, variables })) : null

    // Without its own module, a node would keep its old one's ref, which export keys configs by.
    // Only siblings on the edited node's old module share its ports, so only they move to the new one.
    const previousModuleRef = findNode(id)?.data.moduleRef
    const portChanges = new Map([[id, findSidecarPortChanges(findNode(id)?.data.ports, ports)]])
    const moduleFields = moduleRef ? { moduleRef } : {}
    updateNodeData(id, { name, variables, ports, mathRef, ...moduleFields })
    if (updateAll) {
      siblings.forEach((siblingId) => {
        const isSameModule = findNode(siblingId)?.data.moduleRef === previousModuleRef
        updateNodeData(siblingId, { mathRef, ...(isSameModule ? moduleFields : {}) })
      })
    }

    // The edited node's rows are already reconciled by the editor. Every other node on this math is
    // rebuilt here, ticked or not, since an overwrite in place changes their math too.
    cleanPorts(findNode(id))
    const otherNodes = nodes.value.filter((node) => node.id !== id && node.data?.mathRef === mathRef)
    otherNodes.forEach((node) => {
      updateVariablesFromMath(node, mathRef)
      cleanPorts(node)
    })

    reconcileSavedNodes(affectedIds, sidecarFor, portChanges)
    return moduleRef
  }

  /**
   * Gets the module a save may create, as a recordEdit `library` entry. Undo removes the module
   * unless a node still uses it, and redo puts it back.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {{created: Function, library: Object}|null} Null when the save makes no module.
   *   Pass `created` the ref applySave returns.
   */
  function prepareModuleChange(save) {
    if (!isNewModuleSave(save)) return null
    // A module already on this math, though in no collection, was not the save's to remove.
    const existingRefs = new Set(
      [...libraryStore.availableModules.values()].filter((m) => m.mathRef === save.mathRef).map((m) => m.moduleRef)
    )
    let moduleRef = null
    let module = null
    const isUsed = () => nodes.value.some((node) => node.data?.moduleRef === moduleRef)
    const isStored = () =>
      libraryStore.availableModules.has(moduleRef) && !!libraryStore.availableCollections.get(save.mathRef)?.has(moduleRef)

    return {
      created: (ref) => {
        if (!ref || existingRefs.has(ref)) return
        moduleRef = ref
        module = detachReactivity(libraryStore.availableModules.get(ref))
      },
      library: {
        isAt: (side) => !moduleRef || (side === 'after' ? isStored() : !isStored() || isUsed()),
        restore: (side) => {
          if (!moduleRef) return
          if (side === 'after') libraryStore.addModule(detachReactivity(module))
          else if (!isUsed()) libraryStore.removeModule(moduleRef)
        },
      },
    }
  }

  /**
   * Gets the plot config change a save makes, as a recordEdit `library` entry. Only the saved node's
   * selections are compared and restored, so changes to other nodes' plots don't block the undo.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {{apply: Function, library: Object}|null} Null when the save leaves the plot config as it is.
   */
  function preparePlotChange({ id, name, variables, plotVariables }) {
    if (!plotVariables) return null
    const plotBefore = JSON.parse(JSON.stringify(simulationSettingsStore.plotConfig ?? {}))
    const plotAfter = setNodePlotVariables(plotBefore, { id, data: { name, variables } }, plotVariables)
    if (plotAfter === plotBefore) return null

    const states = { before: getNodeSelections(plotBefore, id), after: getNodeSelections(plotAfter, id) }
    const current = () => getNodeSelections(simulationSettingsStore.plotConfig, id)
    return {
      apply: () => simulationSettingsStore.setPlotConfig(plotAfter),
      library: {
        isAt: (side) => JSON.stringify(current()) === JSON.stringify(states[side]),
        restore: (side) =>
          simulationSettingsStore.setPlotConfig(replaceNodeSelections(simulationSettingsStore.plotConfig, id, states[side])),
      },
    }
  }

  /**
   * Finds the variables a save's math renamed, as carryRenames carries their rows.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {Map<string, string>} Old variable name -> new name.
   */
  function findVariableRenames({ mathRef, previousMathRef, math }) {
    if (math === null) return new Map()
    const previousAnalysis = libraryStore.getMathAnalysis(previousMathRef ?? mathRef)
    const rows = [...new Set(previousAnalysis?.references ?? [])].map((name) => ({ name }))
    const { portRenames } = carryRenames(previousAnalysis, analyzeMathXml(math), rows)
    return new Map(portRenames.map(({ from, to }) => [from, to]))
  }

  /**
   * Gets the sidecar a save writes for its math, as a recordEdit `library` entry: the save's own
   * annotations, or else the previous math's sidecar moved to the new math and its renamed variables.
   * The previous math keeps its own.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {Promise<{text: string|null, apply: Function, library: Object}|null>} Null when the save leaves the
   *   sidecar as it is.
   */
  async function prepareAnnotationChange(save) {
    const { mathRef, annotations } = save
    const previousMathRef = save.previousMathRef ?? mathRef
    let text = annotations?.text
    if (typeof text !== 'string') {
      const previousText = libraryStore.getModuleAnnotations(previousMathRef)
      const renames = findVariableRenames(save)
      if (!previousText || (mathRef === previousMathRef && !renames.size)) return null
      try {
        text = await renameSidecar(previousText, previousMathRef, mathRef, renames)
      } catch (err) {
        console.warn(`Could not move the annotations of ${previousMathRef} to ${mathRef}:`, err)
        return null
      }
    }

    const states = { before: libraryStore.getModuleAnnotations(mathRef), after: text?.trim() ? text : null }
    if (states.after === states.before) return null
    return {
      text: states.after,
      apply: () => libraryStore.setModuleAnnotations(mathRef, states.after),
      library: {
        isAt: (side) => libraryStore.getModuleAnnotations(mathRef) === states[side],
        restore: (side) => libraryStore.setModuleAnnotations(mathRef, states[side]),
      },
    }
  }

  /**
   * Finds the nodes a save writes: the edited node, the siblings it applies to, and every node on its old or new
   * math.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {Array<string>}
   */
  function findAffectedIds({ id, mathRef, previousMathRef, updateAll, siblings }) {
    return [
      ...new Set([
        id,
        ...(updateAll ? siblings : []),
        ...nodes.value.filter((node) => [mathRef, previousMathRef].includes(node.data?.mathRef)).map((node) => node.id),
      ]),
    ]
  }

  /**
   * Parses the sidecars the affected nodes' ports follow: the saved math's as the save leaves it, and the others'
   * as they are.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @param {Object|null} annotationChange - From prepareAnnotationChange.
   * @param {Array<string>} affectedIds
   * @returns {Promise<(mathRef: string) => Object|null|undefined>} A math's sidecar, null when the save clears
   *   it, undefined when there is none to follow.
   */
  async function prepareSidecars({ mathRef, math }, annotationChange, affectedIds) {
    const text = annotationChange ? annotationChange.text : libraryStore.getModuleAnnotations(mathRef)
    const cellml = math ?? libraryStore.availableMath.get(mathRef)
    const otherRefs = [
      ...new Set(affectedIds.map((nodeId) => nodes.value.find((node) => node.id === nodeId)?.data?.mathRef).filter((ref) => ref && ref !== mathRef)),
    ]
    const [target, others] = await Promise.all([
      text ? parseSidecar(text, { mathRef, cellml }) : null,
      Promise.all(otherRefs.map(async (ref) => [ref, await libraryStore.ensureModuleAnnotations(ref)])),
      annotationStore.ensureApiCoords(),
    ])
    const sidecars = new Map(others.filter(([, sidecar]) => sidecar))
    const isCleared = !!annotationChange && !text
    return (ref) => (ref === mathRef ? (target ?? (isCleared ? null : undefined)) : sidecars.get(ref))
  }

  /**
   * Builds the nodes as a save would leave them, before their sidecar ports are reconciled.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {Array<Object>} Copies; the workspace nodes are not changed.
   */
  function previewSavedNodes({ id, name, variables, ports, mathRef, updateAll, siblings }) {
    const validVariables = new Set(variables.map((row) => row.name))
    return nodes.value.map((node) => {
      const data = detachReactivity(node.data ?? {})
      if (node.id === id) return { id: node.id, data: { ...data, name, variables, ports, mathRef } }
      const isMoved = updateAll && siblings.includes(node.id)
      if (!isMoved && data.mathRef !== mathRef) return { id: node.id, data }
      const nodePorts = (data.ports ?? []).filter((port) => (port.variables ?? []).every((v) => validVariables.has(v)))
      return { id: node.id, data: { ...data, mathRef, variables, ports: nodePorts } }
    })
  }

  /**
   * Counts the annotated couplings a save would drop, as its sidecar ports are reconciled and their couplings
   * re-checked, so the editor can ask first.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {Promise<{ couplings: number, connections: number }>}
   */
  async function findDroppedCouplings(save) {
    const affectedIds = findAffectedIds(save)
    const sidecarFor = await prepareSidecars(save, await prepareAnnotationChange(save), affectedIds)
    const preview = previewSavedNodes(save)
    const canvasPorts = nodes.value.find((node) => node.id === save.id)?.data?.ports
    const { couplings } = reconcileNodePorts({
      nodes: preview,
      edges: edges.value,
      nodeIds: affectedIds,
      sidecarFor,
      context: buildSaveContext(sidecarFor, preview),
      portChanges: new Map([[save.id, findSidecarPortChanges(canvasPorts, save.ports)]]),
    })
    return countDroppedCouplings(edges.value, couplings)
  }

  /**
   * Applies an instance editor save as one undo step. Undo puts back the math only while it is still
   * what the save wrote, and keeps math a save created while any node still uses it.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {Promise<number>} How many nodes now use the saved math reference.
   */
  async function saveInstanceEdit(save) {
    const { mathRef, math, isLayoutChanged, updateAll, siblings } = save
    const annotationChange = await prepareAnnotationChange(save)
    const affectedIds = findAffectedIds(save)
    const sidecarFor = await prepareSidecars(save, annotationChange, affectedIds)
    const writtenMathRef = math !== null || isLayoutChanged ? mathRef : null
    const mathBefore = writtenMathRef && libraryStore.getMathEntry(writtenMathRef)
    let mathAfter = null

    const isUsed = (ref) => nodes.value.some((node) => node.data?.mathRef === ref)
    const plotChange = preparePlotChange(save)
    const moduleChange = prepareModuleChange(save)

    await recordEdit({
      type: 'edit-instance',
      nodeIds: affectedIds,
      keys: NODE_KEYS,
      edgeIds: findIncidentEdgeIds(affectedIds),
      apply: () => {
        annotationChange?.apply()
        const moduleRef = applySave(save, affectedIds, sidecarFor)
        moduleChange?.created(moduleRef)
        mathAfter = writtenMathRef && libraryStore.getMathEntry(writtenMathRef)
        plotChange?.apply()
      },
      library: combineLibraries([
        writtenMathRef && {
          // Math a save created stays while another node uses it, so an undo may leave it in place.
          isAt: (side) => {
            const current = libraryStore.getMathEntry(writtenMathRef)
            if (side === 'after') return isSameMathEntry(current, mathAfter)
            return isSameMathEntry(current, mathBefore) || (!mathBefore && isSameMathEntry(current, mathAfter))
          },
          restore: (side) => {
            if (side === 'after') return libraryStore.restoreMathEntry(writtenMathRef, mathAfter)
            if (!mathBefore && isUsed(writtenMathRef)) return
            libraryStore.restoreMathEntry(writtenMathRef, mathBefore)
          },
        },
        moduleChange?.library,
        plotChange?.library,
        annotationChange?.library,
      ]),
    })

    return 1 + (updateAll ? siblings.length : 0)
  }

  return { saveInstanceEdit, findDroppedCouplings }
}
