import { beforeAll, describe, expect, it } from 'vitest'
import {
  annotatedCompatible,
  annotatedCouplingsBetween,
  annotationsAgree,
  buildCouplingContext,
  isLocatedNode,
  mirrorAnnotation,
  mirroredPort,
  placesOf,
  portsForCouplings,
  quantityOfPort,
} from '../../../../src/services/annotations/couple.js'
import { PLACEMENT_SOURCE } from '../../../../src/services/annotations/locationSources.js'
import { matchCouplings } from '../../../../src/services/annotations/match.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { portIdentity } from '../../../../src/utils/portIdentity.js'
import { readToy } from './toyModel.js'
import { TOY_TEMPLATES, loadToyNodes } from './toyNodes.js'

/** A port whose annotation carries a resolved place of its own, as a copy keeps it. */
const withPlace = (port, place) => ({ ...port, annotation: { ...port.annotation, absoluteLocation: place } })

describe('annotated ports on workspace nodes', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  it('gives no places until placement is known', () => {
    expect(placesOf(toy.unplaced('cell'), toy.context())).toEqual([])
    expect(buildCouplingContext()).toMatchObject({ nodes: [] })
  })

  it('reads a port’s quantity from its side-car', () => {
    const quantity = quantityOfPort(toy.port('porter_in', 'c_A_i'), toy.unplaced('porter_in'), toy.context())
    expect(quantity).toMatchObject({ instance: 'node_porter_in', variable: 'c_A_i', role: 'reader', locations: [] })
    expect(
      quantityOfPort({ portType: 'general_ports', label: 'x', variables: [] }, toy.unplaced('cell'), toy.context())
    ).toBeNull()
  })

  it('skips a port on a variable its node’s math lacks', () => {
    const cell = toy.unplaced('cell', [], { variables: [{ name: 'volume' }] })
    expect(quantityOfPort(toy.port('cell', 'c_A'), cell, toy.context())).toBeNull()
  })

  it('reads the side-car as it is now rather than the port’s copy', () => {
    const stale = toy.port('porter_in', 'c_A_i')
    stale.annotation.property = 'OPB:00154'
    expect(quantityOfPort(stale, toy.unplaced('porter_in'), toy.context()).property).toBe('OPB:00340')
    const unparsed = buildCouplingContext()
    expect(quantityOfPort(stale, toy.unplaced('porter_in'), unparsed).property).toBe('OPB:00154')
  })

  it('agrees on complementary ports of one property and species, and nothing else', () => {
    const context = toy.context()
    const [cell, porterIn, porterOut] = [toy.unplaced('cell'), toy.unplaced('porter_in'), toy.unplaced('porter_out')]
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
    const [cell, porterIn] = [toy.unplaced('cell'), toy.unplaced('porter_in')]
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
    const [porterIn, cell] = [toy.unplaced('porter_in'), toy.unplaced('cell')]
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
    const annotation = mirrorAnnotation(toy.port('porter_in', 'c_A_i'), toy.unplaced('porter_in'), toy.unplaced('cell'), toy.context())
    expect(annotation.location).toBeNull()
    expect(annotation.absoluteLocation).toBeUndefined()
  })

  it('numbers a second copy of one subject on a node, so the two stay distinct', () => {
    const context = toy.context()
    const [porterIn, cell] = [toy.unplaced('porter_in'), toy.unplaced('cell')]
    const partner = toy.port('porter_in', 'c_A_i')
    const first = mirroredPort(mirrorAnnotation(partner, porterIn, cell, context))
    const second = mirroredPort(mirrorAnnotation(partner, porterIn, cell, context, [first]))
    expect(second.annotation.contribution).toBe(1)
    expect(portIdentity(first)).not.toBe(portIdentity(second))
  })

  it('returns null for an unannotated partner', () => {
    const port = { portType: 'general_ports', label: 'x', variables: ['x'] }
    expect(mirrorAnnotation(port, toy.unplaced('cell'), toy.unplaced('porter_in'), toy.context())).toBeNull()
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
    const cell = toy.unplaced('cell', [owner])
    const porterIn = toy.unplaced('porter_in')
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
    const [cell, porterIn] = [toy.unplaced('cell'), toy.unplaced('porter_in')]
    const coupling = { source: quantityOf(reader), target: quantityOf(owner) }
    const { couplings, addedPorts } = portsForCouplings(porterIn, cell, [coupling, coupling])
    expect(couplings[0].targetPort).toBe(couplings[1].targetPort)
    expect(addedPorts.get('node_cell')).toHaveLength(1)
  })
})

describe('annotated ports on placed nodes', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  const TOY_NAMES = ['outside', 'cell', 'wall', 'porter_in', 'porter_out', 'vessel']
  const keysOf = (quantity) => quantity.locations.map((location) => location.key)

  it('places a node where its template site is, its own place first', () => {
    const [own, ...next] = placesOf(toy.node('porter_in'), toy.context())
    expect(own).toMatchObject({ key: 'site:bt-toy/cell.apical', kind: 'membraneProtein', facets: ['apical'] })
    expect(next.map((place) => place.key)).toEqual([
      'site:bt-toy/cell',
      'site:bt-toy/cell.membrane',
      'site:bt-toy/apical-fluid',
    ])
    expect(isLocatedNode(toy.node('porter_in'), toy.context())).toBe(true)
    expect(isLocatedNode(toy.unplaced('porter_in'), toy.context())).toBe(false)
  })

  it('locates a port’s quantity at its node’s places, named by their labels', () => {
    const porterIn = toy.node('porter_in')
    expect(keysOf(quantityOfPort(toy.port('porter_in', 'c_A_i'), porterIn, toy.context()))).toEqual(['site:bt-toy/cell'])
    const [outside] = quantityOfPort(toy.port('porter_in', 'c_A_o'), porterIn, toy.context()).locations
    expect(outside).toMatchObject({ key: 'site:bt-toy/apical-fluid', label: 'Apical fluid (lumen)' })
  })

  it('couples complementary ports at the same place, and nothing else', () => {
    const context = toy.context()
    const [cell, porterIn, porterOut] = [toy.node('cell'), toy.node('porter_in'), toy.node('porter_out')]
    expect(annotatedCompatible(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(true)
    // The porter's outside concentration is not the cell's.
    expect(annotatedCompatible(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_o'), porterIn, context)).toBe(
      false
    )
    // Reader to reader never couples.
    expect(
      annotatedCompatible(toy.port('porter_in', 'c_A_i'), porterIn, toy.port('porter_out', 'c_A_i'), porterOut, context)
    ).toBe(false)
    // Unplaced, nothing is located.
    expect(
      annotatedCompatible(toy.port('cell', 'c_A'), toy.unplaced('cell'), toy.port('porter_in', 'c_A_i'), porterIn, context)
    ).toBe(false)
  })

  it('gives a copy the complementary role at a location resolving to the partner’s place', () => {
    const context = toy.context()
    const [porterIn, cell, porterOut] = [toy.node('porter_in'), toy.node('cell'), toy.node('porter_out')]
    const reader = toy.port('porter_in', 'c_A_i')
    const owner = mirrorAnnotation(reader, porterIn, cell, context)
    expect(owner).toMatchObject({ location: 'self', role: 'owner' })
    expect(owner.absoluteLocation).toBeUndefined()
    expect(annotatedCompatible(reader, porterIn, mirroredPort(owner), cell, context)).toBe(true)

    const sum = toy.port('cell', 'v_A')
    const contributor = mirrorAnnotation(sum, cell, porterOut, context)
    expect(contributor).toMatchObject({ location: 'GO:0005737', role: 'contributor' })
    expect(annotatedCompatible(sum, cell, mirroredPort(contributor), porterOut, context)).toBe(true)
  })

  const variablesOf = ({ couplings }) =>
    couplings.map(({ sourcePort, targetPort }) => `${sourcePort.variables[0]} -> ${targetPort.variables[0]}`).sort()

  it('gives the matched couplings for the pair in the edge’s direction, making the ports they need', () => {
    const nodes = TOY_NAMES.map((name) => toy.node(name))
    const [cell, porterIn] = [nodes[1], nodes[3]]
    const result = annotatedCouplingsBetween(porterIn, cell, nodes, toy.context(nodes))
    expect(variablesOf(result)).toEqual(['area -> area', 'c_A_i -> c_A', 'v_A_i -> v_A'])
    expect(result.addedPorts.get('node_cell')).toHaveLength(3)
    expect(result.addedPorts.get('node_porter_in')).toHaveLength(3)

    // Drawn the other way, the couplings follow the edge.
    const reversed = annotatedCouplingsBetween(cell, porterIn, nodes, toy.context(nodes))
    expect(variablesOf(reversed)).toEqual(['area -> area', 'c_A -> c_A_i', 'v_A -> v_A_i'])
  })

  it('joins a cell and its membrane without coupling them, as their toy side-cars share no quantity', async () => {
    // The toy pool has a concentration, a flux, a volume and its membrane's area; the toy wall only a potential and
    // a charge flow.
    const [cell, wall] = [toy.node('cell'), toy.node('wall')]
    expect(variablesOf(annotatedCouplingsBetween(cell, wall, [cell, wall], toy.context([cell, wall])))).toEqual([])

    // Were the wall to annotate its own area, both would own the membrane's area: a clash, still not a coupling.
    const cellml = readToy('wall.cellml').replace(
      '</component>',
      '<variable id="vwallarea" name="area" units="mm2"/></component>'
    )
    const text = `${readToy('wall.ttl')}m:vwallarea bqbiol:isVersionOf opb:00295 ;
    bqbiol:isPropertyOf local:entity_self .
`
    const walled = await parseSidecar(text, { mathRef: 'wall.cellml:wall', cellml })
    const sidecarFor = (mathRef) => (mathRef === walled.mathRef ? walled : toy.sidecarFor(mathRef))
    const nodes = [cell, wall]
    const context = buildCouplingContext({ sidecarFor, nodes, source: PLACEMENT_SOURCE, data: TOY_TEMPLATES })
    const instances = nodes.map((node) => ({
      name: node.id,
      places: placesOf(node, context),
      sidecar: sidecarFor(node.data.mathRef),
    }))
    const { matches, conflicts } = matchCouplings(instances, { locate: PLACEMENT_SOURCE.locate })
    expect(matches).toEqual([])
    expect(conflicts.map(({ a, b }) => [a.variable, b.variable])).toEqual([['area', 'area']])
  })

  it('neither couples nor makes ports for annotations of variables the node’s math lacks', () => {
    const rowsOf = (...names) => ({ variables: names.map((name) => ({ name })) })
    const cell = toy.node('cell', [], rowsOf('area', 'c_A', 'v_A'))
    const porterIn = toy.node('porter_in', [], rowsOf('area', 'c_A_i'))
    const result = annotatedCouplingsBetween(porterIn, cell, [cell, porterIn], toy.context([cell, porterIn]))
    expect(variablesOf(result)).toEqual(['area -> area', 'c_A_i -> c_A'])
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
    const free = toy.node('outside')
    expect(variablesOf(annotatedCouplingsBetween(free, porterIn, [free, porterIn], toy.context([free, porterIn])))).toEqual([
      'c_A -> c_A_o',
      'v_A -> v_A_o',
    ])
    // A sum held at 0 couples nothing, so a save that holds it drops the couplings into it.
    const [sum, flux] = [toy.port('outside', 'v_A'), toy.port('porter_in', 'v_A_o')]
    expect(annotatedCompatible(sum, free, flux, porterIn, toy.context(nodes))).toBe(true)
    expect(annotatedCompatible(sum, outside, flux, porterIn, toy.context(nodes))).toBe(false)
    expect(annotatedCompatible(toy.port('outside', 'c_A'), outside, toy.port('porter_in', 'c_A_o'), porterIn, toy.context(nodes))).toBe(
      true
    )
  })

  it('gives nothing when a node is unplaced', () => {
    const cell = toy.unplaced('cell')
    const porterIn = toy.node('porter_in')
    expect(annotatedCouplingsBetween(porterIn, cell, [cell, porterIn], toy.context([cell, porterIn])).couplings).toEqual(
      []
    )
  })
})
