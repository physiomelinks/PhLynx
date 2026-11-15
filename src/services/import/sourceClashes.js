/**
 * Asks what to do when files being loaded from a source would change what the library already
 * holds from a source of the same name: keep both (the new files get a free source name), replace,
 * or skip the source's files.
 */
import { hoistEncapsulatedComponents, processCellMLData } from '../../utils/cellml'
import { parseMathRef } from '../../utils/config'
import { renameSourceIn, sourceOfFileKey, sourceOfModuleRef, uniqueSourceName } from '../../utils/sourceIdentity'

const MAX_LISTED = 6

/** The source a clash belongs to, or null for a loose file, which is replaced as before. */
function sourceOfClash({ kind, key }) {
  if (kind === 'module') return sourceOfModuleRef(key)
  return sourceOfFileKey(kind === 'math' ? parseMathRef(key).componentFile : key)
}

function describeClash({ kind, key }) {
  if (kind === 'math') {
    const { componentFile, componentName } = parseMathRef(key)
    return `math of ${componentName} in ${componentFile}`
  }
  if (kind === 'units') return `units in ${key}`
  const [type, subtype] = key.split(':')
  return `configuration ${type}:${subtype}`
}

/**
 * What CellML files would add to the library, in the form findClashes takes.
 *
 * @param {Array<{ key: string, cellml: string }>} files - Library keys and the CellML to load under them.
 * @returns {{ mathFiles: Array, unitsFiles: Array }}
 */
export function incomingFromCellml(files) {
  const mathFiles = []
  const unitsFiles = []
  for (const { key, cellml } of files) {
    if (!sourceOfFileKey(key)) continue
    const result = processCellMLData(hoistEncapsulatedComponents(cellml).cellml)
    if (result.type !== 'success') continue
    if (result.components?.length) mathFiles.push({ key, components: result.components })
    if (result.units.count) unitsFiles.push({ key, model: result.units.model })
  }
  return { mathFiles, unitsFiles }
}

/** A settlement for when nothing clashes: every key loads as it is. */
export const NO_CLASHES = Object.freeze({
  clashes: [],
  mapKey: (key) => key,
  isSkipped: () => false,
  isReplaced: () => false,
})

/**
 * A plan for loading files, after any clashes are settled.
 *
 * @typedef {Object} ClashSettlement
 * @property {(key: string) => string} mapKey - Gives a file key or module ref its source's new name, if renamed.
 * @property {(key: string) => boolean} isSkipped - Whether a file key or module ref belongs to a skipped source.
 * @property {(key: string) => boolean} isReplaced - Whether loading it should replace what the library holds.
 * @property {Array<Object>} clashes - What was found, by findClashes; each holds both versions.
 */

/**
 * Finds clashes between incoming files and the library, and asks once per source what to do.
 *
 * @param {Object} incoming - As libraryStore.findClashes takes.
 * @param {Object} deps
 * @param {Object} deps.store - The library store.
 * @param {Function} deps.choose - From useConfirmDialog: resolves 'accept', 'extra' or 'reject'.
 * @returns {Promise<ClashSettlement>}
 */
export async function settleSourceClashes(incoming, { store, choose }) {
  const clashes = store.findClashes(incoming)
  const bySource = new Map()
  for (const clash of clashes) {
    const source = sourceOfClash(clash)
    if (!source) continue
    if (!bySource.has(source)) bySource.set(source, [])
    bySource.get(source).push(clash)
  }

  const renames = new Map()
  const skipped = new Set()
  const replaced = new Set()
  const taken = new Set(store.loadedSources())
  for (const [source, sourceClashes] of bySource) {
    const issues = sourceClashes.slice(0, MAX_LISTED).map((clash) => ({ key: clash.key, message: describeClash(clash) }))
    if (sourceClashes.length > MAX_LISTED) {
      issues.push({ key: 'more', message: `…and ${sourceClashes.length - MAX_LISTED} more` })
    }
    const renamed = uniqueSourceName(source, (name) => taken.has(name))
    const choice = await choose({
      header: 'Different Files, Same Source',
      message:
        `Files from "${source}" differ from the ones already loaded from there. Keep both, loading the new ` +
        `files as "${renamed}"; replace the loaded ones; or skip the new files.`,
      issues,
      severity: 'warning',
      acceptLabel: 'Keep both',
      extraLabel: 'Replace',
      rejectLabel: 'Skip',
    })
    if (choice === 'accept') {
      renames.set(source, renamed)
      taken.add(renamed)
    } else if (choice === 'reject') {
      skipped.add(source)
    } else {
      replaced.add(source)
    }
  }

  const sourceOf = (key) => sourceOfFileKey(key) ?? sourceOfModuleRef(key)
  return {
    clashes,
    mapKey(key) {
      const source = sourceOf(key)
      return source && renames.has(source) ? renameSourceIn(key, source, renames.get(source)) : key
    },
    isSkipped(key) {
      return skipped.has(sourceOf(key))
    },
    isReplaced(key) {
      return replaced.has(sourceOf(key))
    },
  }
}
