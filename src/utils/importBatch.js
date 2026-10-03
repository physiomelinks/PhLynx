import { IMPORT_KEYS } from './constants'
import { processCellMLData } from './cellml'
import { normaliseConfig, parseMathRef } from './config'

const MAX_LISTED = 5

const ROLE_NOUNS = {
  [IMPORT_KEYS.INSTANCE_ARRAY]: 'instance array',
  [IMPORT_KEYS.PARAMETER]: 'parameters file',
  [IMPORT_KEYS.MODULE_CONFIG]: 'module configuration',
  [IMPORT_KEYS.CELLML_FILE]: 'CellML file',
  [IMPORT_KEYS.OMEX]: 'COMBINE archive',
}

/**
 * Returns the lower-case extension of a file name, including the dot.
 * @param {string} filename
 * @returns {string}
 */
export function extensionOf(filename) {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

/**
 * Checks whether a field's `accept` list allows the file's extension.
 * @param {Object} field - Import field config.
 * @param {string} filename
 * @returns {boolean}
 */
export function acceptsExtension(field, filename) {
  if (!field?.accept) return true
  return field.accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(extensionOf(filename))
}

function importPriority(filename) {
  const ext = extensionOf(filename)
  if (ext === '.csv') return 0
  if (ext === '.json') return 1
  if (ext === '.cellml' || ext === '.xml') return 2
  return 3
}

function pathDepth(path) {
  return path.split('/').length
}

/**
 * Orders entries (CSV, JSON, then CellML; shallower paths first; then by
 * path) and keeps one entry per file name.
 * @param {{ file: File, path: string }[]} entries
 * @returns {{ ordered: { file: File, path: string }[], duplicates: { name: string, reason: string }[] }}
 */
export function planBatchEntries(entries) {
  const sorted = [...entries].sort(
    (a, b) =>
      importPriority(a.file.name) - importPriority(b.file.name) ||
      pathDepth(a.path) - pathDepth(b.path) ||
      a.path.localeCompare(b.path)
  )

  const keptByName = new Map()
  const duplicates = []
  for (const entry of sorted) {
    const kept = keptByName.get(entry.file.name)
    if (kept) {
      duplicates.push({ name: entry.path, reason: `same name as ${kept.path}` })
    } else {
      keptByName.set(entry.file.name, entry)
    }
  }
  return { ordered: [...keptByName.values()], duplicates }
}

/**
 * Turns a parser error into a short reason for the user.
 * @param {unknown} error
 * @returns {string}
 */
export function describeImportError(error) {
  if (error instanceof SyntaxError) return `not valid JSON (${error.message})`
  return error?.message || String(error)
}

function roleNoun(field) {
  return ROLE_NOUNS[field.key] ?? field.label ?? 'supported file'
}

/** True when an error shows the file shares nothing with the expected format. */
function isUnrelatedFormat(error) {
  if (error?.unrelated) return true
  return Array.isArray(error?.missing) && error.missing.length === error.required?.length
}

function isUnexpectedError(error) {
  return error instanceof Error && error.constructor !== Error && !(error instanceof SyntaxError)
}

/**
 * Builds the result for a file that no candidate field could parse. Files that share no columns or
 * keys with any expected format are reported as unrecognised, not as failures.
 * @param {{ field: Object, error: unknown }[]} failures
 * @returns {{ error: string, unrecognised?: boolean }}
 */
function describeFailures(failures) {
  const related = failures.filter(({ error }) => !isUnrelatedFormat(error))
  if (related.length === 0) {
    const nouns = failures.map(({ field }) => roleNoun(field)).join(' or ')
    const article = /^[aeiou]/i.test(nouns) ? 'an' : 'a'
    return { error: `not ${article} ${nouns}`, unrecognised: true }
  }
  const closest = related.reduce((best, current) =>
    (current.error?.missing?.length ?? Infinity) < (best.error?.missing?.length ?? Infinity) ? current : best
  )
  return { error: describeImportError(closest.error) }
}

/**
 * Parses a file against each candidate field that accepts its extension and returns the first
 * role whose parser succeeds. Nothing outside the returned object is changed.
 * @param {File} file
 * @param {Object[]} candidates - Import field configs, in order of preference.
 * @param {Object} [options]
 * @param {Object} [options.store] - Library store, for parsers with `requiresStore`.
 * @param {Function} [options.processCellML] - CellML processor for fields with `processUpload: 'cellml'`.
 * @returns {Promise<{ key: string, field: Object, data: any, components?: any[] } | { error: string, unsupported?: boolean, unrecognised?: boolean }>}
 */
export async function parseForRole(file, candidates, { store = null, processCellML = processCellMLData } = {}) {
  const accepting = candidates.filter((field) => acceptsExtension(field, file.name))
  if (accepting.length === 0) {
    return { error: 'not a supported file type here', unsupported: true }
  }

  const failures = []
  for (const field of accepting) {
    try {
      const parsed = field.requiresStore ? await field.parser(file, store) : await field.parser(file)
      const data = parsed?.data ?? parsed

      if (field.processUpload === 'config') {
        // Readiness checks normalise every config, so a config that cannot be normalised fails here.
        data.forEach(normaliseConfig)
      }
      if (field.processUpload === 'cellml') {
        const result = processCellML(data)
        if (result?.type !== 'success') {
          throw new Error(`Invalid CellML: ${result?.issues?.[0]?.description ?? 'the model could not be read.'}`)
        }
        return { key: field.key, field, data, components: result.components }
      }
      return { key: field.key, field, data }
    } catch (error) {
      if (isUnexpectedError(error)) {
        console.error(`[importBatch] Unexpected error while reading "${file.name}" as ${field.key}:`, error)
      }
      failures.push({ field, error })
    }
  }
  return describeFailures(failures)
}

/**
 * Lists the CellML file names that readiness says are still needed.
 * @param {Object|null} status - Result of `checkResourcesAreLoaded`.
 * @returns {Set<string>}
 */
export function requiredCellMLFilenames(status) {
  const mathRefs = status?.missingResources?.math ?? []
  return new Set([...mathRefs].map((mathRef) => parseMathRef(mathRef).componentFile).filter(Boolean))
}

/**
 * Checks whether a parsed config file supplies any module that readiness says is missing.
 * @param {Object[]} configs - Parsed module configuration array.
 * @param {Object|null} status - Result of `checkResourcesAreLoaded`.
 * @returns {boolean}
 */
export function providesMissingModule(configs, status) {
  const missing = status?.missingResources?.modules
  if (!missing?.size || !Array.isArray(configs)) return false
  return configs.some((config) => missing.has(`${config.module_type}:${config.module_subtype}`))
}

/**
 * Escapes text for the toast detail, which is rendered as HTML.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function pluralise(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function formatList(items) {
  const shown = items.slice(0, MAX_LISTED).map(escapeHtml).join(', ')
  return items.length > MAX_LISTED ? `${shown} …and ${items.length - MAX_LISTED} more` : shown
}

/** Groups `{ name, reason }` items into one line per distinct reason. */
function formatReasonLines(prefix, items) {
  const namesByReason = new Map()
  for (const { name, reason } of items) {
    if (!namesByReason.has(reason)) namesByReason.set(reason, [])
    namesByReason.get(reason).push(name)
  }
  return [...namesByReason].map(([reason, names]) => `${prefix}: ${formatList(names)} — ${escapeHtml(reason)}`)
}

/**
 * Builds the single notification shown after a batch of files has been sorted into the dialog.
 * @param {Object} result
 * @param {{ name: string, key: string }[]} result.placed - Files added to a field.
 * @param {{ name: string, reason: string }[]} result.failed - Files that matched a role but could not be read.
 * @param {{ name: string, reason: string }[]} result.skipped - Files left out on purpose.
 * @param {boolean} result.isInstanceArrayImport
 * @param {boolean} result.hasInstanceArray
 * @param {Object|null} result.readiness - Current `checkResourcesAreLoaded` result.
 * @param {{ count: number, folderName: string }|null} [result.autoFill] - Files added from the connected folder.
 * @returns {{ type: string, title: string, message: string, duration: number }}
 */
export function buildBatchSummary({ placed, failed, skipped, isInstanceArrayImport, hasInstanceArray, readiness, autoFill = null }) {
  const lines = []
  const addedParts = []
  if (placed.length) addedParts.push(pluralise(placed.length, 'file'))
  if (autoFill?.count) {
    addedParts.push(`${pluralise(autoFill.count, 'file')} from connected folder "${escapeHtml(autoFill.folderName)}"`)
  }
  if (addedParts.length) lines.push(`Added ${addedParts.join(' and ')}.`)

  let type
  let title
  if (addedParts.length === 0) {
    type = 'error'
    title = 'Nothing Added'
  } else if (isInstanceArrayImport && !hasInstanceArray) {
    type = 'warning'
    title = 'Instance Array Needed'
    lines.push('Add an instance array (.csv) to continue.')
  } else if (isInstanceArrayImport && !readiness?.resourcesAreLoaded) {
    type = 'warning'
    title = 'More Files Needed'
    const { modules, math } = readiness?.missingResources ?? {}
    if (modules?.size) lines.push(`Missing configurations for: ${formatList([...modules])}`)
    if (math?.size) lines.push(`Missing CellML components: ${formatList([...math])}`)
  } else if (failed.length) {
    type = 'warning'
    title = 'Some Files Not Added'
  } else {
    type = 'success'
    title = isInstanceArrayImport ? 'Ready to Import' : 'Files Ready'
  }

  lines.push(...formatReasonLines('Not added', failed))
  lines.push(...formatReasonLines('Ignored', skipped))

  return {
    type,
    title,
    message: lines.join('<br>'),
    duration: type === 'success' ? 3000 : 6000,
  }
}
