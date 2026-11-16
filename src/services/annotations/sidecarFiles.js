/**
 * Reading side-car files: the component a side-car annotates, and the RDF format of a file name.
 */

import { parseRdf } from './rdf.js'
import { createGraph } from './graph.js'
import { SIDECAR_BASE_IRI, componentKind, isNotComponent } from './sidecar.js'
import { BQBIOL, canonicalCurie, splitSubject } from './iris.js'

/**
 * Finds the component a sidecar annotates: the one subject without a '.' in its fragment whose bqbiol:is says
 * what a module is (uniprot, GO:0005886 or SBO:0000290), never the sidecar's own 'local:' entities.
 *
 * @param {string} text - The sidecar RDF.
 * @param {{ format?: string }} [options]
 * @returns {Promise<{ file: string, componentName: string, mathRef: string, kind: string, is: string[] }|null>}
 *   Null when there is no such subject or more than one.
 * @throws {Error} When the text is not valid RDF.
 */
export async function readSidecarComponent(text, { format = 'turtle' } = {}) {
  const graph = createGraph(await parseRdf(text, { format, baseIri: SIDECAR_BASE_IRI }))
  const found = graph.subjectsOf().flatMap((term) => {
    const part = term.termType === 'NamedNode' ? splitSubject(term.value) : null
    if (!part || part.fragment.includes('.') || isNotComponent(graph, term)) return []
    const is = graph.objects(term, BQBIOL.is).map((object) => canonicalCurie(object.value))
    const kind = componentKind(is)
    return kind ? [{ file: part.file, componentName: part.fragment, kind, is }] : []
  })
  if (found.length !== 1) return null
  const [component] = found
  return { ...component, mathRef: `${component.file}:${component.componentName}` }
}

/**
 * The RDF format of a file, from its name: RDF/XML for .rdf, .xml or .owl, else Turtle.
 *
 * @param {string} filename
 * @returns {'rdfxml'|'turtle'}
 */
export function rdfFormatOf(filename) {
  return /\.(rdf|xml|owl)$/i.test(filename ?? '') ? 'rdfxml' : 'turtle'
}
