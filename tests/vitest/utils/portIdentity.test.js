import { describe, expect, it } from 'vitest'
import {
  findPort,
  isNamedPort,
  portDisplayName,
  portIdentity,
  portRef,
  samePort,
} from '../../../src/utils/portIdentity.js'

const labelled = (label, variables = ['x'], portType = 'general_ports') => ({ portType, label, variables })
const annotated = (subject, variables = [], extra = {}) => ({
  portType: 'general_ports',
  label: '',
  variables,
  multiportType: 'None',
  annotation: { subject, variable: variables[0] ?? 'v', role: 'reader', source: { kind: 'sidecar' }, ...extra },
})

describe('port identity', () => {
  it('identifies an annotated port by subject and contribution, any other by label', () => {
    expect(portIdentity(labelled('flow'))).toBe('label:flow')
    expect(portIdentity(annotated('m#c.v_Na_i'))).toBe('rdf:m#c.v_Na_i')
    expect(portIdentity(annotated('m#c.v_Na_i', [], { contribution: 0 }))).toBe('rdf:m#c.v_Na_i')
    expect(portIdentity(annotated('m#c.v_Na_i', [], { contribution: 2 }))).toBe('rdf:m#c.v_Na_i#2')
    expect(portIdentity(null)).toBeNull()
  })

  it('tells apart annotated ports that share an empty label', () => {
    const sodium = annotated('m#s.v_Na_i', ['v_Na_i'])
    const glucose = annotated('m#s.v_Glc_i', ['v_Glc_i'])
    expect(samePort(sodium, glucose)).toBe(false)
    expect(findPort([sodium, glucose], { ...glucose, variables: ['v_Glc_i'] })).toBe(glucose)
  })

  it('keeps an annotated port the same port while its variables change, but not a labelled one', () => {
    expect(samePort(annotated('m#a', []), annotated('m#a', ['a']))).toBe(true)
    expect(samePort(labelled('flow', ['a']), labelled('flow', ['b']))).toBe(false)
    expect(samePort(labelled('flow', ['a']), labelled('flow', ['a']))).toBe(true)
    expect(samePort(annotated('m#a'), { ...annotated('m#a'), portType: 'exit_ports' })).toBe(false)
  })

  it('copies a port as couplings store it, annotation included', () => {
    const port = { ...annotated('m#a', ['a']), _uid: 'u1', multiplyFactor: 1 }
    const ref = portRef(port)
    expect(ref).toEqual({
      portType: 'general_ports',
      label: '',
      variables: ['a'],
      multiportType: 'None',
      multiplyFactor: 1,
      annotation: port.annotation,
    })
    expect(ref.annotation).not.toBe(port.annotation)
    expect(portRef(labelled('flow'))).not.toHaveProperty('annotation')
  })

  it('names an annotated port by its variables, never by its empty label', () => {
    expect(portDisplayName(annotated('m#a', ['v_Na_i']))).toBe('v_Na_i')
    expect(portDisplayName(annotated('m#a', [], { variable: 'c_Na' }))).toBe('c_Na')
    expect(portDisplayName(labelled('flow'))).toBe('flow')
  })

  it('counts an annotated port as named', () => {
    expect(isNamedPort(annotated('m#a'))).toBe(true)
    expect(isNamedPort(labelled(' '))).toBe(false)
    expect(isNamedPort(labelled('flow'))).toBe(true)
  })
})
