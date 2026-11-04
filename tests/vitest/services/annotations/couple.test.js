import { beforeAll, describe, expect, it } from 'vitest'
import {
  annotatedCompatible,
  annotationsAgree,
  buildCouplingContext,
  mirrorAnnotation,
  mirroredPort,
  placesOf,
  portsForCouplings,
  quantityOfPort,
} from '../../../../src/services/annotations/couple.js'
import { portIdentity } from '../../../../src/utils/portIdentity.js'
import { loadToyNodes } from './toyNodes.js'

/** A port whose annotation carries a resolved place of its own, as a copy keeps it. */
const withPlace = (port, place) => ({ ...port, annotation: { ...port.annotation, absoluteLocation: place } })

describe('annotated ports on workspace nodes', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  it('gives no places until placement is known', () => {
    expect(placesOf(toy.node('cell'), toy.context())).toEqual([])
    expect(buildCouplingContext()).toMatchObject({ nodes: [] })
  })

  it('reads a port’s quantity from its side-car', () => {
    const quantity = quantityOfPort(toy.port('porter_in', 'c_A_i'), toy.node('porter_in'), toy.context())
    expect(quantity).toMatchObject({ instance: 'node_porter_in', variable: 'c_A_i', role: 'reader', locations: [] })
    expect(
      quantityOfPort({ portType: 'general_ports', label: 'x', variables: [] }, toy.node('cell'), toy.context())
    ).toBeNull()
  })

  it('skips a port on a variable its node’s math lacks', () => {
    const cell = toy.node('cell', [], { variables: [{ name: 'volume' }] })
    expect(quantityOfPort(toy.port('cell', 'c_A'), cell, toy.context())).toBeNull()
  })

  it('reads the side-car as it is now rather than the port’s copy', () => {
    const stale = toy.port('porter_in', 'c_A_i')
    stale.annotation.property = 'OPB:00154'
    expect(quantityOfPort(stale, toy.node('porter_in'), toy.context()).property).toBe('OPB:00340')
    const unparsed = buildCouplingContext()
    expect(quantityOfPort(stale, toy.node('porter_in'), unparsed).property).toBe('OPB:00154')
  })

  it('agrees on complementary ports of one property and species, and nothing else', () => {
    const context = toy.context()
    const [cell, porterIn, porterOut] = [toy.node('cell'), toy.node('porter_in'), toy.node('porter_out')]
    expect(annotationsAgree(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(true)
    // Reader to reader never agrees.
    expect(
      annotationsAgree(toy.port('porter_in', 'c_A_i'), porterIn, toy.port('porter_out', 'c_A_i'), porterOut, context)
    ).toBe(false)
    // Different properties never agree.
    expect(annotationsAgree(toy.port('cell', 'volume'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(
      false
    )
  })

  it('couples only ports resolved to the same place', () => {
    const context = toy.context()
    const [cell, porterIn] = [toy.node('cell'), toy.node('porter_in')]
    const owner = toy.port('cell', 'c_A')
    const reader = toy.port('porter_in', 'c_A_i')
    // Unplaced, nothing resolves.
    expect(annotatedCompatible(owner, cell, reader, porterIn, context)).toBe(false)
    const place = { key: 'apical-fluid', label: 'apical fluid' }
    expect(annotatedCompatible(withPlace(owner, place), cell, withPlace(reader, place), porterIn, context)).toBe(true)
    const elsewhere = { key: 'basolateral-fluid' }
    expect(annotatedCompatible(withPlace(owner, place), cell, withPlace(reader, elsewhere), porterIn, context)).toBe(false)
  })
})

describe('mirrorAnnotation', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  it('keeps the partner’s resolved place when the node is not placed', () => {
    const context = toy.context()
    const [porterIn, cell] = [toy.node('porter_in'), toy.node('cell')]
    const partner = withPlace(toy.port('porter_in', 'c_A_i'), { key: 'apical-fluid', label: 'apical fluid' })
    const annotation = mirrorAnnotation(partner, porterIn, cell, context)
    expect(annotation).toMatchObject({
      subject: partner.annotation.subject,
      variable: '',
      property: partner.annotation.property,
      species: partner.annotation.species,
      location: null,
      absoluteLocation: { key: 'apical-fluid' },
      role: 'owner',
      source: { kind: 'copied', mathRef: 'pool.cellml:pool', copiedFrom: { subject: partner.annotation.subject } },
    })
    const copy = mirroredPort(annotation)
    expect(copy).toMatchObject({ portType: 'general_ports', label: '', variables: [], multiportType: 'True' })
    expect(annotatedCompatible(partner, porterIn, copy, cell, context)).toBe(true)
  })

  it('has no place to give when the partner resolved none', () => {
    const annotation = mirrorAnnotation(toy.port('porter_in', 'c_A_i'), toy.node('porter_in'), toy.node('cell'), toy.context())
    expect(annotation.location).toBeNull()
    expect(annotation.absoluteLocation).toBeUndefined()
  })

  it('numbers a second copy of one subject on a node, so the two stay distinct', () => {
    const context = toy.context()
    const [porterIn, cell] = [toy.node('porter_in'), toy.node('cell')]
    const partner = toy.port('porter_in', 'c_A_i')
    const first = mirroredPort(mirrorAnnotation(partner, porterIn, cell, context))
    const second = mirroredPort(mirrorAnnotation(partner, porterIn, cell, context, [first]))
    expect(second.annotation.contribution).toBe(1)
    expect(portIdentity(first)).not.toBe(portIdentity(second))
  })

  it('returns null for an unannotated partner', () => {
    const port = { portType: 'general_ports', label: 'x', variables: ['x'] }
    expect(mirrorAnnotation(port, toy.node('cell'), toy.node('porter_in'), toy.context())).toBeNull()
  })
})

describe('portsForCouplings', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  const quantityOf = (port) => ({ ...port.annotation, variable: port.variables[0] })

  it('reuses an annotated port already on a node, and makes the others', () => {
    const owner = toy.port('cell', 'c_A')
    const reader = toy.port('porter_in', 'c_A_i')
    const cell = toy.node('cell', [owner])
    const porterIn = toy.node('porter_in')
    const { couplings, addedPorts } = portsForCouplings(porterIn, cell, [
      { source: quantityOf(reader), target: quantityOf(owner) },
    ])
    expect(couplings[0].targetPort).toBe(owner)
    expect(couplings[0].sourcePort).toMatchObject({ portType: 'general_ports', variables: ['c_A_i'] })
    expect(addedPorts.get('node_porter_in')).toEqual([couplings[0].sourcePort])
    expect(addedPorts.has('node_cell')).toBe(false)
  })

  it('makes one port per subject, though two couplings use it', () => {
    const owner = toy.port('cell', 'c_A')
    const reader = toy.port('porter_in', 'c_A_i')
    const [cell, porterIn] = [toy.node('cell'), toy.node('porter_in')]
    const coupling = { source: quantityOf(reader), target: quantityOf(owner) }
    const { couplings, addedPorts } = portsForCouplings(porterIn, cell, [coupling, coupling])
    expect(couplings[0].targetPort).toBe(couplings[1].targetPort)
    expect(addedPorts.get('node_cell')).toHaveLength(1)
  })
})
