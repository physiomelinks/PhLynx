/**
 * Writes plain triples as Turtle, with the ontology prefixes the annotations use.
 */

import { APICOORD_BASE_IRI } from './apicoord.js'
import { NS } from './iris.js'

const INTERNAL_HOST = new URL(APICOORD_BASE_IRI).host
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const XSD_STRING = `${XSD}string`
const LANG_STRING = `${NS.rdf}langString`

export const TURTLE_PREFIXES = [
  ['rdf', NS.rdf],
  ['xsd', XSD],
  ['dcterms', NS.dcterms],
  ['bqbiol', NS.bqbiol],
  ['api', NS.api],
  ['opb', 'http://identifiers.org/opb/OPB_'],
  ['chebi', 'http://purl.obolibrary.org/obo/CHEBI_'],
  ['go', 'http://purl.obolibrary.org/obo/GO_'],
  ['sbo', 'http://purl.obolibrary.org/obo/SBO_'],
  ['cl', 'http://purl.obolibrary.org/obo/CL_'],
  ['uberon', 'http://purl.obolibrary.org/obo/UBERON_'],
  ['uniprot', 'http://identifiers.org/uniprot/'],
]
// A prefixed name's local part, kept to the plain subset Turtle reads everywhere.
const LOCAL_NAME = /^[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/

/** Percent-encodes the characters a Turtle IRI can't hold. */
function escapeIri(value) {
  return value.replace(/[\u0000- <>"{}|^`\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

/**
 * Finds the blank nodes to write inline: those that are the object of exactly one triple and hang, through other
 * inline blank nodes, from a subject written on its own.
 *
 * @param {Array} triples
 * @param {Map<string, Object>} bySubject - Subject key -> its group.
 * @returns {Set<string>} The inline blank nodes' subject keys.
 */
function findInlineBlankNodes(triples, bySubject) {
  const references = new Map()
  for (const { object } of triples) {
    if (object.termType !== 'BlankNode') continue
    const key = `BlankNode|${object.value}`
    references.set(key, (references.get(key) ?? 0) + 1)
  }
  const candidates = new Set([...references].filter(([, count]) => count === 1).map(([key]) => key))
  const inline = new Set()
  const visit = (key) => {
    for (const objects of bySubject.get(key)?.objects.values() ?? []) {
      for (const object of objects) {
        const objectKey = `${object.termType}|${object.value}`
        if (candidates.has(objectKey) && !inline.has(objectKey)) {
          inline.add(objectKey)
          visit(objectKey)
        }
      }
    }
  }
  for (const key of bySubject.keys()) if (!candidates.has(key)) visit(key)
  return inline
}

/**
 * Writes triples as Turtle, grouped by subject in first-seen order.
 *
 * @param {Array<{ subject: object, predicate: object, object: object }>} triples
 * @param {Array<[string, string]>} [extraPrefixes] - Further [prefix, namespace] pairs.
 * @param {{ baseIri?: string, comments?: string[], inlineBlankNodes?: boolean }} [options] - IRIs under baseIri
 *   are written relative to it ('./file#name'); comments become leading '#' lines; inlineBlankNodes writes a blank
 *   node used once as '[ ... ]'.
 * @returns {string}
 * @throws {Error} When an internal IRI outside baseIri is left in, which would be a bug.
 */
export function writeTurtle(triples, extraPrefixes = [], { baseIri = null, comments = [], inlineBlankNodes = false } = {}) {
  const prefixes = [...TURTLE_PREFIXES, ...extraPrefixes]
  const used = new Set()
  const iri = (value) => {
    if (baseIri && value.startsWith(baseIri)) value = `./${value.slice(baseIri.length)}`
    if (value.includes(INTERNAL_HOST)) throw new Error(`An internal IRI is left in the annotations: ${value}`)
    for (const [prefix, namespace] of prefixes) {
      if (value.startsWith(namespace) && LOCAL_NAME.test(value.slice(namespace.length))) {
        used.add(prefix)
        return `${prefix}:${value.slice(namespace.length)}`
      }
    }
    return `<${escapeIri(value)}>`
  }
  const predicate = (value) => (value === `${NS.rdf}type` ? 'a' : iri(value))

  const bySubject = new Map()
  for (const triple of triples) {
    const key = `${triple.subject.termType}|${triple.subject.value}`
    if (!bySubject.has(key)) bySubject.set(key, { subject: triple.subject, objects: new Map() })
    const objects = bySubject.get(key).objects
    if (!objects.has(triple.predicate.value)) objects.set(triple.predicate.value, [])
    objects.get(triple.predicate.value).push(triple.object)
  }
  const inline = inlineBlankNodes ? findInlineBlankNodes(triples, bySubject) : new Set()

  const term = (t, indent) => {
    if (t.termType === 'BlankNode') {
      const key = `BlankNode|${t.value}`
      if (!inline.has(key)) return `_:${t.value}`
      const body = predicateList(key, `${indent}    `)
      return body ? `[ ${body} ]` : '[]'
    }
    if (t.termType === 'Literal') {
      const quoted = `"${t.value.replace(/[\\"\n\r\t]/g, (c) => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c])}"`
      if (t.language) return `${quoted}@${t.language}`
      if (t.datatype && t.datatype !== XSD_STRING && t.datatype !== LANG_STRING) return `${quoted}^^${iri(t.datatype)}`
      return quoted
    }
    return iri(t.value)
  }
  const predicateList = (key, indent) => {
    const lines = [...(bySubject.get(key)?.objects ?? [])].map(([p, objects]) => {
      const written = [...new Set(objects.map((object) => term(object, indent)))]
      return `${predicate(p)} ${written.join(' , ')}`
    })
    return lines.join(` ;\n${indent}`)
  }
  const statements = [...bySubject]
    .filter(([key]) => !inline.has(key))
    .map(([key, { subject }]) => `${term(subject, '')} ${predicateList(key, '    ')} .`)

  const header = prefixes.filter(([prefix]) => used.has(prefix)).map(([prefix, ns]) => `@prefix ${prefix}: <${escapeIri(ns)}> .`)
  return [...comments.map((line) => `# ${line}`), ...header, '', ...statements, ''].join('\n')
}
