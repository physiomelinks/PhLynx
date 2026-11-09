import { useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { useDefaultParametersStore } from '../stores/defaultParametersStore'
import {
  changedSetEntries,
  hasNewValues,
  hasSetEntries,
  isOwnInstanceSet,
  isSharedSet,
  otherSetUsers,
} from '../utils/parameters/instanceSet'
import { planSharedSetUpdate } from '../utils/parameters/apply'
import { renameSidecar } from '../services/annotations/sidecarEdit'
import { analyzeMathXml } from '../services/math/analyzeMath'
import { carryRenames } from '../services/math/carryRenames'
import {
  fillBlankValues,
  getPortVariables,
  keepDefaults,
  reconcileRows,
  renamePortVariables,
  renameRows,
  renameValues,
} from '../services/math/reconcileRows'
import { instanceConfigSource, isSoleOwnConfig } from '../services/configOwnership'
import { spreadConfig } from '../services/configSpread'
import { separateParameters } from '../services/math/separateParameters'
import { rescaleRows } from '../services/math/unitRescale'
import { getModuleFormat } from '../services/moduleFormats'
import { getNodeSelections, replaceNodeSelections, setNodePlotVariables } from '../services/simulation/plotSelections'
import { FLOW_IDS, GHOST_NODE_TYPE, PROTECTED_MATH_REFS } from '../utils/constants'
import { carryDrivesState, previewCouplings } from '../utils/edges'
import { detachReactivity } from '../utils/reactivity'
import { isBlank } from '../utils/variables'
import { useNodeDataHistory } from './useNodeDataHistory'

const NODE_KEYS = ['name', 'variables', 'ports', 'mathRef', 'moduleRef', 'parameterisation']

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
 * Copies a node's ports for its module or another node, without the ids the connection dialog gives them, which are
 * each node's own.
 *
 * @param {Array} ports
 * @returns {Array}
 */
function toModulePorts(ports) {
  return detachReactivity(ports ?? []).map(({ _uid, ...port }) => port)
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
 * @returns {Object} saveInstanceEdit, savePortEdit and findVariableRenames.
 */
export function useInstanceSave(flowId = FLOW_IDS.MAIN) {
  const { nodes, edges, findNode, updateNodeData } = useVueFlow(flowId)
  const libraryStore = useLibraryStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const defaultParameters = useDefaultParametersStore()
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
   * @param {Map<string, Array>} [marked] - Edges' couplings as the save confirmed them, whose `drivesState` marks they
   *   keep, matched by port label (see confirmPortEditDrives).
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
   * Checks whether a save writes math that no library module uses yet, such as a new component. Math whose
   * ids alone changed is the same math.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {boolean}
   */
  function isNewModuleSave({ mathRef, math, idsChanged }) {
    if (math === null || idsChanged) return false
    return !PROTECTED_MATH_REFS.has(mathRef) && !libraryStore.availableCollections.has(mathRef)
  }

  /**
   * Gives a node another node's ports and variable kinds, keeping its values. Rows its math or the new ports
   * need are added blank.
   *
   * @param {Object} node
   * @param {{ports: Array, variables: Array}} config
   */
  function applyConfigTo(node, config) {
    updateNodeData(node.id, spreadConfig(node, config))
    updateVariablesFromMath(findNode(node.id), node.data.mathRef)
    cleanPorts(findNode(node.id))
  }

  /**
   * Writes the edited node's config to the library. The save's `config.action` says how: 'update' writes it to the
   * node's module and every other node on it, 'new' adds `config.moduleRef` as this node's own (see configOwnership),
   * which updates without asking while no other node uses it, and 'follow' moves
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
      // A new config keeps the module's default parameter set, so its instances and its export still name it.
      const defaultSet = module?.defaultParameterisation && { defaultParameterisation: module.defaultParameterisation }
      const newModule = {
        moduleRef: config.moduleRef,
        mathRef,
        ports: toModulePorts(ports),
        variables: toModuleRows(variables),
        source: instanceConfigSource(id),
        ...defaultSet,
      }
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
      ports: toModulePorts(ports),
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
    // The source's renames, and the units its math changed, are its own variables', so they move and rescale only the
    // rows of nodes that were on the saved math, not those of another module's it overwrote.
    const previousMathRef = save.previousMathRef ?? mathRef
    const renamedIds = new Set(nodes.value.filter((node) => node.data?.mathRef === previousMathRef).map((node) => node.id))

    // Without its own module, a node would keep its old one's ref, which export keys configs by.
    // Only siblings on the edited node's old module share its ports, so only they move to the new one. When this
    // node saves a config of its own, they keep their old module's.
    const previousModuleRef = findNode(id)?.data.moduleRef
    const previousModule = libraryStore.availableModules.get(previousModuleRef)
    // The old module's config follows the source's renames, as the switching nodes' rows do.
    const moduleSource =
      save.config?.action === 'new' && previousModule
        ? { ports: renamePortVariables(previousModule.ports, renames), variables: renameRows(previousModule.variables ?? [], renames) }
        : { ports, variables }
    // The node's own config unless it moves to a new one, leaving this module to the siblings switching with it.
    const ownership = save.config?.action === 'new' ? {} : { source: instanceConfigSource(id) }
    const moduleRef = isNewModule ? libraryStore.createModuleForMath(mathRef, { ...detachReactivity(moduleSource), ...ownership }) : null

    const moduleFields = moduleRef ? { moduleRef } : {}
    // The parameter set the editor last applied, which a later import of that set re-applies.
    const setFields = save.parameterisation ? { parameterisation: save.parameterisation } : {}
    updateNodeData(id, { name, variables, ports, mathRef, ...moduleFields, ...setFields })
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

    const configured = applyConfig(save)
    // Marks confirmed for edges of the instances an update spread the ports to are kept as theirs are recomputed.
    const marked = new Map(save.drivenCouplings ?? [])
    recomputeEdgeCouplings(id, marked)
    new Set([...otherNodes.map((node) => node.id), ...configured]).forEach((nodeId) => recomputeEdgeCouplings(nodeId, marked))
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
   * Gets the write-back of a save's values to the parameter set its node made (dropped with Parameters "None"), as a
   * recordEdit `library` entry, while no other node is tagged with it. Imported sets, sets other nodes made, and the
   * node's own set once others use it (see prepareSharedSetChange) are never written here.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {{apply: Function, library: Object}|null} Null when the node uses no set it made alone.
   */
  function prepareInstanceSetChange({ id, mathRef, variables, parameterisation }) {
    const paramRef = parameterisation ?? findNode(id)?.data.parameterisation
    const set = paramRef ? defaultParameters.getSet(mathRef, paramRef) : null
    if (!isOwnInstanceSet(set, id)) return null
    if (otherSetUsers(nodes.value, { nodeId: id, mathRef, paramRef }).length) return null
    const states = { before: set, after: null }
    const current = () => defaultParameters.getSet(mathRef, paramRef)
    return {
      apply: () => {
        defaultParameters.updateInstanceSet(mathRef, paramRef, id, variables)
        states.after = current()
      },
      library: {
        isAt: (side) => current() === states[side],
        restore: (side) => defaultParameters.restoreSet(mathRef, paramRef, states[side]),
      },
    }
  }

  /**
   * Gets what a save does to a set its node shares with others (an imported set, another node's, or its own once
   * another node uses it), as the editor asked: `update` writes the changed values into the set and gives them to the
   * other nodes tagged with it; `new` makes the node a set of its own from its values, as dropping it with Parameters
   * "None" does, and tags it with it.
   *
   * @param {Object} save - The instance editor's `confirm` payload; `parameterSet.action` is what was chosen.
   * @returns {{nodeIds: string[], apply: Function, library: Object}|null} Null when the save changes no shared set.
   *   `nodeIds` are the other nodes the step changes.
   */
  function prepareSharedSetChange(save) {
    const { id, mathRef, variables, parameterSet } = save
    const node = findNode(id)
    const paramRef = save.parameterisation ?? node?.data.parameterisation
    const set = parameterSet && paramRef ? defaultParameters.getSet(mathRef, paramRef) : null
    const users = set ? otherSetUsers(nodes.value, { nodeId: id, mathRef, paramRef }) : []
    if (!node || !isSharedSet(set, id, users)) return null
    const current = (ref) => defaultParameters.getSet(mathRef, ref)

    if (parameterSet.action === 'update') {
      const entries = changedSetEntries(set, node.data.variables, variables)
      if (!hasSetEntries(entries)) return null
      const target = { nodeId: id, mathRef, paramRef }
      const states = { before: set, after: null }
      return {
        nodeIds: otherSetUsers(nodes.value, target).map((other) => other.id),
        apply: () => {
          defaultParameters.updateSetEntries(mathRef, paramRef, entries)
          // The node's own set holds all its values, as a save while no other node used it writes them.
          defaultParameters.updateInstanceSet(mathRef, paramRef, id, variables)
          states.after = current(paramRef)
          planSharedSetUpdate(nodes.value, target, entries).variablesById.forEach((rows, nodeId) =>
            updateNodeData(nodeId, { variables: rows })
          )
        },
        library: {
          isAt: (side) => current(paramRef) === states[side],
          restore: (side) => defaultParameters.restoreSet(mathRef, paramRef, states[side]),
        },
      }
    }

    if (parameterSet.action !== 'new') return null
    const states = { ref: null, before: null, after: null }
    return {
      nodeIds: [],
      apply: () => {
        states.after = defaultParameters.addInstanceSet(mathRef, id, save.name, findNode(id).data.variables)
        states.ref = states.after.ref
        updateNodeData(id, { parameterisation: states.ref })
      },
      library: {
        isAt: (side) => current(states.ref) === states[side],
        restore: (side) => defaultParameters.restoreSet(mathRef, states.ref, states[side]),
      },
    }
  }

  /**
   * Gets a save's silent parameter-set bookkeeping, as a recordEdit `library` entry. A node with no set (none tagged,
   * and no set loaded for its config's default) that the save gives values makes a set of its own from them, as
   * dropping it with Parameters "None" does, and is tagged with it. A config the node owns alone, with no default,
   * then takes the node's own set as its default. Call `apply` once the save has moved the node to its final module.
   *
   * @param {Object} save - The instance editor's `confirm` payload, or `{id}` for a ports edit.
   * @returns {{apply: Function, library: Object}|null} Null when the save can neither make a set nor give a default.
   */
  function prepareParameterDefaults(save) {
    const { id, variables } = save
    const node = findNode(id)
    if (!node || flowId !== FLOW_IDS.MAIN || node.type === GHOST_NODE_TYPE) return null
    const tag = save.parameterisation ?? node.data.parameterisation
    // The editor shows a global constant's shared value, which the node's row leaves blank.
    const rowsBefore = (node.data.variables ?? []).map((row) =>
      row.type === 'global_constant' && isBlank(row.value) ? { ...row, value: libraryStore.getGlobalConstant(row.name)?.value } : row
    )
    const makesSet = !tag && !!variables && hasNewValues(rowsBefore, variables)
    // Only a node with a set of its own, or about to have one, gives its config a default.
    const hasOwnSet = isOwnInstanceSet(tag && defaultParameters.getSet(save.mathRef ?? node.data.mathRef, tag), id)
    if (!makesSet && !hasOwnSet && save.parameterSet?.action !== 'new') return null
    const states = { mathRef: null, ref: null, before: null, after: null, moduleRef: null, defaultRef: null }
    const currentSet = () => defaultParameters.getSet(states.mathRef, states.ref)
    const currentModule = () => libraryStore.availableModules.get(states.moduleRef)
    // Only the default is this step's: the config's other changes, and a config the save added, are its config entry's.
    const defaultAt = (side) => (side === 'after' ? states.defaultRef : undefined)
    const setDefault = (module, defaultRef) => {
      const { defaultParameterisation, ...rest } = detachReactivity(module)
      libraryStore.replaceModule(defaultRef ? { ...rest, defaultParameterisation: defaultRef } : rest)
    }

    return {
      apply: () => {
        const data = findNode(id).data
        const module = libraryStore.availableModules.get(data.moduleRef)
        const hasDefaultSet = !!module?.defaultParameterisation && !!defaultParameters.getSet(data.mathRef, module.defaultParameterisation)
        if (makesSet && !hasDefaultSet) {
          states.after = defaultParameters.addInstanceSet(data.mathRef, id, data.name, data.variables)
          Object.assign(states, { mathRef: data.mathRef, ref: states.after.ref })
          updateNodeData(id, { parameterisation: states.ref })
        }
        const own = findNode(id).data.parameterisation
        const otherCount = nodes.value.filter((other) => other.id !== id && other.data?.moduleRef === data.moduleRef).length
        if (!module || module.defaultParameterisation || !isSoleOwnConfig(module, id, otherCount)) return
        if (!isOwnInstanceSet(defaultParameters.getSet(data.mathRef, own), id)) return
        Object.assign(states, { moduleRef: data.moduleRef, defaultRef: own })
        setDefault(module, own)
      },
      library: {
        isAt: (side) =>
          (!states.ref || currentSet() === states[side]) &&
          (!states.moduleRef || !currentModule() || currentModule().defaultParameterisation === defaultAt(side)),
        restore: (side) => {
          if (states.ref) defaultParameters.restoreSet(states.mathRef, states.ref, states[side])
          if (states.moduleRef && currentModule()) setDefault(currentModule(), defaultAt(side))
        },
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
   * annotations, or else the previous math's sidecar moved to the new math. Its variable subjects are
   * ids, which follow renamed variables as they are. The previous math keeps its own.
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
      if (!previousText || mathRef === previousMathRef) return null
      try {
        text = await renameSidecar(previousText, previousMathRef, mathRef)
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
   * Applies an instance editor save as one undo step. Undo puts back the math only while it is still
   * what the save wrote, and keeps math a save created while any node still uses it.
   *
   * @param {Object} save - The instance editor's `confirm` payload.
   * @returns {Promise<number>} How many nodes the save updated.
   */
  async function saveInstanceEdit(save) {
    const { id, mathRef, previousMathRef, math, isLayoutChanged, isSourceChanged, updateAll, siblings, config } = save
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
    const sharedSetChange = prepareSharedSetChange(save)
    affectedIds.push(...(sharedSetChange?.nodeIds ?? []).filter((nodeId) => !affectedIds.includes(nodeId)))
    const writtenMathRef = math !== null || isLayoutChanged || isSourceChanged ? mathRef : null
    const mathBefore = writtenMathRef && libraryStore.getMathEntry(writtenMathRef)
    let mathAfter = null

    const isUsed = (ref) => nodes.value.some((node) => node.data?.mathRef === ref)
    const annotationChange = await prepareAnnotationChange(save)
    const plotChange = preparePlotChange(save)
    const moduleChange = prepareModuleChange(save)
    const unitsChange = prepareUnitsChange(save)
    const configChange = prepareConfigChange(save)
    const setChange = prepareInstanceSetChange(save)
    const defaultsChange = prepareParameterDefaults(save)

    await recordEdit({
      type: 'edit-instance',
      nodeIds: affectedIds,
      keys: NODE_KEYS,
      edgeIds: findIncidentEdgeIds(affectedIds),
      apply: () => {
        annotationChange?.apply()
        const moduleRef = applySave(save)
        setChange?.apply()
        sharedSetChange?.apply()
        // Once the node's set is settled, and before the module changes capture the modules, so they hold a default
        // it gives.
        defaultsChange?.apply()
        moduleChange?.created(moduleRef)
        configChange?.changed()
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
        configChange?.library,
        plotChange?.library,
        setChange?.library,
        sharedSetChange?.library,
        defaultsChange?.library,
        annotationChange?.library,
      ]),
    })

    return 1 + (updateAll ? siblings.length : 0)
  }

  /**
   * Applies a ports edit made outside the instance editor, such as in the connection dialog, as one undo step, with
   * the module change each node's `configs` entry chooses (see useModuleConfigPrompt's resolvePortEdits). An
   * instance an earlier node's update gave that node's ports keeps them unless its own config changed too.
   *
   * @param {Object} edit
   * @param {string} edit.type - The command type.
   * @param {Array<[string, Array]>} edit.ports - Each node's id and ports after the edit, in the order resolved.
   * @param {Map<string, Object>} [edit.configs] - Each changed node's config by id.
   * @param {Map<string, Array>} [edit.drivenCouplings] - Couplings, by edge, confirmed to drive a store, whose marks the
   *   edges of instances an update rewrote keep (see confirmPortEditDrives).
   * @param {Function} [edit.apply] - Makes the rest of the edit once the ports are written, such as edges' couplings.
   * @returns {Promise<boolean>} Whether a step was recorded.
   */
  async function savePortEdit({ type, ports, configs = new Map(), drivenCouplings = new Map(), apply = () => {} }) {
    const ids = ports.map(([id]) => id)
    const updatedRefs = new Set(
      [...configs].filter(([, config]) => config.action === 'update').map(([id]) => findNode(id)?.data.moduleRef)
    )
    const affectedIds = [
      ...new Set([...ids, ...nodes.value.filter((node) => updatedRefs.has(node.data?.moduleRef)).map((node) => node.id)]),
    ]
    const configChanges = [...configs].map(([id, config]) => prepareConfigChange({ id, config }))
    // A config made here takes its node's own set as its default.
    const defaultsChanges = [...configs].map(([id]) => prepareParameterDefaults({ id }))

    return recordEdit({
      type,
      nodeIds: affectedIds,
      keys: NODE_KEYS,
      edgeIds: findIncidentEdgeIds(affectedIds),
      apply: () => {
        // Instances whose ports an update rewrote after the edit's own, whose couplings follow them.
        const rewritten = new Set()
        ports.forEach(([id, nodePorts]) => {
          const config = configs.get(id)
          if (rewritten.has(id) && !config) return
          updateNodeData(id, { ports: nodePorts })
          rewritten.delete(id)
          applyConfig({ id, config, math: null }).forEach((other) => rewritten.add(other))
        })
        apply()
        defaultsChanges.forEach((change) => change?.apply())
        configChanges.forEach((change) => change?.changed())
        rewritten.forEach((id) => recomputeEdgeCouplings(id, drivenCouplings))
      },
      library: combineLibraries([...configChanges, ...defaultsChanges].map((change) => change?.library ?? null)),
    })
  }

  return { saveInstanceEdit, savePortEdit, findVariableRenames }
}
