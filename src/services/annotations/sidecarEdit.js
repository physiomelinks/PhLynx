/**
 * Edits module sidecars as text: replaces the annotations of the edited variables and the component's kind, and
 * moves a sidecar to another math. Triples the editor doesn't manage are kept as written.
 */

import { createGraph, termKey } from './graph.js'
import {
  BQBIOL,
  GO,
  GO_LOCATIONS,
  NS,
  SBO,
  SEMSIM,
  canonicalCurie,
  expandCurie,
  hasPrefix,
  isFlowProperty,
  splitCurie,
} from './iris.js'
import { parseRdf } from './rdf.js'
import {
  SIDECAR_BASE_IRI,
  isKindCurie,
  isProcessNode,
  isSideFragment,
  readSidecar,
  selfEntityIri,
  isLocalResource,
  sidecarLocalNamespace,
  sideName,
} from './sidecar.js'
import { speciesToken } from './species.js'
import { writeTurtle } from './turtle.js'
import { variableIdsOf } from '../math/variableIds.js'

const KIND_TERMS = { compartment: SBO.physicalCompartment, membrane: GO.plasmaMembrane }
// The predicates that link a variable to its entity or process, a process to its participants, a participant to its
// entity and an entity to its place.
const LINK_PREDICATES = new Set([
  BQBIOL.isPropertyOf,
  BQBIOL.isPartOf,
  SEMSIM.hasSourceParticipant,
  SEMSIM.hasSinkParticipant,
  SEMSIM.hasMediatorParticipant,
  SEMSIM.hasPhysicalEntityReference,
])
const ENTITY_ROLES = new Set(['entity', 'entity_source', 'entity_other'])
// The place an entity is part of, by its entity's role.
const PLACE_ROLES = { entity: 'place', entity_source: 'place_source', entity_other: 'place_other' }
const LOCATED_ROLES = new Set([...ENTITY_ROLES, ...Object.values(PLACE_ROLES)])
// How a dropped node is named in the warning about it, by its findAnnotationNodes role.
const ROLE_TEXT = {
  entity_source: "source's entity",
  entity_other: 'entity',
  place: "entity's place",
  place_source: "source's place",
  place_other: "entity's place",
}

const named = (value) => ({ termType: 'NamedNode', value })
const triple = (subject, predicate, object) => ({ subject, predicate: named(predicate), object })

/**
 * Builds the test for a sidecar's side nodes, 'local:outside', 'local:inside' and 'local:side_…'.
 *
 * @param {string} localNamespace - The sidecar's own namespace.
 * @returns {(term: Object) => boolean}
 */
function sideTest(localNamespace) {
  return (term) =>
    term.termType === 'NamedNode' &&
    term.value.startsWith(localNamespace) &&
    isSideFragment(decodeURIComponent(term.value.slice(localNamespace.length)))
}

/**
 * Whether a triple is a side node's GO term, which the editor keeps for the sides in use.
 *
 * @param {Object} sideTriple
 * @param {(term: Object) => boolean} isSide
 * @returns {boolean}
 */
function isSideTermTriple({ subject, predicate, object }, isSide) {
  return isSide(subject) && predicate.value === BQBIOL.is && GO_LOCATIONS.has(canonicalCurie(object.value))
}

/**
 * Whether a triple on 'local:entity_self' is one the editor writes: bqbiol:isPartOf the plasma membrane, a
 * transporter's, or bqbiol:isVersionOf a GO cellular component, a compartment's space kind. Any other place of
 * 'local:entity_self' is the user's and kept.
 *
 * @param {Object} selfTriple
 * @param {string} selfIri
 * @param {string} predicateIri
 * @returns {boolean}
 */
function isSelfPlaceTriple({ subject, predicate, object }, selfIri, predicateIri) {
  const curie = canonicalCurie(object.value)
  return (
    subject.termType === 'NamedNode' &&
    subject.value === selfIri &&
    predicate.value === predicateIri &&
    (predicateIri === BQBIOL.isPartOf ? curie === GO.plasmaMembrane : GO_LOCATIONS.has(curie))
  )
}

/**
 * Builds the node for an ontology term.
 *
 * @param {string} curieOrIri - A CURIE or IRI with a known prefix.
 * @returns {Object} A NamedNode with the canonical IRI.
 * @throws {Error} When the value is not a known CURIE.
 */
function buildTermNode(curieOrIri) {
  const curie = canonicalCurie(curieOrIri)
  if (!splitCurie(curie)[0]) throw new Error(`'${curieOrIri}' is not a known CURIE.`)
  return named(expandCurie(curie))
}

/**
 * Splits a mathRef into its file and component, at the last ':'.
 *
 * @param {string} mathRef - 'file:component'.
 * @returns {{ file: string, component: string }}
 * @throws {Error} For a malformed mathRef.
 */
function splitMathRef(mathRef) {
  const index = typeof mathRef === 'string' ? mathRef.lastIndexOf(':') : -1
  if (index <= 0 || index === mathRef.length - 1) throw new Error(`'${mathRef}' is not a mathRef.`)
  return { file: mathRef.slice(0, index), component: mathRef.slice(index + 1) }
}

/**
 * The sidecar subject IRI for a fragment of a math file.
 *
 * @param {string} file
 * @param {string} fragment
 * @returns {string}
 */
function subjectIri(file, fragment) {
  return `${SIDECAR_BASE_IRI}${encodeURIComponent(file)}#${encodeURIComponent(fragment)}`
}

/**
 * Reads the comment lines at the top of a sidecar.
 *
 * @param {string} text
 * @returns {string[]} The comments without their '#'.
 */
function readLeadingComments(text) {
  const comments = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('#')) break
    comments.push(line.replace(/^#\s?/, ''))
  }
  return comments
}

/**
 * Writes sidecar triples with the math file as the 'm:' prefix and the sidecar's own file as 'local:', each local
 * entity, process and participant right after the first subject that links to it.
 *
 * @param {Array} triples
 * @param {string} file - The math file.
 * @param {string} component - The component, which names the sidecar's file.
 * @param {string[]} comments
 * @returns {string}
 */
function writeSidecar(triples, file, component, comments) {
  const localNamespace = sidecarLocalNamespace(component)
  const local = `./${localNamespace.slice(SIDECAR_BASE_IRI.length)}`
  const ordered = orderLocalsAfterReferrers(triples, localNamespace, selfEntityIri(component), sideTest(localNamespace))
  return writeTurtle(ordered, [['m', `./${encodeURIComponent(file)}#`], ['local', local]], {
    baseIri: SIDECAR_BASE_IRI,
    comments,
    inlineBlankNodes: true,
  })
}

/**
 * Orders triples depth first: each local node a link reaches follows the first subject that links to it.
 * 'local:entity_self' and the sides, which many link to, keep their places.
 *
 * @param {Array} triples
 * @param {string} localNamespace - The sidecar's own namespace.
 * @param {string} selfIri
 * @param {(term: Object) => boolean} isSide
 * @returns {Array}
 */
function orderLocalsAfterReferrers(triples, localNamespace, selfIri, isSide) {
  const bySubject = new Map()
  for (const t of triples) {
    const key = termKey(t.subject)
    if (!bySubject.has(key)) bySubject.set(key, [])
    bySubject.get(key).push(t)
  }
  const isLocal = (term) =>
    term.termType === 'BlankNode' ||
    (term.termType === 'NamedNode' && term.value.startsWith(localNamespace) && term.value !== selfIri && !isSide(term))
  const isLinked = (t) =>
    LINK_PREDICATES.has(t.predicate.value) && isLocal(t.object) && bySubject.has(termKey(t.object))
  const linkedKeys = new Set(triples.filter(isLinked).map((t) => termKey(t.object)))
  const ordered = []
  const done = new Set()
  const emit = (key) => {
    if (done.has(key)) return
    done.add(key)
    ordered.push(...bySubject.get(key))
    for (const t of bySubject.get(key)) if (isLinked(t)) emit(termKey(t.object))
  }
  for (const key of bySubject.keys()) if (!linkedKeys.has(key)) emit(key)
  for (const key of bySubject.keys()) emit(key)
  return ordered
}

/**
 * Whether a bqbiol:is term on the component or 'local:entity_self' says what kind of module it is.
 *
 * @param {string} value - An IRI.
 * @returns {boolean}
 */
function isKindTerm(value) {
  return isKindCurie(canonicalCurie(value))
}

/**
 * Whether a triple on an entity holds its species or location.
 *
 * @param {Object} graph
 * @param {Object} entityTriple
 * @param {{ selfIris: Set<string>, isSide: (term: Object) => boolean }} module - selfIris are
 *   'local:entity_self' and the component, which a location may be part of, as may a side.
 * @returns {boolean}
 */
function isManagedEntityTriple(graph, { predicate, object }, { selfIris, isSide }) {
  if (predicate.value === BQBIOL.isPartOf) {
    const curie = canonicalCurie(object.value)
    const isPlace = selfIris.has(object.value) || isSide(object) || GO_LOCATIONS.has(curie)
    return isPlace || isOwnPlace(graph, object, selfIris)
  }
  if (predicate.value !== BQBIOL.is) return false
  const curie = canonicalCurie(object.value)
  return hasPrefix(curie, 'CHEBI') || GO_LOCATIONS.has(curie)
}

/**
 * Whether an entity's bqbiol:isPartOf object is a place of the module's own, as the reader reads 'self+GO:…': a
 * node the sidecar defines, such as 'local:place_<id>', that is one GO cellular component and part of the module.
 * Any other node it is part of is not the editor's, so the link to it is kept.
 *
 * @param {Object} graph
 * @param {Object} term
 * @param {Set<string>} selfIris
 * @returns {boolean}
 */
function isOwnPlace(graph, term, selfIris) {
  const isNode = term.termType === 'BlankNode' || (term.termType === 'NamedNode' && isLocalResource(term.value))
  if (!isNode || selfIris.has(term.value)) return false
  const is = graph.objects(term, BQBIOL.is)
  if (is.length !== 1 || !GO_LOCATIONS.has(canonicalCurie(is[0].value))) return false
  return graph.objects(term, BQBIOL.isPartOf).some((object) => selfIris.has(object.value))
}

/**
 * Whether a triple on a variable holds its OPB property or its entity link.
 *
 * @param {Object} variableTriple
 * @returns {boolean}
 */
function isManagedVariableTriple({ predicate, object }) {
  if (predicate.value === BQBIOL.isPropertyOf) return true
  return predicate.value === BQBIOL.isVersionOf && hasPrefix(canonicalCurie(object.value), 'OPB')
}

/**
 * Whether a triple on a process or participant is SemSim's: its participants, entity and multiplier.
 *
 * @param {Object} processTriple
 * @returns {boolean}
 */
function isManagedProcessTriple({ predicate }) {
  return predicate.value.startsWith(NS.semsim)
}

/**
 * Finds the entity, process, participants and their entities a variable's annotation links to. The module's own
 * entity, the component and the sides are never part of it.
 *
 * @param {Object} graph
 * @param {Array} triples
 * @param {Object} subject - The variable.
 * @param {{ selfIris: Set<string>, isSide: (term: Object) => boolean }} module - selfIris are
 *   'local:entity_self' and the component.
 * @param {Set<string>} [shared] - Keys of other annotations' variables and nodes, whose links leave a node own.
 * @returns {Map<string, { term: Object, role: string, own: boolean, managed: Array, kept: Array }>} By key; role is
 *   'process', 'sink', 'source', 'mediator', 'participant', 'entity', 'entity_source', 'entity_other' or the
 *   entity's place, 'place', 'place_source' or 'place_other'; own when
 *   only the annotation links to it; managed and kept split its triples.
 */
function findAnnotationNodes(graph, triples, subject, module, shared = new Set()) {
  const { selfIris, isSide } = module
  const nodes = new Map()
  const visit = (term, role) => {
    const key = termKey(term)
    if (term.termType === 'Literal' || selfIris.has(term.value) || isSide(term) || nodes.has(key)) return
    nodes.set(key, { term, role })
    if (role === 'process') {
      const participants = [
        [SEMSIM.hasSinkParticipant, 'sink'],
        [SEMSIM.hasSourceParticipant, 'source'],
        [SEMSIM.hasMediatorParticipant, 'mediator'],
      ]
      for (const [predicate, name] of participants) {
        graph.objects(term, predicate).forEach((participant, index) => visit(participant, index ? 'participant' : name))
      }
    } else if (ENTITY_ROLES.has(role)) {
      for (const place of graph.objects(term, BQBIOL.isPartOf)) {
        if (isOwnPlace(graph, place, selfIris)) visit(place, PLACE_ROLES[role])
      }
    } else if (!LOCATED_ROLES.has(role)) {
      const entityRole = { sink: 'entity', source: 'entity_source' }[role] ?? 'entity_other'
      for (const entity of graph.objects(term, SEMSIM.hasPhysicalEntityReference)) visit(entity, entityRole)
    }
  }
  graph.objects(subject, BQBIOL.isPropertyOf).forEach((bearer, index) => {
    if (isProcessNode(graph, bearer)) visit(bearer, index ? 'participant' : 'process')
    else visit(bearer, index ? 'entity_other' : 'entity')
  })

  const inside = new Set([termKey(subject), ...nodes.keys()])
  for (const [key, node] of nodes) {
    const isInside = (t) => inside.has(termKey(t.subject)) || shared.has(termKey(t.subject))
    const own = triples.every((t) => termKey(t.object) !== key || isInside(t))
    const isManaged = LOCATED_ROLES.has(node.role)
      ? (t) => isManagedEntityTriple(graph, t, module)
      : isManagedProcessTriple
    const its = own ? triples.filter((t) => termKey(t.subject) === key) : []
    Object.assign(node, { own, managed: its.filter(isManaged), kept: its.filter((t) => !isManaged(t)) })
  }
  return nodes
}

// The names of the module's own places ('self+GO:…') and of the plasma membrane it sits in, which shared entities
// are named after; any other GO term names itself, e.g. 'GO_0005737'.
const OWN_PLACE_NAMES = {
  [GO.plasmaMembrane]: 'membrane',
  [GO.cytoplasm]: 'cytoplasm',
  [GO.extracellularRegion]: 'extracellular',
}
const PLASMA_MEMBRANE_NAME = 'plasma_membrane'
// A species' side, in the name of the entity there: 'local:Na_out', 'local:Na_in'.
const SIDE_TOKENS = { outside: 'out', inside: 'in' }

/**
 * Builds the entity located by a species and location, one each sidecar shares and names after them:
 * - a bare 'self' is 'local:entity_self' itself, and a species there 'local:Na_self', part of it;
 * - a space next to the module is its side, 'local:outside' and so on, and a species there 'local:Na_out', part of
 *   it;
 * - a place of the module's own, 'self+GO:…', is '<place> bqbiol:is <GO> ; bqbiol:isPartOf local:entity_self', e.g.
 *   'local:membrane', and a species there 'local:Na_membrane', part of that place, so no node is both;
 * - the plasma membrane the module sits in is no side: 'local:plasma_membrane bqbiol:is <GO>', or
 *   'local:Na_plasma_membrane', a species part of its GO term.
 *
 * @param {string[]} species
 * @param {string|null} location - 'self', 'self+GO:…' or a GO cellular component.
 * @param {{ self: Object, local: (name: string) => Object, sideOf: (curie: string) => Object }} module - self is
 *   'local:entity_self'; local builds a 'local:' node; sideOf builds a space's side node.
 * @returns {{ node: Object, place: Object|null, triples: Array }|null} Null when it would say nothing.
 */
function buildLocatedEntity(species, location, { self, local, sideOf }) {
  if (!species.length && location === 'self') return { node: self, place: null, triples: [] }
  const tokens = species.map(speciesToken).join('_')
  const at = (placeName) => local(placeName ? `${tokens}_${placeName}` : tokens)
  const speciesOf = (node) => species.map((curie) => triple(node, BQBIOL.is, buildTermNode(curie)))
  const partOf = (place) => {
    const node = at(place.name)
    return { node, place: null, triples: [...speciesOf(node), triple(node, BQBIOL.isPartOf, place.node)] }
  }
  if (location === 'self') return partOf({ name: 'self', node: self })
  if (!location) return species.length ? { node: at(null), place: null, triples: speciesOf(at(null)) } : null

  if (location.startsWith('self+')) {
    const go = canonicalCurie(location.slice('self+'.length))
    const name = OWN_PLACE_NAMES[go] ?? go.replace(/[^A-Za-z0-9]/g, '_')
    const place = local(name)
    const placeTriples = [triple(place, BQBIOL.is, buildTermNode(go)), triple(place, BQBIOL.isPartOf, self)]
    if (!species.length) return { node: place, place: null, triples: placeTriples }
    const located = partOf({ name, node: place })
    return { ...located, place, triples: [...located.triples, ...placeTriples] }
  }
  const go = canonicalCurie(location)
  if (go === GO.plasmaMembrane) {
    if (species.length) return partOf({ name: PLASMA_MEMBRANE_NAME, node: buildTermNode(go) })
    const node = local(PLASMA_MEMBRANE_NAME)
    return { node, place: null, triples: [triple(node, BQBIOL.is, buildTermNode(go))] }
  }
  const side = sideOf(go)
  if (!species.length) return { node: side, place: null, triples: [] }
  return partOf({ name: SIDE_TOKENS[sideName(go)] ?? sideName(go), node: side })
}

/**
 * Builds a variable's annotation. A flow is borne by 'local:process_<id>', whose one sink is the located entity,
 * with a source only when it comes from somewhere; each participant is a blank node. Anything else is borne by its
 * located entity. The entities are shared (see buildLocatedEntity). Multipliers and mediators are never written:
 * absent, a multiplier is 1, and an export adds a transporter's mediator.
 *
 * @param {Object} subject - The variable.
 * @param {{ property?: string|null, species?: string[], location?: string|null, from?: string|null }} entry - from
 *   is the source's location; without one the flow has only a sink.
 * @param {string} id - The variable's id, which names its process.
 * @param {{ self: Object, local: Function, isSide: Function, sideOf: Function }} module - See buildLocatedEntity;
 *   isSide tells a side node.
 * @returns {{ triples: Array, nodes: Map<string, Object> }} nodes by role, as findAnnotationNodes names them.
 */
function buildAnnotation(subject, entry, id, module) {
  const { self, local, isSide } = module
  const { property = null, species = [], location = null } = entry
  const triples = property ? [triple(subject, BQBIOL.isVersionOf, buildTermNode(property))] : []
  const nodes = new Map()
  const isOwnNode = (node) => node !== self && !isSide(node)
  const sink = buildLocatedEntity(species, location, module)
  if (!sink) return { triples, nodes }
  if (isOwnNode(sink.node)) nodes.set('entity', sink.node)
  if (sink.place) nodes.set('place', sink.place)
  if (!isFlowProperty(property)) {
    triples.push(triple(subject, BQBIOL.isPropertyOf, sink.node), ...sink.triples)
    return { triples, nodes }
  }

  const process = local(`process_${id}`)
  const from = entry.from ?? null
  const source = from ? buildLocatedEntity(species, from, module) : null
  const participants = [
    ...(source ? [['source', SEMSIM.hasSourceParticipant, source.node]] : []),
    ['sink', SEMSIM.hasSinkParticipant, sink.node],
  ]
  nodes.set('process', process)
  if (source && isOwnNode(source.node)) nodes.set('entity_source', source.node)
  if (source?.place) nodes.set('place_source', source.place)
  triples.push(triple(subject, BQBIOL.isPropertyOf, process))
  for (const [role, predicate, entity] of participants) {
    const participant = { termType: 'BlankNode', value: `phlynx-${role}-${id}` }
    nodes.set(role, participant)
    triples.push(triple(process, predicate, participant))
    triples.push(triple(participant, SEMSIM.hasPhysicalEntityReference, entity))
  }
  triples.push(...sink.triples, ...(source?.triples ?? []))
  return { triples, nodes }
}

/**
 * Edits a sidecar: sets the component's kind, and 'local:entity_self''s to match, a transporter's in the plasma
 * membrane, and replaces each edited variable's annotation (see buildAnnotation). Entities are shared, so each is
 * written once and goes when no variable uses it any more; the sides in use say what space they are, and unused
 * ones go. Only CURIEs are written; other terms, other predicates and unedited subjects are kept, and a replaced
 * node's other triples move to its successor.
 *
 * @param {string|null} text - The sidecar Turtle, or empty for a new sidecar.
 * @param {string} mathRef - 'file:component'.
 * @param {Object} edit
 * @param {'compartment'|'membrane'|'transporter'|null} [edit.componentKind] - Left as is when undefined; null
 *   removes the kind term.
 * @param {string} [edit.transporter] - The transporter's UniProt CURIE; without it a transporter keeps its UniProt
 *   terms and drops the other kind terms.
 * @param {string|null} [edit.spaceKind] - A compartment's kind of space, the GO cellular component
 *   'local:entity_self' is a version of; null removes it. Left as is when undefined, unless the kind changes from
 *   a compartment.
 * @param {Map<string, Object|null>|Object<string, Object|null>} [edit.variables] - Variable name -> { property,
 *   species, location, from }, or null to clear its annotation. Unlisted variables are left as is. from is a flow's
 *   source location, or null or undefined for none.
 * @param {string} [edit.cellml] - The math, whose variable ids name the subjects ('<file>#<id>'); needed to edit
 *   variables. Each variable annotated anew needs an id in it (see ensureVariableIds).
 * @param {(message: string) => void} [edit.onWarning] - Told of what else a node held when the edit drops the node
 *   and nothing takes its place, such as a process's GO term when its flow becomes a level. A node something else
 *   references is never dropped.
 * @returns {Promise<string>} The new sidecar Turtle.
 * @throws {Error} When the text is not valid Turtle, the mathRef is malformed, a term is not a known CURIE, variables
 *   are edited without the math or a newly annotated variable has no id.
 */
export async function editSidecar(
  text,
  mathRef,
  { componentKind, transporter, spaceKind, variables = new Map(), cellml, onWarning } = {}
) {
  const { file, component: componentName } = splitMathRef(mathRef)
  const source = text ?? ''
  const triples = source.trim() ? await parseRdf(source, { baseIri: SIDECAR_BASE_IRI }) : []
  const graph = createGraph(triples)
  const sidecar = readSidecar(graph, { mathRef, cellml })
  const subjectFile = sidecar.file ?? file
  const component = named(sidecar.component?.subject ?? subjectIri(subjectFile, componentName))
  const edits = variables instanceof Map ? variables : new Map(Object.entries(variables))
  // Variable subjects are ids, so without the math no annotated variable can be found.
  if (edits.size && !cellml) throw new Error('the math is needed to edit variable annotations.')

  const sidecarName = sidecar.componentName ?? componentName
  const localNamespace = sidecarLocalNamespace(sidecarName)
  const local = (name) => named(`${localNamespace}${encodeURIComponent(name)}`)
  const self = named(selfEntityIri(sidecarName))
  const selfIris = new Set([self.value, component.value])
  const isSide = sideTest(localNamespace)
  const sideOf = (curie) => local(sideName(curie))

  const references = new Map()
  for (const { object } of triples) references.set(termKey(object), (references.get(termKey(object)) ?? 0) + 1)

  const removed = new Set()
  const added = []

  // The kind terms: the component's, edited, and 'local:entity_self''s to match.
  const kindTriples = (subject) =>
    triples.filter(
      (t) => t.subject.value === subject.value && t.predicate.value === BQBIOL.is && isKindTerm(t.object.value)
    )
  let kindTerms = kindTriples(component).map((t) => t.object.value)
  if (componentKind !== undefined) {
    const kindTerm = componentKind === 'transporter' ? transporter : KIND_TERMS[componentKind]
    const isKeptUniprot = componentKind === 'transporter' && !transporter
    const isUniprot = (t) => hasPrefix(canonicalCurie(t.object.value), 'uniprot')
    const kept = isKeptUniprot ? kindTriples(component).filter(isUniprot) : []
    for (const t of kindTriples(component)) if (!kept.includes(t)) removed.add(t)
    if (kindTerm) added.push(triple(component, BQBIOL.is, buildTermNode(kindTerm)))
    kindTerms = [...(kindTerm ? [buildTermNode(kindTerm).value] : []), ...kept.map((t) => t.object.value)]
  }
  const selfKind = kindTriples(self)
  const sameKind = (a, b) => a.map(canonicalCurie).sort().join(' ') === b.map(canonicalCurie).sort().join(' ')
  if (!sameKind(selfKind.map((t) => t.object.value), kindTerms)) {
    for (const t of selfKind) removed.add(t)
    for (const value of kindTerms) added.push(triple(self, BQBIOL.is, buildTermNode(value)))
  }
  const kind = componentKind === undefined ? (sidecar.component?.kind ?? null) : componentKind

  // 'local:entity_self''s place and space kind: a transporter is in the plasma membrane; a compartment's space kind
  // is the user's.
  const setSelfPlaces = (predicate, curies) => {
    const current = triples.filter((t) => isSelfPlaceTriple(t, self.value, predicate))
    if (sameKind(current.map((t) => t.object.value), curies)) return
    for (const t of current) removed.add(t)
    for (const curie of curies) added.push(triple(self, predicate, buildTermNode(curie)))
  }
  if (kind === 'transporter') setSelfPlaces(BQBIOL.isPartOf, [GO.plasmaMembrane])
  else if (componentKind !== undefined) setSelfPlaces(BQBIOL.isPartOf, [])
  const leavesCompartment = componentKind !== undefined && componentKind !== 'compartment'
  if (spaceKind !== undefined || leavesCompartment) {
    setSelfPlaces(BQBIOL.isVersionOf, spaceKind && kind === 'compartment' ? [spaceKind] : [])
  }
  const module = { self, local, isSide, sideOf, selfIris }

  const subjectOf = new Map(sidecar.variables.map(({ variable, subject }) => [variable, subject]))
  const ids = new Map([
    ...(cellml ? variableIdsOf(cellml) : []),
    ...sidecar.variables.map(({ variable, id }) => [variable, id]),
  ])
  for (const [variable, entry] of edits) {
    if (!subjectOf.has(variable) && !entry) continue
    if (!subjectOf.has(variable) && !ids.has(variable)) throw new Error(`the variable '${variable}' has no id.`)
    const subject = named(subjectOf.get(variable) ?? subjectIri(subjectFile, ids.get(variable)))
    const own = triples.filter((t) => t.subject.termType === 'NamedNode' && t.subject.value === subject.value)
    for (const t of own) if (isManagedVariableTriple(t)) removed.add(t)
    const nodes = findAnnotationNodes(graph, triples, subject, module)
    for (const node of nodes.values()) for (const t of node.managed) removed.add(t)

    if (!entry) {
      keepLinksToKept(graph, triples, subject, nodes, removed)
      continue
    }
    const built = buildAnnotation(subject, entry, ids.get(variable), module)
    added.push(...built.triples)
    // A shared entity another variable still uses is written afresh, so it says the same in CURIEs.
    for (const [role, node] of built.nodes) {
      if (!LOCATED_ROLES.has(role) || node.termType !== 'NamedNode') continue
      for (const t of triples) {
        if (termKey(t.subject) === node.value && isManagedEntityTriple(graph, t, module)) removed.add(t)
      }
    }
    // What else a replaced node held moves to the node with its role, or goes with it.
    for (const node of nodes.values()) {
      if (!node.kept.length) continue
      const successor = built.nodes.get(node.role)
      if (successor && successor.value === node.term.value && node.term.termType === 'NamedNode') continue
      for (const t of node.kept) removed.add(t)
      if (!successor) onWarning?.(describeDropped(variable, node))
      else for (const { predicate, object } of node.kept) added.push({ subject: successor, predicate, object })
    }
  }

  const isGone = (term) =>
    term.termType === 'BlankNode' ||
    (term.value.startsWith(localNamespace) && term.value !== self.value && !isSide(term))
  const merged = dropOrphanNodes(dedupe(mergeInPlace(triples, removed, added)), references, isGone, (dropped) => {
    const kept = dropped.filter((t) => !isManagedEntityTriple(graph, t, module) && !isManagedProcessTriple(t))
    const [{ subject }] = dropped
    if (kept.length && subject.termType === 'NamedNode') onWarning?.(describeUnused(subject, kept))
  })
  const result = settleSides(merged, isSide, sideOf, added)
  const written = orderModuleFirst(result, component, self, isSide)
  return writeSidecar(written, subjectFile, sidecarName, readLeadingComments(source))
}

/**
 * Words the warning for a node an edit dropped with other triples, e.g. "'J' no longer has its process, so its
 * bqbiol:isVersionOf GO:0005412 was dropped."
 *
 * @param {string} variable
 * @param {{ role: string, kept: Array }} node - From findAnnotationNodes.
 * @returns {string}
 */
function describeDropped(variable, { role, kept }) {
  const verb = kept.length === 1 ? 'was' : 'were'
  return `'${variable}' no longer has its ${ROLE_TEXT[role] ?? role}, so its ${statementsText(kept)} ${verb} dropped.`
}

/**
 * Words triples' predicates and objects for a warning, e.g. 'bqbiol:isVersionOf GO:0005412'.
 *
 * @param {Array} kept
 * @returns {string}
 */
function statementsText(kept) {
  const text = (term) => {
    if (term.termType === 'Literal') return JSON.stringify(term.value)
    if (term.termType === 'BlankNode') return '[…]'
    if (term.value.startsWith(NS.bqbiol)) return `bqbiol:${term.value.slice(NS.bqbiol.length)}`
    return canonicalCurie(term.value)
  }
  return kept.map(({ predicate, object }) => `${text(predicate)} ${text(object)}`).join('; ')
}

/**
 * Keeps, when a variable's annotation is cleared, the links to its nodes that hold other triples, so they stay
 * reachable.
 *
 * @param {Object} graph
 * @param {Array} triples
 * @param {Object} subject - The variable.
 * @param {Map<string, Object>} nodes - From findAnnotationNodes.
 * @param {Set<Object>} removed - The triples the edit removes; links are taken out of it.
 */
function keepLinksToKept(graph, triples, subject, nodes, removed) {
  const holds = (key, seen = new Set()) => {
    const node = nodes.get(key)
    if (!node?.own || seen.has(key)) return false
    seen.add(key)
    const isLinkOut = (t) => termKey(t.subject) === key && LINK_PREDICATES.has(t.predicate.value)
    return node.kept.length > 0 || triples.some((t) => isLinkOut(t) && holds(termKey(t.object), seen))
  }
  for (const t of triples) {
    const from = termKey(t.subject)
    if (from !== subject.value && !nodes.has(from)) continue
    if (LINK_PREDICATES.has(t.predicate.value) && holds(termKey(t.object))) removed.delete(t)
  }
}

/**
 * Merges the edit into the triples, putting each subject's new triples where the subject first appeared.
 *
 * @param {Array} triples - The triples before the edit.
 * @param {Set<Object>} removed - Triples the edit removes.
 * @param {Array} added - Triples the edit adds.
 * @returns {Array}
 */
function mergeInPlace(triples, removed, added) {
  const addedBySubject = new Map()
  for (const t of added) {
    const key = termKey(t.subject)
    if (!addedBySubject.has(key)) addedBySubject.set(key, [])
    addedBySubject.get(key).push(t)
  }
  const merged = []
  for (const t of triples) {
    const key = termKey(t.subject)
    if (addedBySubject.has(key)) {
      merged.push(...addedBySubject.get(key))
      addedBySubject.delete(key)
    }
    if (!removed.has(t)) merged.push(t)
  }
  return [...merged, ...[...addedBySubject.values()].flat()]
}

/**
 * Drops repeated triples, keeping the first: an entity several variables share is written by each.
 *
 * @param {Array} triples
 * @returns {Array}
 */
function dedupe(triples) {
  const seen = new Set()
  return triples.filter((t) => {
    const key = `${termKey(t.subject)} ${t.predicate.value} ${termKey(t.object)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Drops the triples of nodes that were referenced before the edit and no longer are: blank nodes and the sidecar's
 * own entities, places and processes, never 'local:entity_self' or a side.
 *
 * @param {Array} triples
 * @param {Map<string, number>} references - Term key -> how many triples had it as object before the edit.
 * @param {(term: Object) => boolean} canGo - Whether a node may be dropped.
 * @param {(dropped: Array) => void} onDrop - Told of each dropped node's triples.
 * @returns {Array}
 */
function dropOrphanNodes(triples, references, canGo, onDrop) {
  let current = triples
  for (;;) {
    const objects = new Set(current.map((t) => termKey(t.object)))
    const isOrphan = ({ subject }) =>
      references.has(termKey(subject)) && !objects.has(termKey(subject)) && canGo(subject)
    const orphans = current.filter(isOrphan)
    if (!orphans.length) return current
    for (const key of new Set(orphans.map((t) => termKey(t.subject)))) {
      onDrop(orphans.filter((t) => termKey(t.subject) === key))
    }
    current = current.filter((t) => !isOrphan(t))
  }
}

/**
 * Words the warning for an entity no variable uses any more that held other triples.
 *
 * @param {Object} node
 * @param {Array} kept - Its triples the editor doesn't write.
 * @returns {string}
 */
function describeUnused(node, kept) {
  const name = decodeURIComponent(node.value.slice(node.value.indexOf('#') + 1))
  const verb = kept.length === 1 ? 'was' : 'were'
  return `No variable uses 'local:${name}' any more, so its ${statementsText(kept)} ${verb} dropped.`
}

/**
 * Gives each side in use its GO term and drops those of sides no longer used. A side the edit links to says the
 * space it is named after; one it doesn't link to keeps what it says.
 *
 * @param {Array} triples
 * @param {(term: Object) => boolean} isSide
 * @param {(curie: string) => Object} sideOf
 * @param {Array} added - The triples the edit adds, whose sides it names.
 * @returns {Array}
 */
function settleSides(triples, isSide, sideOf, added) {
  const used = new Set(triples.filter((t) => isSide(t.object)).map((t) => t.object.value))
  const linked = new Set(added.filter((t) => isSide(t.object)).map((t) => t.object.value))
  const kept = triples.filter((t) => !isSideTermTriple(t, isSide) || used.has(t.subject.value))
  const settled = []
  for (const value of used) {
    if (!linked.has(value)) continue
    const curie = [...GO_LOCATIONS].find((go) => sideOf(go).value === value)
    const terms = kept.filter((t) => isSideTermTriple(t, isSide) && t.subject.value === value)
    if (!curie || (terms.length === 1 && canonicalCurie(terms[0].object.value) === curie)) continue
    for (const t of terms) kept.splice(kept.indexOf(t), 1)
    settled.push(triple(named(value), BQBIOL.is, buildTermNode(curie)))
  }
  return [...kept, ...settled]
}

/**
 * Puts the component's triples first, 'local:entity_self''s next and then the sides' GO terms, so they head the
 * written sidecar. Any other predicate on 'local:entity_self' follows its own.
 *
 * @param {Array} triples
 * @param {Object} component
 * @param {Object} self
 * @param {(term: Object) => boolean} isSide
 * @returns {Array}
 */
function orderModuleFirst(triples, component, self, isSide) {
  const isOf = (node) => (t) => t.subject.termType === 'NamedNode' && t.subject.value === node.value
  const isSideTriple = (t) => isSide(t.subject)
  const rest = triples.filter((t) => !isOf(component)(t) && !isOf(self)(t) && !isSideTriple(t))
  const rank = ({ subject: { value } }) => [/#outside$/, /#inside$/].findIndex((pattern) => pattern.test(value))
  const order = (t) => `${rank(t) < 0 ? 2 : rank(t)}${t.subject.value}`
  const sides = triples.filter(isSideTriple).sort((a, b) => order(a).localeCompare(order(b)))
  // What the module is comes before where it is and what space it is.
  const selfOrder = [BQBIOL.is, BQBIOL.isPartOf, BQBIOL.isVersionOf]
  const selfRank = (t) => (selfOrder.indexOf(t.predicate.value) + selfOrder.length + 1) % (selfOrder.length + 1)
  const selfTriples = triples.filter(isOf(self)).sort((a, b) => selfRank(a) - selfRank(b))
  return [...triples.filter(isOf(component)), ...selfTriples, ...sides, ...rest]
}

/**
 * Moves a sidecar to another math: its subjects in the old file move to the new one, the component's to the new
 * component, and its local entities to the new component's sidecar. Variable subjects keep their ids, unless `ids`
 * renames them, and so do the local nodes named after them ('local:process_<id>', and in older sidecars
 * 'local:entity_<id>' and so on). Shared entities, named after their species and place, keep their names.
 *
 * @param {string|null} text - The sidecar Turtle.
 * @param {string} oldRef - The math it describes, 'file:component'.
 * @param {string} newRef - The math it moves to.
 * @param {{ ids?: Map<string, string> }} [options] - ids maps a subject's old id to its new one.
 * @returns {Promise<string|null>} The moved sidecar, or the text unchanged when it is empty.
 * @throws {Error} When the text is not valid Turtle or a mathRef is malformed.
 */
export async function renameSidecar(text, oldRef, newRef, { ids } = {}) {
  if (!text?.trim()) return text
  const from = splitMathRef(oldRef)
  const to = splitMathRef(newRef)
  const oldPrefix = `${SIDECAR_BASE_IRI}${encodeURIComponent(from.file)}#`
  const oldLocal = sidecarLocalNamespace(from.component)

  const renameFragment = (fragment) => (fragment === from.component ? to.component : (ids?.get(fragment) ?? fragment))
  const renameTerm = (term) => {
    if (term.termType !== 'NamedNode') return term
    if (term.value.startsWith(oldLocal)) {
      const fragment = term.value.slice(oldLocal.length)
      const renamed = renameLocalFragment(decodeURIComponent(fragment), ids)
      return named(`${sidecarLocalNamespace(to.component)}${renamed ? encodeURIComponent(renamed) : fragment}`)
    }
    if (!term.value.startsWith(oldPrefix)) return term
    return named(subjectIri(to.file, renameFragment(decodeURIComponent(term.value.slice(oldPrefix.length)))))
  }

  const triples = await parseRdf(text, { baseIri: SIDECAR_BASE_IRI })
  const moved = triples.map((t) => ({ subject: renameTerm(t.subject), predicate: t.predicate, object: renameTerm(t.object) }))
  return writeSidecar(moved, to.file, to.component, readLeadingComments(text))
}

/**
 * Renames a local node named after a variable id: '<entity|place|process|sink|source|mediator>_<id>', or
 * '<entity|place>_<id>_source'.
 *
 * @param {string} fragment - Decoded.
 * @param {Map<string, string>|undefined} ids - Old id -> new id.
 * @returns {string|null} The new fragment, or null when it is not renamed.
 */
function renameLocalFragment(fragment, ids) {
  const match = ids && fragment.match(/^(entity|place|process|sink|source|mediator)_(.+)$/)
  if (!match) return null
  const [, role, rest] = match
  if (ids.has(rest)) return `${role}_${ids.get(rest)}`
  const isLocated = role === 'entity' || role === 'place'
  const sourceId = isLocated && rest.endsWith('_source') ? rest.slice(0, -'_source'.length) : null
  return sourceId && ids.has(sourceId) ? `${role}_${ids.get(sourceId)}_source` : null
}

/**
 * The subject IRI of a variable: '<file>#<id>', as editSidecar writes it.
 *
 * @param {string} mathRef - 'file:component'.
 * @param {string} id - The variable's CellML id.
 * @param {string} [file] - The sidecar's own file, when it differs from the mathRef's.
 * @returns {string}
 * @throws {Error} For a malformed mathRef.
 */
export function buildVariableSubject(mathRef, id, file) {
  return subjectIri(file ?? splitMathRef(mathRef).file, id)
}

/**
 * Lists the triples editSidecar keeps as written: everything but the module's kind terms, 'local:entity_self''s
 * places, the sides' GO terms and each variable's property and the species and locations, processes and
 * participants its annotation links to.
 *
 * @param {string|null} text - The sidecar Turtle.
 * @param {string} mathRef - 'file:component'.
 * @param {{ cellml?: string }} [options] - cellml resolves the '#<id>' variable subjects.
 * @returns {Promise<Array<{ subject: Object, predicate: Object, object: Object }>>}
 * @throws {Error} When the text is not valid Turtle.
 */
export async function listOtherTriples(text, mathRef, { cellml } = {}) {
  if (!text?.trim()) return []
  const triples = await parseRdf(text, { baseIri: SIDECAR_BASE_IRI })
  const graph = createGraph(triples)
  const sidecar = readSidecar(graph, { mathRef, cellml })
  const componentIri = sidecar.component?.subject
  const selfIri = selfEntityIri(sidecar.componentName ?? splitMathRef(mathRef).component)
  const selfIris = new Set([selfIri, componentIri].filter(Boolean))
  const isSide = sideTest(sidecarLocalNamespace(sidecar.componentName ?? splitMathRef(mathRef).component))
  const module = { selfIris, isSide }
  const managed = new Set()
  for (const t of triples) {
    const isModule = t.subject.termType === 'NamedNode' && selfIris.has(t.subject.value)
    if (isModule && t.predicate.value === BQBIOL.is && isKindTerm(t.object.value)) managed.add(t)
    const isSelfPlace = [BQBIOL.isPartOf, BQBIOL.isVersionOf].some((p) => isSelfPlaceTriple(t, selfIri, p))
    if (isSelfPlace || isSideTermTriple(t, isSide)) managed.add(t)
  }
  // An entity several variables share is the editor's as much as one only one variable has.
  const subjects = sidecar.variables.map(({ subject }) => named(subject))
  const shared = new Set(subjects.map(termKey))
  for (const subject of subjects) {
    for (const key of findAnnotationNodes(graph, triples, subject, module).keys()) shared.add(key)
  }
  for (const subject of subjects) {
    for (const t of triples) if (t.subject.value === subject.value && isManagedVariableTriple(t)) managed.add(t)
    const nodes = findAnnotationNodes(graph, triples, subject, module, shared)
    for (const node of nodes.values()) for (const t of node.managed) managed.add(t)
  }
  return triples.filter((t) => !managed.has(t))
}
