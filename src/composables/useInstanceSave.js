import { useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import {
  fillBlankValues,
  getPortVariables,
  keepDefaults,
  reconcileRows,
  renamePortVariables,
  renameRows,
  renameValues,
} from '../services/math/reconcileRows'
import { separateParameters } from '../services/math/separateParameters'
import { rescaleRows } from '../services/math/unitRescale'
import { getModuleFormat } from '../services/moduleFormats'
import { getNodeSelections, replaceNodeSelections, setNodePlotVariables } from '../services/simulation/plotSelections'
import { FLOW_IDS, PROTECTED_MATH_REFS } from '../utils/constants'
import { carryDrivesState, previewCouplings } from '../utils/edges'
import { detachReactivity } from '../utils/reactivity'
import { useNodeDataHistory } from './useNodeDataHistory'

const NODE_KEYS = ['name', 'variables', 'ports', 'mathRef', 'moduleRef']

/**
 * Checks whether two math entries (see libraryStore.getMathEntry) hold the same math, defaults, layout and source.
 *
 * @param {Object|null} entry
 * @param {Object|null} otherEntry
 * @returns {boolean}
 */
function isSameMathEntry(entry, otherEntry) {
  const serialise = (value) => value && JSON.stringify([value.math, [...value.defaults], value.layout, value.source])
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
  const libraryStore = useLibraryStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const { recordEdit, findIncidentEdgeIds } = useNodeDataHistory(flowId)

  /**
   * Rebuilds a node's rows from its math, keeping their values. A row the math newly needs starts
   * blank: the math's defaults only seed new instances. Locked math (e.g. generated from a diagram)
   * can't be edited to fill them, so its blank rows take the math's defaults.
   *
   * @param {Object} node
   * @param {string} mathRef - The math the node now uses.
   */
  function updateVariablesFromMath(node, mathRef) {
    const analysis = libraryStore.getMathAnalysis(mathRef)
    if (!analysis) return
    const isLocked = getModuleFormat(libraryStore.getMathFormat(mathRef)).isMathLocked
    const defaults = isLocked ? libraryStore.getMathDefaults(mathRef) : new Map()
    const rows = reconcileRows(analysis, node.data.variables ?? [], {
      portVariables: getPortVariables(node.data.ports),
      defaults,
    })
    node.data.variables = isLocked ? fillBlankValues(rows, defaults) : rows
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
   * Recomputes couplings on every edge touching a node from the current ports, keeping which drive a store. Call it
   * after changing ports on one or more nodes.
   *
   * @param {string} nodeId
   * @param {Map<string, Array>} [marked] - Edges' couplings as the save confirmed them, under the old variable names, whose
   *   `drivesState` marks they keep (InstanceEditorDialog's confirmPortDrives).
   */
  function recomputeEdgeCouplings(nodeId, marked = new Map()) {
    const node = findNode(nodeId)
    if (!node) return
    const couplings = previewCouplings(nodeId, node.data.ports ?? [], nodes.value, edges.value)
    edges.value.forEach((edge) => {
      if (!couplings.has(edge.id)) return
      edge.data = { ...edge.data, couplings: carryDrivesState(marked.get(edge.id) ?? [], couplings.get(edge.id), { byLabel: true }) }
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
    const { id, name, variables, ports, mathRef, math, layout, isLayoutChanged, source, isSourceChanged, units, globalConstants, updateAll, siblings } =
      save
    const renames = new Map(save.renames ?? [])
    const unitRescales = save.unitRescales ?? []
    // The module's defaults before its source regenerated the math, under the names the source's edit gave them.
    const previousDefaults = save.previousDefaults ? renameValues(new Map(save.previousDefaults), renames) : null
    // Keep the shared units and reference, so one node's fields don't replace them.
    globalConstants.forEach(({ name, value, units, data_reference, overwrite }) => {
      const shared = libraryStore.getGlobalConstant(name)
      libraryStore.assignGlobalConstant(name, value, shared?.units ?? units, shared?.data_reference ?? data_reference, !!overwrite)
    })
    const isNewModule = isNewModuleSave(save)
    // The source first, so the math's format is known once the math is added.
    if (isSourceChanged) libraryStore.setMathSource(mathRef, source ?? null)
    // Units generated with the math, kept in the module's own file, are there before the math is analysed.
    if (units?.model) libraryStore.addUnitsFile(detachReactivity(units))
    else if (units) libraryStore.removeUnitsFile(units.componentFile)
    if (math !== null) {
      libraryStore.addMath(mathRef, math, true, layout)
      // A source's math is laid out afresh with each generation, so a layout from its last one is never kept.
      if (isSourceChanged && !layout) libraryStore.setMathLayout(mathRef, null)
      // Values are each instance's, so a regenerated math keeps the module's defaults; only new variables take the
      // source's values.
      if (previousDefaults) {
        const kept = keepDefaults(separateParameters(math).values, previousDefaults)
        libraryStore.setMathDefaults(mathRef, new Map([...libraryStore.getMathDefaults(mathRef), ...kept]))
      }
    } else if (isLayoutChanged) libraryStore.setMathLayout(mathRef, layout)
    const moduleRef = isNewModule ? libraryStore.createModuleForMath(mathRef, detachReactivity({ ports, variables })) : null
    // The source's renames, and the units its math changed, are its own variables', so they move and rescale only the
    // rows of nodes that were on the saved math, not those of another module's it overwrote.
    const previousMathRef = save.previousMathRef ?? mathRef
    const renamedIds = new Set(nodes.value.filter((node) => node.data?.mathRef === previousMathRef).map((node) => node.id))

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
      // Values, and ports, follow variables the source's edit renamed.
      if (renames.size && renamedIds.has(node.id)) {
        node.data.variables = renameRows(node.data.variables ?? [], renames)
        node.data.ports = renamePortVariables(node.data.ports, renames)
      }
      // Values keep their quantities in the math's new units.
      if (unitRescales.length && renamedIds.has(node.id)) node.data.variables = rescaleRows(node.data.variables ?? [], unitRescales)
      updateVariablesFromMath(node, mathRef)
      cleanPorts(node)
    })

    recomputeEdgeCouplings(id, new Map(save.drivenCouplings ?? []))
    otherNodes.forEach((node) => recomputeEdgeCouplings(node.id))
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
   * Gets the units file a save replaces or removes, as a recordEdit `library` entry.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {{captureAfter: Function, library: Object}|null} Null when the save writes no units. Call
   *   `captureAfter` once the save is applied.
   */
  function prepareUnitsChange({ units }) {
    if (!units) return null
    const { componentFile } = units
    const current = () => libraryStore.availableUnits.find((file) => file.componentFile === componentFile)?.model ?? null
    const states = { before: current(), after: null }
    return {
      captureAfter: () => (states.after = current()),
      library: {
        isAt: (side) => current() === states[side],
        restore: (side) => {
          if (states[side] === null) libraryStore.removeUnitsFile(componentFile)
          else libraryStore.addUnitsFile({ componentFile, model: states[side] })
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
   * @returns {Promise<number>} How many nodes the save updated.
   */
  async function saveInstanceEdit(save) {
    const { id, mathRef, previousMathRef, math, isLayoutChanged, isSourceChanged, updateAll, siblings } = save
    const affectedIds = [
      ...new Set([
        id,
        ...(updateAll ? siblings : []),
        ...nodes.value.filter((node) => [mathRef, previousMathRef].includes(node.data?.mathRef)).map((node) => node.id),
      ]),
    ]
    const writtenMathRef = math !== null || isLayoutChanged || isSourceChanged ? mathRef : null
    const mathBefore = writtenMathRef && libraryStore.getMathEntry(writtenMathRef)
    let mathAfter = null

    const isUsed = (ref) => nodes.value.some((node) => node.data?.mathRef === ref)
    const plotChange = preparePlotChange(save)
    const moduleChange = prepareModuleChange(save)
    const unitsChange = prepareUnitsChange(save)

    await recordEdit({
      type: 'edit-instance',
      nodeIds: affectedIds,
      keys: NODE_KEYS,
      edgeIds: findIncidentEdgeIds(affectedIds),
      apply: () => {
        const moduleRef = applySave(save)
        moduleChange?.created(moduleRef)
        mathAfter = writtenMathRef && libraryStore.getMathEntry(writtenMathRef)
        unitsChange?.captureAfter()
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
        unitsChange?.library,
        plotChange?.library,
      ]),
    })

    return 1 + (updateAll ? siblings.length : 0)
  }

  return { saveInstanceEdit }
}
