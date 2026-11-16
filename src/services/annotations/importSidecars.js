/**
 * Matching side-car files to the library modules they annotate, by the component each one names.
 */

/**
 * Sorts read side-car files into those that annotate a library module and those that don't. A file matches only
 * the module its own component subject names; nothing is matched by file name.
 *
 * @param {Array<{ name: string, text: string, mathRef?: string|null }>} files - mathRef from readSidecarComponent.
 * @param {(mathRef: string) => boolean} hasMath - Whether the library has the math.
 * @returns {{ matched: Array<{ name: string, text: string, mathRef: string }>,
 *   unmatched: Array<{ name: string, reason: string }> }} A second file for the same module is unmatched.
 */
export function matchSidecarFiles(files, hasMath) {
  const matched = []
  const unmatched = []
  const taken = new Set()
  for (const { name, text, mathRef } of files) {
    if (!mathRef) unmatched.push({ name, reason: 'names no single module component' })
    else if (!hasMath(mathRef)) unmatched.push({ name, reason: `annotates ${mathRef}, which is not in the library` })
    else if (taken.has(mathRef)) unmatched.push({ name, reason: `annotates ${mathRef}, as an earlier file does` })
    else {
      taken.add(mathRef)
      matched.push({ name, text, mathRef })
    }
  }
  return { matched, unmatched }
}
