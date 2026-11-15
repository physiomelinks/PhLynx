/**
 * Matching side-car files to the library modules they annotate, by the component each one names.
 */
import { parseMathRef } from '../../utils/config'
import { baseNameOf, sourceOfFileKey } from '../../utils/sourceIdentity'

/**
 * Finds the library math a side-car's component subject names. A subject names its file by name
 * alone, while a source's files are keyed by path; such a file is looked for by name, in the
 * side-car's own source first.
 *
 * @param {string} mathRef - From the subject: `file:component`.
 * @param {string} sidecarKey - The side-car file's key, a path when it came from a source.
 * @param {(mathRef: string) => boolean} hasMath
 * @param {Iterable<string>} mathRefs - Every math ref in the library.
 * @returns {{ mathRef: string|null, candidates: string[] }} Null with several candidates when it is ambiguous.
 */
export function resolveSidecarMathRef(mathRef, sidecarKey, hasMath, mathRefs) {
  if (hasMath(mathRef)) return { mathRef, candidates: [] }
  const { componentFile, componentName } = parseMathRef(mathRef)
  const name = baseNameOf(componentFile)
  const candidates = [...mathRefs].filter((ref) => {
    const parts = parseMathRef(ref)
    return parts.componentName === componentName && baseNameOf(parts.componentFile) === name
  })
  const source = sourceOfFileKey(sidecarKey)
  const own = source ? candidates.filter((ref) => sourceOfFileKey(parseMathRef(ref).componentFile) === source) : []
  if (own.length === 1) return { mathRef: own[0], candidates: [] }
  if (candidates.length === 1) return { mathRef: candidates[0], candidates: [] }
  return { mathRef: null, candidates: own.length > 1 ? own : candidates }
}

/**
 * Sorts read side-car files into those that annotate a library module and those that don't. A file matches only
 * the module its own component subject names; nothing is matched by file name.
 *
 * @param {Array<{ name: string, text: string, mathRef?: string|null }>} files - mathRef from readSidecarComponent;
 *   name is the file's key, a path when it came from a source.
 * @param {(mathRef: string) => boolean} hasMath - Whether the library has the math.
 * @param {Iterable<string>} [mathRefs] - Every math ref in the library, to find a source's file by name
 *   (see resolveSidecarMathRef).
 * @returns {{ matched: Array<{ name: string, text: string, mathRef: string }>,
 *   unmatched: Array<{ name: string, reason: string }> }} A second file for the same module is unmatched.
 */
export function matchSidecarFiles(files, hasMath, mathRefs = []) {
  const matched = []
  const unmatched = []
  const taken = new Set()
  for (const { name, text, mathRef: named } of files) {
    const { mathRef, candidates } = named
      ? resolveSidecarMathRef(named, name, hasMath, mathRefs)
      : { mathRef: null, candidates: [] }
    if (!named) unmatched.push({ name, reason: 'names no single module component' })
    else if (candidates.length) {
      unmatched.push({ name, reason: `annotates ${named}, which several sources have: ${candidates.join(', ')}` })
    } else if (!mathRef) unmatched.push({ name, reason: `annotates ${named}, which is not in the library` })
    else if (taken.has(mathRef)) unmatched.push({ name, reason: `annotates ${mathRef}, as an earlier file does` })
    else {
      taken.add(mathRef)
      matched.push({ name, text, mathRef })
    }
  }
  return { matched, unmatched }
}
