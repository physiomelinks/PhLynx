/**
 * Namespaces in the library: a collection of files and modules imported together, such as a
 * dropped folder or zip of a module repository, which the folder's name names unless the user
 * names it otherwise on import.
 *
 * A file in a namespace is keyed `<namespace>/<file name>`, such as `cardiac_ap/membrane.cellml`;
 * the folders the file sat in only matter while its CellML imports are resolved. A module in a
 * namespace is keyed `type:subtype:namespace`. A loose file, a built-in module and anything saved
 * before namespaces existed has none, and keeps its bare key.
 *
 * Keys never hold ':' in a file name or namespace, since math refs (`file:component`) and module
 * refs split on it, nor '/' in a namespace.
 */
import { normalisePath } from '../services/import/cellmlImports'

/** The namespace of what has none, when one is chosen. */
export const NO_NAMESPACE = ''

/**
 * Makes a name safe to use as a namespace: no ':' (refs split on it) and no '/' (a namespace is
 * one path segment).
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitiseNamespace(name) {
  return String(name ?? '').replace(/[:/\\]/g, '_').trim()
}

/**
 * The file name at the end of a key or path.
 *
 * @param {string} key
 * @returns {string}
 */
export function baseNameOf(key) {
  return key ? key.slice(key.lastIndexOf('/') + 1) : key
}

/**
 * The library key of a file in a namespace.
 *
 * @param {string|null} namespace - None for a loose file.
 * @param {string} name - Its file name; any folders are dropped.
 * @returns {string}
 */
export function fileKeyOf(namespace, name) {
  const base = baseNameOf(name).replace(/:/g, '_')
  return namespace ? `${namespace}/${base}` : base
}

/**
 * The namespace a file imported from a folder or zip goes in unless the user names another: the
 * first folder of its path, which is the folder or zip dropped.
 *
 * @param {string} path - Relative to what was imported.
 * @returns {string|null} Null for a loose file.
 */
export function namespaceOfPath(path) {
  const normalised = normalisePath(path ?? '') ?? path ?? ''
  return normalised.includes('/') ? sanitiseNamespace(normalised.slice(0, normalised.indexOf('/'))) || null : null
}

/**
 * The library key a file imported from a path loads under: in the namespace of its first folder,
 * by its name.
 *
 * @param {string} path
 * @returns {string}
 */
export function fileKeyFromPath(path) {
  return fileKeyOf(namespaceOfPath(path), path)
}

/**
 * The namespace a file key is in.
 *
 * @param {string} fileKey
 * @returns {string|null} Null for a bare name.
 */
export function namespaceOfFileKey(fileKey) {
  if (!fileKey || !fileKey.includes('/')) return null
  return fileKey.slice(0, fileKey.indexOf('/'))
}

/**
 * Builds a module ref, qualified by its namespace when it has one.
 *
 * @param {string} moduleType
 * @param {string} moduleSubtype
 * @param {string|null} [namespace]
 * @returns {string}
 */
export function moduleRefOf(moduleType, moduleSubtype, namespace = null) {
  return namespace ? `${moduleType}:${moduleSubtype}:${namespace}` : `${moduleType}:${moduleSubtype}`
}

/**
 * The namespace a module ref is qualified by.
 *
 * @param {string} moduleRef
 * @returns {string|null}
 */
export function namespaceOfModuleRef(moduleRef) {
  const parts = moduleRef?.split(':') ?? []
  return parts.length > 2 ? parts.slice(2).join(':') : null
}

/**
 * The namespace of a file key, mathRef (`file:component`) or module ref.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function namespaceOfKey(key) {
  if (!key) return null
  if (key.includes('/')) return namespaceOfFileKey(key)
  return namespaceOfModuleRef(key)
}

/**
 * Finds the file a config's `component_file` names: the file of that name in the config's
 * namespace. CA configs give a bare file name; a path's folders are dropped, as an import drops
 * them.
 *
 * @param {string|null} namespace - The namespace the config is loaded into.
 * @param {string} componentFile - The config's `component_file`.
 * @returns {string}
 */
export function resolveComponentFile(namespace, componentFile) {
  if (!componentFile) return componentFile
  return fileKeyOf(namespace, componentFile)
}

/**
 * Finds the library module an instance array row asks for by type and subtype.
 *
 * @param {Map<string, Object>} modules - Modules by ref.
 * @param {string} moduleType
 * @param {string} moduleSubtype
 * @param {string|null} [preferredNamespace] - The namespace the instance array targets.
 * @returns {{ module: Object|null, ambiguous: string[] }} The module from the preferred namespace,
 *   else the one without a namespace, else the only one in any namespace. `ambiguous` lists the
 *   namespaces when several match and none of these rules picks one.
 */
export function findModule(modules, moduleType, moduleSubtype, preferredNamespace = null) {
  if (preferredNamespace) {
    const own = modules.get(moduleRefOf(moduleType, moduleSubtype, preferredNamespace))
    if (own) return { module: own, ambiguous: [] }
  }
  const unqualified = modules.get(moduleRefOf(moduleType, moduleSubtype))
  if (unqualified) return { module: unqualified, ambiguous: [] }

  const prefix = `${moduleType}:${moduleSubtype}:`
  const qualified = [...modules.keys()].filter((ref) => ref.startsWith(prefix))
  if (qualified.length === 1) return { module: modules.get(qualified[0]), ambiguous: [] }
  return { module: null, ambiguous: qualified.map(namespaceOfModuleRef).sort() }
}

/**
 * Moves a file key, or a mathRef (`file:component`), from one namespace to another. One in
 * another namespace is returned as it is.
 *
 * @param {string} key
 * @param {string|null} from - Null or '' for no namespace.
 * @param {string|null} to - Null or '' for no namespace.
 * @returns {string}
 */
export function renameFileNamespace(key, from, to) {
  if (typeof key !== 'string' || (from || null) === (to || null)) return key
  if ((namespaceOfFileKey(key) ?? null) !== (from || null)) return key
  const rest = from ? key.slice(from.length + 1) : key
  return to ? `${to}/${rest}` : rest
}

/**
 * Moves a module ref from one namespace to another. One in another namespace is returned as it is.
 *
 * @param {string} moduleRef
 * @param {string|null} from - Null or '' for no namespace.
 * @param {string|null} to - Null or '' for no namespace.
 * @returns {string}
 */
export function renameModuleNamespace(moduleRef, from, to) {
  if (typeof moduleRef !== 'string' || (from || null) === (to || null)) return moduleRef
  const [type, subtype] = moduleRef.split(':')
  if (subtype === undefined || (namespaceOfModuleRef(moduleRef) ?? null) !== (from || null)) return moduleRef
  return moduleRefOf(type, subtype, to || null)
}

/**
 * Picks the namespace files with no namespace of their own (such as a lone config or parameters
 * file) are loaded into.
 *
 * @param {Iterable<string>} matching - Namespaces ('' for none) where what the files refer to is
 *   loaded, such as a config's math.
 * @param {Iterable<string>} loaded - Every namespace the library has, besides none.
 * @returns {{ namespace: string }|{ choices: string[] }} The namespace, '' for none; or, when
 *   several fit, those to choose from.
 */
export function pickTargetNamespace(matching, loaded) {
  const fits = [...new Set(matching)].sort()
  if (fits.length === 1) return { namespace: fits[0] }
  if (fits.length > 1) return { choices: fits }
  const namespaces = [...new Set(loaded)].filter(Boolean).sort()
  if (namespaces.length === 0) return { namespace: NO_NAMESPACE }
  if (namespaces.length === 1) return { namespace: namespaces[0] }
  return { choices: [NO_NAMESPACE, ...namespaces] }
}

/**
 * How a file key is shown: its file name, with its namespace as a tag, and the whole key for a
 * tooltip. A loose file shows its name alone.
 *
 * @param {string} fileKey
 * @returns {{ name: string, namespace: string|null, title: string }}
 */
export function describeFileKey(fileKey) {
  return { name: baseNameOf(fileKey ?? ''), namespace: namespaceOfFileKey(fileKey), title: fileKey ?? '' }
}

/**
 * How a module ref is shown: `type:subtype`, then its namespace in brackets when it has one.
 *
 * @param {string} moduleRef
 * @param {Object} [options]
 * @param {boolean} [options.withNamespace=true] - False where the namespace is shown beside it already.
 * @returns {string}
 */
export function moduleRefLabel(moduleRef, { withNamespace = true } = {}) {
  if (!moduleRef) return ''
  const namespace = namespaceOfModuleRef(moduleRef)
  if (!namespace) return moduleRef
  const bare = moduleRef.slice(0, moduleRef.length - namespace.length - 1)
  return withNamespace ? `${bare} (${namespace})` : bare
}

/**
 * How a namespace is shown, '' (none) included.
 *
 * @param {string|null} namespace
 * @returns {string}
 */
export function namespaceLabel(namespace) {
  return namespace ? namespace : '(no namespace)'
}

/**
 * Makes a namespace safe as part of a file name or CellML identifier: letters, digits, '_' and
 * '-' only.
 *
 * @param {string} namespace
 * @returns {string}
 */
export function fileSafeNamespace(namespace) {
  return String(namespace).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'namespace'
}

/**
 * Names the files an export writes side by side. Each takes its file name; where several have
 * the same one (ignoring case), those in a namespace are prefixed with it (`cardiac_membrane.cellml`),
 * and any still clashing are numbered (`cardiac_membrane_2.cellml`). So an export of one namespace,
 * or with no clashes, writes files by their names alone, as it did before namespaces existed.
 *
 * @param {Iterable<string>} fileKeys
 * @param {Object} [options]
 * @param {Iterable<string>} [options.reserved] - Names already used, such as a main model's.
 * @returns {Map<string, string>} The flat name for each file key.
 */
export function flatFileNames(fileKeys, { reserved = [] } = {}) {
  const keys = [...new Set(fileKeys)].sort()
  const byName = new Map()
  for (const key of keys) {
    const name = baseNameOf(key).toLowerCase()
    byName.set(name, [...(byName.get(name) ?? []), key])
  }

  const taken = new Set([...reserved].map((name) => name.toLowerCase()))
  const names = new Map()
  const claim = (key, name) => {
    const dot = name.lastIndexOf('.')
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    let flat = name
    for (let n = 2; taken.has(flat.toLowerCase()); n++) flat = `${stem}_${n}${extension}`
    taken.add(flat.toLowerCase())
    names.set(key, flat)
  }
  // Unclashing names and loose files first, so they keep their names whatever else is exported.
  const clashing = []
  for (const group of byName.values()) {
    for (const key of group) {
      if (group.length > 1 && namespaceOfFileKey(key)) clashing.push(key)
      else claim(key, baseNameOf(key))
    }
  }
  for (const key of clashing) claim(key, `${fileSafeNamespace(namespaceOfFileKey(key))}_${baseNameOf(key)}`)
  return new Map(keys.map((key) => [key, names.get(key)]))
}

/**
 * The namespaces ('' for none) defining a module an instance array's rows ask for: those it may
 * target.
 *
 * @param {Array<{ module_type: string, module_subtype: string }>} rows
 * @param {Iterable<string>} moduleRefs - The library's.
 * @returns {Set<string>}
 */
export function instanceArrayNamespaces(rows, moduleRefs) {
  const wanted = new Set((rows ?? []).map((row) => `${row.module_type}:${row.module_subtype}`))
  const namespaces = new Set()
  for (const ref of moduleRefs) {
    const [type, subtype] = ref.split(':')
    if (wanted.has(`${type}:${subtype}`)) namespaces.add(namespaceOfModuleRef(ref) ?? NO_NAMESPACE)
  }
  return namespaces
}
