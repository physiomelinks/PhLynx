import { hoistEncapsulatedComponents } from '../../utils/cellml'
import { notify } from '../../utils/notify'

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
