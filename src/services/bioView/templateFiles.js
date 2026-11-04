/**
 * Template files the user loads and saves: reading their text, wording what is wrong with them, and writing a
 * template back out. The user's own library itself lives in the template store.
 */

import { escapeHtml } from '../../utils/importBatch.js'
import { bareTemplateId } from './templates.js'

/** The suffix template files are saved with. */
export const TEMPLATE_FILE_SUFFIX = '.template.json'

/** How many problems a notification lists before it just counts the rest. */
export const SHOWN_PROBLEMS = 3

/** The largest file read at all; templates themselves are capped smaller, once parsed. */
export const MAX_TEMPLATE_FILE_BYTES = 1024 * 1024

/**
 * Parses a template file's text.
 *
 * @param {string} text
 * @returns {{ raw: *, errors: Array<string> }} `raw` is undefined when the text is not JSON.
 */
export function parseTemplateText(text) {
  if (typeof text !== 'string' || !text.trim()) return { raw: undefined, errors: ['The file is empty.'] }
  try {
    return { raw: JSON.parse(text), errors: [] }
  } catch (e) {
    return { raw: undefined, errors: [`The file is not valid JSON: ${e.message}`] }
  }
}

/**
 * Reads and parses a template file the user picked, refusing ones too big to be a template unread. Glyph
 * library files are read the same way.
 *
 * @param {Blob} file
 * @param {Object} [options]
 * @param {string} [options.what='a template'] - What the file should be, as problems name it.
 * @returns {Promise<{ raw: *, errors: Array<string> }>}
 */
export async function readTemplateFile(file, { what = 'a template' } = {}) {
  if (file.size > MAX_TEMPLATE_FILE_BYTES) {
    const limit = `${MAX_TEMPLATE_FILE_BYTES / 1024} KB`
    return { raw: undefined, errors: [`The file is too big to be ${what} (over ${limit}).`] }
  }
  let text
  try {
    text = await file.text()
  } catch (e) {
    return { raw: undefined, errors: [`The file could not be read: ${e?.message ?? e}`] }
  }
  return parseTemplateText(text)
}

/**
 * Words a list of problems for a notification: the first few, one per line, and how many more there are.
 * Notifications show their message as HTML, and problems quote the file, so each line is escaped.
 *
 * @param {Array<string>} problems
 * @param {number} [max=SHOWN_PROBLEMS]
 * @returns {string} HTML.
 */
export function summariseProblems(problems, max = SHOWN_PROBLEMS) {
  const shown = problems.slice(0, max).map(escapeHtml)
  const more = problems.length - shown.length
  return (more > 0 ? [...shown, `…and ${more} more.`] : shown).join('<br>')
}

/**
 * Writes a template as a file anyone can load: its own id, without the `local:` prefix.
 *
 * @param {Object} template - A validated template.
 * @returns {{ filename: string, text: string }}
 */
export function templateFile(template) {
  const id = bareTemplateId(template.id)
  const text = JSON.stringify({ ...template, id }, null, 2) + '\n'
  return { filename: `${id}${TEMPLATE_FILE_SUFFIX}`, text }
}
