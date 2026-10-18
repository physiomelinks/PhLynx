/**
 * circulatory_autogen (CA) parameter files of a module array with super-modules, and their values on its modules.
 * Pure.
 *
 * - A parameterisation is `parameterisations/<name>/<name>_parameters.csv` next to its module version's config; a
 *   super-module's legacy default_parameters file is named relative to its config. Files are found by the path they
 *   were dropped at: next to the config's own path when it is known, else at CA's library layout
 *   (`<module_type>/versions/<module_subtype>/parameterisations/...`).
 * - Rows are matched to modules by their exact model names, `<variable>_<CA flat name>` (CA's `heart_lv`), as CA
 *   names them; never by suffix (see utils/parameters.js, #694).
 */
import { applyParameterValues } from '../../utils/parameters'
import { moduleRefOf } from './caModuleConfig'

const PARAMETERISATIONS_DIR = 'parameterisations'

/**
 * Whether a dropped file's path is a parameterisation's: `.../parameterisations/<name>/<name>_parameters.csv`.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isParameterisationPath(path) {
  const parts = String(path ?? '').split('/')
  const [dir, name, file] = parts.slice(-3)
  return parts.length >= 3 && dir === PARAMETERISATIONS_DIR && file === `${name}_parameters.csv`
}

/** @returns {string} A request's path relative to its config's directory. */
export const requestPath = ({ parameterisation, file }) =>
  file ?? `${PARAMETERISATIONS_DIR}/${parameterisation}/${parameterisation}_parameters.csv`

/** Joins a directory and a relative path, resolving `.` and `..`. */
function joinPath(dir, relative) {
  const parts = []
  for (const part of [...(dir ? dir.split('/') : []), ...relative.split('/')]) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/**
 * Matches a module version's parameter file among those dropped: next to its config when that path is known and the
 * file is there, else by CA's library layout, else by its version folder.
 *
 * @param {Iterable<string>} paths - The parameter files' paths.
 * @param {Map<string, string>} configPaths - moduleRef -> the path its config was dropped at.
 * @param {{module_type: string, module_subtype: string}} entry - A super-module template or component.
 * @param {{parameterisation?: string, file?: string}} request
 * @returns {{path: string|null, ambiguous: string[]}} The file's path; or, when several files match equally, null
 *   and their paths.
 */
export function matchParameterFile(paths, configPaths, entry, request) {
  const relative = requestPath(request)
  const all = [...paths]
  const configPath = configPaths.get(moduleRefOf(entry.module_type, entry.module_subtype))
  if (configPath) {
    const path = joinPath(dirOf(configPath), relative)
    if (all.includes(path)) return { path, ambiguous: [] }
  }
  const ends = (suffix) => all.filter((path) => path === suffix || path.endsWith(`/${suffix}`))
  for (const suffix of [`${entry.module_type}/versions/${entry.module_subtype}/${relative}`, `${entry.module_subtype}/${relative}`]) {
    const found = ends(suffix)
    if (found.length === 1) return { path: found[0], ambiguous: [] }
    if (found.length > 1) return { path: null, ambiguous: found }
  }
  return { path: null, ambiguous: [] }
}

/**
 * Finds the path of a module version's parameter file among those dropped (see matchParameterFile).
 *
 * @returns {string|null} Null when there is none, or several match.
 */
export function findParameterFile(paths, configPaths, entry, request) {
  return matchParameterFile(paths, configPaths, entry, request).path
}

/**
 * Says that several dropped files could be a module version's parameter file, and which.
 *
 * @param {{module_type: string, module_subtype: string}} entry
 * @param {{parameterisation?: string, file?: string}} request
 * @param {string[]} paths - The candidates.
 * @returns {string}
 */
export function ambiguousParameterFileMessage(entry, request, paths) {
  return (
    `${entry.module_type}:${entry.module_subtype} ${requestPath(request)} matches several files: ${paths.join(', ')}. ` +
    `Drop only the module library folder it is in.`
  )
}

/**
 * Makes a CA ParameterLoader (see caSupermodules.js) over the parameter files dropped.
 *
 * @param {Map<string, Object[]>} files - path -> rows.
 * @param {Map<string, string>} [configPaths] - moduleRef -> config path.
 * @returns {import('./caSupermodules').ParameterLoader}
 * @throws {Error} from the loader, when several files match a request.
 */
export function parameterFileLoader(files, configPaths = new Map()) {
  return (entry, request) => {
    const { path, ambiguous } = matchParameterFile(files.keys(), configPaths, entry, request)
    if (ambiguous.length) throw new Error(ambiguousParameterFileMessage(entry, request, ambiguous))
    return path ? files.get(path) : null
  }
}

/**
 * Lists the parameter files a module array's super-modules read, as CA reads them: each instance's parameterisation
 * (its own, else its entry's default), each super-module's default_parameters, and the parameterisation each
 * component submodule names. A file named outright is required, as CA stops without it; an entry's default is read
 * when it is there.
 *
 * @param {Object[]} rows - Module array rows.
 * @param {Map<string, Object>} supermodules - moduleRef -> template.
 * @returns {Array<{entry: Object, request: Object, required: boolean, label: string}>} Each once.
 */
export function referencedParameterFiles(rows, supermodules) {
  const found = new Map()
  const add = (entry, request, required) => {
    const label = `${entry.module_type}:${entry.module_subtype} ${requestPath(request)}`
    const known = found.get(label)
    if (known) known.required ||= required
    else found.set(label, { entry, request, required, label })
  }
  const visit = (record, chain) => {
    const ref = moduleRefOf(record.module_type, record.module_subtype)
    const template = supermodules.get(ref)
    if (!template) {
      if (chain.length && record.parameterisation) add(record, { parameterisation: record.parameterisation }, true)
      return
    }
    if (chain.includes(ref)) return
    if (record.parameterisation) add(template, { parameterisation: record.parameterisation }, true)
    else if (template.default_parameterisation) add(template, { parameterisation: template.default_parameterisation }, false)
    if (template.default_parameters) add(template, { file: template.default_parameters }, true)
    template.submodules.forEach((sub) => visit(sub, [...chain, ref]))
  }
  rows.forEach((row) => visit(row, []))
  return [...found.values()]
}

/**
 * The library's component modules as CA config entries, for componentParameterRows: its type, and its variables
 * with their types, so a global_constant keeps its name.
 *
 * @param {Map<string, Object>} modules - moduleRef -> library module.
 * @returns {Map<string, Object>}
 */
export function componentEntries(modules) {
  return new Map(
    [...modules].map(([moduleRef, module]) => {
      const [module_type, ...subtype] = moduleRef.split(':')
      const variables_and_units = (module.variables ?? []).map((row) => [row.name, row.units, row.access, row.type])
      return [moduleRef, { moduleRef, module_type, module_subtype: subtype.join(':'), variables_and_units }]
    })
  )
}

/**
 * Indexes parameter rows by name, the first of a name winning.
 *
 * @param {Object[]} rows
 * @returns {Map<string, Object>}
 */
export function rowIndex(rows) {
  const index = new Map()
  for (const row of rows) {
    const name = String(row.variable_name ?? '').trim()
    if (name && !index.has(name)) index.set(name, row)
  }
  return index
}

/**
 * Applies parameter rows to modules by their exact CA model names, `<variable>_<name>` for the module named `name`.
 *
 * @param {Array} nodes - Modules, not changed.
 * @param {Map<string, Object>} index - From rowIndex.
 * @param {(node: Object) => string} [nameOf] - A module's CA flat name; its own name by default.
 * @returns {{nodes: Array, used: Set<string>, skipped: Array<{nodeName: string, name: string}>}} The modules with
 *   their values, the row names applied, and the computed rows left as they were (see applyParameterValues).
 */
export function applyRowsByName(nodes, index, nameOf = (node) => node.data.name) {
  const used = new Set()
  const skipped = []
  const out = nodes.map((node) => {
    const name = nameOf(node)
    const valueFor = (variable) => {
      const key = `${variable}_${name}`
      const row = index.get(key)
      if (row) used.add(key)
      return row
    }
    const result = applyParameterValues(node.data.variables ?? [], valueFor)
    skipped.push(...result.skipped.map((variable) => ({ nodeName: name, name: variable })))
    return result.updated ? { ...node, data: { ...node.data, variables: result.variables } } : node
  })
  return { nodes: out, used, skipped }
}

/**
 * The rows that set global constants: those no module took that name a variable of the model, each name once, the
 * first winning (CA's first-wins).
 *
 * @param {Object[]} rows - In precedence order.
 * @param {Set<string>} used - The rows modules took.
 * @param {Array} nodes - The model's modules.
 * @returns {Array<{name: string, value: string, units: string, data_reference: string}>}
 */
export function globalRows(rows, used, nodes) {
  const catalogue = new Set(nodes.flatMap((node) => (node.data.variables ?? []).map((row) => row.name.trim())))
  return [...rowIndex(rows)]
    .filter(([name]) => !used.has(name) && catalogue.has(name))
    .map(([name, row]) => ({ name, value: row.value, units: row.units, data_reference: row.data_reference }))
}
