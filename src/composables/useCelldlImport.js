import { issueLines } from '../services/celldl/issues'
import { useLibraryStore } from '../stores/libraryStore'
import { escapeHtml } from '../utils/importBatch'
import { readFileAsText } from '../utils/misc'
import { notify } from '../utils/notify'

/**
 * Imports CellDL diagrams as modules, each converted to CellML that runs like any other.
 *
 * @param {Object} options
 * @param {Function} options.confirm - Confirm dialog; resolves true to add a diagram with warnings.
 * @returns {{ loadCelldlFiles: Function }}
 */
export function useCelldlImport({ confirm }) {
  const libraryStore = useLibraryStore()

  /**
   * Asks whether to add a diagram that converted with warnings.
   *
   * @param {string} filename
   * @param {Object[]} warnings
   * @returns {Promise<boolean>}
   */
  const confirmWarnings = (filename, warnings) =>
    confirm({
      header: 'CellDL Diagram Warnings',
      message: [`${filename} converted with warnings:`, ...issueLines(warnings), '', 'Add it anyway?'].join('\n'),
      severity: 'warning',
      acceptLabel: 'Add',
      rejectLabel: 'Cancel',
    })

  /**
   * Adds each diagram as a module, in turn so each gets a name of its own. A diagram that doesn't
   * convert adds nothing, and its errors are shown.
   *
   * @param {Array<File|{ name: string, content: string }>} entries
   * @returns {Promise<Array<{ ok: boolean, name: string, mathRef?: string }>>}
   */
  const loadCelldlFiles = async (entries) => {
    const { importCelldl } = await import('../services/celldl/importCelldl.js')
    const results = []
    for (const entry of entries) {
      const name = entry.name
      try {
        const content = entry instanceof File ? await readFileAsText(entry) : entry.content
        const result = await importCelldl(name, content, libraryStore, {
          confirmWarnings: (warnings) => confirmWarnings(name, warnings),
        })
        if (result.ok) {
          notify.success({ title: 'CellDL Diagram Loaded', message: escapeHtml(`Added ${result.componentName} from ${name}.`) })
        } else if (!result.cancelled) {
          notify.error({
            title: 'CellDL Import Error',
            message: [`${name} can't be imported:`, ...issueLines(result.errors)].map(escapeHtml).join('<br>'),
          })
        }
        results.push({ ok: result.ok, name, mathRef: result.ok ? result.mathRef : undefined })
      } catch (error) {
        console.error('CellDL import failed:', error)
        notify.error({ title: 'CellDL Import Error', message: escapeHtml(`${name} can't be converted: ${error.message}`) })
        results.push({ ok: false, name })
      }
    }
    return results
  }

  return { loadCelldlFiles }
}
