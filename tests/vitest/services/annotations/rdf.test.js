import { describe, expect, it } from 'vitest'
import { parseRdf, resolveFormat } from '../../../../src/services/annotations/rdf.js'

const BASE = 'https://example.org/models/'

describe('parseRdf', () => {
  it('parses Turtle into plain triples, resolving relative IRIs against the base', async () => {
    const triples = await parseRdf(
      '@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .\n<./box.cellml#box> bqbiol:is [ bqbiol:is "x"@en ] .',
      { baseIri: BASE }
    )
    expect(triples).toHaveLength(2)
    const outer = triples.find((t) => t.subject.termType === 'NamedNode')
    expect(outer.subject.value).toBe('https://example.org/models/box.cellml#box')
    expect(outer.predicate).toEqual({ termType: 'NamedNode', value: 'http://biomodels.net/biology-qualifiers/is' })
    expect(outer.object.termType).toBe('BlankNode')
    const inner = triples.find((t) => t.subject.termType === 'BlankNode')
    expect(inner.subject.value).toBe(outer.object.value)
    expect(inner.object).toMatchObject({ termType: 'Literal', value: 'x', language: 'en' })
  })

  it('parses RDF/XML', async () => {
    const xml = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:bqbiol="http://biomodels.net/biology-qualifiers/">
  <rdf:Description rdf:about="./box.cellml#box"><bqbiol:is rdf:resource="http://identifiers.org/SBO:0000290"/></rdf:Description>
</rdf:RDF>`
    const triples = await parseRdf(xml, { format: 'rdfxml', baseIri: BASE })
    expect(triples).toEqual([
      {
        subject: { termType: 'NamedNode', value: 'https://example.org/models/box.cellml#box' },
        predicate: { termType: 'NamedNode', value: 'http://biomodels.net/biology-qualifiers/is' },
        object: { termType: 'NamedNode', value: 'http://identifiers.org/SBO:0000290' },
      },
    ])
  })

  it('keeps literal datatypes', async () => {
    const [triple] = await parseRdf('<a> <b> 3 .', { baseIri: BASE })
    expect(triple.object).toEqual({
      termType: 'Literal',
      value: '3',
      datatype: 'http://www.w3.org/2001/XMLSchema#integer',
    })
  })

  it('rejects a syntax error and a missing base', async () => {
    await expect(parseRdf('<a> <b> .', { baseIri: BASE })).rejects.toThrow()
    await expect(parseRdf('<a> <b> <c> .')).rejects.toThrow(/baseIri/)
  })

  it('resolves format names, extensions and media types', () => {
    expect(resolveFormat('ttl')).toBe('text/turtle')
    expect(resolveFormat('.rdf')).toBe('application/rdf+xml')
    expect(resolveFormat('RDF/XML')).toBe('application/rdf+xml')
    expect(resolveFormat('text/turtle')).toBe('text/turtle')
    expect(() => resolveFormat('json')).toThrow()
  })
})
