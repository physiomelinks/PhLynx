import { describe, expect, it } from 'vitest'
import { BQBIOL } from '../../../../src/services/annotations/iris.js'
import { parseRdf } from '../../../../src/services/annotations/rdf.js'
import { SIDECAR_BASE_IRI } from '../../../../src/services/annotations/sidecar.js'
import { writeTurtle } from '../../../../src/services/annotations/turtle.js'

const ARCHIVE_BASE = 'https://example.org/archive/'
const named = (value) => ({ termType: 'NamedNode', value })
const blank = (value) => ({ termType: 'BlankNode', value })

describe('writeTurtle', () => {
  it('writes prefixed names, relative IRIs, blank nodes and literals that parse back', async () => {
    const text = writeTurtle(
      [
        { subject: named('./model.cellml#a'), predicate: named(BQBIOL.isPropertyOf), object: blank('b0') },
        { subject: blank('b0'), predicate: named(BQBIOL.is), object: named('https://identifiers.org/chebi/CHEBI:29101') },
        { subject: named('./model.cellml#a'), predicate: named('http://purl.org/dc/terms/title'), object: { termType: 'Literal', value: 'say "hi"\n' } },
      ],
      [['model', './model.cellml#']],
      { comments: ['A heading.'] }
    )
    expect(text.startsWith('# A heading.\n')).toBe(true)
    expect(text).toContain('model:a bqbiol:isPropertyOf _:b0')
    expect(text).toContain('chebi:29101')
    const triples = await parseRdf(text, { baseIri: ARCHIVE_BASE })
    expect(triples).toHaveLength(3)
    expect(triples[0].subject.value).toBe(`${ARCHIVE_BASE}model.cellml#a`)
    expect(triples.find((t) => t.object.termType === 'Literal').object.value).toBe('say "hi"\n')
  })

  it('writes identifiers.org terms, SemSim predicates and OBO PURLs with their prefixes', () => {
    const subject = named('http://example.org/p')
    const text = writeTurtle([
      { subject, predicate: named('http://bime.uw.edu/semsim/hasSinkParticipant'), object: named('http://example.org/s') },
      { subject, predicate: named(BQBIOL.isVersionOf), object: named('https://identifiers.org/go/GO:0005412') },
      { subject, predicate: named(BQBIOL.is), object: named('http://purl.obolibrary.org/obo/UBERON_0000025') },
    ])
    expect(text).toContain('@prefix semsim: <http://bime.uw.edu/semsim/> .')
    expect(text).toContain('@prefix go: <https://identifiers.org/go/GO:> .')
    expect(text).toContain('semsim:hasSinkParticipant')
    expect(text).toContain('go:0005412')
    expect(text).toContain('obo:UBERON_0000025')
  })

  it('refuses an internal IRI', () => {
    const internal = named('https://phlynx.invalid/modules/x.cellml#x')
    expect(() => writeTurtle([{ subject: internal, predicate: internal, object: internal }])).toThrow(/internal IRI/)
  })

  it('writes IRIs under the base as the file prefix, and blank nodes used once inline', async () => {
    const subject = named(`${SIDECAR_BASE_IRI}pool.cellml#pool.c_A`)
    const triples = [
      { subject, predicate: named(BQBIOL.isPropertyOf), object: blank('e') },
      { subject: blank('e'), predicate: named(BQBIOL.is), object: named('https://identifiers.org/chebi/CHEBI:29101') },
      { subject: blank('e'), predicate: named(BQBIOL.isPartOf), object: named(`${SIDECAR_BASE_IRI}pool.cellml#pool`) },
    ]
    const text = writeTurtle(triples, [['m', './pool.cellml#']], { baseIri: SIDECAR_BASE_IRI, inlineBlankNodes: true })
    expect(text).toContain('@prefix m: <./pool.cellml#> .')
    expect(text).toContain('m:pool.c_A bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ;')
    expect(text).not.toContain('_:')
    const parsed = await parseRdf(text, { baseIri: SIDECAR_BASE_IRI })
    expect(parsed).toHaveLength(3)
    expect(parsed.map((t) => t.subject.value)).toContain(subject.value)
  })

  it('keeps blank nodes that are shared or in a cycle as labels', async () => {
    const subject = named('http://example.org/s')
    const triples = [
      { subject, predicate: named(BQBIOL.is), object: blank('shared') },
      { subject: named('http://example.org/t'), predicate: named(BQBIOL.is), object: blank('shared') },
      { subject: blank('x'), predicate: named(BQBIOL.is), object: blank('y') },
      { subject: blank('y'), predicate: named(BQBIOL.is), object: blank('x') },
    ]
    const text = writeTurtle(triples, [], { inlineBlankNodes: true })
    expect(text).toContain('_:shared')
    expect(await parseRdf(text, { baseIri: SIDECAR_BASE_IRI })).toHaveLength(4)
  })
})
