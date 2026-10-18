import { useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { planRetypeBinding } from '../services/hierarchy/localConstants'
import { getPortVariables, reconcileRows } from '../services/math/reconcileRows'
import { getNodeSelections, replaceNodeSelections, setNodePlotVariables } from '../services/simulation/plotSelections'
import { FLOW_IDS, PROTECTED_MATH_REFS } from '../utils/constants'
import { previewCouplings } from '../utils/edges'
import { notify } from '../utils/notify'
import { detachReactivity } from '../utils/reactivity'
import { applyShadowedOverrideRemoval } from './useLocalConstants'
import { useModelGraph } from './useModelGraph'
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
 * @returns {Object} saveInstanceEdit.
 */
export function useInstanceSave(flowId = FLOW_IDS.MAIN) {
  const { nodes, edges, findNode, updateNodeData } = useVueFlow(flowId)
  const { expandSelection } = useModelGraph(flowId)
  const libraryStore = useLibraryStore()
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
   * Recomputes couplings on every edge touching a node from the current ports, each keeping its
   * slots while they are free (see previewCouplings). Call it after changing ports on one or more
   * nodes. A coupling with no free slot is left out.
   *
   * @param {string} nodeId
   * @param {Array<string>} conflicts - Collects a message for each coupling left out.
   */
  function recomputeEdgeCouplings(nodeId, conflicts) {
    const node = findNode(nodeId)
    if (!node) return
    const couplings = previewCouplings(nodeId, node.data.ports ?? [], nodes.value, edges.value, conflicts)
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
   * @returns {string|null} The ref of the module made for the math, if one was.
   */
  function applySave(save) {
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

    // An edge between two recomputed nodes is resolved for each, so report each coupling left out once.
    const conflicts = []
    recomputeEdgeCouplings(id, conflicts)
    otherNodes.forEach((node) => recomputeEdgeCouplings(node.id, conflicts))
    if (conflicts.length) notify.warning({ title: 'Couplings Removed', items: [...new Set(conflicts)] })
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
   * Applies an instance editor save as one undo step. Undo puts back the math only while it is still
   * what the save wrote, and keeps math a save created while any node still uses it.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {Promise<number>} How many instances of the model now use the saved math reference: a module inside a
   *   super-module counts once for each super instance of it.
   */
  async function saveInstanceEdit(save) {
    const { id, mathRef, previousMathRef, math, isLayoutChanged, updateAll, siblings } = save
    const affectedIds = [
      ...new Set([
        id,
        ...(updateAll ? siblings : []),
        ...nodes.value.filter((node) => [mathRef, previousMathRef].includes(node.data?.mathRef)).map((node) => node.id),
      ]),
    ]
    const writtenMathRef = math !== null || isLayoutChanged ? mathRef : null
    const mathBefore = writtenMathRef && libraryStore.getMathEntry(writtenMathRef)
    let mathAfter = null

    const isUsed = (ref) => nodes.value.some((node) => node.data?.mathRef === ref)
    const plotChange = preparePlotChange(save)
    const moduleChange = prepareModuleChange(save)
    // Rows retyped to a local constant leave their super instances' overrides inert, so those go too.
    const edited = findNode(id)
    const shadowed = edited ? planRetypeBinding(nodes.value, edited, save.variables) : { changes: new Map(), count: 0 }

    await recordEdit({
      type: 'edit-instance',
      nodeIds: [...affectedIds, ...shadowed.changes.keys()],
      keys: shadowed.changes.size ? [...NODE_KEYS, 'overrides'] : NODE_KEYS,
      edgeIds: findIncidentEdgeIds(affectedIds),
      apply: () => {
        const moduleRef = applySave(save)
        applyShadowedOverrideRemoval(shadowed, updateNodeData)
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
      ]),
    })

    return expandSelection([id, ...(updateAll ? siblings : [])]).length
  }

  return { saveInstanceEdit }
}
