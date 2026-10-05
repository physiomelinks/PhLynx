import { processCellMLData } from './cellml'
import { normaliseConfig, parseMathRef } from './config'
import { extensionOf } from './import'

const MAX_LISTED = 5

/**
 * Checks whether a field's `accept` list allows the file's extension.
 * @param {Object} field - Import field config.
 * @param {string} filename
 * @returns {boolean}
 */
function acceptsExtension(field, filename) {
  if (!field?.accept) return true
  return field.accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(extensionOf(filename))
}

function pathDepth(path) {
  return path.split('/').length
}

/**
 * Orders entries (shallower paths first, then by path) and keeps one entry per file name.
 * @param {{ file: File, path: string }[]} entries
 * @returns {{ ordered: { file: File, path: string }[], duplicates: { name: string, reason: string }[] }}
 */
export function planBatchEntries(entries) {
  const sorted = [...entries].sort((a, b) => pathDepth(a.path) - pathDepth(b.path) || a.path.localeCompare(b.path))

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

function isUnexpectedError(error) {
  return error instanceof Error && error.constructor !== Error && !(error instanceof SyntaxError)
}

/**
 * Builds the result for a file that no candidate field could parse. Files unrelated to every
 * expected format are skipped rather than reported as failures.
 * @param {unknown[]} errors - One parser error per candidate field.
 * @returns {{ error: string, skip?: boolean }}
 */
function describeFailures(errors) {
  const error = errors.find((e) => !e?.unrelated)
  if (!error) return { error: 'not a recognised import file', skip: true }
  if (error instanceof SyntaxError) return { error: `not valid JSON (${error.message})` }
  return { error: error?.message || String(error) }
}

/**
 * Parses a file against each candidate field that accepts its extension and returns the first
 * role whose parser succeeds. Nothing outside the returned object is changed.
 * @param {File} file
 * @param {Object[]} candidates - Import field configs, in order of preference.
 * @param {Object} [store] - Library store, passed to each parser.
 * @returns {Promise<{ key: string, field: Object, data: any, components?: any[] } | { error: string, skip?: boolean }>}
 */
export async function parseForRole(file, candidates, store = null) {
  const accepting = candidates.filter((field) => acceptsExtension(field, file.name))
  if (accepting.length === 0) {
    return { error: 'not a supported file type here', skip: true }
  }

  const errors = []
  for (const field of accepting) {
    try {
      const parsed = await field.parser(file, store)
      const data = parsed?.data ?? parsed

      if (field.processUpload === 'config') {
        // Readiness checks normalise every config, so a config that cannot be normalised fails here.
        data.forEach(normaliseConfig)
      }
      if (field.processUpload === 'cellml') {
        const result = processCellMLData(data)
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
      errors.push(error)
    }
  }
  return describeFailures(errors)
}

/**
 * Lists the CellML file names that readiness says are still needed.
 * @param {Object} status - Result of `checkResourcesAreLoaded`.
 * @returns {Set<string>}
 */
export function requiredCellMLFilenames(status) {
  return new Set([...status.missingResources.math].map((mathRef) => parseMathRef(mathRef).componentFile).filter(Boolean))
}

/**
 * Checks whether a parsed config file supplies any module that readiness says is missing.
 * @param {Object[]} configs - Parsed module configuration array.
 * @param {Object} status - Result of `checkResourcesAreLoaded`.
 * @returns {boolean}
 */
export function providesMissingModule(configs, status) {
  return configs.some((config) => status.missingResources.modules.has(`${config.module_type}:${config.module_subtype}`))
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
export function buildBatchSummary({ placed = [], failed = [], skipped = [], isInstanceArrayImport, hasInstanceArray, readiness, autoFill = null }) {
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
