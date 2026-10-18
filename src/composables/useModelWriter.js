/**
 * Writes values into the model by model id. A root module's model id is its node's id, so its values are written to
 * its node. A module inside a super instance is written, by default, for this super instance: as an override on the outermost
 * super instance of its path, keyed by the rest of the path, which wins over the super-module's value; or, as the
 * super-module's default, to the super-module's child itself, for every super instance not overriding it (see
 * services/hierarchy/overrides.js). A row bound to a local constant writes the local constant instead: this super
 * instance's override of it, or the super-module's declaration. Writes go through updateNodeData, inside whatever undo
 * step the caller records (see recordTargetOf).
 */
import { useVueFlow } from '@vue-flow/core'

import { useModelGraph } from './useModelGraph'
import { applyShadowedOverrideRemoval } from './useLocalConstants'
import { isLocalConstantRow, LOCAL_CONSTANT_TYPE, planRetypeBinding } from '../services/hierarchy/localConstants'
import {
  aggregateProvenance,
  inheritedLocalConstant,
  inheritedRows,
  localConstantTargetOf,
  overridesOf as listOverrides,
  provenanceOf as rowProvenance,
  withDeclaration,
  withOverrides,
  writeTargetOf,
} from '../services/hierarchy/overrides'
import { FLOW_IDS } from '../utils/constants'
import { notify } from '../utils/notify'
import { detachReactivity } from '../utils/reactivity'

/**
 * Gives the writers of the workspace's model, and where its values come from, for the parameter table and sidebar.
 *
 * @returns {{writeValue: Function, writeVariables: Function, resetOverride: Function, removeOverride: Function,
 *   recordTargetOf: Function, targetOf: Function, provenanceOf: Function, aggregateProvenanceOf: Function,
 *   overridesOf: Function}}
 */
export function useModelWriter() {
  const { findNode, updateNodeData, nodes } = useVueFlow(FLOW_IDS.MAIN)
  const model = useModelGraph()

  /**
   * Finds where a model id's values are written (see overrides.js writeTargetOf), telling the user when they can't be.
   *
   * @param {string} modelId
   * @param {'instance'|'supermodule'} [target='instance']
   * @returns {Object|null}
   */
  function targetOf(modelId, target = 'instance') {
    const found = writeTargetOf(modelId, target, model.graph.value.origin, findNode)
    if (found?.problem) {
      notify.warning({ title: 'Value Not Set', items: [found.problem] })
      return null
    }
    return found
  }

  /**
   * Gets what a write changes, for the caller's recordEdit: the node and data field written.
   *
   * @param {string} modelId
   * @param {Object} [options]
   * @param {'instance'|'supermodule'} [options.target='instance']
   * @param {string|null} [options.variable] - The row written, so a write of a local constant is found.
   * @param {Object|null} [options.patch] - Its fields written.
   * @returns {{nodeIds: string[], keys: string[]}} None for a write that can't be made.
   */
  function recordTargetOf(modelId, { target = 'instance', variable = null, patch = null } = {}) {
    if (isLocalConstantWrite(modelId, variable, patch)) {
      const found = localConstantTargetOf(modelId, target, model.graph.value.origin, findNode)
      return found?.nodeId ? { nodeIds: [found.nodeId], keys: [found.field] } : { nodeIds: [], keys: [] }
    }
    const found = writeTargetOf(modelId, target, model.graph.value.origin, findNode)
    if (!found?.nodeId) return { nodeIds: [], keys: [] }
    const { changes } = bindingPlanOf(found, variable, patch)
    return changes.size ? { nodeIds: [found.nodeId, ...changes.keys()], keys: [found.field, 'overrides'] } : { nodeIds: [found.nodeId], keys: [found.field] }
  }

  /**
   * Plans what a write retyping a super-module child's row to a local constant drops: the overrides it leaves inert
   * (see localConstants.js planRetypeBinding).
   *
   * @param {Object|null} found - The write's target (see writeTargetOf).
   * @param {string|null} variable
   * @param {Object|null} patch
   * @returns {{changes: Map<string, Object>, count: number}}
   */
  function bindingPlanOf(found, variable, patch) {
    if (found?.field !== 'variables' || patch?.type !== LOCAL_CONSTANT_TYPE || !variable) return { changes: new Map(), count: 0 }
    const child = findNode(found.nodeId)
    const rows = (child?.data?.variables ?? []).map((row) => (row.name === variable ? { ...row, ...patch } : row))
    return child ? planRetypeBinding(nodes.value, child, rows) : { changes: new Map(), count: 0 }
  }

  /** @returns {Array} A model node's rows as they are now. */
  const rowsOf = (modelId) => model.findModelNode(modelId)?.data?.variables ?? findNode(modelId)?.data?.variables ?? []

  /** @returns {boolean} Whether a write of a row sets the local constant it is bound to: one that keeps its type. */
  const isLocalConstantWrite = (modelId, variable, patch) =>
    !!variable &&
    isLocalConstantRow(rowsOf(modelId).find((row) => row.name === variable)) &&
    (patch?.type === undefined || patch.type === LOCAL_CONSTANT_TYPE)

  /**
   * Writes the value of the local constant a model node's row is bound to (see overrides.js localConstantTargetOf).
   *
   * @param {string} modelId
   * @param {string} name
   * @param {*} value - Null clears this super instance's override.
   * @param {'instance'|'supermodule'} target
   * @returns {Array|null} The node's rows, or null when nothing was written.
   */
  function writeLocalConstant(modelId, name, value, target) {
    const found = localConstantTargetOf(modelId, target, model.graph.value.origin, findNode)
    if (!found) return null
    if (found.field === 'supermodule') {
      updateNodeData(found.nodeId, { supermodule: detachReactivity(withDeclaration(findNode(found.nodeId).data.supermodule, name, { value })) })
    } else {
      const inherited = inheritedLocalConstant(modelId, model.graph.value.origin.get(modelId), name, findNode)
      const overrides = withOverrides(findNode(found.nodeId).data.overrides ?? {}, found.key, { [name]: value === null ? null : { value } }, [{ name, value: inherited }])
      updateNodeData(found.nodeId, { overrides: detachReactivity(overrides) })
    }
    return rowsOf(modelId)
  }

  /**
   * Writes overrides of the outermost super instance under a key.
   *
   * @returns {Array} The module's rows, as they now are.
   */
  function writeOverrides(modelId, { nodeId, key }, patches) {
    const from = model.graph.value.origin.get(modelId)
    const inherited = inheritedRows(modelId, from, findNode)
    const overrides = withOverrides(findNode(nodeId).data.overrides ?? {}, key, patches, inherited)
    updateNodeData(nodeId, { overrides: detachReactivity(overrides) })
    const set = overrides[key] ?? {}
    return detachReactivity(inherited.map((row) => (set[row.name] ? { ...row, ...set[row.name] } : row)))
  }

  /**
   * Writes a module's rows.
   *
   * @param {string} modelId
   * @param {Array} variables - Its new rows, all of them. For this super instance, only values that differ are written,
   *   each as an override.
   * @param {Object} [options]
   * @param {'instance'|'supermodule'} [options.target='instance'] - This super instance, or its super-module's child; the
   *   same for a root module.
   * @returns {Array|null} The rows written, or null when nothing was.
   */
  function writeVariables(modelId, variables, { target = 'instance' } = {}) {
    const found = targetOf(modelId, target)
    if (!found) return null
    if (found.field === 'variables') {
      updateNodeData(found.nodeId, { variables })
      return variables
    }
    const current = new Map(rowsOf(modelId).map((row) => [row.name, row]))
    const patches = Object.fromEntries(
      variables
        .filter((row) => String(current.get(row.name)?.value ?? '') !== String(row.value ?? ''))
        .map((row) => [row.name, { value: row.value }])
    )
    return writeOverrides(modelId, found, patches)
  }

  /**
   * Writes fields of one of a module's rows, leaving its other rows as they are. The rows written are copies, so
   * none is shared with the rows they replace. For this super instance only the value is written, as an override; one the
   * module would have anyway clears it. A value of a row bound to a local constant sets the local constant.
   *
   * @param {string} modelId
   * @param {string} variable - The row's name.
   * @param {Object} patch - Its fields to change, such as `value`.
   * @param {Object} [options] - As writeVariables.
   * @returns {Array|null} The module's rows written, or null when nothing was.
   */
  function writeValue(modelId, variable, patch, { target = 'instance' } = {}) {
    if (isLocalConstantWrite(modelId, variable, patch)) return 'value' in patch ? writeLocalConstant(modelId, variable, patch.value, target) : null
    const found = targetOf(modelId, target)
    if (!found) return null
    if (found.field === 'overrides') return writeOverrides(modelId, found, { [variable]: patch })
    const shadowed = bindingPlanOf(found, variable, patch)
    const rows = (findNode(found.nodeId).data?.variables ?? []).map((row) => (row.name === variable ? { ...row, ...patch } : row))
    const variables = detachReactivity(rows)
    updateNodeData(found.nodeId, { variables })
    applyShadowedOverrideRemoval(shadowed, updateNodeData)
    return variables
  }

  /**
   * Clears this super instance's override of a module's value, so it has the super-module's again.
   *
   * @param {string} modelId - A module inside a super instance.
   * @param {string} variable
   * @returns {Array|null} The module's rows, or null when it isn't inside a super instance.
   */
  function resetOverride(modelId, variable) {
    if (isLocalConstantWrite(modelId, variable)) {
      return localConstantTargetOf(modelId, 'instance', model.graph.value.origin, findNode)?.field === 'overrides'
        ? writeLocalConstant(modelId, variable, null, 'instance')
        : null
    }
    const found = writeTargetOf(modelId, 'instance', model.graph.value.origin, findNode)
    if (found?.field !== 'overrides') return null
    return writeOverrides(modelId, found, { [variable]: null })
  }

  /**
   * Removes one override of a super instance by its key, as its sidebar lists them, orphaned ones included.
   *
   * @param {string} superInstanceId
   * @param {string} key - Local id path.
   * @param {string} variable
   * @returns {boolean} Whether there was one.
   */
  function removeOverride(superInstanceId, key, variable) {
    const overrides = findNode(superInstanceId)?.data?.overrides
    if (!overrides?.[key] || !(variable in overrides[key])) return false
    const { [variable]: _removed, ...entry } = overrides[key]
    const next = { ...overrides }
    if (Object.keys(entry).length) next[key] = entry
    else delete next[key]
    updateNodeData(superInstanceId, { overrides: detachReactivity(next) })
    return true
  }

  /**
   * Says where each of a model node's values comes from (see overrides.js provenanceOf): chips default, overridden
   * (by this super instance) or ignored, and the #686 status, from the model.
   *
   * @param {string} modelId
   * @returns {Map<string, Object>} By row name.
   */
  const provenanceOf = (modelId) => rowProvenance(modelId, model.graph.value, findNode)

  /**
   * Sums up where a super-module's module's values come from across its copies, as editing the super-module on its
   * own shows them ("connected in 2/3"; see overrides.js aggregateProvenance).
   *
   * @param {string} mainId - The module's store id.
   * @returns {Map<string, Object>} By row name.
   */
  const aggregateProvenanceOf = (mainId) => aggregateProvenance(mainId, model.graph.value, findNode)

  /**
   * Lists a super instance's overrides for its sidebar, orphaned ones flagged (see overrides.js overridesOf).
   *
   * @param {string} superInstanceId
   * @returns {Array<{key: string, path: string, variable: string, value: *, isOrphaned: boolean}>}
   */
  const overridesOf = (superInstanceId) => listOverrides(superInstanceId, nodes.value)

  return {
    writeValue,
    writeVariables,
    resetOverride,
    removeOverride,
    recordTargetOf,
    targetOf,
    provenanceOf,
    aggregateProvenanceOf,
    overridesOf,
  }
}
