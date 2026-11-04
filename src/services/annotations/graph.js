/**
 * An index over plain triples from rdf.js, with lookups by subject+predicate and predicate+object.
 */

/**
 * A string key for a plain term: the IRI, '_:' + label for a blank node, or a quoted literal.
 *
 * @param {{ termType: string, value: string, datatype?: string, language?: string }} term
 * @returns {string}
 */
export function termKey(term) {
  if (term.termType === 'BlankNode') return `_:${term.value}`
  if (term.termType === 'Literal')
    return `"${term.value}"${term.language ? `@${term.language}` : `^^${term.datatype ?? ''}`}`
  return term.value
}

/**
 * Indexes triples for lookup.
 *
 * @param {Array<{ subject: object, predicate: object, object: object }>} triples
 * @returns {{ triples: Array, objects: Function, subjects: Function, first: Function, predicatesOf: Function,
 *   subjectsOf: Function, term: Function }}
 */
export function createGraph(triples) {
  const bySubject = new Map() // subjectKey -> Map<predicateIri, object[]>
  const byPredicateObject = new Map() // predicateIri + ' ' + objectKey -> subject[]
  const terms = new Map()

  for (const triple of triples) {
    const subjectKey = termKey(triple.subject)
    const objectKey = termKey(triple.object)
    terms.set(subjectKey, triple.subject)
    terms.set(objectKey, triple.object)
    if (!bySubject.has(subjectKey)) bySubject.set(subjectKey, new Map())
    const predicates = bySubject.get(subjectKey)
    if (!predicates.has(triple.predicate.value)) predicates.set(triple.predicate.value, [])
    predicates.get(triple.predicate.value).push(triple.object)
    const poKey = `${triple.predicate.value} ${objectKey}`
    if (!byPredicateObject.has(poKey)) byPredicateObject.set(poKey, [])
    byPredicateObject.get(poKey).push(triple.subject)
  }

  const keyOf = (termOrKey) => (typeof termOrKey === 'string' ? termOrKey : termKey(termOrKey))

  return {
    triples,
    /** Objects of (subject, predicate); subject is a term or key. */
    objects: (subject, predicate) => bySubject.get(keyOf(subject))?.get(predicate) ?? [],
    /** Subjects of (predicate, object); object is a term or key. */
    subjects: (predicate, object) => byPredicateObject.get(`${predicate} ${keyOf(object)}`) ?? [],
    /** The first object of (subject, predicate), or undefined. */
    first: (subject, predicate) => bySubject.get(keyOf(subject))?.get(predicate)?.[0],
    /** The predicate IRIs used on a subject. */
    predicatesOf: (subject) => [...(bySubject.get(keyOf(subject))?.keys() ?? [])],
    /** Every subject term. */
    subjectsOf: () => [...bySubject.keys()].map((key) => terms.get(key)),
    /** The term for a key, if seen. */
    term: (key) => terms.get(key),
  }
}
