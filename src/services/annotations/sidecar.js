/**
 * Module sidecars: OMEX-style composite annotations giving each variable of one math component its property,
 * species and location relative to the module. Problems become warnings, never exceptions.
 */

import { buildVariableIdMap } from '../../utils/cellml.js'
import { CELLML_NS } from '../../utils/constants.js'
import { parseRdf } from './rdf.js'
import { createGraph, termKey } from './graph.js'
import { BQBIOL, GO, GO_LOCATIONS, SBO, canonicalCurie, hasPrefix, splitSubject } from './iris.js'

export const SIDECAR_BASE_IRI = 'https://phlynx.invalid/modules/'

const VARIABLE_PREDICATES = new Set([BQBIOL.isVersionOf, BQBIOL.isPropertyOf])

/**
 * Parses one sidecar.
 *
 * @param {string} text - The sidecar RDF.
 * @param {{ mathRef?: string, cellml?: string, format?: string, baseIri?: string }} [options] - mathRef
 *   ('file:component') checks the subjects; cellml resolves '#id' subjects and checks variable names.
 * @returns {Promise<object>} See readSidecar.
 */
export async function parseSidecar(text, { format = 'turtle', baseIri = SIDECAR_BASE_IRI, ...options } = {}) {
  let triples
  try {
    triples = await parseRdf(text, { format, baseIri })
  } catch (error) {
    return {
      ...emptySidecar(options.mathRef),
      warnings: [{ message: `Could not parse the sidecar: ${error.message}` }],
    }
  }
  return readSidecar(createGraph(triples), { baseIri, ...options })
}

/**
 * Parses several sidecars into a Map keyed by mathRef.
 *
 * @param {Array<{ text: string, mathRef?: string, cellml?: string, format?: string }>} entries
 * @returns {Promise<Map<string, object>>}
 */
export async function parseSidecars(entries) {
  const sidecars = await Promise.all(entries.map(({ text, ...options }) => parseSidecar(text, options)))
  return new Map(sidecars.map((sidecar) => [sidecar.mathRef, sidecar]))
}

function emptySidecar(mathRef = null) {
  return { mathRef, file: null, componentName: null, component: null, variables: [], warnings: [] }
}

function listComponentVariables(cellml, componentName) {
  const doc = new DOMParser().parseFromString(cellml, 'application/xml')
  const component = Array.from(doc.getElementsByTagNameNS(CELLML_NS, 'component')).find(
    (element) => element.getAttribute('name') === componentName
  )
  if (!component) return null
  return new Set(Array.from(component.getElementsByTagNameNS(CELLML_NS, 'variable')).map((v) => v.getAttribute('name')))
}

/**
 * Reads a sidecar from an indexed graph.
 *
 * @param {object} graph - From createGraph.
 * @param {{ mathRef?: string, cellml?: string }} [options]
 * @returns {{ mathRef: string|null, file: string|null, componentName: string|null,
 *   component: { subject: string, kind: string|null, is: string[], isVersionOf: string[] }|null,
 *   variables: Array<{ variable: string, subject: string, property: string|null, entity: object,
 *   species: string[], location: string|null }>, warnings: Array<{ subject?: string, message: string }> }}
 */
export function readSidecar(graph, { mathRef, cellml } = {}) {
  const warnings = []
  const warn = (subject, message) => warnings.push(subject ? { subject, message } : { message })

  const [expectedFile, expectedComponent] = mathRef ? mathRef.split(':') : [null, null]
  const named = graph.subjectsOf().filter((term) => term.termType === 'NamedNode')
  const parts = new Map(named.map((term) => [term.value, splitSubject(term.value)]))

  // The component subject: the named subject whose fragment is the expected component name, else the one
  // whose fragment contains no '.' and carries bqbiol:is.
  let componentSubject = named.find(
    (term) => expectedComponent && parts.get(term.value)?.fragment === expectedComponent
  )
  if (!componentSubject) {
    const candidates = named.filter((term) => {
      const part = parts.get(term.value)
      return part && !part.fragment.includes('.') && graph.objects(term, BQBIOL.is).length > 0
    })
    if (candidates.length === 1 && !expectedComponent) componentSubject = candidates[0]
  }

  const file = componentSubject ? parts.get(componentSubject.value).file : expectedFile
  const componentName = componentSubject ? parts.get(componentSubject.value).fragment : expectedComponent
  const resolvedMathRef = mathRef ?? (file && componentName ? `${file}:${componentName}` : null)
  if (expectedFile && file && file !== expectedFile) {
    warn(componentSubject?.value, `The component's file '${file}' is not '${expectedFile}'.`)
  }

  let component = null
  if (componentSubject) {
    const is = graph.objects(componentSubject, BQBIOL.is).map((term) => canonicalCurie(term.value))
    component = {
      subject: componentSubject.value,
      kind: componentKind(is),
      is,
      isVersionOf: graph.objects(componentSubject, BQBIOL.isVersionOf).map((term) => canonicalCurie(term.value)),
    }
    if (!component.kind) warn(component.subject, 'The component has no uniprot, GO:0005886 or SBO:0000290 term.')
  } else {
    warn(null, `No component subject${expectedComponent ? ` '#${expectedComponent}'` : ''} found.`)
  }

  const idMap = cellml ? buildVariableIdMap(cellml) : new Map()
  const knownVariables = cellml && componentName ? listComponentVariables(cellml, componentName) : null
  if (cellml && componentName && !knownVariables) warn(null, `The math has no component '${componentName}'.`)

  const variables = []
  const seen = new Set()
  const entityKeys = new Set()
  for (const term of named) {
    if (term.value === componentSubject?.value) continue
    const part = parts.get(term.value)
    const predicates = graph.predicatesOf(term)
    if (!predicates.some((predicate) => VARIABLE_PREDICATES.has(predicate))) continue
    const variable = resolveVariableName(part, componentName, idMap)
    if (!variable) {
      warn(term.value, 'The subject names no variable of the component.')
      continue
    }
    if (part.file !== file) warn(term.value, `The subject is in '${part.file}', not '${file}'.`)
    if (knownVariables && !knownVariables.has(variable)) warn(term.value, `The math has no variable '${variable}'.`)
    if (seen.has(variable)) {
      warn(term.value, `The variable '${variable}' is annotated twice.`)
      continue
    }
    seen.add(variable)
    const entry = readVariable(graph, term, variable, componentSubject?.value, warn)
    for (const object of graph.objects(term, BQBIOL.isPropertyOf)) entityKeys.add(termKey(object))
    variables.push(entry)
  }

  for (const term of named) {
    if (term.value === componentSubject?.value || entityKeys.has(term.value)) continue
    if (!graph.predicatesOf(term).some((predicate) => VARIABLE_PREDICATES.has(predicate))) {
      warn(term.value, 'The subject is neither the component, a variable nor an entity.')
    }
  }

  return { mathRef: resolvedMathRef, file, componentName, component, variables, warnings }
}

/**
 * Derives what a module is from its component's bqbiol:is terms.
 *
 * @param {string[]} is - Canonical CURIEs.
 * @returns {'transporter'|'membrane'|'compartment'|null}
 */
export function componentKind(is) {
  if (is.some((curie) => hasPrefix(curie, 'uniprot'))) return 'transporter'
  if (is.includes(GO.plasmaMembrane)) return 'membrane'
  if (is.includes(SBO.physicalCompartment)) return 'compartment'
  return null
}

function resolveVariableName(part, componentName, idMap) {
  if (!part) return null
  if (componentName && part.fragment.startsWith(`${componentName}.`))
    return part.fragment.slice(componentName.length + 1)
  return idMap.get(part.fragment) ?? null
}

function readVariable(graph, term, variable, componentIri, warn) {
  const subject = term.value
  const properties = graph.objects(term, BQBIOL.isVersionOf).map((object) => canonicalCurie(object.value))
  const opb = properties.filter((curie) => hasPrefix(curie, 'OPB'))
  if (opb.length === 0) warn(subject, 'No OPB property (bqbiol:isVersionOf).')
  if (opb.length > 1) warn(subject, `Several OPB properties: ${opb.join(', ')}.`)

  const entities = graph.objects(term, BQBIOL.isPropertyOf)
  if (entities.length !== 1) warn(subject, `Expected one bqbiol:isPropertyOf, found ${entities.length}.`)
  const { entity, species, location } = entities.length
    ? readEntity(graph, entities[0], componentIri, (message) => warn(subject, message))
    : { entity: null, species: [], location: null }

  return { variable, subject, property: opb[0] ?? null, entity, species, location }
}

/**
 * Reads the physical entity of a variable and derives its species and location.
 *
 * @returns {{ entity: { self: boolean, is: string[], isPartOf: string|null }, species: string[],
 *   location: string|null }} location is 'self', 'self+GO:…' or a GO cellular component.
 */
function readEntity(graph, entityTerm, componentIri, warn) {
  if (entityTerm.termType === 'NamedNode' && entityTerm.value === componentIri) {
    return { entity: { self: true, is: [], isPartOf: null }, species: [], location: 'self' }
  }
  if (entityTerm.termType === 'Literal') {
    warn('The entity is a literal.')
    return { entity: null, species: [], location: null }
  }

  const is = graph.objects(entityTerm, BQBIOL.is).map((object) => canonicalCurie(object.value))
  const partOf = graph
    .objects(entityTerm, BQBIOL.isPartOf)
    .map((object) => (object.value === componentIri ? 'self' : canonicalCurie(object.value)))
  if (partOf.length > 1) warn(`Several bqbiol:isPartOf: ${partOf.join(', ')}.`)
  const isPartOf = partOf[0] ?? null

  const species = is.filter((curie) => hasPrefix(curie, 'CHEBI'))
  const goTerms = is.filter((curie) => GO_LOCATIONS.has(curie))
  const unknown = is.filter((curie) => !species.includes(curie) && !goTerms.includes(curie))
  if (unknown.length) warn(`Unrecognised entity terms: ${unknown.join(', ')}.`)
  if (goTerms.length > 1) warn(`Several GO locations: ${goTerms.join(', ')}.`)
  if (isPartOf && isPartOf !== 'self' && !GO_LOCATIONS.has(isPartOf)) warn(`Unrecognised bqbiol:isPartOf ${isPartOf}.`)

  const entity = { self: false, is, isPartOf }
  let location = null
  if (isPartOf === 'self') {
    location = goTerms.length ? `self+${goTerms[0]}` : 'self'
  } else {
    location = goTerms[0] ?? (GO_LOCATIONS.has(isPartOf) ? isPartOf : null)
    if (goTerms.length && GO_LOCATIONS.has(isPartOf) && isPartOf !== goTerms[0]) {
      warn(`The GO term ${goTerms[0]} and bqbiol:isPartOf ${isPartOf} disagree.`)
    }
  }
  if (!location) warn('The entity has no location: no GO cellular component and not part of the component.')
  return { entity, species, location }
}
