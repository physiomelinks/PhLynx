/**
 * Module sidecars: OMEX-style composite annotations giving each variable of one math component its property,
 * species and location relative to the module. Problems become warnings, never exceptions.
 */

import { CELLML_NS } from '../../utils/constants.js'
import { parseRdf } from './rdf.js'
import { createGraph, termKey } from './graph.js'
import {
  BQBIOL,
  GO,
  GO_LOCATIONS,
  SBO,
  SEMSIM,
  canonicalCurie,
  hasPrefix,
  isFlowProperty,
  splitSubject,
} from './iris.js'

export const SIDECAR_BASE_IRI = 'https://phlynx.invalid/modules/'

/*
 * Composite annotations follow OMEX Metadata 1.2 (Gennari et al. 2021, J Integr Bioinform 18:20210020):
 * section 2.1 names entities defined in an annotation file with the file's own namespace,
 * '@prefix local: <http://omex-library.org/ArchiveName.omex/ModelName.rdf#>'. Section 2.3.7.1 writes an entity
 * composite,
 *   OMEXmodel:VLV bqbiol:isVersionOf opb:OPB_00154 ; bqbiol:isPropertyOf local:entity_0 .
 *   local:entity_0 bqbiol:is fma:9670 ; bqbiol:isPartOf fma:18228 .
 * and section 2.3.7.2 a process composite, a rate borne by a process with source, sink and mediator participants:
 *   OMEXmodel:J bqbiol:isVersionOf opb:OPB_00592 ; bqbiol:isPropertyOf local:process_0 .
 *   local:process_0 semsim:hasSinkParticipant local:sink_0 .
 *   local:sink_0 semsim:hasPhysicalEntityReference local:entity_1 .
 * A sidecar's local namespace is its own file, '<./<component>.ttl#>'. 'local:entity_self' is the module itself,
 * which carries the module's kind and bears its own properties. A species in a place is one entity every variable
 * there shares, named after them, e.g. 'local:Na_in'. A flow is borne by 'local:process_<id>' and is the rate into
 * its process's one sink, whose entity is the flow's located entity; the source is there only when the flow says
 * where it comes from:
 *   m:<id> bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_<id> .
 *   local:process_<id> semsim:hasSourceParticipant [ semsim:hasPhysicalEntityReference local:Na_out ] ;
 *       semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:Na_in ] .
 * A species in a place of the module's own, such as its membrane, is part of that place, so no entity is both the
 * species and the GO term:
 *   local:Na_membrane bqbiol:is chebi:29101 ; bqbiol:isPartOf local:membrane .
 *   local:membrane bqbiol:is go:0005886 ; bqbiol:isPartOf local:entity_self .
 * A space next to the module is one named side every variable there shares, 'local:outside' or 'local:inside',
 * which is its GO term; a quantity of the space itself is borne by the side:
 *   local:Na_out bqbiol:is chebi:29101 ; bqbiol:isPartOf local:outside .
 *   local:outside bqbiol:is go:0005576 .
 * Entities named after one variable, 'local:entity_<id>' with named participants, read the same, as do blank nodes.
 * A bare 'bqbiol:isPartOf go:0005576' reads the same.
 */

/**
 * The namespace of the entities a sidecar defines, its own file's.
 *
 * @param {string} component - The component the sidecar describes.
 * @returns {string}
 */
export function sidecarLocalNamespace(component) {
  return `${SIDECAR_BASE_IRI}${encodeURIComponent(component)}.ttl#`
}

/**
 * The IRI of a module's own entity, 'local:entity_self'.
 *
 * @param {string} component
 * @returns {string}
 */
export function selfEntityIri(component) {
  return `${sidecarLocalNamespace(component)}entity_self`
}

/**
 * Whether an IRI names something an annotation file defines: its file is a .ttl or .rdf, not the math.
 *
 * @param {string} iri
 * @returns {boolean}
 */
export function isLocalResource(iri) {
  return /\.(ttl|rdf)$/i.test(splitSubject(iri)?.file ?? '')
}

// The named sides of the spaces next to a module, by their GO term; any other is 'side_<GO id>'.
const SIDE_NAMES = { [GO.extracellularRegion]: 'outside', [GO.cytoplasm]: 'inside' }

/**
 * Names the side node of a space next to a module: 'outside', 'inside', else 'side_GO_<id>'.
 *
 * @param {string} curie - A GO cellular component.
 * @returns {string}
 */
export function sideName(curie) {
  return SIDE_NAMES[curie] ?? `side_${curie.replace(/[^A-Za-z0-9]/g, '_')}`
}

/**
 * Whether a fragment of a sidecar's own namespace names a side node.
 *
 * @param {string} fragment - Decoded.
 * @returns {boolean}
 */
export function isSideFragment(fragment) {
  return Object.values(SIDE_NAMES).includes(fragment) || /^side_GO_\d+$/.test(fragment)
}

const VARIABLE_PREDICATES = new Set([BQBIOL.isVersionOf, BQBIOL.isPropertyOf])
const PARTICIPANT_PREDICATES = [SEMSIM.hasSourceParticipant, SEMSIM.hasSinkParticipant, SEMSIM.hasMediatorParticipant]
// Predicates whose objects are entities, processes or participants rather than terms.
const STRUCTURE_PREDICATES = [BQBIOL.isPropertyOf, ...PARTICIPANT_PREDICATES, SEMSIM.hasPhysicalEntityReference]

/**
 * Whether a term is the object of a structural link, so an entity, process or participant, never a variable or
 * the component.
 *
 * @param {object} graph - From createGraph.
 * @param {object} term
 * @returns {boolean}
 */
function isLinkedNode(graph, term) {
  return STRUCTURE_PREDICATES.some((predicate) => graph.subjects(predicate, term).length > 0)
}

/**
 * Whether a named subject can't be a module's component: something the sidecar defines, or a linked node.
 *
 * @param {object} graph - From createGraph.
 * @param {object} term
 * @returns {boolean}
 */
export function isNotComponent(graph, term) {
  return isLocalResource(term.value) || isLinkedNode(graph, term)
}

/**
 * Parses one sidecar.
 *
 * @param {string} text - The sidecar RDF.
 * @param {{ mathRef?: string, cellml?: string, format?: string, baseIri?: string }} [options] - mathRef
 *   ('file:component') checks the subjects; cellml resolves the '#<id>' variable subjects, which need it.
 * @returns {Promise<object>} See readSidecar; `unreadable` is set when the text does not parse.
 */
export async function parseSidecar(text, { format = 'turtle', baseIri = SIDECAR_BASE_IRI, ...options } = {}) {
  let triples
  try {
    triples = await parseRdf(text, { format, baseIri })
  } catch (error) {
    return {
      ...emptySidecar(options.mathRef),
      unreadable: true,
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
  return { mathRef, file: null, componentName: null, component: null, variables: [], unresolved: [], warnings: [] }
}

/**
 * The variable names by id of a math's component, else of the whole math when it has no such component.
 *
 * @param {string} cellml
 * @param {string|null} componentName
 * @returns {{ ids: Map<string, string>, hasComponent: boolean }}
 */
function readVariableIds(cellml, componentName) {
  const doc = new DOMParser().parseFromString(cellml, 'application/xml')
  const component = Array.from(doc.getElementsByTagNameNS(CELLML_NS, 'component')).find(
    (element) => element.getAttribute('name') === componentName
  )
  const ids = new Map()
  for (const variable of (component ?? doc).getElementsByTagNameNS(CELLML_NS, 'variable')) {
    const id = variable.getAttribute('id')
    if (id && !ids.has(id)) ids.set(id, variable.getAttribute('name'))
  }
  return { ids, hasComponent: !!component }
}

/**
 * Reads a sidecar from an indexed graph.
 *
 * @param {object} graph - From createGraph.
 * @param {{ mathRef?: string, cellml?: string }} [options]
 * @returns {{ mathRef: string|null, file: string|null, componentName: string|null,
 *   component: { subject: string, kind: string|null, is: string[], isVersionOf: string[],
 *   spaceKind: string|null }|null,
 *   variables: Array<{ variable: string, id: string, subject: string, property: string|null, entity: object,
 *   species: string[], location: string|null, process: object|null, from: string|null }>,
 *   unresolved: Array<{ subject: string, id: string }>, warnings: Array<{ subject?: string, message: string }> }}
 *   Each variable subject is '<file>#<id>', the CellML id of the variable now named `variable`; unresolved lists
 *   those naming no variable of the math. A flow's species and location are its sink's, `from` its source's
 *   location, and `process` its process composite (see readProcess).
 */
export function readSidecar(graph, { mathRef, cellml } = {}) {
  const warnings = []
  const warn = (subject, message) => warnings.push(subject ? { subject, message } : { message })

  const [expectedFile, expectedComponent] = mathRef ? mathRef.split(':') : [null, null]
  const named = graph.subjectsOf().filter((term) => term.termType === 'NamedNode')
  const parts = new Map(named.map((term) => [term.value, splitSubject(term.value)]))

  // The component subject: the named subject whose fragment is the expected component name, else the one
  // whose fragment contains no '.', carries bqbiol:is and is not a local entity.
  let componentSubject = named.find(
    (term) => expectedComponent && parts.get(term.value)?.fragment === expectedComponent
  )
  if (!componentSubject) {
    const candidates = named.filter((term) => {
      const part = parts.get(term.value)
      if (!part || part.fragment.includes('.') || isNotComponent(graph, term)) return false
      return graph.objects(term, BQBIOL.is).length > 0
    })
    if (candidates.length === 1 && !expectedComponent) componentSubject = candidates[0]
  }

  const file = componentSubject ? parts.get(componentSubject.value).file : expectedFile
  const componentName = componentSubject ? parts.get(componentSubject.value).fragment : expectedComponent
  const resolvedMathRef = mathRef ?? (file && componentName ? `${file}:${componentName}` : null)
  if (expectedFile && file && file !== expectedFile) {
    warn(componentSubject?.value, `The component's file '${file}' is not '${expectedFile}'.`)
  }

  const selfIri = componentName ? selfEntityIri(componentName) : null
  let component = null
  if (componentSubject) {
    const is = graph.objects(componentSubject, BQBIOL.is).map((term) => canonicalCurie(term.value))
    component = {
      subject: componentSubject.value,
      kind: componentKind(is),
      is,
      isVersionOf: graph.objects(componentSubject, BQBIOL.isVersionOf).map((term) => canonicalCurie(term.value)),
      spaceKind: selfIri ? readSpaceKind(graph, selfIri) : null,
    }
    if (!component.kind) warn(component.subject, 'The component has no uniprot, GO:0005886 or SBO:0000290 term.')
    else checkSelfEntity(graph, selfIri, is, warn)
  } else {
    warn(null, `No component subject${expectedComponent ? ` '#${expectedComponent}'` : ''} found.`)
  }

  const { ids, hasComponent } = cellml
    ? readVariableIds(cellml, componentName)
    : { ids: new Map(), hasComponent: false }
  if (cellml && componentName && !hasComponent) warn(null, `The math has no component '${componentName}'.`)

  const variables = []
  const unresolved = []
  const seen = new Set()
  const handled = new Set()
  for (const term of named) {
    if (term.value === componentSubject?.value || isNotComponent(graph, term)) continue
    const part = parts.get(term.value)
    const predicates = graph.predicatesOf(term)
    if (!predicates.some((predicate) => VARIABLE_PREDICATES.has(predicate))) continue
    handled.add(term.value)
    const variable = part ? ids.get(part.fragment) : undefined
    if (!variable) {
      warn(term.value, `The math has no variable with the id '${part?.fragment ?? term.value}'.`)
      unresolved.push({ subject: term.value, id: part?.fragment ?? null })
      continue
    }
    if (part.file !== file) warn(term.value, `The subject is in '${part.file}', not '${file}'.`)
    if (seen.has(variable)) {
      warn(term.value, `The variable '${variable}' is annotated twice.`)
      continue
    }
    seen.add(variable)
    variables.push(readVariable(graph, term, { variable, id: part.fragment }, selfIri, warn))
  }

  // Whatever a variable reaches is its entity, process or participant; anything else named is a stray.
  const reached = reachableFrom(graph, [...handled])
  for (const term of named) {
    if (term.value === componentSubject?.value || term.value === selfIri) continue
    if (handled.has(term.value) || reached.has(termKey(term))) continue
    warn(term.value, 'The subject is neither the component, a variable nor an entity.')
  }

  return { mathRef: resolvedMathRef, file, componentName, component, variables, unresolved, warnings }
}

/**
 * Warns when 'local:entity_self' is missing or disagrees with the component on what the module is.
 *
 * @param {object} graph
 * @param {string|null} selfIri
 * @param {string[]} componentIs - The component's bqbiol:is CURIEs.
 * @param {Function} warn
 */
function checkSelfEntity(graph, selfIri, componentIs, warn) {
  const selfIs = selfIri ? graph.objects(selfIri, BQBIOL.is).map((term) => canonicalCurie(term.value)) : []
  if (!selfIs.length) {
    warn(selfIri, 'local:entity_self does not say what the module is.')
    return
  }
  const kindTerms = (is) => is.filter(isKindCurie).sort().join(' ')
  if (kindTerms(selfIs) !== kindTerms(componentIs)) {
    warn(selfIri, 'local:entity_self and the component disagree on what the module is.')
  }
}

/**
 * Reads the kind of space a module is, the GO cellular component 'local:entity_self' is a version of, if any. It
 * is the user's choice, never a role.
 *
 * @param {object} graph
 * @param {string} selfIri
 * @returns {string|null}
 */
function readSpaceKind(graph, selfIri) {
  const terms = graph.objects(selfIri, BQBIOL.isVersionOf).map((term) => canonicalCurie(term.value))
  return terms.find((curie) => GO_LOCATIONS.has(curie)) ?? null
}

/**
 * Whether a CURIE says what kind of module a component is.
 *
 * @param {string} curie
 * @returns {boolean}
 */
export function isKindCurie(curie) {
  return curie === SBO.physicalCompartment || curie === GO.plasmaMembrane || hasPrefix(curie, 'uniprot')
}

/**
 * The keys of every node reachable from some subjects through non-literal objects.
 *
 * @param {object} graph
 * @param {Array<string>} starts - Subject keys.
 * @returns {Set<string>}
 */
function reachableFrom(graph, starts) {
  const reached = new Set()
  const queue = [...starts]
  while (queue.length) {
    const key = queue.pop()
    for (const predicate of graph.predicatesOf(key)) {
      for (const object of graph.objects(key, predicate)) {
        const objectKey = termKey(object)
        if (object.termType === 'Literal' || reached.has(objectKey)) continue
        reached.add(objectKey)
        queue.push(objectKey)
      }
    }
  }
  return reached
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

/**
 * Whether a term is a process: it has SemSim participants.
 *
 * @param {object} graph
 * @param {object} term
 * @returns {boolean}
 */
export function isProcessNode(graph, term) {
  return term.termType !== 'Literal' && PARTICIPANT_PREDICATES.some((p) => graph.objects(term, p).length > 0)
}

/**
 * Reads one variable's annotation: its OPB property and what bears it, an entity or, for a flow, a process.
 *
 * @returns {Object} The entry readSidecar lists.
 */
function readVariable(graph, term, { variable, id }, selfIri, warn) {
  const subject = term.value
  const properties = graph.objects(term, BQBIOL.isVersionOf).map((object) => canonicalCurie(object.value))
  const opb = properties.filter((curie) => hasPrefix(curie, 'OPB'))
  if (opb.length === 0) warn(subject, 'No OPB property (bqbiol:isVersionOf).')
  if (opb.length > 1) warn(subject, `Several OPB properties: ${opb.join(', ')}.`)
  const property = opb[0] ?? null

  const bearers = graph.objects(term, BQBIOL.isPropertyOf)
  if (bearers.length !== 1) warn(subject, `Expected one bqbiol:isPropertyOf, found ${bearers.length}.`)
  const empty = { entity: null, species: [], location: null, process: null, from: null }
  if (!bearers.length) return { variable, id, subject, property, ...empty }

  const subjectWarn = (message) => warn(subject, message)
  const isProcess = isProcessNode(graph, bearers[0])
  if (property && isFlowProperty(property) && !isProcess) subjectWarn('The flow is borne by an entity, not a process.')
  if (property && !isFlowProperty(property) && isProcess) subjectWarn(`The process bears ${property}, not a flow.`)
  if (!isProcess) {
    const located = readEntity(graph, bearers[0], selfIri, subjectWarn)
    return { variable, id, subject, property, ...located, process: null, from: null }
  }

  const { process, sink } = readProcess(graph, bearers[0], selfIri, subjectWarn)
  if (process.sinks.length !== 1) {
    subjectWarn(`Expected one sink participant, found ${process.sinks.length}.`)
    return { variable, id, subject, property, ...empty, process }
  }
  if (!process.sinks[0].entity) subjectWarn('The sink has no physical entity.')
  const { entity, species, location } = sink
  const from = process.sources[0]?.location ?? null
  return { variable, id, subject, property, entity, species, location, process, from }
}

/**
 * Reads a process composite: its participants, each with its entity's species and location and its multiplier.
 *
 * @returns {{ process: { subject: string, isVersionOf: string[], sources: Array<Object>, sinks: Array<Object>,
 *   mediators: Array<Object> }, sink: Object }} Each participant is { entity, species, location, multiplier },
 *   entity being the entity's key ('_:' + label for a blank node); sink is the first sink's readEntity result.
 */
function readProcess(graph, processTerm, selfIri, warn) {
  const participants = (predicate, entityWarn) =>
    graph.objects(processTerm, predicate).map((participant) => {
      const [entityTerm] = graph.objects(participant, SEMSIM.hasPhysicalEntityReference)
      const multipliers = graph.objects(participant, SEMSIM.hasMultiplier).map((object) => Number(object.value))
      if (multipliers.length && multipliers[0] !== 1) {
        warn(`A participant has multiplier ${multipliers[0]}; it is read as 1.`)
      }
      const located = entityTerm
        ? readEntity(graph, entityTerm, selfIri, entityWarn)
        : { entity: null, species: [], location: null }
      return { entity: entityTerm ? termKey(entityTerm) : null, located, multiplier: multipliers[0] ?? 1 }
    })
  const sinks = participants(SEMSIM.hasSinkParticipant, warn)
  const sources = participants(SEMSIM.hasSourceParticipant, warn)
  const mediators = participants(SEMSIM.hasMediatorParticipant, () => {})
  const flatten = (list) =>
    list.map(({ entity, located: { species, location }, multiplier }) => ({ entity, species, location, multiplier }))
  return {
    process: {
      subject: termKey(processTerm),
      isVersionOf: graph.objects(processTerm, BQBIOL.isVersionOf).map((object) => canonicalCurie(object.value)),
      sources: flatten(sources),
      sinks: flatten(sinks),
      mediators: flatten(mediators),
    },
    sink: sinks[0]?.located ?? null,
  }
}

/**
 * Reads the place an entity is part of: the module, 'self'; a GO cellular component; or a node the sidecar
 * defines that is one GO term: 'self+GO:…' when it is part of the module, such as 'local:place_<id>', else that
 * GO term, such as the side 'local:outside'.
 *
 * @returns {string|null} 'self', 'self+GO:…', a GO CURIE, or the CURIE or key of what else it is part of.
 */
function readPlace(graph, placeTerm, selfIri) {
  if (placeTerm.value === selfIri) return 'self'
  const isNode = placeTerm.termType === 'BlankNode' || isLocalResource(placeTerm.value)
  if (!isNode) return canonicalCurie(placeTerm.value)
  const go = graph.objects(placeTerm, BQBIOL.is).map((object) => canonicalCurie(object.value))
  const partOfSelf = graph.objects(placeTerm, BQBIOL.isPartOf).some((object) => object.value === selfIri)
  if (go.length !== 1 || !GO_LOCATIONS.has(go[0])) return termKey(placeTerm)
  if (partOfSelf) return `self+${go[0]}`
  return graph.objects(placeTerm, BQBIOL.isPartOf).length ? termKey(placeTerm) : go[0]
}

/**
 * Reads a physical entity and derives its species and location.
 *
 * @returns {{ entity: { self: boolean, is: string[], isPartOf: string|null }, species: string[],
 *   location: string|null }} location is 'self', 'self+GO:…' or a GO cellular component; isPartOf reads a place
 *   of the module's own as its location, 'self+GO:…'.
 */
function readEntity(graph, entityTerm, selfIri, warn) {
  if (entityTerm.termType === 'NamedNode' && entityTerm.value === selfIri) {
    return { entity: { self: true, is: [], isPartOf: null }, species: [], location: 'self' }
  }
  if (entityTerm.termType === 'Literal') {
    warn('The entity is a literal.')
    return { entity: null, species: [], location: null }
  }

  const is = graph.objects(entityTerm, BQBIOL.is).map((object) => canonicalCurie(object.value))
  const partOf = graph.objects(entityTerm, BQBIOL.isPartOf).map((object) => readPlace(graph, object, selfIri))
  if (partOf.length > 1) warn(`Several bqbiol:isPartOf: ${partOf.join(', ')}.`)
  const isPartOf = partOf[0] ?? null

  const species = is.filter((curie) => hasPrefix(curie, 'CHEBI'))
  const goTerms = is.filter((curie) => GO_LOCATIONS.has(curie))
  const unknown = is.filter((curie) => !species.includes(curie) && !goTerms.includes(curie))
  if (unknown.length) warn(`Unrecognised entity terms: ${unknown.join(', ')}.`)
  if (goTerms.length > 1) warn(`Several GO locations: ${goTerms.join(', ')}.`)
  const isOwnPlace = isPartOf?.startsWith('self+')
  if (isPartOf && isPartOf !== 'self' && !isOwnPlace && !GO_LOCATIONS.has(isPartOf)) {
    warn(`Unrecognised bqbiol:isPartOf ${isPartOf}.`)
  }

  const entity = { self: false, is, isPartOf }
  let location = null
  if (isOwnPlace) {
    location = isPartOf
    if (goTerms.length) warn(`The GO term ${goTerms[0]} and bqbiol:isPartOf ${isPartOf} disagree.`)
  } else if (isPartOf === 'self') {
    location = goTerms.length ? `self+${goTerms[0]}` : 'self'
  } else {
    location = goTerms[0] ?? (GO_LOCATIONS.has(isPartOf) ? isPartOf : null)
    if (goTerms.length && GO_LOCATIONS.has(isPartOf) && isPartOf !== goTerms[0]) {
      warn(`The GO term ${goTerms[0]} and bqbiol:isPartOf ${isPartOf} disagree.`)
    }
  }
  if (!location) warn('The entity has no location: no GO cellular component and not part of the module.')
  return { entity, species, location }
}
