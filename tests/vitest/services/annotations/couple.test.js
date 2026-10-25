import { beforeAll, describe, expect, it } from 'vitest'
import {
  annotatedCompatible,
  annotatedCouplingsBetween,
  buildCouplingContext,
  coordOf,
  mirrorAnnotation,
  mirroredPort,
  quantityOfPort,
} from '../../../../src/services/annotations/couple.js'
import { portIdentity } from '../../../../src/utils/portIdentity.js'
import { loadToyNodes } from './toyNodes.js'

describe('annotated ports on workspace nodes', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  it('finds a node’s coord only while its instance file is loaded', () => {
    const cell = toy.node('cell')
    expect(coordOf(cell, toy.context())).toMatchObject({ kind: 'cell' })
    expect(coordOf(cell, buildCouplingContext())).toBeNull()
    expect(coordOf(toy.node('cell', [], { apiCoord: undefined }), toy.context())).toBeNull()
  })

  it('locates a port’s quantity from its node’s coord', () => {
    const quantity = quantityOfPort(toy.port('porter_in', 'c_A_i'), toy.node('porter_in'), toy.context())
    expect(quantity).toMatchObject({ instance: 'node_porter_in', variable: 'c_A_i', role: 'reader' })
    expect(quantity.locations.map((location) => location.key)).toEqual([expect.stringMatching(/^cyto:/)])
    expect(
      quantityOfPort({ portType: 'general_ports', label: 'x', variables: [] }, toy.node('cell'), toy.context())
    ).toBeNull()
  })

  it('names the assumed lyph by its instance name, not its node id', () => {
    const nodes = ['outside', 'cell', 'wall', 'porter_in', 'porter_out', 'vessel'].map((name) => toy.node(name))
    const porter = nodes.find((node) => node.data.name === 'porter_out')
    const [place] = quantityOfPort(toy.port('porter_out', 'c_A_o'), porter, toy.context(nodes)).locations
    expect(place).toMatchObject({ confidence: 'low' })
    expect(place.why).toContain('Assumed: vessel is the only lyph')
  })

  it('reads the sidecar as it is now rather than the port’s copy', () => {
    const stale = toy.port('porter_in', 'c_A_i')
    stale.annotation.property = 'OPB:00154'
    expect(quantityOfPort(stale, toy.node('porter_in'), toy.context()).property).toBe('OPB:00340')
    const unparsed = buildCouplingContext({ apiCoords: toy.apiCoords })
    expect(quantityOfPort(stale, toy.node('porter_in'), unparsed).property).toBe('OPB:00154')
  })

  it('couples complementary ports at the same place, and nothing else', () => {
    const context = toy.context()
    const [cell, porterIn, porterOut] = [toy.node('cell'), toy.node('porter_in'), toy.node('porter_out')]
    expect(annotatedCompatible(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(
      true
    )
    // The porter's outside concentration is not the cell's.
    expect(annotatedCompatible(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_o'), porterIn, context)).toBe(
      false
    )
    // Reader to reader never couples.
    expect(
      annotatedCompatible(toy.port('porter_in', 'c_A_i'), porterIn, toy.port('porter_out', 'c_A_i'), porterOut, context)
    ).toBe(false)
    // Different properties never couple.
    expect(
      annotatedCompatible(toy.port('cell', 'volume'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)
    ).toBe(false)
    // Unbound, nothing is located.
    const unbound = toy.node('cell', [], { apiCoord: undefined })
    expect(
      annotatedCompatible(toy.port('cell', 'c_A'), unbound, toy.port('porter_in', 'c_A_i'), porterIn, context)
    ).toBe(false)
  })
})

describe('mirrorAnnotation', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  it('gives the copy the complementary role at a location resolving to the partner’s place', () => {
    const context = toy.context()
    const [porterIn, cell] = [toy.node('porter_in'), toy.node('cell')]
    const partner = toy.port('porter_in', 'c_A_i')
    const annotation = mirrorAnnotation(partner, porterIn, cell, context)
    expect(annotation).toMatchObject({
      subject: partner.annotation.subject,
      variable: '',
      property: partner.annotation.property,
      species: partner.annotation.species,
      location: 'self',
      role: 'owner',
      source: { kind: 'copied', mathRef: 'pool.cellml:pool', copiedFrom: { subject: partner.annotation.subject } },
    })
    expect(annotation.absoluteLocation).toBeUndefined()

    const copy = mirroredPort(annotation)
    expect(copy).toMatchObject({ portType: 'general_ports', label: '', variables: [], multiportType: 'True' })
    expect(annotatedCompatible(partner, porterIn, copy, cell, context)).toBe(true)
  })

  it('mirrors an owner onto a relative location', () => {
    const context = toy.context()
    const [cell, porterOut] = [toy.node('cell'), toy.node('porter_out')]
    const partner = toy.port('cell', 'v_A')
    const annotation = mirrorAnnotation(partner, cell, porterOut, context)
    expect(annotation).toMatchObject({ location: 'GO:0005737', role: 'contributor' })
    const copy = mirroredPort(annotation)
    expect(copy.multiportType).toBe('None')
    expect(annotatedCompatible(partner, cell, copy, porterOut, context)).toBe(true)
  })

  it('keeps the partner’s resolved place when the copy’s node has no coord', () => {
    const context = toy.context()
    const porterIn = toy.node('porter_in')
    const unbound = toy.node('cell', [], { apiCoord: undefined })
    const partner = toy.port('porter_in', 'c_A_i')
    const annotation = mirrorAnnotation(partner, porterIn, unbound, context)
    expect(annotation.location).toBeNull()
    expect(annotation.absoluteLocation.key).toMatch(/^cyto:/)
    expect(annotatedCompatible(partner, porterIn, mirroredPort(annotation), unbound, context)).toBe(true)
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

describe('annotatedCouplingsBetween', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  const variablesOf = ({ couplings }) =>
    couplings.map(({ sourcePort, targetPort }) => `${sourcePort.variables[0]} -> ${targetPort.variables[0]}`).sort()

  it('gives the matcher’s couplings for the pair in the edge’s direction, making the ports they need', () => {
    const cell = toy.node('cell')
    const porterIn = toy.node('porter_in')
    const nodes = [toy.node('outside'), cell, toy.node('wall'), porterIn, toy.node('porter_out'), toy.node('vessel')]
    const result = annotatedCouplingsBetween(porterIn, cell, nodes, toy.context(nodes))
    expect(variablesOf(result)).toEqual(['area -> area', 'c_A_i -> c_A', 'v_A_i -> v_A'])
    expect(result.addedPorts.get('node_cell')).toHaveLength(3)
    expect(result.addedPorts.get('node_porter_in')).toHaveLength(3)

    // Drawn the other way, the couplings follow the edge.
    const reversed = annotatedCouplingsBetween(cell, porterIn, nodes, toy.context(nodes))
    expect(variablesOf(reversed)).toEqual(['area -> area', 'c_A -> c_A_i', 'v_A -> v_A_i'])
  })

  it('reuses an annotated port already on a node', () => {
    const existing = toy.port('cell', 'c_A')
    const cell = toy.node('cell', [existing])
    const porterIn = toy.node('porter_in')
    const result = annotatedCouplingsBetween(porterIn, cell, [cell, porterIn], toy.context([cell, porterIn]))
    expect(result.couplings.find(({ targetPort }) => targetPort.variables[0] === 'c_A').targetPort).toBe(existing)
    expect(result.addedPorts.get('node_cell')).toHaveLength(2)
  })

  it('drops a held-constant node’s aggregators', () => {
    const outside = toy.node('outside', [], { annotationOverlay: { heldConstant: true } })
    const porterIn = toy.node('porter_in')
    const nodes = [outside, porterIn]
    expect(variablesOf(annotatedCouplingsBetween(outside, porterIn, nodes, toy.context(nodes)))).toEqual([
      'c_A -> c_A_o',
    ])
  })

  it('gives nothing when a node is unbound', () => {
    const cell = toy.node('cell', [], { apiCoord: undefined })
    const porterIn = toy.node('porter_in')
    expect(annotatedCouplingsBetween(porterIn, cell, [cell, porterIn], toy.context()).couplings).toEqual([])
  })
})
