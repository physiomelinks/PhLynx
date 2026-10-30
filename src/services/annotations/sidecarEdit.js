/**
 * Edits module sidecars as text: replaces the annotations of the edited variables and the component's kind, and
 * moves a sidecar to another math. Triples the editor doesn't manage are kept as written.
 */

import { createGraph, termKey } from './graph.js'
import { BQBIOL, GO, GO_LOCATIONS, SBO, canonicalCurie, expandCurie, hasPrefix, splitCurie } from './iris.js'
import { parseRdf } from './rdf.js'
import { SIDECAR_BASE_IRI, readSidecar } from './sidecar.js'
import { writeTurtle } from './turtle.js'

const KIND_TERMS = { compartment: SBO.physicalCompartment, membrane: GO.plasmaMembrane }

const named = (value) => ({ termType: 'NamedNode', value })
const triple = (subject, predicate, object) => ({ subject, predicate: named(predicate), object })

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
 * Writes sidecar triples with the math file as the 'm:' prefix.
 *
 * @param {Array} triples
 * @param {string} file - The math file.
 * @param {string[]} comments
 * @returns {string}
 */
function writeSidecar(triples, file, comments) {
  return writeTurtle(triples, [['m', `./${encodeURIComponent(file)}#`]], {
    baseIri: SIDECAR_BASE_IRI,
    comments,
    inlineBlankNodes: true,
  })
}

/**
 * Whether a bqbiol:is term on the component says what kind of module it is.
 *
 * @param {string} value - An IRI.
 * @returns {boolean}
 */
function isKindTerm(value) {
  const curie = canonicalCurie(value)
  return curie === SBO.physicalCompartment || curie === GO.plasmaMembrane || hasPrefix(curie, 'uniprot')
}

/**
 * Whether a triple on an entity holds its species or location.
 *
 * @param {Object} entityTriple
 * @param {string} componentIri
 * @returns {boolean}
 */
function isManagedEntityTriple({ predicate, object }, componentIri) {
  if (predicate.value === BQBIOL.isPartOf) {
    return object.value === componentIri || GO_LOCATIONS.has(canonicalCurie(object.value))
  }
  if (predicate.value !== BQBIOL.is) return false
  const curie = canonicalCurie(object.value)
  return hasPrefix(curie, 'CHEBI') || GO_LOCATIONS.has(curie)
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
 * Builds a variable's entity triples for its species and location.
 *
 * @param {{ species?: string[], location?: string|null }} entry
 * @param {Object} entity - The entity term to describe.
 * @param {Object} component - The component term.
 * @returns {Array} The entity's triples, empty for 'self' with no species.
 */
function buildEntityTriples({ species = [], location = null }, entity, component) {
  const triples = species.map((curie) => triple(entity, BQBIOL.is, buildTermNode(curie)))
  const isSelf = location === 'self' || location?.startsWith('self+')
  const go = location?.startsWith('self+') ? location.slice('self+'.length) : isSelf ? null : location
  if (go) triples.push(triple(entity, BQBIOL.is, buildTermNode(go)))
  if (isSelf) triples.push(triple(entity, BQBIOL.isPartOf, component))
  return triples
}

/**
 * Edits a sidecar: sets the component's kind and replaces each edited variable's property, species and location.
 * Only CURIEs are written; other terms, other predicates and unedited subjects are kept.
 *
 * @param {string|null} text - The sidecar Turtle, or empty for a new sidecar.
 * @param {string} mathRef - 'file:component'.
 * @param {Object} edit
 * @param {'compartment'|'membrane'|'transporter'|null} [edit.componentKind] - Left as is when undefined; null
 *   removes the kind term.
 * @param {string} [edit.transporter] - The transporter's UniProt CURIE; without it a transporter keeps its UniProt
 *   terms and drops the other kind terms.
 * @param {Map<string, Object|null>|Object<string, Object|null>} [edit.variables] - Variable name -> { property,
 *   species, location }, or null to clear its annotation. Unlisted variables are left as is.
 * @param {string} [edit.cellml] - The math, to find variables annotated by '#id'.
 * @returns {Promise<string>} The new sidecar Turtle.
 * @throws {Error} When the text is not valid Turtle, the mathRef is malformed or a term is not a known CURIE.
 */
export async function editSidecar(text, mathRef, { componentKind, transporter, variables = new Map(), cellml } = {}) {
  const { file, component: componentName } = splitMathRef(mathRef)
  const source = text ?? ''
  const triples = source.trim() ? await parseRdf(source, { baseIri: SIDECAR_BASE_IRI }) : []
  const graph = createGraph(triples)
  const sidecar = readSidecar(graph, { mathRef, cellml })
  const subjectFile = sidecar.file ?? file
  const component = named(sidecar.component?.subject ?? subjectIri(subjectFile, componentName))
  const edits = variables instanceof Map ? variables : new Map(Object.entries(variables))

  const usedLabels = new Set(
    triples.flatMap(({ subject, object }) => [subject, object]).filter((t) => t.termType === 'BlankNode').map((t) => t.value)
  )
  let labelCount = 0
  const createBlankNode = () => {
    let label
    do label = `entity${labelCount++}`
    while (usedLabels.has(label))
    return { termType: 'BlankNode', value: label }
  }

  const references = new Map()
  for (const { object } of triples) references.set(termKey(object), (references.get(termKey(object)) ?? 0) + 1)

  const removed = new Set()
  const added = []

  if (componentKind !== undefined) {
    const kindTerm = componentKind === 'transporter' ? transporter : KIND_TERMS[componentKind]
    const isKeptUniprot = componentKind === 'transporter' && !transporter
    for (const t of triples) {
      const isComponentIs = t.subject.value === component.value && t.predicate.value === BQBIOL.is
      if (!isComponentIs || !isKindTerm(t.object.value)) continue
      if (!(isKeptUniprot && hasPrefix(canonicalCurie(t.object.value), 'uniprot'))) removed.add(t)
    }
    if (kindTerm) added.push(triple(component, BQBIOL.is, buildTermNode(kindTerm)))
  }

  const subjectOf = new Map(sidecar.variables.map(({ variable, subject }) => [variable, subject]))
  for (const [variable, entry] of edits) {
    const subject = named(subjectOf.get(variable) ?? subjectIri(subjectFile, `${componentName}.${variable}`))
    const own = triples.filter((t) => t.subject.termType === 'NamedNode' && t.subject.value === subject.value)
    const links = own.filter((t) => t.predicate.value === BQBIOL.isPropertyOf)
    for (const t of own) if (isManagedVariableTriple(t)) removed.add(t)

    // The entity to reuse: the only one, unless it is the component or another subject's too.
    const [link] = links
    const isOwnEntity =
      links.length === 1 &&
      link.object.termType !== 'Literal' &&
      link.object.value !== component.value &&
      references.get(termKey(link.object)) === 1
    const entity = isOwnEntity ? link.object : null
    let isEntityKept = false
    if (entity) {
      for (const t of triples) {
        if (termKey(t.subject) !== termKey(entity)) continue
        if (isManagedEntityTriple(t, component.value)) removed.add(t)
        else isEntityKept = true
      }
    }
    if (!entry) {
      if (isEntityKept) removed.delete(link)
      continue
    }

    if (entry.property) {
      added.push(triple(subject, BQBIOL.isVersionOf, buildTermNode(entry.property)))
    }
    const isBareSelf = entry.location === 'self' && !entry.species?.length
    if (isBareSelf && !isEntityKept) {
      added.push(triple(subject, BQBIOL.isPropertyOf, component))
      continue
    }
    const target = entity ?? createBlankNode()
    const entityTriples = buildEntityTriples(entry, target, component)
    if (!entityTriples.length && !isEntityKept) continue
    if (entity) removed.delete(link)
    else added.push(triple(subject, BQBIOL.isPropertyOf, target))
    added.push(...entityTriples)
  }

  const result = dropOrphanBlankNodes(mergeInPlace(triples, removed, added), references)
  return writeSidecar(orderComponentFirst(result, component), subjectFile, readLeadingComments(source))
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
 * Drops the triples of blank nodes that were referenced before the edit and no longer are.
 *
 * @param {Array} triples
 * @param {Map<string, number>} references - Term key -> how many triples had it as object before the edit.
 * @returns {Array}
 */
function dropOrphanBlankNodes(triples, references) {
  let current = triples
  for (;;) {
    const objects = new Set(current.map((t) => termKey(t.object)))
    const isOrphan = (t) =>
      t.subject.termType === 'BlankNode' && references.has(termKey(t.subject)) && !objects.has(termKey(t.subject))
    const next = current.filter((t) => !isOrphan(t))
    if (next.length === current.length) return next
    current = next
  }
}

/**
 * Puts the component's triples first so it heads the written sidecar.
 *
 * @param {Array} triples
 * @param {Object} component
 * @returns {Array}
 */
function orderComponentFirst(triples, component) {
  const isComponent = (t) => t.subject.termType === 'NamedNode' && t.subject.value === component.value
  return [...triples.filter(isComponent), ...triples.filter((t) => !isComponent(t))]
}

/**
 * Moves a sidecar to another math: its subjects in the old file move to the new one, the component's to the new
 * component, and each '<component>.<variable>' subject to the variable's new name.
 *
 * @param {string|null} text - The sidecar Turtle.
 * @param {string} oldRef - The math it describes, 'file:component'.
 * @param {string} newRef - The math it moves to.
 * @param {Map<string, string>|Object<string, string>} [varRenames] - Old variable name -> new name.
 * @returns {Promise<string|null>} The moved sidecar, or the text unchanged when it is empty.
 * @throws {Error} When the text is not valid Turtle or a mathRef is malformed.
 */
export async function renameSidecar(text, oldRef, newRef, varRenames = new Map()) {
  if (!text?.trim()) return text
  const from = splitMathRef(oldRef)
  const to = splitMathRef(newRef)
  const renames = varRenames instanceof Map ? varRenames : new Map(Object.entries(varRenames))
  const oldPrefix = `${SIDECAR_BASE_IRI}${encodeURIComponent(from.file)}#`

  const renameFragment = (fragment) => {
    if (fragment === from.component) return to.component
    if (!fragment.startsWith(`${from.component}.`)) return fragment
    const variable = fragment.slice(from.component.length + 1)
    return `${to.component}.${renames.get(variable) ?? variable}`
  }
  const renameTerm = (term) => {
    if (term.termType !== 'NamedNode' || !term.value.startsWith(oldPrefix)) return term
    return named(subjectIri(to.file, renameFragment(decodeURIComponent(term.value.slice(oldPrefix.length)))))
  }

  const triples = await parseRdf(text, { baseIri: SIDECAR_BASE_IRI })
  const moved = triples.map((t) => ({ subject: renameTerm(t.subject), predicate: t.predicate, object: renameTerm(t.object) }))
  return writeSidecar(moved, to.file, readLeadingComments(text))
}
