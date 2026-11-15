import { hoistEncapsulatedComponents } from '../../utils/cellml'
import { escapeHtml } from '../../utils/importBatch'
import { notify } from '../../utils/notify'
import { createMapSource, describeImportIssues, inlineUnitsImports } from './cellmlImports'

/**
 * Inlines the units imports of CellML files loaded together, looking each import up among the
 * other files by path and then by name, with one notice for every import that stays unresolved.
 *
 * @param {Array<{name: string, path?: string, content: string|null}>} files - Null content is passed through.
 * @returns {Promise<Array<string|null>>} Each file's CellML, in order.
 */
export async function resolveCellmlImports(files) {
  const pathOf = (file) => file.path ?? file.name
  const source = createMapSource(files.filter((file) => file.content != null).map((file) => [pathOf(file), file.content]))
  const unresolved = []
  const resolved = []
  for (const file of files) {
    if (file.content == null) {
      resolved.push(file.content)
      continue
    }
    const { cellml, issues } = await inlineUnitsImports(file.content, pathOf(file), source)
    if (issues.length) unresolved.push(`${escapeHtml(file.name)}: ${describeImportIssues(issues).map(escapeHtml).join('; ')}`)
    resolved.push(cellml)
  }
  if (unresolved.length) {
    notify.warning({
      title: 'Some Imports Not Resolved',
      message: [...unresolved, 'Unresolved units are looked up by name in the other loaded units files.'].join('<br>'),
    })
  }
  return resolved
}

/**
 * Readies a CellML file for import: encapsulated components move to the top level (see
 * hoistEncapsulatedComponents), and notices say when containment groups were ignored or the
 * encapsulation could not be undone. Call it once per imported file, and give its result to every
 * later import step.
 *
 * @param {string} content - Raw CellML XML string.
 * @param {string} fileName - Shown in the notices.
 * @returns {string} The CellML to import; the same string when there is no encapsulation.
 */
export function prepareCellmlImport(content, fileName) {
  const [cellml] = prepareCellmlImports([{ name: fileName, content }])
  return cellml
}

/**
 * Readies several CellML files for import as prepareCellmlImport does, with one notice of each
 * kind for the whole batch.
 *
 * @param {Array<{name: string, content: string}>} files
 * @returns {string[]} The CellML to import for each file, in order.
 */
export function prepareCellmlImports(files) {
  const prepared = files.map(({ name, content }) => ({ name, ...hoistEncapsulatedComponents(content) }))
  const namesWith = (flag) => prepared.filter((file) => file[flag]).map((file) => file.name)

  const containment = namesWith('ignoredContainment')
  if (containment.length > 0) {
    notify.info({
      title: 'Containment Groups Ignored',
      message: `${containment.join(', ')} ${containment.length === 1 ? 'groups' : 'group'} components by containment, which PhLynx doesn't use. The components are imported without it.`,
      duration: 5000,
    })
  }
  const failed = namesWith('hoistFailed')
  if (failed.length > 0) {
    notify.warning({
      title: 'Encapsulation Kept',
      message: `PhLynx couldn't move the encapsulated components in ${failed.join(', ')} to the top level, so their math may not import correctly.`,
    })
  }
  return prepared.map((file) => file.cellml)
}
