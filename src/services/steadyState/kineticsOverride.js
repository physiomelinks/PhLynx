/**
 * A scope with some instances run in other kinetics, for one run only: to compare an instance's full kinetics with its
 * steady state without changing or saving the instance.
 */
import { reconcileRows } from '../math/reconcileRows'
import { STEADY_STATE_KINETICS, isSteadyInstance, steadyStateRows } from './steadyStateLibrary'

/**
 * The cycle's total from an instance's full-kinetics rows: the sum of its states' initial amounts.
 *
 * @param {Array} rows
 * @param {string[]} cycleStates
 * @returns {number} NaN when a state has no amount.
 */
export function cycleTotal(rows, cycleStates) {
  const byName = new Map(rows.map((row) => [row.name, row]))
  const amountOf = (state) => {
    const row = byName.get(state)
    const own = Number(row?.value)
    return row && row.value !== '' && Number.isFinite(own) ? own : Number(byName.get(row?.initialiser)?.value)
  }
  return cycleStates.reduce((sum, state) => sum + amountOf(state), 0)
}

/**
 * An instance as it would be in `mode`: its kinetics set, and its rows the ones it keeps for that kinetics, or, never
 * having had them, its current rows' values carried over, with the cycle's total from its states' amounts.
 *
 * @param {Object} node
 * @param {'full'|typeof STEADY_STATE_KINETICS} mode
 * @param {Object} libraryStore
 * @returns {Promise<Object>} The node, a copy unless it is already in `mode`.
 * @throws {Error} When the instance's steady state can't be derived.
 */
export async function nodeInKinetics(node, mode, libraryStore) {
  const isSteady = mode === STEADY_STATE_KINETICS
  if (isSteady === isSteadyInstance(node)) return node
  const { mathRef } = node.data
  const stashed = node.data.kineticsStash?.variables ?? null
  const kineticsStash = { variables: node.data.variables }
  if (isSteady) {
    const entry = await libraryStore.ensureSteadyState(mathRef)
    if (entry?.status !== 'ready') throw new Error(entry?.message ?? `The steady state of "${node.data.name}" can't be derived.`)
    let variables = stashed ?? steadyStateRows(entry, node.data.variables, node.data.ports)
    if (!stashed) {
      // The cycle's total from this instance's own amounts, not the module's defaults
      const total = cycleTotal(node.data.variables ?? [], entry.result?.spec?.cycleStates ?? [])
      const totals = new Set(entry.result?.reduced?.parameters ?? [])
      if (Number.isFinite(total)) variables = variables.map((row) => (totals.has(row.name) ? { ...row, value: String(total) } : row))
    }
    return { ...node, data: { ...node.data, kinetics: STEADY_STATE_KINETICS, variables, kineticsStash } }
  }
  const analysis = libraryStore.getMathAnalysis(mathRef) ?? (await libraryStore.ensureMathAnalysis?.(mathRef))
  const variables = stashed ?? reconcileRows(analysis, node.data.variables ?? [], { defaults: libraryStore.getMathDefaults(mathRef) })
  const { kinetics: _kinetics, ...data } = node.data
  return { ...node, data: { ...data, variables, kineticsStash } }
}

/**
 * A scope with the given instances in the given kinetics, for one run.
 *
 * @param {Object} scope - From resolveScope.
 * @param {Map<string, string>} kinetics - Each instance's kinetics, by node id.
 * @param {Object} libraryStore
 * @returns {Promise<Object>}
 */
export async function scopeWithKinetics(scope, kinetics, libraryStore) {
  if (!kinetics?.size) return scope
  const replaced = new Map()
  for (const [id, mode] of kinetics) {
    const node = scope.allNodes?.find((candidate) => candidate.id === id) ?? scope.nodes.find((candidate) => candidate.id === id)
    if (node) replaced.set(id, await nodeInKinetics(node, mode, libraryStore))
  }
  const swap = (nodes) => nodes?.map((node) => replaced.get(node.id) ?? node)
  return { ...scope, nodes: swap(scope.nodes), ...(scope.allNodes ? { allNodes: swap(scope.allNodes) } : {}) }
}
