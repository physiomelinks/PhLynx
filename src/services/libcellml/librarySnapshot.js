/**
 * The parts of the library a model build reads, as plain data for the libCellML worker, and a library rebuilt from
 * them there. A Pinia store, or a facade such as applyParameterOverrides builds, can't cross postMessage.
 */
import { toRaw } from 'vue'

/**
 * Copies a value as plain data, without Vue's proxies: arrays, plain objects, Maps, Sets and primitives. Typed arrays
 * are kept as they are, functions and other class instances left out, and a value met again is copied once.
 *
 * @param {*} value
 * @param {WeakMap} [copies] - Copies made so far, by original.
 * @returns {*}
 */
export function toPlain(value, copies = new WeakMap()) {
  const raw = toRaw(value)
  if (raw === null || typeof raw !== 'object') return typeof raw === 'function' ? undefined : raw
  if (copies.has(raw)) return copies.get(raw)
  if (ArrayBuffer.isView(raw)) return raw
  if (raw instanceof Map) {
    const copy = new Map()
    copies.set(raw, copy)
    for (const [key, item] of raw) copy.set(toPlain(key, copies), toPlain(item, copies))
    return copy
  }
  if (raw instanceof Set) {
    const copy = new Set()
    copies.set(raw, copy)
    for (const item of raw) copy.add(toPlain(item, copies))
    return copy
  }
  if (Array.isArray(raw)) {
    const copy = []
    copies.set(raw, copy)
    for (const item of raw) copy.push(toPlain(item, copies))
    return copy
  }
  const prototype = Object.getPrototypeOf(raw)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const copy = {}
  copies.set(raw, copy)
  for (const [key, item] of Object.entries(raw)) {
    const plain = toPlain(item, copies)
    if (plain !== undefined || item === undefined) copy[key] = plain
  }
  return copy
}

/**
 * Snapshots what building the nodes' model reads from the library: their maths, with each one's analysis, source
 * format, sidecar and annotated variables; every units file; the global constants their rows use; and the units
 * definitions. A part the library doesn't provide is left out, so the rebuilt library doesn't either.
 *
 * @param {Object} library - The library store, or a facade with the same methods.
 * @param {Array} nodes - Nodes, each `data` with `mathRef` and `variables`.
 * @returns {Object} Plain data for libraryFromSnapshot.
 */
export function snapshotLibrary(library, nodes) {
  const mathRefs = new Set(nodes.map((node) => node.data?.mathRef).filter(Boolean))
  const constantNames = new Set(
    nodes.flatMap((node) => (node.data?.variables ?? []).filter((row) => row.type === 'global_constant').map((row) => row.name))
  )
  const byMathRef = (read) => new Map([...mathRefs].map((mathRef) => [mathRef, read(mathRef)]))
  const parsedAnnotations = library.getParsedModuleAnnotations
  return toPlain({
    math: byMathRef((mathRef) => library.availableMath.get(mathRef)),
    units: library.availableUnits,
    globalConstants: new Map([...constantNames].map((name) => [name, library.getGlobalConstant(name)])),
    unitDefinitions: library.unitDefinitions instanceof Map ? library.unitDefinitions : undefined,
    analyses: library.getMathAnalysis ? byMathRef((mathRef) => library.getMathAnalysis(mathRef)) : undefined,
    // Only the format is read, not the source's document.
    sourceFormats: library.getMathSource ? byMathRef((mathRef) => library.getMathSource(mathRef)?.format ?? null) : undefined,
    sidecars: library.getModuleAnnotations ? byMathRef((mathRef) => library.getModuleAnnotations(mathRef)) : undefined,
    // Only the annotated variables' names are read, not the rest of the parse.
    annotatedVariables: parsedAnnotations
      ? byMathRef((mathRef) => parsedAnnotations(mathRef)?.variables?.map(({ variable }) => variable) ?? null)
      : undefined,
  })
}

/**
 * Rebuilds a library from snapshotLibrary's data, with the methods and properties a model build reads.
 *
 * @param {ReturnType<typeof snapshotLibrary>} snapshot
 * @returns {Object}
 */
export function libraryFromSnapshot(snapshot) {
  const { math, units, globalConstants, unitDefinitions, analyses, sourceFormats, sidecars, annotatedVariables } = snapshot
  const library = {
    availableMath: math,
    availableUnits: units,
    getGlobalConstant: (name) => globalConstants.get(name),
  }
  if (unitDefinitions) library.unitDefinitions = unitDefinitions
  if (analyses) library.getMathAnalysis = (mathRef) => analyses.get(mathRef) ?? null
  if (sourceFormats) {
    library.getMathSource = (mathRef) => (sourceFormats.get(mathRef) ? { format: sourceFormats.get(mathRef) } : null)
  }
  if (sidecars) library.getModuleAnnotations = (mathRef) => sidecars.get(mathRef) ?? null
  if (annotatedVariables) {
    library.getParsedModuleAnnotations = (mathRef) => {
      const variables = annotatedVariables.get(mathRef)
      return variables ? { variables: variables.map((variable) => ({ variable })) } : null
    }
  }
  return library
}
