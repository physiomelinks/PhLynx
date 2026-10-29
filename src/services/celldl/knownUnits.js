import { parseMathRef } from '../../utils/config.js'
import { unitsModelXml } from '../../utils/unitExpression.js'
import { keptGroupingUnits } from '../userModules.js'

/**
 * Gets the units the library already has, for bg2cellml to name its own units around: every
 * units file but the module's own, which the conversion replaces.
 *
 * @param {Array<{ componentFile: string, model: string }>} availableUnits - libraryStore.availableUnits.
 * @param {string} [ownUnitsFile] - The module's units file.
 * @returns {string[]} Each file's CellML.
 */
export function knownUnitsFor(availableUnits, ownUnitsFile) {
  return (availableUnits ?? []).filter((file) => file.componentFile !== ownUnitsFile).map((file) => file.model)
}

/**
 * Gets the units the library already has for a module's conversion to name around: every other grouping's, and those
 * of its own grouping's that the grouping's other modules use (keptGroupingUnits), which the save keeps. The rest of
 * its grouping's units are the module's own, which the conversion replaces.
 *
 * @param {Object} libraryStore - For `availableMath` and `availableUnits`.
 * @param {string|null} [mathRef] - The module's math, which needn't be stored yet, e.g. `User_Modules.celldl:rc`.
 * @returns {string[]} CellML models.
 */
export function knownUnitsForModule(libraryStore, mathRef) {
  if (!mathRef) return knownUnitsFor(libraryStore.availableUnits)
  const known = knownUnitsFor(libraryStore.availableUnits, parseMathRef(mathRef).componentFile)
  const kept = keptGroupingUnits(libraryStore, mathRef)
  return kept.size ? [...known, unitsModelXml(kept, 'units')] : known
}
