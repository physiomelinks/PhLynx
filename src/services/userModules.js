/**
 * Groupings of library math: the part of a math reference before ':' (e.g. `User_Modules.celldl`), which the library
 * lists modules under and keys units by. A grouping is a label, not a file: each module is still stored under its own
 * math reference. New CellML modules go in USER_MODULES_FILE and new or imported CellDL modules in
 * CELLDL_USER_MODULES_FILE, whose modules share one units entry.
 */
import {
  CELLDL_USER_MODULES_FILE,
  CELLML_NS,
  MATHML_NS,
  NEW_MODULE_MATH_REF,
  STANDARD_UNITS,
  USER_MODULES_FILE,
} from '../utils/constants'
import { getCellmlAttributeNode } from '../utils/cellml'
import { parseMathRef } from '../utils/config'
import { extractUnitDefinitions } from '../utils/units'
import { unitsModelXml } from '../utils/unitExpression'

const STANDARD = new Set(STANDARD_UNITS)

/** Whether two component names are the same, ignoring case, as names in a grouping must differ. */
export const isSameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()

/**
 * Names the CellML file a grouping is written as: a `.cellml` grouping as it is, and another format's, such as
 * `User_Modules.celldl`, as a `.cellml` file that no CellML grouping of its stem would be, e.g.
 * `User_CellDL_Modules.cellml`.
 *
 * @param {string} grouping
 * @returns {string}
 */
export function groupingCellmlFile(grouping) {
  const match = /^(.*)\.([^.]+)$/.exec(grouping ?? '')
  if (!match || match[2].toLowerCase() === 'cellml') return grouping
  const [, stem, extension] = match
  const format = extension.toLowerCase() === 'celldl' ? 'CellDL' : extension
  const modules = /(_?)(modules)$/i.exec(stem)
  return modules
    ? `${stem.slice(0, modules.index)}${modules[1]}${format}_${modules[2]}.cellml`
    : `${stem}_${format}.cellml`
}

/**
 * Gets the grouping a module's math is saved in under a new name. Only a module new from the template is a user
 * module: a diagram's goes in User_Modules.celldl, CellML's in User_Modules.cellml. An edit of existing math, renamed
 * or saved as new, stays in that math's grouping.
 *
 * @param {string|null} mathRef - The edited module's math, e.g. NEW_MODULE_MATH_REF for the template.
 * @param {{isDiagram?: boolean}} [options] - Whether the module is a diagram's.
 * @returns {string|undefined} Undefined when there's no math.
 */
export function newComponentGrouping(mathRef, { isDiagram = false } = {}) {
  if (mathRef !== NEW_MODULE_MATH_REF) return mathRef ? parseMathRef(mathRef).componentFile : undefined
  return isDiagram ? CELLDL_USER_MODULES_FILE : USER_MODULES_FILE
}

/**
 * Gets the math reference a diagram's save converts for (newComponentGrouping), which its live conversion checks and
 * names units against too.
 *
 * @param {string|null} mathRef - The edited module's math.
 * @param {string|null} [name] - The component name it's saved under, the module's own by default.
 * @returns {string|null} Null when there's no math.
 */
export function diagramSaveRef(mathRef, name = null) {
  if (!mathRef) return null
  return `${newComponentGrouping(mathRef, { isDiagram: true })}:${name || parseMathRef(mathRef).componentName}`
}

/**
 * Finds the math a grouping holds under a component name, ignoring case.
 *
 * @param {Iterable<string>} mathRefs - E.g. libraryStore.availableMath.keys().
 * @param {string} grouping
 * @param {string} name
 * @returns {string|null} Its math reference.
 */
export function findInGrouping(mathRefs, grouping, name) {
  for (const mathRef of mathRefs) {
    const { componentFile, componentName } = parseMathRef(mathRef)
    if (componentFile === grouping && isSameName(componentName, name)) return mathRef
  }
  return null
}

/**
 * Lists the non-standard units a component's math uses: its variables' units and its numbers' units.
 *
 * @param {string} math - A CellML model with one component.
 * @returns {Set<string>}
 */
export function unitsUsedBy(math) {
  const used = new Set()
  if (typeof math !== 'string' || !math.trim()) return used
  const doc = new DOMParser().parseFromString(math, 'application/xml')
  for (const variable of doc.getElementsByTagNameNS(CELLML_NS, 'variable')) used.add(variable.getAttribute('units'))
  for (const cn of doc.getElementsByTagNameNS(MATHML_NS, 'cn')) used.add(getCellmlAttributeNode(cn, 'units')?.value)
  return new Set([...used].filter((name) => name && !STANDARD.has(name)))
}

/**
 * Gets the units in a grouping's units entry that its modules, other than one, use, with the units those are defined
 * in terms of.
 *
 * @param {Object} libraryStore - For `availableMath` and `availableUnits`.
 * @param {string} mathRef - The module left out, which needn't be stored yet.
 * @returns {Map<string, Array<Object>>} Definitions by name (see extractUnitDefinitions).
 */
export function keptGroupingUnits(libraryStore, mathRef) {
  const { componentFile } = parseMathRef(mathRef)
  const entry = libraryStore.availableUnits.find((file) => file.componentFile === componentFile)
  const kept = new Map()
  if (!entry) return kept
  const definitions = extractUnitDefinitions(entry.model)
  const pending = []
  for (const [ref, math] of libraryStore.availableMath) {
    if (ref !== mathRef && parseMathRef(ref).componentFile === componentFile) pending.push(...unitsUsedBy(math))
  }
  while (pending.length) {
    const name = pending.pop()
    if (kept.has(name) || !definitions.has(name)) continue
    kept.set(name, definitions.get(name))
    pending.push(...definitions.get(name).map((part) => part.units))
  }
  return kept
}

/**
 * Gets a grouping's units entry once a module in it is saved with the units generated for it: the units its other
 * modules use, kept as they are, and the module's own. A grouping with no other units gets the module's as they are.
 *
 * @param {Object} libraryStore
 * @param {string} mathRef - The saved module's math.
 * @param {string|null} unitsModel - Its units, as CellML, or null when it has none.
 * @returns {{componentFile: string, model: string|null}} A null model when the grouping has no units left.
 */
export function groupingUnitsAfterSave(libraryStore, mathRef, unitsModel) {
  const { componentFile } = parseMathRef(mathRef)
  const kept = keptGroupingUnits(libraryStore, mathRef)
  if (!kept.size) return { componentFile, model: unitsModel ?? null }
  // The conversion named its units around the kept ones (knownUnitsForModule), so a shared name is the same units.
  const merged = new Map(kept)
  for (const [name, parts] of extractUnitDefinitions(unitsModel)) if (!merged.has(name)) merged.set(name, parts)
  return { componentFile, model: unitsModelXml(merged, 'units') }
}
