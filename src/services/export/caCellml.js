/**
 * Writes the CellML that a circulatory_autogen (CA) export's module config refers to: each component file, with the
 * library's math (edits included), and one units file. CA finds module files by the `modules.cellml` ending and units
 * files by the `units.cellml` ending, beside the config.
 */
import { STANDARD_UNITS } from '../../utils/constants'
import { combineComponentModels, whenLibCellMLReady } from '../../utils/cellml'
import { parseMathRef } from '../../utils/config'
import { unitsModelXml } from '../../utils/unitExpression'
import { groupingCellmlFile, unitsUsedBy } from '../userModules'

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
 * Names a component file as CA finds module files, ending in `modules.cellml`. A grouping of another format, such as
 * `User_Modules.celldl`, is first named as CellML (groupingCellmlFile).
 *
 * @param {string} componentFile - A grouping.
 * @returns {string} The name unchanged when it ends so, else `<stem>_modules.cellml`.
 */
export function caModuleFileName(componentFile) {
  const file = groupingCellmlFile(componentFile)
  if (file.endsWith('modules.cellml')) return file
  const stem = file.replace(/\.cellml$/i, '')
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
 * Gives a grouping's short tag for the components an export renames: another format's extension (`celldl`), or a
 * CellML grouping's stem without its `modules` ending (`User_Modules.cellml` → `user`).
 *
 * @param {string} grouping
 * @returns {string} A tag of letters, digits and underscores.
 */
export function groupingTag(grouping) {
  const match = /^(.*)\.([^.]+)$/.exec(grouping) ?? [grouping, grouping, 'cellml']
  const [, stem, extension] = match
  const raw = extension.toLowerCase() === 'cellml' ? stem.replace(/_?modules$/i, '') : extension
  const tag = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return tag || 'file'
}

/**
 * Picks new names for components of one name in several groupings, as CA finds components by name. The first grouping
 * keeps the name, CellML groupings before others and then by name; each other gets `<name>_<tag>` (groupingTag),
 * numbered from 2 while that is taken.
 *
 * @param {Map<string, Set<string>>} typesByFile - Component names by grouping.
 * @returns {Array<{file: string, from: string, to: string}>} The renames, by name and then in grouping order.
 */
export function renameClashingComponents(typesByFile) {
  const filesByType = new Map()
  for (const [file, types] of typesByFile) {
    for (const type of types) filesByType.set(type, [...(filesByType.get(type) ?? []), file])
  }
  const isCellml = (file) => /\.cellml$/i.test(file)
  const order = (a, b) => isCellml(b) - isCellml(a) || (a < b ? -1 : a > b ? 1 : 0)
  const taken = new Set(filesByType.keys())
  const renames = []
  // By name, so the numbering doesn't follow the nodes' order.
  for (const [type, files] of [...filesByType].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (files.length < 2) continue
    for (const file of [...files].sort(order).slice(1)) {
      const base = `${type}_${groupingTag(file)}`
      let to = base
      for (let n = 2; taken.has(to); n++) to = `${base}_${n}`
      taken.add(to)
      renames.push({ file, from: type, to })
    }
  }
  return renames
}

/**
 * Builds the CellML files a CA module config refers to.
 *
 * @param {string} fileName - The export's name; the units file is `<fileName>_units.cellml`.
 * @param {Array<{module_type: string, component_file: string, component_type: string}>} moduleConfig - The config
 *   entries; each `component_file` is renamed in place where CA wouldn't find it, and each `component_type` where
 *   another grouping holds a component of its name (renameClashingComponents).
 * @param {Object} libraryStore - The library, for `availableMath` and `unitDefinitions`.
 * @returns {Promise<{files: Map<string, string>, missingUnits: string[], renamedComponents: Array<{file: string,
 *   from: string, to: string}>}>} Each file's text by name, the units no library units file defines, and the
 *   components renamed, by their grouping in the library.
 * @throws {Error} When a component has no math in the library, or two files get the same name.
 */
export async function buildCaCellmlFiles(fileName, moduleConfig, libraryStore) {
  const typesByFile = new Map()
  const allTypes = new Set()
  const add = (componentFile, componentType) => {
    allTypes.add(componentType)
    if (!typesByFile.has(componentFile)) typesByFile.set(componentFile, new Set())
    typesByFile.get(componentFile).add(componentType)
  }

  for (const entry of moduleConfig) add(entry.component_file, entry.component_type)
  if (moduleConfig.some((entry) => isHeart(entry.module_type)) && !allTypes.has('zero_flow')) {
    const { componentFile, componentName } = parseMathRef(ZERO_FLOW_MATH_REF)
    if (libraryStore.availableMath.has(ZERO_FLOW_MATH_REF)) add(componentFile, componentName)
  }

  const mathRefs = [...typesByFile].flatMap(([file, types]) => [...types].map((type) => `${file}:${type}`))
  const missing = mathRefs.filter((mathRef) => !libraryStore.availableMath.has(mathRef))
  if (missing.length) throw new Error(`No math in the library for ${listNamed(missing)}.`)

  const renamedComponents = renameClashingComponents(typesByFile)
  const exportNames = new Map(renamedComponents.map(({ file, from, to }) => [`${file}:${from}`, to]))
  const renames = new Map([...typesByFile.keys()].map((file) => [file, caModuleFileName(file)]))
  const taken = new Map()
  for (const [file, name] of renames) {
    if (taken.has(name)) throw new Error(`"${taken.get(name)}" and "${file}" would both be written as "${name}".`)
    taken.set(name, file)
  }
  for (const entry of moduleConfig) {
    entry.component_type = exportNames.get(`${entry.component_file}:${entry.component_type}`) ?? entry.component_type
    entry.component_file = renames.get(entry.component_file)
  }

  await whenLibCellMLReady()
  const files = new Map()
  const usedUnits = new Set()
  for (const [file, types] of typesByFile) {
    const maths = [...types].map((type) => libraryStore.availableMath.get(`${file}:${type}`))
    maths.forEach((math) => unitsUsedBy(math).forEach((name) => usedUnits.add(name)))
    const names = [...types].map((type) => exportNames.get(`${file}:${type}`))
    // The model's name can't hold "component": CA copies from the first line that does.
    files.set(renames.get(file), combineComponentModels('modules', maths, names))
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

  return { files, missingUnits, renamedComponents }
}
