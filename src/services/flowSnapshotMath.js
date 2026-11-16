/**
 * The math carried by a flow snapshot (the OMEX archive's flow-snapshot.json): each node's math is
 * stored once by hash, with the source it is generated from (a CellDL diagram) when it has one.
 */
import { checkMathSource } from './moduleFormats'

/**
 * Gives each node the hash of its math, collecting the math and its sources by that hash. Math
 * stored with different sources gets different hashes, so a source never reaches CellML math that
 * happens to read the same.
 *
 * @param {Array<Object>} nodes - Snapshot nodes; each one with math gets `data.mathHash`.
 * @param {ReturnType<import('../stores/libraryStore').useLibraryStore>} libraryStore
 * @returns {{ mathLibrary: Object<string, string>, mathSources: Object<string, Object> }} Both sorted by
 *   hash; mathSources is empty when no math has a source.
 */
export function collectSnapshotMath(nodes, libraryStore) {
  const entries = new Map()

  for (const node of nodes) {
    const mathRef = node.data?.mathRef
    const mathText = mathRef && libraryStore.availableMath.get(mathRef)
    if (!mathText) continue

    const source = libraryStore.getMathSource(mathRef)
    const sourceKey = source ? JSON.stringify(source) : null
    const baseHash = libraryStore.getMathHashByRef(mathRef) ?? libraryStore.createMathHash(mathText)
    let mathHash = baseHash
    let collisionIndex = 1

    while (
      entries.has(mathHash) &&
      (entries.get(mathHash).mathText !== mathText || entries.get(mathHash).sourceKey !== sourceKey)
    ) {
      mathHash = `${baseHash}_${collisionIndex++}`
    }

    entries.set(mathHash, { mathText, sourceKey, source })
    node.data.mathHash = mathHash
  }

  const sorted = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))
  return {
    mathLibrary: Object.fromEntries(sorted.map(([hash, entry]) => [hash, entry.mathText])),
    mathSources: Object.fromEntries(
      sorted.filter(([, entry]) => entry.source).map(([hash, entry]) => [hash, entry.source])
    ),
  }
}

/**
 * Gets the source a snapshot stores for a math hash, checked like a saved one.
 *
 * @param {Object} flowSnapshot
 * @param {string} mathHash
 * @returns {Object|null} Null for CellML math or a malformed source.
 */
export function getSnapshotMathSource(flowSnapshot, mathHash) {
  const mathSources = flowSnapshot?.mathSources
  if (!mathSources || typeof mathSources !== 'object' || !Object.hasOwn(mathSources, mathHash)) return null
  return checkMathSource(mathSources[mathHash])
}
