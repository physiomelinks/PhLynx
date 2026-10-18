/**
 * Expands circulatory_autogen (CA) super-module instances in a module array into their prefixed submodules: a port of
 * CA's supermodules.py (expand_supermodules), with the parameter naming of parameter_names.py and the precedence of
 * parameterisations.py, pinned in services/import/ca-schemas/README.md.
 *
 * An instance record `heart` of a super-module is replaced, at its place in the array, by one record per submodule in
 * the super-module's order, named `heart_<sub>` (CA's '_'; see `separator`):
 * - the hosts in per_submodule_inputs[sub] are prepended to its inputs, those in per_submodule_outputs[sub] appended
 *   to its outputs, and its sibling names are prefixed;
 * - in each host, `heart` is replaced in place by every `heart_<sub>` linked to that host, in per_submodule_* order;
 * - a submodule that is itself an instance is expanded in turn, linked through its own per_submodule_*;
 * - another instance not yet expanded that names `heart` as a host is re-spliced the same way.
 *
 * Records are normalised (see caModuleArray.normaliseModuleRecord), in PhLynx keys. Templates come from
 * caModuleConfig.supermoduleTemplate.
 */
import { pyRepr, pyTuple, PER_SUBMODULE_KEYS, SUPERMODULE_FORMAT } from './caModuleArray'
import { moduleRefOf } from './caModuleConfig'

/** CA's level separator in expanded names, until CA#582 settles PhLynx's '__'. */
export const CA_SEPARATOR = '_'
/** A super-module nested deeper than this is taken to be a cycle the ancestry check missed. */
export const MAX_DEPTH = 64
const GLOBAL = 'global'

/** A super-module instance CA can't expand; `instance` is its record's name as expanded so far. */
export class SupermoduleExpansionError extends Error {
  /**
   * @param {string} message
   * @param {{instance: string}} details
   */
  constructor(message, { instance }) {
    super(message)
    this.name = 'SupermoduleExpansionError'
    this.instance = instance
  }
}

/**
 * @typedef {Object} ParameterRow
 * @property {string} variable_name
 * @property {string} units
 * @property {string} value
 * @property {string} data_reference
 */

/**
 * @callback ParameterLoader
 * Reads a parameter file of a module version.
 * @param {Object} entry - The template or component config entry.
 * @param {{parameterisation?: string, file?: string}} request - A parameterisation's
 *   `parameterisations/<name>/<name>_parameters.csv`, or a super-module's legacy default_parameters file.
 * @returns {Object[]|null|undefined} Its rows, or null when there is no such file.
 */

/** A deep copy that also takes reactive proxies, which structuredClone refuses. */
const clone = (value) => JSON.parse(JSON.stringify(value))
const keyOf = (record) => moduleRefOf(record.module_type, record.module_subtype)
const tupleOf = (record) => pyTuple(record.module_type, record.module_subtype)
const caKey = (record) => `${record.module_type}/${record.module_subtype}`

/**
 * A parameter row with only CA's four columns, trimmed; other columns (sourced...) are dropped.
 *
 * @param {Object} row
 * @returns {ParameterRow}
 */
const parameterRow = (row) =>
  Object.fromEntries(
    ['variable_name', 'units', 'value', 'data_reference'].map((column) => [column, String(row[column] ?? '').trim()])
  )

/**
 * Rows with each variable_name kept once, the first winning.
 *
 * @param {ParameterRow[]} rows
 * @returns {ParameterRow[]}
 */
export function firstRowsWin(rows) {
  const seen = new Set()
  return rows.filter((row) => !seen.has(row.variable_name) && seen.add(row.variable_name))
}

/**
 * `heart/lv/E` -> `{path: ['heart', 'lv'], variable: 'E'}`; `global/R` -> `{path: [], variable: 'R'}`.
 *
 * @param {string} name
 * @param {string} [where]
 * @returns {{path: string[], variable: string}}
 */
export function splitPathName(name, where = '') {
  const parts = String(name).split('/').map((part) => part.trim())
  if (parts.length < 2 || parts.some((part) => !part)) {
    throw new Error(
      `${where}parameter "${name}": a "/" name is <vessel>/<variable>, with nothing empty on either side of a "/".`
    )
  }
  const variable = parts.pop()
  return { path: parts.length === 1 && parts[0] === GLOBAL ? [] : parts, variable }
}

/**
 * The model name of a host parameters file row: `aortic_root/C` -> `C_aortic_root`, `heart/lv/E` -> `E_heart_lv`,
 * `global/R` -> `R`; a name without '/' is already one.
 *
 * @param {string} name
 * @param {Object} [options]
 * @param {string} [options.separator] - Between levels of the vessel name.
 * @returns {string}
 */
export function modelName(name, { separator = CA_SEPARATOR, where = '' } = {}) {
  if (!String(name).includes('/')) return name
  const { path, variable } = splitPathName(name, where)
  return path.length ? `${variable}_${path.join(separator)}` : variable
}

/**
 * The model name of a row of a super-module's parameterisation or default_parameters file, for the instance
 * `instance`: `lv/E` -> `E_<instance>_lv`, `soma/i_M/rho_M` -> `rho_M_<instance>_soma_i_M`, `global/R` and `R` -> `R`.
 * The older `E_lv` form is split at the longest submodule-path suffix.
 *
 * @param {string} name
 * @param {string} instance - The instance record's (expanded) name.
 * @param {string[][]} submodulePaths - From submodulePathParts.
 * @param {Object} [options]
 * @param {string} [options.where] - Message prefix.
 * @param {string} [options.separator]
 * @returns {{name: string, oldForm: boolean, global: boolean}}
 * @throws {Error} for a '/' path that is not a submodule.
 */
export function supermoduleRowName(name, instance, submodulePaths, { where = '', separator = CA_SEPARATOR } = {}) {
  const joined = (path, sep) => path.join(sep)
  if (String(name).includes('/')) {
    const { path, variable } = splitPathName(name, where)
    if (!path.length) return { name: variable, oldForm: false, global: true }
    if (!submodulePaths.some((p) => joined(p, '/') === joined(path, '/'))) {
      const known = submodulePaths.map((p) => joined(p, '/')).sort()
      throw new Error(
        `${where}parameter "${name}": "${joined(path, '/')}" is not a submodule of this supermodule (its ` +
          `submodules: ${pyRepr(known)}; a nested one is written <submodule>/<its submodule>).`
      )
    }
    return { name: `${variable}_${[instance, ...path].join(separator)}`, oldForm: false, global: false }
  }
  const byLength = [...submodulePaths].sort((a, b) => joined(b, '_').length - joined(a, '_').length)
  for (const path of byLength) {
    const suffix = `_${joined(path, '_')}`
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return { name: `${name.slice(0, -suffix.length)}_${[instance, ...path].join(separator)}`, oldForm: true, global: false }
    }
  }
  return { name, oldForm: false, global: true }
}

/**
 * Every submodule of a super-module as a path: `['sub']`, and for one that is itself a super-module
 * `['sub', 'subsub']`...
 *
 * @param {Object} template
 * @param {Map<string, Object>} supermodules
 * @returns {string[][]}
 */
export function submodulePathParts(template, supermodules, depth = 0) {
  return template.submodules.flatMap((sub) => {
    const nested = supermodules.get(keyOf(sub))
    const own = [[sub.name]]
    if (!nested || depth >= MAX_DEPTH) return own
    return [...own, ...submodulePathParts(nested, supermodules, depth + 1).map((path) => [sub.name, ...path])]
  })
}

/**
 * The rows of a module version's parameterisation: the record's own, which must exist, else the entry's
 * default_parameterisation when its file exists.
 *
 * @param {Object} entry
 * @param {string|undefined} parameterisation
 * @param {ParameterLoader} load
 * @param {string} where
 * @returns {{used: string|null, rows: ParameterRow[]}}
 */
function parameterisationRows(entry, parameterisation, load, where) {
  if (!parameterisation) {
    const fallback = entry.default_parameterisation
    const rows = fallback ? load(entry, { parameterisation: fallback }) : null
    return rows ? { used: fallback, rows: rows.map(parameterRow) } : { used: null, rows: [] }
  }
  const rows = load(entry, { parameterisation })
  if (!rows) {
    throw new Error(
      `${where}: unknown parameterisation "${parameterisation}" of (${entry.module_type}, ${entry.module_subtype}): ` +
        `parameterisations/${parameterisation}/${parameterisation}_parameters.csv does not exist.`
    )
  }
  return { used: parameterisation, rows: rows.map(parameterRow) }
}

/**
 * An instance's parameters, renamed: its parameterisation's, then its default_parameters, each name once.
 *
 * @returns {{rows: ParameterRow[], settings: Array, warnings: string[]}}
 */
function supermoduleParameters(template, instance, where, supermodules, load, separator) {
  if (!load) return { rows: [], settings: [], warnings: [] }
  const paths = submodulePathParts(template, supermodules)
  const warnings = []
  const globals = new Set()
  const rename = (rows, source) => {
    const old = []
    const renamed = rows.map((row) => {
      const { name, oldForm, global } = supermoduleRowName(row.variable_name, instance.name, paths, {
        where: `${source}: `,
        separator,
      })
      if (oldForm) old.push(row.variable_name)
      if (global) globals.add(name)
      return { ...row, variable_name: name }
    })
    if (old.length) {
      warnings.push(
        `${source}: ${old.length} parameter name(s) are written {variable}_{submodule} (e.g. "${old[0]}"), which has ` +
          `to be guessed apart where a variable or submodule name contains "_". Write <submodule>/<variable> instead.`
      )
    }
    return renamed
  }
  const { used, rows: own } = parameterisationRows(template, instance.parameterisation, load, where)
  const ownSource = used ? `parameterisations/${used}/${used}_parameters.csv` : where
  let rows = rename(own, ownSource)
  if (template.default_parameters) {
    const defaults = load(template, { file: template.default_parameters })
    if (!defaults) {
      throw new Error(
        `${where}: default_parameters file ${template.default_parameters} of supermodule ` +
          `${tupleOf(template)} not found (it is resolved against ${template.configFile}).`
      )
    }
    rows = [...rows, ...rename(defaults.map(parameterRow), template.default_parameters)]
  }
  rows = firstRowsWin(rows)
  const named = instance.parameterisation ?? template.default_parameterisation
  const who = `supermodule "${instance.name}"` + (named ? ` (parameterisation "${named}")` : '')
  const settings = rows
    .filter((row) => globals.has(row.variable_name))
    .map((row) => [row.variable_name, row.value, row.units, who, instance.name])
  return { rows, settings, warnings }
}

function splice(names, target, replacement) {
  return names.flatMap((name) => (name === target ? replacement : [name]))
}

function isInstance(record, supermodules, source) {
  if (supermodules.has(keyOf(record))) return true
  if (record.module_subtype === SUPERMODULE_FORMAT || PER_SUBMODULE_KEYS.some((key) => key in record)) {
    const known = [...supermodules.values()].map(tupleOf).sort()
    throw new SupermoduleExpansionError(
      `${source}: "${record.name}" is a supermodule instance of type (${record.module_type}, ` +
        `${record.module_subtype}), but no supermodule entry of that type was found in the module configs (known ` +
        `supermodules: ${known.length ? `[${known.join(', ')}]` : 'none'}). Add it to a *_modules_config.json in ` +
        `module_library_dirs or external_modules_dir.`,
      { instance: record.name }
    )
  }
  return false
}

/** Checks an instance's links as CA does before expanding it; see expandSupermodules for the errors. */
function checkLinks(instance, template, byName, supermodules, where) {
  const { name } = instance
  const subNames = template.submodules.map((sub) => sub.name)
  const nested = new Set(template.submodules.filter((sub) => supermodules.has(keyOf(sub))).map((sub) => sub.name))
  const perInputs = instance.per_submodule_inputs ?? {}
  const perOutputs = instance.per_submodule_outputs ?? {}
  const pers = [
    ['per_submodule_inputs', perInputs, 'out', 'out_instances'],
    ['per_submodule_outputs', perOutputs, 'inp', 'inp_instances'],
  ]
  for (const [perKey, per] of pers) {
    const unknown = Object.keys(per).filter((sub) => !subNames.includes(sub))
    if (unknown.length) {
      throw new Error(
        `${where}: ${perKey} names ${pyRepr(unknown)}, which are not submodules of ` +
          `${pyTuple(instance.module_type, instance.module_subtype)}; its submodules are ${pyRepr(subNames)}.`
      )
    }
    const inner = Object.keys(per).filter((sub) => nested.has(sub))
    if (inner.length) {
      throw new Error(
        `${where}: ${perKey} names ${pyRepr(inner)}, which are themselves supermodule instances; connect the host to ` +
          `one of their submodules through that supermodule's own per_submodule_*.`
      )
    }
  }
  for (const [perKey, per] of pers) {
    for (const [sub, hosts] of Object.entries(per)) {
      const repeated = [...new Set(hosts.filter((host, i) => hosts.indexOf(host) !== i))].sort()
      if (repeated.length) {
        throw new Error(
          `${where}: ${perKey}["${sub}"] names ${pyRepr(repeated)} more than once; each host is linked once per ` +
            `submodule.`
        )
      }
    }
  }
  for (const other of byName.values()) {
    for (const [listKey, side] of [['out_instances', 'out'], ['inp_instances', 'inp']]) {
      if (other[listKey].filter((n) => n === name).length > 1) {
        throw new Error(
          `${where}: "${other.name}" lists "${name}" more than once in its ${side} list. List it once; the ` +
            `instance's per_submodule_* entries say which of its submodules it links to.`
        )
      }
    }
  }
  for (const [perKey, per, side, listKey] of pers) {
    for (const [sub, hosts] of Object.entries(per)) {
      for (const host of hosts) {
        if (!byName.has(host)) {
          throw new Error(`${where}: ${perKey}["${sub}"] names host "${host}", which is not in the module array.`)
        }
        if (!byName.get(host)[listKey].includes(name)) {
          const caList = listKey === 'out_instances' ? 'out_vessels' : 'inp_vessels'
          throw new Error(
            `${where}: ${perKey}["${sub}"] names host "${host}", but "${host}" does not list "${name}" in its ` +
              `${side} list (${caList}/${listKey}).`
          )
        }
      }
    }
  }
  const inputHosts = new Set(Object.values(perInputs).flat())
  const outputHosts = new Set(Object.values(perOutputs).flat())
  for (const other of byName.values()) {
    if (other.out_instances.includes(name) && !inputHosts.has(other.name)) {
      throw new Error(
        `${where}: "${other.name}" lists "${name}" in its out list, but no per_submodule_inputs entry of "${name}" ` +
          `names "${other.name}", so it is not known which submodule it feeds.`
      )
    }
    if (other.inp_instances.includes(name) && !outputHosts.has(other.name)) {
      throw new Error(
        `${where}: "${other.name}" lists "${name}" in its inp list, but no per_submodule_outputs entry of "${name}" ` +
          `names "${other.name}", so it is not known which submodule feeds it.`
      )
    }
  }
  for (const [listKey, hosts, perKey, side] of [
    ['inp_instances', inputHosts, 'per_submodule_inputs', 'inp'],
    ['out_instances', outputHosts, 'per_submodule_outputs', 'out'],
  ]) {
    const stray = instance[listKey].filter((host) => !hosts.has(host))
    if (stray.length) throw new Error(`${where}: its ${side} list names ${pyRepr(stray)}, which no ${perKey} entry names.`)
  }
  return { perInputs, perOutputs }
}

/** Expands one instance; any problem with it is thrown as a SupermoduleExpansionError naming it. */
function expandOne(records, index, state) {
  try {
    return expandInstance(records, index, state)
  } catch (error) {
    if (error instanceof SupermoduleExpansionError) throw error
    throw new SupermoduleExpansionError(error.message, { instance: records[index].name })
  }
}

function expandInstance(records, index, state) {
  const { supermodules, source, ancestry, paths, separator } = state
  const instance = records[index]
  const { name } = instance
  const template = supermodules.get(keyOf(instance))
  const where = `${source}: supermodule instance "${name}" ${tupleOf(instance)}`

  const chain = ancestry.get(name) ?? []
  if (chain.includes(caKey(instance)) || chain.length >= MAX_DEPTH) {
    throw new Error(`${where}: supermodules nest in a cycle (${[...chain, caKey(instance)].join(' -> ')}).`)
  }

  const byName = new Map(records.filter((_, i) => i !== index).map((record) => [record.name, record]))
  const { perInputs, perOutputs } = checkLinks(instance, template, byName, supermodules, where)

  const prefixed = (sub) => `${name}${separator}${sub}`
  const instancePath = paths.get(name) ?? [name]
  const newRecords = template.submodules.map((sub) => {
    const record = clone(sub)
    record.name = prefixed(sub.name)
    record.inp_instances = [...(perInputs[sub.name] ?? []), ...sub.inp_instances.map(prefixed)]
    record.out_instances = [...sub.out_instances.map(prefixed), ...(perOutputs[sub.name] ?? [])]
    for (const perKey of PER_SUBMODULE_KEYS) {
      if (perKey in record) {
        record[perKey] = Object.fromEntries(
          Object.entries(record[perKey]).map(([s, hosts]) => [s, hosts.map(prefixed)])
        )
      }
    }
    paths.set(record.name, [...instancePath, sub.name])
    return record
  })

  const clashes = newRecords.map((record) => record.name).filter((n) => byName.has(n))
  if (clashes.length) {
    throw new Error(
      `${where}: expanding it gives the names ${pyRepr(clashes)}, which are already in the module array. Rename the ` +
        `instance or the clashing records.`
    )
  }

  const linked = (per, host) => Object.entries(per).filter(([, hosts]) => hosts.includes(host)).map(([s]) => prefixed(s))
  for (const other of byName.values()) {
    if (other.out_instances.includes(name)) other.out_instances = splice(other.out_instances, name, linked(perInputs, other.name))
    if (other.inp_instances.includes(name)) other.inp_instances = splice(other.inp_instances, name, linked(perOutputs, other.name))
    // Another instance not expanded yet that names this one as a host now names the submodules linked to it.
    for (const [perKey, links] of [['per_submodule_inputs', perOutputs], ['per_submodule_outputs', perInputs]]) {
      if (perKey in other) {
        const replacement = linked(links, other.name)
        other[perKey] = Object.fromEntries(
          Object.entries(other[perKey]).map(([s, hosts]) => [s, splice(hosts, name, replacement)])
        )
      }
    }
  }

  newRecords.forEach((record) => ancestry.set(record.name, [...chain, caKey(instance)]))
  paths.delete(name)
  const parameters = supermoduleParameters(template, instance, where, supermodules, state.load, separator)
  return { records: [...records.slice(0, index), ...newRecords, ...records.slice(index + 1)], ...parameters }
}

/**
 * Expands every super-module instance in a module array, recursively.
 *
 * @param {Object[]} records - Normalised records; not changed.
 * @param {Map<string, Object>} supermodules - moduleRef -> template.
 * @param {Object} [options]
 * @param {string} [options.source] - Message prefix, e.g. the file name.
 * @param {ParameterLoader} [options.load] - Reads parameter files; without one no parameters are read.
 * @param {string} [options.separator] - Joins an instance and its submodule's name: CA's '_' by default.
 * @param {Array} [options.settings] - Receives the globals the parameterisations set, for conflictingGlobals; they
 *   are checked here when it is not given.
 * @returns {{records: Object[], parameterRows: ParameterRow[], paths: Map<string, string[]>, warnings: string[]}}
 *   `parameterRows` are the instances' renamed parameters, outer before nested, each name once; `paths` gives each
 *   record's names from the top level down (`['heart', 'ra']`).
 * @throws {SupermoduleExpansionError} naming `source` and the instance: an unknown super-module type, per_submodule_* naming a
 *   non-submodule or a nested instance, a host listed twice, a host missing or not naming the instance back, a record
 *   naming the instance with no per_submodule_* link, an expanded name clash, nesting in a cycle, or a missing
 *   parameter file.
 */
export function expandSupermodules(records, supermodules, { source = 'module array', load, separator = CA_SEPARATOR, settings } = {}) {
  const state = { supermodules, source, ancestry: new Map(), paths: new Map(), separator, load }
  let current = clone(records)
  current.forEach((record) => state.paths.set(record.name, [record.name]))
  let parameterRows = []
  const allSettings = settings ?? []
  const warnings = []
  for (;;) {
    const index = current.findIndex((record) => isInstance(record, supermodules, source))
    if (index === -1) break
    const expanded = expandOne(current, index, state)
    current = expanded.records
    parameterRows.push(...expanded.rows)
    allSettings.push(...expanded.settings)
    warnings.push(...expanded.warnings)
  }
  if (!settings) warnings.push(...conflictingGlobals(allSettings, source, separator))
  parameterRows = firstRowsWin(parameterRows)
  const paths = new Map(current.map((record) => [record.name, state.paths.get(record.name) ?? [record.name]]))
  return { records: current, parameterRows, paths, warnings }
}

/**
 * The names of a config entry's global_constant variables.
 *
 * @param {Object} entry
 * @returns {Set<string>}
 */
const globalConstants = (entry) =>
  new Set((entry.variables_and_units ?? []).filter((row) => Array.isArray(row) && row[3] === 'global_constant').map((row) => row[0]))

/**
 * The parameterisation rows of every (expanded) record whose type is a component, in record order: a row `C` becomes
 * `C_<record>`, a global_constant of the module keeps its name.
 *
 * @param {Object[]} records
 * @param {Map<string, Object>} components - moduleRef -> component config entry (PhLynx keys).
 * @param {Object} [options]
 * @param {string} [options.source]
 * @param {ParameterLoader} [options.load]
 * @param {Array} [options.settings] - As for expandSupermodules.
 * @returns {ParameterRow[]}
 * @throws {Error} for a parameterisation of an unknown type, an unknown parameterisation, or a '/' row name.
 */
export function componentParameterRows(records, components, { source = 'module array', load, settings = [] } = {}) {
  if (!load) return []
  const rows = []
  for (const record of records) {
    const where = `${source}: "${record.name}" ${tupleOf(record)}`
    const entry = components.get(keyOf(record))
    if (!entry) {
      if (record.parameterisation) {
        throw new Error(
          `${where}: names parameterisation "${record.parameterisation}", but no module config entry of that type ` +
            `was found, so there is no module library directory to look for its parameterisations in.`
        )
      }
      continue
    }
    const { used, rows: raw } = parameterisationRows(entry, record.parameterisation, load, where)
    const globals = globalConstants(entry)
    for (const row of raw) {
      if (row.variable_name.includes('/')) {
        throw new Error(
          `${where}: parameterisation "${used}" names "${row.variable_name}", but a parameterisation's parameters are ` +
            `the module's own variables, named without a vessel ("C", not "lv/C"); the vessel is the module-array ` +
            `record that uses it.`
        )
      }
      if (globals.has(row.variable_name)) {
        settings.push([row.variable_name, row.value, row.units, `"${record.name}" (parameterisation "${used}")`, record.name])
        rows.push(row)
      } else {
        rows.push({ ...row, variable_name: `${row.variable_name}_${record.name}` })
      }
    }
  }
  return rows
}

const sameValue = (a, b) => {
  const [x, y] = [Number(a), Number(b)]
  return String(a).trim() !== '' && String(b).trim() !== '' && !Number.isNaN(x) && !Number.isNaN(y)
    ? x === y
    : String(a).trim() === String(b).trim()
}

/**
 * A warning for each global that parameterisations set to different values, unless the one used is a super-module's
 * and the other inside it.
 *
 * @param {Array<[string, string, string, string, string]>} settings - `[name, value, units, who, record]` in
 *   precedence order, the first used.
 * @param {string} source
 * @param {string} [separator]
 * @returns {string[]}
 */
export function conflictingGlobals(settings, source, separator = CA_SEPARATOR) {
  const byName = new Map()
  for (const [name, ...rest] of settings) byName.set(name, [...(byName.get(name) ?? []), rest])
  const warnings = []
  for (const [name, entries] of byName) {
    const [firstValue, firstUnits, firstWho, firstRecord] = entries[0]
    const others = entries
      .slice(1)
      .filter(([value, , , record]) => !sameValue(value, firstValue) && !record.startsWith(firstRecord + separator))
    if (!others.length) continue
    const values = [[firstValue, firstUnits, firstWho], ...others]
    const listed = values.map(([v, u, w]) => `${v} ${u} by ${w}`).join('; ')
    const clash =
      new Set(values.map(([, u]) => u)).size === 1
        ? ''
        : ` The units differ too, so these modules may mean different quantities by "${name}"; one of them needs renaming.`
    warnings.push(
      `${source}: the global constant "${name}" is set to different values by module parameterisations (${listed}). ` +
        `The model uses ${firstValue} ${firstUnits} (the first), so the other modules run at a value their ` +
        `parameterisation did not choose. Set "${name}" in the host parameters file to choose the value for the ` +
        `whole model.${clash}`
    )
  }
  return warnings
}

/**
 * A module array with its super-modules expanded and its default parameters, as CA loads it: the super-modules'
 * parameterisations and default_parameters, then the components' parameterisations, each name once.
 *
 * @param {Object[]} records
 * @param {Map<string, Object>} supermodules
 * @param {Map<string, Object>} [components] - Without them, only the super-modules' parameters are read.
 * @param {Object} [options] - As for expandSupermodules.
 * @returns {{records: Object[], parameterRows: ParameterRow[], paths: Map<string, string[]>, warnings: string[]}}
 */
export function loadExpandedRecords(records, supermodules, components, options = {}) {
  const settings = []
  const source = options.source ?? 'module array'
  const expanded = expandSupermodules(records, supermodules, { ...options, settings })
  let parameterRows = expanded.parameterRows
  if (components) {
    const own = componentParameterRows(expanded.records, components, { ...options, settings })
    parameterRows = firstRowsWin([...parameterRows, ...own])
  }
  const warnings = [...expanded.warnings, ...conflictingGlobals(settings, source, options.separator)]
  return { ...expanded, parameterRows, warnings }
}

/**
 * A host parameters file's rows with the default rows it does not set appended: the host wins, then the first of
 * several defaults. Host names in the '/' form are read as model names first.
 *
 * @param {ParameterRow[]} hostRows
 * @param {ParameterRow[]} defaultRows
 * @param {Object} [options]
 * @param {string} [options.separator]
 * @returns {ParameterRow[]}
 */
export function mergeDefaultParameters(hostRows, defaultRows, { separator = CA_SEPARATOR } = {}) {
  const host = hostRows.map((row) => ({ ...row, variable_name: modelName(row.variable_name, { separator }) }))
  const existing = new Set(host.map((row) => row.variable_name))
  const added = defaultRows.filter((row) => !existing.has(row.variable_name) && existing.add(row.variable_name))
  return [...host, ...added]
}
