import { useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { getPortVariables, reconcileRows } from '../services/math/reconcileRows'
import { getNodeSelections, replaceNodeSelections, setNodePlotVariables } from '../services/simulation/plotSelections'
import { FLOW_IDS, PROTECTED_MATH_REFS } from '../utils/constants'
import { previewCouplings } from '../utils/edges'
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
 * Gets a module's rows for a node's: their names and kinds, with the module's own values where it has the row.
 *
 * @param {Array} rows - The node's rows.
 * @param {Array} [moduleRows=rows] - The module's current rows, for their values.
 * @returns {Array}
 */
function toModuleRows(rows, moduleRows = rows) {
  const previous = new Map(moduleRows.map((row) => [row.name, row]))
  return detachReactivity(
    rows.map(({ name, units, access, type }) => ({
      name,
      value: previous.get(name)?.value ?? null,
      units,
      access,
      type,
      data_reference: previous.get(name)?.data_reference ?? null,
    }))
  )
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
   * Recomputes couplings on every edge touching a node from the current ports. Call it after
   * changing ports on one or more nodes.
   *
   * @param {string} nodeId
   */
  function recomputeEdgeCouplings(nodeId) {
    const node = findNode(nodeId)
    if (!node) return
    const couplings = previewCouplings(nodeId, node.data.ports ?? [], nodes.value, edges.value)
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
   * Gives a node another node's ports and variable kinds, keeping its values. Rows its math or the new ports
   * need are added blank.
   *
   * @param {Object} node
   * @param {{ports: Array, variables: Array}} config
   */
  function applyConfigTo(node, { ports, variables }) {
    const kinds = new Map(variables.map((row) => [row.name, row]))
    const rows = node.data.variables.map((row) => {
      const kind = kinds.get(row.name)
      return kind ? { ...row, units: kind.units, access: kind.access, type: kind.type } : row
    })
    const names = new Set(rows.map((row) => row.name))
    const added = toModuleRows(variables.filter((row) => !names.has(row.name)), [])
    updateNodeData(node.id, { ports: detachReactivity(ports), variables: [...rows, ...added] })
    updateVariablesFromMath(findNode(node.id), node.data.mathRef)
    cleanPorts(findNode(node.id))
  }

  /**
   * Writes the edited node's config to the library. The save's `config.action` says how: 'update' writes it to the
   * node's module and every other node on it, 'new' adds `config.moduleRef` for this node alone, and 'follow' moves
   * the module to the node's math. A 'new' with `follow` also moves the module it leaves to that math. A module on
   * changed math takes the ports and rows of an instance staying on it.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {string[]} The other nodes whose ports changed.
   */
  function applyConfig({ id, config, math }) {
    const node = findNode(id)
    if (!config || !node) return []
    const { moduleRef, mathRef, ports, variables } = node.data
    const module = libraryStore.availableModules.get(moduleRef)
    // New math may have dropped rows and ports from the instances staying on the module, so it takes theirs.
    const isMathChanged = math !== null || (module && module.mathRef !== mathRef)
    const stayer = isMathChanged && nodes.value.find((other) => other.id !== id && other.data?.moduleRef === moduleRef && other.data.mathRef === mathRef)
    const stayerConfig = stayer && {
      ports: detachReactivity(stayer.data.ports),
      variables: toModuleRows(stayer.data.variables, module?.variables ?? []),
    }
    if (config.action === 'new') {
      if ((config.follow || stayer) && module) libraryStore.replaceModule({ ...detachReactivity(module), mathRef, ...stayerConfig })
      const newModule = { moduleRef: config.moduleRef, mathRef, ports, variables: toModuleRows(variables) }
      libraryStore.addModule(detachReactivity(newModule))
      updateNodeData(id, { moduleRef: config.moduleRef })
      return []
    }

    if (!module) return []
    if (config.action === 'follow') {
      libraryStore.replaceModule({ ...detachReactivity(module), mathRef, ...stayerConfig })
      return []
    }
    libraryStore.replaceModule({
      ...detachReactivity(module),
      mathRef,
      ports: detachReactivity(ports),
      variables: toModuleRows(variables, module.variables ?? []),
    })
    const others = nodes.value.filter((other) => other.id !== id && other.data?.moduleRef === moduleRef)
    others.forEach((other) => applyConfigTo(other, node.data))
    return others.map((other) => other.id)
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
    // Without its own module, a node would keep its old one's ref, which export keys configs by.
    // Only siblings on the edited node's old module share its ports, so only they move to the new one. When this
    // node saves a config of its own, they keep their old module's.
    const previousModuleRef = findNode(id)?.data.moduleRef
    const previousModule = libraryStore.availableModules.get(previousModuleRef)
    const source = save.config?.action === 'new' && previousModule ? previousModule : { ports, variables }
    const moduleRef = isNewModule
      ? libraryStore.createModuleForMath(mathRef, detachReactivity({ ports: source.ports, variables: source.variables }))
      : null

    const moduleFields = moduleRef ? { moduleRef } : {}
    updateNodeData(id, { name, variables, ports, mathRef, ...moduleFields })
    if (updateAll) {
      siblings.forEach((siblingId) => {
        const isSameModule = findNode(siblingId)?.data.moduleRef === previousModuleRef
        updateNodeData(siblingId, { mathRef, ...(isSameModule ? moduleFields : {}) })
      })
    }

    // The edited node's rows are already reconciled by the editor. Every other node on this math is
    // rebuilt here, since an overwrite changes their math too.
    cleanPorts(findNode(id))
    const otherNodes = nodes.value.filter((node) => node.id !== id && node.data?.mathRef === mathRef)
    otherNodes.forEach((node) => {
      updateVariablesFromMath(node, mathRef)
      cleanPorts(node)
    })

    const configured = applyConfig(save)
    new Set([id, ...otherNodes.map((node) => node.id), ...configured]).forEach(recomputeEdgeCouplings)
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
   * Gets the module change a save's `config` makes, as a recordEdit `library` entry. Undo puts an updated module
   * back, and removes a new one unless a node still uses it.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {{changed: Function, library: Object}|null} Null when the save leaves the modules as they are.
   *   Call `changed` after applySave.
   */
  function prepareConfigChange({ id, config }) {
    if (!config) return null
    const isNew = config.action === 'new'
    const changes = [
      prepareModuleUpdate(findNode(id)?.data.moduleRef),
      isNew && prepareModuleAdd(config.moduleRef),
    ].filter(Boolean)
    if (!changes.length) return null
    return {
      changed: () => changes.forEach((change) => change.changed()),
      library: combineLibraries(changes.map((change) => change.library)),
    }
  }

  /**
   * Gets a change to a stored module, for prepareConfigChange.
   *
   * @param {string} moduleRef
   * @returns {{changed: Function, library: Object}|null} Null when there is no such module.
   */
  function prepareModuleUpdate(moduleRef) {
    const current = () => detachReactivity(libraryStore.availableModules.get(moduleRef) ?? null)
    const states = { before: current(), after: null }
    if (!states.before) return null
    return {
      changed: () => (states.after = current()),
      library: {
        isAt: (side) => JSON.stringify(current()) === JSON.stringify(states[side]),
        restore: (side) => libraryStore.replaceModule(detachReactivity(states[side])),
      },
    }
  }

  /**
   * Gets a module a save adds, for prepareConfigChange. Undo removes it unless a node still uses it.
   *
   * @param {string} moduleRef
   * @returns {{changed: Function, library: Object}}
   */
  function prepareModuleAdd(moduleRef) {
    let module = null
    const isUsed = () => nodes.value.some((node) => node.data?.moduleRef === moduleRef)
    const isStored = () => libraryStore.availableModules.has(moduleRef)
    return {
      changed: () => (module = detachReactivity(libraryStore.availableModules.get(moduleRef))),
      library: {
        isAt: (side) => (side === 'after' ? isStored() : !isStored() || isUsed()),
        restore: (side) => {
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
   * @returns {Promise<number>} How many nodes now use the saved math reference.
   */
  async function saveInstanceEdit(save) {
    const { id, mathRef, previousMathRef, math, isLayoutChanged, updateAll, siblings, config } = save
    const editedModuleRef = findNode(id)?.data.moduleRef
    const affectedIds = [
      ...new Set([
        id,
        ...(updateAll ? siblings : []),
        ...nodes.value
          .filter(
            (node) =>
              [mathRef, previousMathRef].includes(node.data?.mathRef) ||
              (config?.action === 'update' && node.data?.moduleRef === editedModuleRef)
          )
          .map((node) => node.id),
      ]),
    ]
    const writtenMathRef = math !== null || isLayoutChanged ? mathRef : null
    const mathBefore = writtenMathRef && libraryStore.getMathEntry(writtenMathRef)
    let mathAfter = null

    const isUsed = (ref) => nodes.value.some((node) => node.data?.mathRef === ref)
    const plotChange = preparePlotChange(save)
    const moduleChange = prepareModuleChange(save)
    const configChange = prepareConfigChange(save)

    await recordEdit({
      type: 'edit-instance',
      nodeIds: affectedIds,
      keys: NODE_KEYS,
      edgeIds: findIncidentEdgeIds(affectedIds),
      apply: () => {
        const moduleRef = applySave(save)
        moduleChange?.created(moduleRef)
        configChange?.changed()
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
        configChange?.library,
        plotChange?.library,
      ]),
    })

    return 1 + (updateAll ? siblings.length : 0)
  }

  return { saveInstanceEdit }
}
