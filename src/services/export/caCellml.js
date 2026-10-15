/**
 * Writes the CellML that a circulatory_autogen (CA) export's module config refers to: each component file, with the
 * library's math (edits included), and one units file. CA finds module files by the `modules.cellml` ending and units
 * files by the `units.cellml` ending, beside the config.
 */
import { CELLML_NS, MATHML_NS, STANDARD_UNITS } from '../../utils/constants'
import { combineComponentModels, getCellmlAttributeNode, whenLibCellMLReady } from '../../utils/cellml'
import { parseMathRef } from '../../utils/config'
import { unitsModelXml } from '../../utils/unitExpression'

// CA adds this component when a heart has one venous input; it comes from CA's built-in BG modules.
const ZERO_FLOW_MATH_REF = 'BG_modules.cellml:zero_flow'
const MAX_NAMED = 3
// Flow and volume units CA's junction, terminal and volume-sum components use.
const CA_GLUE_UNITS = ['m3', 'm3_per_s', 'L_per_s']
const STANDARD = new Set(STANDARD_UNITS)

/**
 * Names at most three items, then how many more there are.
 *
 * @param {string[]} items
 * @returns {string}
 */
export function listNamed(items) {
  const named = items.slice(0, MAX_NAMED)
  const more = items.length - named.length
  return more > 0 ? `${named.join(', ')} and ${more} more` : named.join(', ')
}

/**
 * Names a component file as CA finds module files, ending in `modules.cellml`.
 *
 * @param {string} componentFile
 * @returns {string} The name unchanged when it ends so, else `<stem>_modules.cellml`.
 */
export function caModuleFileName(componentFile) {
  if (componentFile.endsWith('modules.cellml')) return componentFile
  const stem = componentFile.replace(/\.cellml$/i, '')
  return /modules$/i.test(stem) ? `${stem.slice(0, -'modules'.length)}modules.cellml` : `${stem}_modules.cellml`
}

/**
 * Whether CA treats a module type as the heart (see CA's is_heart_vessel_type).
 *
 * @param {string} moduleType
 * @returns {boolean}
 */
export function isHeart(moduleType) {
  return moduleType.startsWith('heart') && !moduleType.startsWith('heart_effector')
}

/**
 * Lists the non-standard units a component's math uses: its variables' units and its numbers' units.
 *
 * @param {string} math - A CellML model with one component.
 * @returns {Set<string>}
 */
function unitsUsedBy(math) {
  const doc = new DOMParser().parseFromString(math, 'application/xml')
  const used = new Set()
  for (const variable of doc.getElementsByTagNameNS(CELLML_NS, 'variable')) used.add(variable.getAttribute('units'))
  for (const cn of doc.getElementsByTagNameNS(MATHML_NS, 'cn')) used.add(getCellmlAttributeNode(cn, 'units')?.value)
  return new Set([...used].filter((name) => name && !STANDARD.has(name)))
}

/**
 * Builds the CellML files a CA module config refers to.
 *
 * @param {string} fileName - The export's name; the units file is `<fileName>_units.cellml`.
 * @param {Array<{module_type: string, component_file: string, component_type: string}>} moduleConfig - The config
 *   entries; each `component_file` is renamed in place where CA wouldn't find it.
 * @param {Object} libraryStore - The library, for `availableMath` and `unitDefinitions`.
 * @returns {Promise<{files: Map<string, string>, missingUnits: string[]}>} Each file's text by name, and the units no
 *   library units file defines.
 * @throws {Error} When a component has no math in the library, two files hold components of one name, or two files
 *   get the same name.
 */
export async function buildCaCellmlFiles(fileName, moduleConfig, libraryStore) {
  const typesByFile = new Map()
  const fileOfType = new Map()
  const clashes = new Set()
  const add = (componentFile, componentType) => {
    const file = fileOfType.get(componentType)
    if (file && file !== componentFile) clashes.add(componentType)
    fileOfType.set(componentType, componentFile)
    if (!typesByFile.has(componentFile)) typesByFile.set(componentFile, new Set())
    typesByFile.get(componentFile).add(componentType)
  }

  for (const entry of moduleConfig) add(entry.component_file, entry.component_type)
  if (moduleConfig.some((entry) => isHeart(entry.module_type)) && !fileOfType.has('zero_flow')) {
    const { componentFile, componentName } = parseMathRef(ZERO_FLOW_MATH_REF)
    if (libraryStore.availableMath.has(ZERO_FLOW_MATH_REF)) add(componentFile, componentName)
  }

  if (clashes.size) {
    throw new Error(`CA finds components by name, but several files hold ${listNamed([...clashes])}.`)
  }
  const mathRefs = [...typesByFile].flatMap(([file, types]) => [...types].map((type) => `${file}:${type}`))
  const missing = mathRefs.filter((mathRef) => !libraryStore.availableMath.has(mathRef))
  if (missing.length) throw new Error(`No math in the library for ${listNamed(missing)}.`)

  const renames = new Map([...typesByFile.keys()].map((file) => [file, caModuleFileName(file)]))
  const taken = new Map()
  for (const [file, name] of renames) {
    if (taken.has(name)) throw new Error(`"${taken.get(name)}" and "${file}" would both be written as "${name}".`)
    taken.set(name, file)
  }
  for (const entry of moduleConfig) entry.component_file = renames.get(entry.component_file)

  await whenLibCellMLReady()
  const files = new Map()
  const usedUnits = new Set()
  for (const [file, types] of typesByFile) {
    const maths = [...types].map((type) => libraryStore.availableMath.get(`${file}:${type}`))
    maths.forEach((math) => unitsUsedBy(math).forEach((name) => usedUnits.add(name)))
    // The model's name can't hold "component": CA copies from the first line that does.
    files.set(renames.get(file), combineComponentModels('modules', maths))
  }

  // Units are defined in terms of other units, which the file needs too.
  const definitions = libraryStore.unitDefinitions
  const units = new Map()
  const missingUnits = []
  // CA's generated glue components use these whatever the components use, when they're defined.
  const pending = [...usedUnits, ...CA_GLUE_UNITS.filter((name) => definitions.has(name))]
  while (pending.length) {
    const name = pending.shift()
    if (units.has(name) || STANDARD.has(name) || missingUnits.includes(name)) continue
    const parts = definitions.get(name)
    if (!parts) {
      missingUnits.push(name)
      continue
    }
    units.set(name, parts)
    pending.push(...parts.map((part) => part.units))
  }
  files.set(`${fileName}_units.cellml`, unitsModelXml(units, 'units'))

  return { files, missingUnits }
}
