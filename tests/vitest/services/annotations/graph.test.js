import { describe, expect, it } from 'vitest'
import { createGraph, termKey } from '../../../../src/services/annotations/graph.js'

const named = (value) => ({ termType: 'NamedNode', value })
const blank = (value) => ({ termType: 'BlankNode', value })

describe('createGraph', () => {
  const triples = [
    { subject: named('s'), predicate: named('p'), object: named('o1') },
    { subject: named('s'), predicate: named('p'), object: blank('b0') },
    { subject: blank('b0'), predicate: named('q'), object: { termType: 'Literal', value: '1', datatype: 'xsd:int' } },
  ]
  const graph = createGraph(triples)

  it('looks up objects and subjects by term or key', () => {
    expect(graph.objects('s', 'p')).toEqual([named('o1'), blank('b0')])
    expect(graph.objects(blank('b0'), 'q')[0].value).toBe('1')
    expect(graph.subjects('p', 'o1')).toEqual([named('s')])
    expect(graph.subjects('p', blank('b0'))).toEqual([named('s')])
    expect(graph.first('s', 'p')).toEqual(named('o1'))
    expect(graph.first('s', 'missing')).toBeUndefined()
    expect(graph.objects('nobody', 'p')).toEqual([])
  })

  it('lists subjects and predicates', () => {
    expect(graph.subjectsOf()).toEqual([named('s'), blank('b0')])
    expect(graph.predicatesOf('s')).toEqual(['p'])
    expect(graph.term('_:b0')).toEqual(blank('b0'))
  })

  it('keys blank nodes and literals apart from IRIs', () => {
    expect(termKey(blank('x'))).toBe('_:x')
    expect(termKey({ termType: 'Literal', value: 'a', language: 'en' })).toBe('"a"@en')
    expect(termKey({ termType: 'Literal', value: 'a', datatype: 'd' })).toBe('"a"^^d')
  })
})
