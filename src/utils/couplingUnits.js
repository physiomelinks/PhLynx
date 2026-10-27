import { cleanName } from './identifiers'
import { resolveUnits, sameDimensions } from './units'

const nameOf = (variable) => (typeof variable === 'object' && variable !== null ? variable.name : variable)

/**
 * Why a coupling's paired variables can't be equivalent, as readable messages; empty when they can.
 * Variables pair by position, whatever their multiport type, and a pair conflicts when its units have
 * different dimensions. A scale-only difference (mm and metre) is fine, as libcellml converts it; a
 * variable without a row, units or a resolvable definition is skipped.
 *
 * @param {Object} sourcePort
 * @param {Object} targetPort
 * @param {Object[]} sourceRows - The source node's data.variables.
 * @param {Object[]} targetRows - The target node's data.variables.
 * @param {Map<string, Array<Object>>} unitDefinitions - The library's, as libraryStore.unitDefinitions.
 * @param {Map<string, Object|null>} [cache] - For resolveUnits, shared across calls with the same definitions.
 * @returns {string[]}
 */
export function couplingUnitConflicts(sourcePort, targetPort, sourceRows, targetRows, unitDefinitions, cache = new Map()) {
  const unitsOf = (rows, name) => cleanName((rows ?? []).find((row) => row.name === name)?.units)
  const sourceVariables = (sourcePort?.variables ?? []).map(nameOf)
  const targetVariables = (targetPort?.variables ?? []).map(nameOf)
  const conflicts = []
  for (let i = 0; i < Math.min(sourceVariables.length, targetVariables.length); i++) {
    const [source, target] = [sourceVariables[i], targetVariables[i]]
    if (!source || !target) continue
    const sourceUnits = unitsOf(sourceRows, source)
    const targetUnits = unitsOf(targetRows, target)
    if (!sourceUnits || !targetUnits || sourceUnits === targetUnits) continue
    const a = resolveUnits(sourceUnits, unitDefinitions ?? new Map(), cache)
    const b = resolveUnits(targetUnits, unitDefinitions ?? new Map(), cache)
    if (a && b && !sameDimensions(a, b)) {
      conflicts.push(`"${source}" (${sourceUnits}) and "${target}" (${targetUnits}) have incompatible units.`)
    }
  }
  return conflicts
}
