/**
 * Resolves the `<import>` elements of CellML files against a file source: an uploaded folder or
 * zip, or a repository read file by file over HTTP (such as a GitHub commit).
 *
 * Only units imports are inlined for now. Imported units are replaced by concrete definitions,
 * so nothing that reaches the library points at a file the library cannot open. Component
 * imports are left in place and reported.
 */
import { getLibCellML } from '../../utils/cellml'

const XLINK_NS = 'http://www.w3.org/1999/xlink'
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i

/**
 * Something CellML files can be read from, by paths relative to its root.
 *
 * @typedef {Object} FileSource
 * @property {(path: string) => Promise<string|null>} read - The file's text, or null if it does not exist.
 * @property {(name: string) => string[]} [findByName] - Paths of every file with this base name; only
 *   sources that can list their files have it.
 */

/**
 * An unresolved import, as reported to the user.
 *
 * @typedef {Object} ImportIssue
 * @property {string} href - The import's `xlink:href`, as written.
 * @property {string[]} units - Units the import brought in (empty for a component-only import).
 * @property {string[]} components - Components the import brought in.
 * @property {string} reason
 */

/**
 * Collapses `.` and `..` segments in a slash-separated path.
 *
 * @param {string} path
 * @returns {string|null} Null when the path climbs above the root.
 */
export function normalisePath(path) {
  const parts = []
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.join('/')
}

/**
 * Resolves an import's href against the path of the file that holds it.
 *
 * @param {string} fromPath - Root-relative path of the importing file.
 * @param {string} href
 * @returns {{ kind: 'path', path: string } | { kind: 'url', url: string } | { kind: 'outside' }}
 */
export function resolveHref(fromPath, href) {
  if (ABSOLUTE_URL.test(href)) return { kind: 'url', url: href }
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : ''
  const path = normalisePath(href.startsWith('/') ? href : dir + href)
  return path === null ? { kind: 'outside' } : { kind: 'path', path }
}

/**
 * A source over files already in hand, such as an uploaded folder or the contents of a zip.
 *
 * @param {Iterable<[string, string|Blob|(() => Promise<string>)]>} entries - Root-relative path to
 *   text, a Blob/File, or a loader.
 * @returns {FileSource}
 */
export function createMapSource(entries) {
  const files = new Map()
  for (const [path, content] of entries) {
    const key = normalisePath(path)
    if (key !== null && !files.has(key)) files.set(key, content)
  }
  const cache = new Map()
  return {
    async read(path) {
      if (!files.has(path)) return null
      if (!cache.has(path)) {
        const content = files.get(path)
        let text
        if (typeof content === 'string') text = content
        else if (typeof content === 'function') text = await content()
        else text = await content.text()
        cache.set(path, text)
      }
      return cache.get(path)
    },
    findByName(name) {
      return [...files.keys()].filter((path) => path.split('/').pop() === name)
    },
  }
}

/**
 * A source read file by file over HTTP. It cannot list its files, so imports resolve only by path.
 *
 * @param {string} baseUrl - URL of the root, ending in `/`.
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {FileSource}
 */
export function createUrlSource(baseUrl, { fetchImpl = globalThis.fetch } = {}) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const cache = new Map()
  return {
    read(path) {
      if (!cache.has(path)) {
        cache.set(
          path,
          fetchImpl(new URL(path, base).href).then((response) => {
            if (response.status === 404) return null
            if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${path}`)
            return response.text()
          })
        )
      }
      return cache.get(path)
    },
  }
}

/**
 * A source over one commit of a public GitHub repository, read from raw.githubusercontent.com.
 * Pin `ref` to a commit SHA so a file and the files it imports come from the same revision.
 *
 * @param {{ owner: string, repo: string, ref: string, root?: string }} location - `root` is the
 *   folder within the repository that paths are relative to, such as `CellML`.
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {FileSource}
 */
export function createGitHubSource({ owner, repo, ref, root = '' }, options = {}) {
  const prefix = normalisePath(root)
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${prefix ? `${prefix}/` : ''}`
  return createUrlSource(base, options)
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

function hrefOf(element) {
  return element.getAttributeNS(XLINK_NS, 'href') || element.getAttribute('xlink:href') || ''
}

function childrenNamed(element, localName) {
  return [...element.children].filter((child) => child.localName === localName)
}

function importElements(doc) {
  return childrenNamed(doc.documentElement, 'import')
}

/**
 * Finds a file for an import: by path, else (in a source that can list files) by a unique base name.
 *
 * @returns {Promise<{ path: string, text: string, byName?: boolean } | { reason: string }>}
 */
async function locate(source, fromPath, href) {
  const target = resolveHref(fromPath, href)
  if (target.kind === 'url') return { reason: 'imports from other locations are not fetched yet' }

  if (target.kind === 'path') {
    const text = await source.read(target.path)
    if (text !== null) return { path: target.path, text }
  }

  const name = href.split('/').pop()
  const matches = source.findByName?.(name) ?? []
  if (matches.length === 1) {
    const text = await source.read(matches[0])
    if (text !== null) return { path: matches[0], text, byName: true }
  }
  if (matches.length > 1) return { reason: `"${name}" matches ${matches.length} files and none at the import's path` }
  return { reason: target.kind === 'outside' ? 'the file is outside the uploaded folder' : 'file not found' }
}

/**
 * Reads every file the given file imports, directly or through other imports, with each file's
 * hrefs rewritten to root-relative paths. libcellml looks models up by `basePath + href` without
 * normalising it, so rewritten hrefs are what let it find them.
 *
 * @param {string} rootPath
 * @param {Document} rootDoc
 * @param {FileSource} source
 * @returns {Promise<{ files: Map<string, string>, targets: Map<Element, { href: string, path?: string, reason?: string }> }>}
 *   `files` holds every imported file's rewritten text; `targets` says where each of the root's imports went.
 */
async function collectImports(rootPath, rootDoc, source) {
  const files = new Map()
  const targets = new Map()
  const pending = []

  const visit = async (fromPath, doc, recordTargets) => {
    for (const element of importElements(doc)) {
      const href = hrefOf(element)
      const found = await locate(source, fromPath, href)
      if (recordTargets) targets.set(element, { ...found, href })
      if (!found.path) continue
      // The root keeps its own hrefs: imports left in it must still be relative to it.
      if (!recordTargets) element.setAttributeNS(XLINK_NS, 'xlink:href', found.path)
      if (!files.has(found.path)) {
        files.set(found.path, null)
        pending.push(found)
      }
    }
  }

  await visit(rootPath, rootDoc, true)
  while (pending.length) {
    const { path, text } = pending.shift()
    const doc = parseXml(text)
    if (!doc) {
      files.set(path, text)
      continue
    }
    await visit(path, doc, false)
    files.set(path, new XMLSerializer().serializeToString(doc))
  }
  return { files, targets }
}

/** Copies an element into `doc` under `namespace`, so units printed as CellML 2.0 can sit in a 1.x model. */
function adoptInNamespace(doc, element, namespace) {
  const copy = doc.createElementNS(namespace, element.localName)
  for (const attribute of element.attributes) {
    if (attribute.name === 'xmlns') continue
    copy.setAttribute(attribute.name, attribute.value)
  }
  for (const child of element.children) copy.appendChild(adoptInNamespace(doc, child, namespace))
  return copy
}

function deleteAll(...objects) {
  for (const object of objects) object?.delete?.()
}

function loggerMessages(logger) {
  const messages = []
  for (let i = 0; i < logger.errorCount(); i++) {
    const issue = logger.error(i)
    messages.push(issue.description())
    issue.delete()
  }
  return messages
}

/**
 * Flattens the given units imports into concrete `<units>` elements with libcellml.
 *
 * @returns {{ units: Element[] } | { error: string }}
 */
function flattenUnitsImports(namespace, unitsImports, files) {
  const libcellml = getLibCellML()
  const doc = parseXml(`<model xmlns="${namespace}" xmlns:xlink="${XLINK_NS}" name="units_imports"/>`)
  for (const { path, units } of unitsImports) {
    const element = doc.createElementNS(namespace, 'import')
    element.setAttributeNS(XLINK_NS, 'xlink:href', path)
    for (const unit of units) element.appendChild(adoptInNamespace(doc, unit, namespace))
    doc.documentElement.appendChild(element)
  }

  const parser = new libcellml.Parser(false)
  const importer = new libcellml.Importer(false)
  const printer = new libcellml.Printer()
  const libraryModels = []
  let model = null
  let flattened = null
  try {
    for (const [path, text] of files) {
      const imported = parser.parseModel(text)
      if (parser.errorCount()) {
        const [message] = loggerMessages(parser)
        deleteAll(imported)
        return { error: `${path} could not be read: ${message}` }
      }
      importer.addModel(imported, path)
      libraryModels.push(imported)
    }

    model = parser.parseModel(new XMLSerializer().serializeToString(doc))
    if (parser.errorCount()) return { error: loggerMessages(parser)[0] }
    importer.resolveImports(model, '')
    if (importer.errorCount() || model.hasUnresolvedImports()) {
      return { error: loggerMessages(importer)[0] ?? 'the imported units could not be resolved' }
    }
    flattened = importer.flattenModel(model)
    if (!flattened) return { error: loggerMessages(importer)[0] ?? 'the imported units could not be flattened' }

    const printed = parseXml(printer.printModel(flattened, false))
    return { units: printed ? childrenNamed(printed.documentElement, 'units') : [] }
  } finally {
    deleteAll(flattened, model, ...libraryModels, printer, importer, parser)
  }
}

/**
 * Replaces a CellML file's imported units with concrete definitions read from `source`.
 *
 * Imported units that cannot be resolved are removed and reported, so the library never holds a
 * units placeholder pointing at a file it cannot open; the generator then looks those units up
 * by name among the library's units files. Component imports are kept and reported.
 *
 * @param {string} cellml - The file's text.
 * @param {string} path - Its root-relative path in `source`.
 * @param {FileSource|null} source
 * @returns {Promise<{ cellml: string, inlined: string[], issues: ImportIssue[] }>}
 */
export async function inlineUnitsImports(cellml, path, source) {
  const doc = parseXml(cellml)
  const imports = doc ? importElements(doc) : []
  if (imports.length === 0) return { cellml, inlined: [], issues: [] }

  const namespace = doc.documentElement.namespaceURI
  const emptySource = { read: async () => null }
  const { files, targets } = await collectImports(path, doc, source ?? emptySource)

  const issues = []
  const resolvable = []
  for (const element of imports) {
    const units = childrenNamed(element, 'units')
    const components = childrenNamed(element, 'component')
    const target = targets.get(element)
    const report = (reason) =>
      issues.push({
        href: hrefOf(element),
        units: units.map((u) => u.getAttribute('name')),
        components: components.map((c) => c.getAttribute('name')),
        reason,
      })
    if (components.length) report('component imports are not supported yet')
    if (!units.length) continue
    if (target?.path) resolvable.push({ element, path: target.path, units })
    else report(target?.reason ?? 'file not found')
  }

  let concrete = []
  if (resolvable.length) {
    const result = flattenUnitsImports(namespace, resolvable, files)
    if (result.error) {
      for (const { element, units } of resolvable) {
        issues.push({
          href: targets.get(element).href,
          units: units.map((u) => u.getAttribute('name')),
          components: [],
          reason: result.error,
        })
      }
    } else {
      concrete = result.units
    }
  }

  // Remove every units placeholder, resolved or not, and any import left empty. The concrete
  // units go where the first units import was.
  const marker = doc.createComment('')
  for (const element of imports) {
    const units = childrenNamed(element, 'units')
    if (!units.length) continue
    if (!marker.parentNode) doc.documentElement.insertBefore(marker, element)
    units.forEach((unit) => unit.remove())
    if (element.children.length === 0) element.remove()
  }

  const localNames = new Set(childrenNamed(doc.documentElement, 'units').map((u) => u.getAttribute('name')))
  const inlined = []
  for (const unit of concrete) {
    const name = unit.getAttribute('name')
    // A local definition of the same name wins, as it would for any other reference in this file.
    if (localNames.has(name)) continue
    doc.documentElement.insertBefore(adoptInNamespace(doc, unit, namespace), marker)
    inlined.push(name)
  }
  marker.remove()

  return { cellml: new XMLSerializer().serializeToString(doc), inlined, issues }
}

/**
 * One line per import issue, for notifications.
 *
 * @param {ImportIssue[]} issues
 * @returns {string[]}
 */
export function describeImportIssues(issues) {
  return issues.map(({ href, units, components, reason }) => {
    const what = [
      units.length ? `units ${units.join(', ')}` : '',
      components.length ? `components ${components.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' and ')
    return `${what} from ${href}: ${reason}`
  })
}
