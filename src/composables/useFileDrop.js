import JSZip from 'jszip'

import { hasRelevantExtension, collectEntry, fileFromEntry } from '../utils/import'
import { sanitiseSourceName } from '../utils/sourceIdentity'

const isZip = (name) => name.toLowerCase().endsWith('.zip')

/**
 * Lists the relevant files inside a zip, with paths relative to the zip's root, so a zipped
 * module repository resolves its CellML imports as the unzipped folder would. A path's first
 * folder names the files' source; when the zip has no single top folder, the zip's own name does.
 *
 * @param {File} zipFile
 * @returns {Promise<{ file: File, path: string }[]>}
 */
export async function entriesFromZip(zipFile) {
  const archive = await JSZip.loadAsync(zipFile)
  const results = []
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue
    const segments = entry.name.split('/')
    const name = segments.at(-1)
    if (segments.some((segment) => segment.startsWith('.') || segment === '__MACOSX' || segment === 'node_modules')) continue
    if (!hasRelevantExtension(name)) continue
    results.push({ file: new File([await entry.async('blob')], name), path: entry.name })
  }
  const tops = new Set(results.map(({ path }) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : null)))
  if (tops.size === 1 && !tops.has(null)) return results
  const stem = sanitiseSourceName((zipFile.name ?? 'archive').replace(/\.zip$/i, '')) || 'archive'
  return results.map(({ file, path }) => ({ file, path: `${stem}/${path}` }))
}

export function useFileDrop() {
  /**
   * Reads the files of a drop, walking folders and opening zips.
   *
   * @param {DataTransfer} dataTransfer
   * @param {Object} [options]
   * @param {number} [options.maxDepth] - Folder levels below a dropped folder to walk; deep enough for
   *   a module repository with its CellML one level down (`CellML/math/x.cellml`).
   * @returns {Promise<{ file: File, path: string }[]>}
   */
  async function filesFromDataTransfer(dataTransfer, { maxDepth = 4 } = {}) {
    const items = dataTransfer?.items
    const results = []

    const supportsEntries = items && items.length > 0 && typeof items[0]?.webkitGetAsEntry === 'function'

    if (supportsEntries) {
      const entries = Array.from(items)
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean)

      for (const entry of entries) {
        if (entry.isFile && isZip(entry.name)) {
          results.push(...(await entriesFromZip(await fileFromEntry(entry))))
        } else {
          await collectEntry(entry, '', 0, maxDepth, results)
        }
      }
      return results
    }

    const files = Array.from(dataTransfer?.files || [])
    for (const file of files) {
      if (isZip(file.name)) {
        results.push(...(await entriesFromZip(file)))
      } else if (hasRelevantExtension(file.name)) {
        results.push({ file, path: file.name })
      }
    }
    return results
  }

  return { filesFromDataTransfer }
}
