/**
 * Identity for library files and modules that came from a source: a dropped folder or zip, a
 * connected folder, or (later) a repository at a commit.
 *
 * A file from a source is keyed by its path, whose first segment names the source, such as
 * `enterocyte-modules/math/membrane.cellml`. A module from a source is keyed
 * `type:subtype:source`. A loose file, a built-in module and anything saved before sources
 * existed has no source and keeps its bare key, so those keys stay valid as they are.
 *
 * Keys never hold ':' in a file or source part, since math refs (`file:component`) and module
 * refs split on it.
 */
import { normalisePath } from '../services/import/cellmlImports'

/**
 * Makes a name safe to use as a source: no ':' (refs split on it) and no '/' (the source is one
 * path segment).
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitiseSourceName(name) {
  return String(name).replace(/[:/\\]/g, '_').trim()
}

/**
 * Makes a root-relative path into a library file key: normalised, without ':'.
 *
 * @param {string} path
 * @returns {string}
 */
export function fileKeyFromPath(path) {
  return (normalisePath(path) ?? path).replace(/:/g, '_')
}

/**
 * The source a file key belongs to.
 *
 * @param {string} fileKey
 * @returns {string|null} The first path segment, or null for a bare name.
 */
export function sourceOfFileKey(fileKey) {
  if (!fileKey || !fileKey.includes('/')) return null
  return fileKey.slice(0, fileKey.indexOf('/'))
}

/**
 * The file name at the end of a file key.
 *
 * @param {string} fileKey
 * @returns {string}
 */
export function baseNameOf(fileKey) {
  return fileKey ? fileKey.slice(fileKey.lastIndexOf('/') + 1) : fileKey
}

/**
 * The folder part of a file key, without a trailing slash.
 *
 * @param {string} fileKey
 * @returns {string}
 */
function dirOf(fileKey) {
  return fileKey.includes('/') ? fileKey.slice(0, fileKey.lastIndexOf('/')) : ''
}

/**
 * Builds a module ref, qualified by its source when it has one.
 *
 * @param {string} moduleType
 * @param {string} moduleSubtype
 * @param {string|null} [source]
 * @returns {string}
 */
export function moduleRefOf(moduleType, moduleSubtype, source = null) {
  return source ? `${moduleType}:${moduleSubtype}:${source}` : `${moduleType}:${moduleSubtype}`
}

/**
 * The source a module ref is qualified by.
 *
 * @param {string} moduleRef
 * @returns {string|null}
 */
export function sourceOfModuleRef(moduleRef) {
  const parts = moduleRef?.split(':') ?? []
  return parts.length > 2 ? parts.slice(2).join(':') : null
}

/**
 * Finds the file a config's `component_file` names. CA configs give a bare file name; within a
 * source it is looked for among the source's files, preferring the conventional layout
 * (`configurations/` beside `math/`).
 *
 * @param {string} configKey - File key of the config file, such as `repo/configurations/x.json`.
 * @param {string} componentFile - The config's `component_file`.
 * @param {Iterable<string>} candidates - File keys of CellML files loaded or being loaded.
 * @returns {string} The file key the config's math is under: a candidate, else where the
 *   conventional layout puts it. Unchanged for a config without a source.
 */
export function resolveComponentFile(configKey, componentFile, candidates) {
  const source = sourceOfFileKey(configKey)
  if (!source || !componentFile) return componentFile

  const configDir = dirOf(configKey)
  const parentDir = dirOf(configDir)
  const preferred = [
    /\/configurations$/i.test(configDir) ? `${parentDir}/math/${componentFile}` : null,
    `${configDir}/${componentFile}`,
  ]
    .filter(Boolean)
    .map(fileKeyFromPath)

  // A path in the config is relative to the config.
  if (componentFile.includes('/')) return fileKeyFromPath(`${configDir}/${componentFile}`)

  const name = componentFile
  const matches = [...new Set(candidates)].filter((key) => sourceOfFileKey(key) === source && baseNameOf(key) === name)
  const conventional = preferred.find((key) => matches.includes(key))
  if (conventional) return conventional
  if (matches.length) return matches.sort()[0]
  return preferred[0]
}

/**
 * Finds the library module an instance array row asks for by type and subtype.
 *
 * @param {Map<string, Object>} modules - Modules by ref.
 * @param {string} moduleType
 * @param {string} moduleSubtype
 * @param {string|null} [preferredSource] - The source the instance array came from.
 * @returns {{ module: Object|null, ambiguous: string[] }} The module from the preferred source,
 *   else the one without a source, else the only one from any source. `ambiguous` lists the
 *   sources when several match and none of these rules picks one.
 */
export function findModule(modules, moduleType, moduleSubtype, preferredSource = null) {
  if (preferredSource) {
    const own = modules.get(moduleRefOf(moduleType, moduleSubtype, preferredSource))
    if (own) return { module: own, ambiguous: [] }
  }
  const unqualified = modules.get(moduleRefOf(moduleType, moduleSubtype))
  if (unqualified) return { module: unqualified, ambiguous: [] }

  const prefix = `${moduleType}:${moduleSubtype}:`
  const sourced = [...modules.keys()].filter((ref) => ref.startsWith(prefix))
  if (sourced.length === 1) return { module: modules.get(sourced[0]), ambiguous: [] }
  return { module: null, ambiguous: sourced.map(sourceOfModuleRef).sort() }
}

/**
 * Moves a file key or module ref from one source to another.
 *
 * @param {string} key - A file key or module ref.
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function renameSourceIn(key, from, to) {
  if (key.startsWith(`${from}/`)) return `${to}/${key.slice(from.length + 1)}`
  if (sourceOfModuleRef(key) === from) return `${key.slice(0, key.length - from.length)}${to}`
  return key
}

/**
 * A source name not yet taken: the name itself, else `name (2)`, `name (3)`, ...
 *
 * @param {string} source
 * @param {(name: string) => boolean} isTaken
 * @returns {string}
 */
export function uniqueSourceName(source, isTaken) {
  if (!isTaken(source)) return source
  let n = 2
  while (isTaken(`${source} (${n})`)) n++
  return `${source} (${n})`
}

/**
 * How a file key is shown: its file name, with its source as a tag, and the whole key for a
 * tooltip. A loose file shows its name alone.
 *
 * @param {string} fileKey
 * @returns {{ name: string, source: string|null, title: string }}
 */
export function describeFileKey(fileKey) {
  return { name: baseNameOf(fileKey ?? ''), source: sourceOfFileKey(fileKey), title: fileKey ?? '' }
}

/**
 * How a module ref is shown: `type:subtype`, then its source in brackets when it has one.
 *
 * @param {string} moduleRef
 * @param {Object} [options]
 * @param {boolean} [options.withSource=true] - False where the source is shown beside it already.
 * @returns {string}
 */
export function moduleRefLabel(moduleRef, { withSource = true } = {}) {
  if (!moduleRef) return ''
  const source = sourceOfModuleRef(moduleRef)
  if (!source) return moduleRef
  const bare = moduleRef.slice(0, moduleRef.length - source.length - 1)
  return withSource ? `${bare} (${source})` : bare
}
