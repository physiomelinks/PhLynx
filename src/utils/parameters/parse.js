/**
 * Reads parameterisation files, JSON (`schema_version: 1`, as libcuflynx writes) or CSV, into one shape.
 *
 * @typedef {{value: string|null, units: string, data_reference: string, extra: Object<string, string>}} Param
 *   `value` keeps the number as written, and is null while the file leaves it to be filled.
 * @typedef {Object} ParameterFile
 * @property {'module'|'model'} kind - `module` is one parameterisation; `model` holds values by instance.
 * @property {string} ref - The file stem minus `_parameters`.
 * @property {Map<string, Param>} globals
 * @property {Map<string, Param>} values - Kind `module`.
 * @property {Map<string, Map<string, Param>>} instances - Kind `model`, by instance path (`inst/sub` when nested).
 * @property {Array<Object>} [rows] - A `<variable>_<instance>` CSV's rows, as `applyParametersToNodes` takes them.
 * @property {string[]} warnings
 */

/** The JSON schema version read. */
export const PARAMETERS_SCHEMA_VERSION = 1

/** Keys a JSON file reserves, so no variable may take them. */
const RESERVED_NAMES = new Set(['global', 'value', 'schema_version'])

/** Values that mean the file leaves a parameter to be filled. */
const EMPTY_VALUES = new Set(['', 'EMPTY_MUST_BE_FILLED'])

/** The columns every parameters CSV has; the rest are kept as extras. */
const CSV_COLUMNS = new Set(['variable_name', 'units', 'value', 'data_reference'])

/** The config type of a parameter shared by every module. */
const GLOBAL_TYPE = 'global_constant'

/**
 * Gives a file's parameter ref: its stem minus `_parameters`, with no `:` as `:` splits store keys.
 *
 * @param {string} fileName
 * @returns {string}
 */
export function parameterRefOf(fileName) {
  const stem = (fileName.split('/').pop() ?? '').replace(/\.[^.]*$/, '')
  return stem.replace(/_parameters$/, '').replaceAll(':', '_')
}

/**
 * Makes an error the import sorts as a file of another role, not a broken parameters file.
 *
 * @param {string} message
 * @returns {Error}
 */
function unrelatedError(message) {
  return Object.assign(new Error(message), { unrelated: true })
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isLeaf = (value) => isObject(value) && 'value' in value
/** An object holding instances or entries, not a parameter entry (which has a `value` or only plain fields). */
const isGroup = (value) => isObject(value) && !isLeaf(value) && Object.values(value).some(isObject)

/**
 * Keeps a value's text, or null when the file leaves it to be filled.
 *
 * @param {*} value
 * @returns {string|null}
 */
function valueText(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return EMPTY_VALUES.has(text) ? null : text
}

/**
 * Makes a Param from a JSON leaf or a CSV row, keeping fields beyond the four as text extras.
 *
 * @param {Object} entry
 * @param {Set<string>} [skip] - Fields not to keep as extras.
 * @returns {Param}
 */
function toParam(entry, skip = CSV_COLUMNS) {
  const extra = {}
  for (const [key, field] of Object.entries(entry)) {
    if (skip.has(key) || field === undefined || field === null) continue
    extra[key] = typeof field === 'object' ? JSON.stringify(field) : String(field)
  }
  return {
    value: valueText(entry.value),
    units: String(entry.units ?? '').trim(),
    data_reference: String(entry.data_reference ?? '').trim(),
    extra,
  }
}

/**
 * Parses JSON keeping each number's text as written (`1e-3` stays `1e-3`) where the engine gives the source.
 *
 * @param {string} text
 * @returns {*}
 */
function parseKeepingNumberText(text) {
  return JSON.parse(text, (_key, value, context) =>
    typeof value === 'number' ? (context?.source ?? String(value)) : value
  )
}

/**
 * Reads a map of parameter entries, checking each name and entry.
 *
 * @param {Object} entries - Name to leaf.
 * @param {string} prefix - Path to the map, for messages (`''` at the top).
 * @returns {Map<string, Param>}
 */
function readEntries(entries, prefix = '') {
  const params = new Map()
  for (const [name, entry] of Object.entries(entries)) {
    if (RESERVED_NAMES.has(name)) throw new Error(`\`${name}\` cannot be a variable name`)
    if (!isLeaf(entry)) throw new Error(`entry \`${prefix}${name}\` has no \`value\``)
    // An entry whose value is an entry is a group holding a variable named `value`.
    if (isObject(entry.value)) throw new Error('`value` cannot be a variable name')
    params.set(name, toParam(entry))
  }
  return params
}

/**
 * Reads an instance's entries, and those of instances nested in it as `inst/sub`.
 *
 * @param {string} path - The instance path.
 * @param {Object} entries
 * @param {Map<string, Map<string, Param>>} instances - Added to.
 */
function readInstance(path, entries, instances) {
  const leaves = {}
  for (const [name, entry] of Object.entries(entries)) {
    if (isGroup(entry)) readInstance(`${path}/${name}`, entry, instances)
    else leaves[name] = entry
  }
  instances.set(path, readEntries(leaves, `${path}.`))
}

/**
 * Counts the parameters a file leaves to be filled.
 *
 * @param {ParameterFile} file
 * @returns {number}
 */
function countUnfilled(file) {
  const maps = [file.globals, file.values, ...file.instances.values()]
  return maps.reduce((count, map) => count + [...map.values()].filter((param) => param.value === null).length, 0)
}

/**
 * Adds the "needs a value" warning to a file whose parameters are not all filled.
 *
 * @param {ParameterFile} file
 * @returns {ParameterFile}
 */
function withUnfilledWarning(file) {
  const unfilled = countUnfilled(file)
  if (unfilled === 1) file.warnings.push('1 parameter needs a value')
  else if (unfilled) file.warnings.push(`${unfilled} parameters need a value`)
  return file
}

/**
 * Makes an empty ParameterFile.
 *
 * @param {'module'|'model'} kind
 * @param {string} ref
 * @returns {ParameterFile}
 */
function emptyFile(kind, ref) {
  return { kind, ref, globals: new Map(), values: new Map(), instances: new Map(), warnings: [] }
}

/**
 * Reads a parameters JSON file. A file of only entries (plus `global`) is a `module` file; one holding instances is a
 * `model` file.
 *
 * @param {File|string} input - The file, or its text.
 * @param {string} [fileName] - The file's name, when `input` is text; gives the ref.
 * @returns {Promise<ParameterFile>} Rejects with `unrelated` set for JSON of another role (a config array, or an
 *   object of no parameter entries), and with a message for a broken parameters file.
 */
export async function parseParametersJson(input, fileName = input?.name ?? '') {
  const text = typeof input === 'string' ? input : await input.text()
  const parsed = parseKeepingNumberText(text)
  if (!isObject(parsed)) throw unrelatedError('Parameters file must be a JSON object.')

  const { schema_version: version, global: globals = {}, ...entries } = parsed
  if (version === undefined) {
    const hasEntries = Object.values(entries).some((entry) => isLeaf(entry) || (isObject(entry) && Object.values(entry).some(isLeaf)))
    if (!hasEntries) throw unrelatedError('Not a parameters file.')
    throw new Error('not a parameters file (missing schema_version)')
  }
  if (String(version) !== String(PARAMETERS_SCHEMA_VERSION)) {
    throw new Error(`unsupported schema_version ${version} (expected ${PARAMETERS_SCHEMA_VERSION})`)
  }
  if (isLeaf(globals) || !isObject(globals)) throw new Error('`global` cannot be a variable name')

  const isModel = Object.values(entries).some(isGroup)
  const file = emptyFile(isModel ? 'model' : 'module', parameterRefOf(fileName))
  file.globals = readEntries(globals, 'global.')
  if (!isModel) file.values = readEntries(entries)
  else {
    const loose = {}
    for (const [name, entry] of Object.entries(entries)) {
      if (isGroup(entry)) readInstance(name, entry, file.instances)
      else loose[name] = entry
    }
    // Entries beside instances have no instance to go to: checked, then left out.
    const ignored = readEntries(loose).size
    if (ignored) file.warnings.push(`${ignored} ${ignored === 1 ? 'entry' : 'entries'} outside any instance ignored`)
  }
  return withUnfilledWarning(file)
}

/**
 * Sorts a parameters CSV by its columns.
 * - `A` (module library): a `sourced` column and bare names.
 * - `B` (CA model): `<variable>_<instance>` names and no `sourced` column.
 * - `C` (test library): a `kind` column naming each row's type.
 *
 * @param {string[]} fields - The CSV's columns.
 * @returns {'A'|'B'|'C'}
 */
export function classifyParametersCsv(fields) {
  if (fields.includes('kind')) return 'C'
  if (fields.includes('sourced')) return 'A'
  return 'B'
}

/**
 * Reads bare-named CSV rows as one parameterisation. A row whose `kind` is `global_constant` goes to the globals.
 *
 * @param {Array<Object>} rows - Rows as `parseParametersFile` gives them.
 * @param {string} ref
 * @returns {ParameterFile}
 */
export function csvToModuleFile(rows, ref) {
  const file = emptyFile('module', ref)
  for (const row of rows) {
    const name = row.variable_name.trim()
    const target = row.kind?.trim() === GLOBAL_TYPE ? file.globals : file.values
    const param = toParam(row)
    const previous = target.get(name)
    if (previous && previous.value !== param.value) file.warnings.push(`\`${name}\` is listed twice; the last value is kept`)
    target.set(name, param)
  }
  return withUnfilledWarning(file)
}

/**
 * Reads a parameters CSV's rows, sorted by their columns (see classifyParametersCsv).
 *
 * @param {Array<Object>} rows - Rows as `parseParametersFile` gives them.
 * @param {string} fileName - Gives the ref.
 * @returns {ParameterFile} A `model` file keeps a `B` file's rows for `applyParametersToNodes`.
 */
export function csvToParameterFile(rows, fileName) {
  const ref = parameterRefOf(fileName)
  const format = classifyParametersCsv(Object.keys(rows[0] ?? {}))
  if (format !== 'B') return csvToModuleFile(rows, ref)
  return { ...emptyFile('model', ref), rows }
}

/**
 * Checks a parameterisation against its module's config, sorting each entry by the config's type: an entry listed
 * under `global` that the config types otherwise moves to the values, and a value the config types
 * `global_constant` moves to the globals.
 *
 * @param {{globals: Map<string, Param>, values: Map<string, Param>}} set - Not changed.
 * @param {{mathRef: string, variables: Array<{name: string, units: string, type: string}>}} module
 * @returns {{globals: Map<string, Param>, values: Map<string, Param>, warnings: string[]}}
 */
export function reconcileWithConfig(set, module) {
  const variables = new Map(module.variables.map((variable) => [variable.name, variable]))
  const globals = new Map()
  const values = new Map()
  const warnings = []

  const sort = (name, param, listedGlobal) => {
    const variable = variables.get(name)
    if (!variable) {
      warnings.push(`\`${name}\` is not a variable of ${module.mathRef}`)
      ;(listedGlobal ? globals : values).set(name, param)
      return
    }
    if (variable.units && param.units && variable.units.trim() !== param.units) {
      warnings.push(`\`${name}\` units ${param.units} ≠ config ${variable.units.trim()}`)
    }
    const isGlobal = variable.type === GLOBAL_TYPE
    if (listedGlobal && !isGlobal) {
      warnings.push(`\`${name}\` is listed under global but ${module.mathRef} types it ${variable.type}, so it is applied as one`)
    }
    ;(isGlobal ? globals : values).set(name, param)
  }

  for (const [name, param] of set.globals) sort(name, param, true)
  for (const [name, param] of set.values) sort(name, param, false)
  return { globals, values, warnings }
}
