/**
 * An export's diagnostics: the errors that stop it, and the warnings and notes shown with it, gathered so the caller
 * shows them once, as one summary, rather than each stage showing its own.
 */
import { notify } from '../../utils/notify'

// Past this many characters a summary stays until closed, too long to read before it goes.
const STICKY_LENGTH = 240

/**
 * @typedef {Object} ExportReport
 * @property {string[]} errors - What stops the export.
 * @property {Array<{title: string, items: string[]}>} warnings
 * @property {Array<{title: string, items: string[]}>} infos
 */

/** @returns {ExportReport} An empty report. */
export const createExportReport = () => ({ errors: [], warnings: [], infos: [] })

/** An export stopped by its report's errors, each in `errors`; its message is them, a line each. */
export class ExportBlockedError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(errors.join('\n'))
    this.name = 'ExportBlockedError'
    this.errors = errors
  }
}

/**
 * Throws a report's errors, if it has any.
 *
 * @param {ExportReport} report
 * @throws {ExportBlockedError}
 */
export function throwIfBlocked(report) {
  if (report.errors.length) throw new ExportBlockedError(report.errors)
}

/**
 * A report's warnings and notes as one toast's options: a warning when it has any, its lines escaped (`items`), and
 * sticky when there are several or they are long.
 *
 * @param {ExportReport} report
 * @param {string} title
 * @returns {{type: string, title: string, items: string[], sticky: boolean}|null} Null when there is nothing to show.
 */
export function reportSummary(report, title) {
  const notes = [...report.warnings, ...report.infos]
  if (!notes.length) return null
  const items = notes.map((note) => `${note.title}: ${note.items.join(' ')}`)
  return {
    type: report.warnings.length ? 'warning' : 'info',
    title,
    items,
    sticky: items.length > 1 || items.join('').length > STICKY_LENGTH,
  }
}

/**
 * Shows each of a report's warnings and notes as a toast of its own, for a caller that gathers none.
 *
 * @param {ExportReport} report
 */
export function notifyEach(report) {
  report.warnings.forEach((note) => notify.warning(note))
  report.infos.forEach((note) => notify.info(note))
}
