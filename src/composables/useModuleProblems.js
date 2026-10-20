/**
 * What a module still needs before it can be built: a parameter without a value or a variable without known units. A
 * module card shows its own; a super instance card, how many modules inside it have any, as its placement expands.
 */
import { computed, effectScope } from 'vue'

import { useCanvasLevel } from './useCanvasLevel'
import { useModelGraph } from './useModelGraph'
import { useLibraryStore } from '../stores/libraryStore'
import { isUnitKnown } from '../utils/parameterRows'
import { isEditableVariableType, isEmpty } from '../utils/variables'

/**
 * Checks a module's rows.
 *
 * @param {Array} variables - Its rows.
 * @param {Object} libraryStore - For global constants' values and the units known.
 * @param {Object} [options]
 * @param {boolean} [options.skipLocalConstants=false] - Leaves local constants' values out, as a stored row's is its
 *   super-module's; an expanded row has it bound.
 * @returns {{missingParameters: boolean, missingUnits: boolean}}
 */
export function moduleProblems(variables, libraryStore, { skipLocalConstants = false } = {}) {
  let missingParameters = false
  let missingUnits = false
  for (const variable of variables ?? []) {
    if (!isEditableVariableType(variable.type)) continue
    if (!(skipLocalConstants && variable.type === 'local_constant')) {
      const value = variable.type === 'global_constant' ? libraryStore.getGlobalConstant(variable.name)?.value : variable.value
      if (isEmpty(value)) missingParameters = true
    }
    if (isEmpty(variable.units) || !isUnitKnown(variable, libraryStore.availableUnitNames)) missingUnits = true
  }
  return { missingParameters, missingUnits }
}

// Each workspace's counts, by its model, by library store (one per Pinia).
const counts = new WeakMap()

/**
 * Counts the modules with problems in the model, once for every workspace and shared by every card: by each placement
 * they are inside (the super instances' store ids, outermost first, joined by `\0`), and by each super instance they
 * are inside at any level, each store module once.
 *
 * @param {Object} model - From useModelGraph.
 * @param {Object} libraryStore
 * @returns {import('vue').ComputedRef<{byPlacement: Map<string, number>, byInstance: Map<string, Set<string>>}>}
 */
function problemCounts(model, libraryStore) {
  if (!counts.has(libraryStore)) counts.set(libraryStore, new WeakMap())
  const byModel = counts.get(libraryStore)
  if (!byModel.has(model)) {
    byModel.set(
      model,
      effectScope(true).run(() =>
        computed(() => {
          const byPlacement = new Map()
          const byInstance = new Map()
          const { nodes, origin } = model.graph.value
          for (const node of nodes) {
            const { mainId, instanceChain = [] } = origin?.get(node.id) ?? {}
            if (!instanceChain.length) continue
            const { missingParameters, missingUnits } = moduleProblems(node.data?.variables, libraryStore)
            if (!missingParameters && !missingUnits) continue
            instanceChain.forEach((instanceId, level) => {
              const key = instanceChain.slice(0, level + 1).join('\0')
              byPlacement.set(key, (byPlacement.get(key) ?? 0) + 1)
              if (!byInstance.has(instanceId)) byInstance.set(instanceId, new Set())
              byInstance.get(instanceId).add(mainId)
            })
          }
          return { byPlacement, byInstance }
        })
      )
    )
  }
  return byModel.get(model)
}

/**
 * Gives how many modules inside a super instance have problems, as its placement on the canvas expands, overrides and
 * all. Edited on its own, a super-module has no one placement, so its super instances count each module once, across
 * every copy.
 *
 * @param {string} [flowId] - The flow the card is in.
 * @returns {(id: string) => number} By the super instance's store id.
 */
export function useSuperInstanceProblems(flowId) {
  const libraryStore = useLibraryStore()
  const canvasLevel = useCanvasLevel(flowId)
  const problems = problemCounts(useModelGraph(flowId), libraryStore)

  return (id) =>
    canvasLevel.isEditingSupermodule.value
      ? (problems.value.byInstance.get(id)?.size ?? 0)
      : (problems.value.byPlacement.get([...canvasLevel.instancePath.value, id].join('\0')) ?? 0)
}
