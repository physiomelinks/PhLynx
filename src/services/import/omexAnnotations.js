/**
 * The annotation files in an OMEX archive: module sidecars go back to the library, ApiCoord instance files to the
 * annotation store, and the combined file PhLynx generates is skipped, since export writes it again.
 */

import { parseApiCoords } from '../annotations/apicoord.js'
import { rdfFormatOf } from '../annotations/generate.js'
import { reconcileAnnotatedPorts } from '../annotations/ports.js'
import {
  COMBINED_ANNOTATIONS_MARKER,
  OMEX_METADATA_FORMAT,
  RDF_XML_FORMAT,
  TURTLE_FORMAT,
  mathRefFromSidecarLocation,
} from '../export/annotationsRdf.js'

const RDF_FORMATS = new Set([TURTLE_FORMAT, RDF_XML_FORMAT, OMEX_METADATA_FORMAT])

/**
 * Whether an archive entry could be an annotation file.
 *
 * @param {string} location
 * @param {string} format - The manifest format.
 * @returns {boolean}
 */
export function isAnnotationCandidate(location, format) {
  return RDF_FORMATS.has(format) || /\.(ttl|rdf)$/i.test(location ?? '')
}

/**
 * Tells what an annotation candidate is.
 *
 * @param {string} location
 * @param {string} format - The manifest format.
 * @param {string} text
 * @returns {Promise<{ kind: 'sidecar', mathRef: string } | { kind: 'generated' } |
 *   { kind: 'instances', format: string } | null>} Null for any other RDF, which stays an extra.
 */
export async function classifyAnnotationEntry(location, format, text) {
  if (text.startsWith(COMBINED_ANNOTATIONS_MARKER)) return { kind: 'generated' }
  const mathRef = mathRefFromSidecarLocation(location)
  if (mathRef) return { kind: 'sidecar', mathRef }
  const rdfFormat = format === RDF_XML_FORMAT ? 'rdfxml' : format === TURTLE_FORMAT ? 'turtle' : rdfFormatOf(location)
  const { instances } = await parseApiCoords(text, { format: rdfFormat })
  return instances.length ? { kind: 'instances', format: rdfFormat } : null
}

/**
 * Puts an archive's sidecars and instance files back in their stores.
 *
 * @param {{ sidecars?: Array<{ mathRef: string, text: string }>,
 *   instanceFiles?: Array<{ location: string, format: string, text: string }> }} annotations - From importOmexFile.
 * @param {{ libraryStore: Object, annotationStore: Object }} stores
 * @returns {{ sidecars: number, instanceFiles: number }} How many of each were restored.
 */
export function restoreOmexAnnotations(annotations, { libraryStore, annotationStore }) {
  const sidecars = annotations?.sidecars ?? []
  const instanceFiles = annotations?.instanceFiles ?? []
  for (const { mathRef, text } of sidecars) libraryStore.setModuleAnnotations(mathRef, text)
  for (const source of instanceFiles) annotationStore.addInstanceSource(source)
  return { sidecars: sidecars.length, instanceFiles: instanceFiles.length }
}

/**
 * The sidecar ports of nodes built from an archive's CellML, from the sidecars it restored. A saved workspace's
 * nodes keep the ports they were saved with.
 *
 * @param {Array<Object>} nodes - Workspace nodes.
 * @param {Array<{ mathRef: string }>} sidecars - The restored sidecars, from importOmexFile.
 * @param {{ ensureModuleAnnotations: (mathRef: string) => Promise<Object|null> }} libraryStore
 * @returns {Promise<Map<string, Array<Object>>>} The ports of each node that changed.
 */
export async function buildRestoredPorts(nodes, sidecars, libraryStore) {
  const mathRefs = [...new Set((sidecars ?? []).map((sidecar) => sidecar.mathRef))]
  const parsed = new Map(
    await Promise.all(mathRefs.map(async (mathRef) => [mathRef, await libraryStore.ensureModuleAnnotations(mathRef)]))
  )
  const ports = new Map()
  for (const node of nodes) {
    const mathRef = node.data?.mathRef
    const sidecar = parsed.get(mathRef)
    if (!sidecar) continue
    const variables = node.data.variables?.map((row) => row.name)
    const result = reconcileAnnotatedPorts(node.data.ports ?? [], sidecar, { mathRef, variables })
    if (result.added.length || result.removed.length || result.changed.length) ports.set(node.id, result.ports)
  }
  return ports
}
