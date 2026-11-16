import { beforeAll, describe, expect, it } from 'vitest'
import { annotatedCouplingsBetween } from '../../../../src/services/annotations/couple.js'
import {
  annotatedCouplingsForEdge,
  driveEdgesByAnnotations,
  drivenSummary,
  withCouplings,
} from '../../../../src/services/annotations/edgeCouplings.js'
import { loadToyNodes } from './toyNodes.js'

const manualPort = (variable) => ({ portType: 'general_ports', label: variable, variables: [variable] })
const manualCoupling = (source, target) => ({ sourcePort: manualPort(source), targetPort: manualPort(target) })
const edgeOf = (source, target) => ({
  id: 'e1',
  source: source.id,
  target: target.id,
  data: { couplings: [manualCoupling('c_A_i', 'c_A')] },
})
const variablesOf = (couplings) =>
  couplings.map(({ sourcePort, targetPort }) => `${sourcePort.variables[0]} -> ${targetPort.variables[0]}`).sort()

describe('driveEdgesByAnnotations', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  const annotatedPair = () => {
    const porterIn = toy.node('porter_in', [
      manualPort('c_A_i'),
      toy.port('porter_in', 'area'),
      toy.port('porter_in', 'c_A_i'),
      toy.port('porter_in', 'v_A_i'),
    ])
    const cell = toy.node('cell', [
      manualPort('c_A'),
      toy.port('cell', 'area'),
      toy.port('cell', 'c_A'),
      toy.port('cell', 'v_A'),
    ])
    const edge = edgeOf(porterIn, cell)
    return { porterIn, cell, edge, nodes: [porterIn, cell] }
  }

  it('switches an edge between placed annotated nodes to the matched couplings', () => {
    const { porterIn, cell, edge, nodes } = annotatedPair()
    const context = toy.context(nodes)
    const { edges, changed, ports } = driveEdgesByAnnotations({ nodes, edges: [edge], context })

    const accepted = annotatedCouplingsBetween(porterIn, cell, nodes, context).couplings
    expect(edges[0].data.couplings).toEqual(accepted)
    expect(variablesOf(edges[0].data.couplings)).toEqual(['area -> area', 'c_A_i -> c_A', 'v_A_i -> v_A'])
    expect(annotatedCouplingsForEdge(porterIn, cell, { nodes, context }).couplings).toEqual(accepted)
    expect(edges[0].data.manualCouplings).toEqual([manualCoupling('c_A_i', 'c_A')])
    expect(changed).toEqual([expect.objectContaining({ edgeId: 'e1', kind: 'switched' })])
    expect(ports.size).toBe(0)
    expect(drivenSummary(changed)).toBe('1 connection now uses annotation ports.')
    // Pure: the input edge is unchanged.
    expect(edge.data.manualCouplings).toBeUndefined()
  })

  it('is idempotent', () => {
    const { edge, nodes } = annotatedPair()
    const context = toy.context(nodes)
    const once = driveEdgesByAnnotations({ nodes, edges: [edge], context })
    const twice = driveEdgesByAnnotations({ nodes, edges: once.edges, context })
    expect(twice.changed).toEqual([])
    expect(twice.edges[0]).toBe(once.edges[0])
  })

  it('restores the manual couplings once an end has no annotated ports', () => {
    const { porterIn, cell, edge, nodes } = annotatedPair()
    const driven = driveEdgesByAnnotations({ nodes, edges: [edge], context: toy.context(nodes) }).edges[0]
    const bare = { ...cell, data: { ...cell.data, ports: [manualPort('c_A')] } }
    // As dropping the annotated ports leaves it: no couplings through them.
    const stripped = { ...driven, data: { ...driven.data, couplings: [] } }
    const after = [porterIn, bare]
    const { edges, changed } = driveEdgesByAnnotations({ nodes: after, edges: [stripped], context: toy.context(after) })
    expect(edges[0].data.couplings).toEqual([manualCoupling('c_A_i', 'c_A')])
    expect(edges[0].data).not.toHaveProperty('manualCouplings')
    expect(changed[0].kind).toBe('restored')
    expect(drivenSummary(changed)).toBeNull()
  })

  it('restores no manual coupling whose port has since gone', () => {
    const { porterIn, cell, edge, nodes } = annotatedPair()
    const driven = driveEdgesByAnnotations({ nodes, edges: [edge], context: toy.context(nodes) }).edges[0]
    const bare = { ...cell, data: { ...cell.data, ports: [manualPort('c_B')] } }
    const stripped = { ...driven, data: { ...driven.data, couplings: [] } }
    const after = [porterIn, bare]
    const { edges } = driveEdgesByAnnotations({ nodes: after, edges: [stripped], context: toy.context(after) })
    expect(edges[0].data).toEqual({ couplings: [] })
  })

  it('leaves an edge with annotated ports on one end only untouched', () => {
    const { porterIn, edge } = annotatedPair()
    const cell = toy.node('cell', [manualPort('c_A')])
    const nodes = [porterIn, cell]
    const { edges, changed } = driveEdgesByAnnotations({ nodes, edges: [edge], context: toy.context(nodes) })
    expect(changed).toEqual([])
    expect(edges[0]).toBe(edge)
  })

  it('keeps the stored couplings of an edge at an unplaced node', () => {
    const { porterIn, cell, edge } = annotatedPair()
    const unplaced = { ...cell, data: { ...cell.data, bioView: undefined } }
    const nodes = [porterIn, unplaced]
    const { edges, changed } = driveEdgesByAnnotations({ nodes, edges: [edge], context: toy.context(nodes) })
    expect(changed).toEqual([])
    expect(edges[0].data.couplings).toEqual([manualCoupling('c_A_i', 'c_A')])
  })

  it('restores the manual couplings once an end is no longer placed', () => {
    const { porterIn, cell, edge, nodes } = annotatedPair()
    const driven = driveEdgesByAnnotations({ nodes, edges: [edge], context: toy.context(nodes) }).edges[0]
    const unplaced = { ...cell, data: { ...cell.data, bioView: undefined } }
    const stripped = { ...driven, data: { ...driven.data, couplings: [] } }
    const after = [porterIn, unplaced]
    const { edges, changed } = driveEdgesByAnnotations({ nodes: after, edges: [stripped], context: toy.context(after) })
    expect(edges[0].data.couplings).toEqual([manualCoupling('c_A_i', 'c_A')])
    expect(changed[0].kind).toBe('restored')
  })

  it('keeps the manual couplings where the matcher couples nothing', () => {
    const { porterIn, edge } = annotatedPair()
    // The basolateral fluid shares no place with the apical porter.
    const vessel = toy.node('vessel', [manualPort('c_A'), toy.port('vessel', 'c_A')])
    const nodes = [porterIn, vessel]
    const moved = { ...edge, target: vessel.id }
    const { edges, changed } = driveEdgesByAnnotations({ nodes, edges: [moved], context: toy.context(nodes) })
    expect(changed).toEqual([])
    expect(edges[0].data.couplings).toEqual([manualCoupling('c_A_i', 'c_A')])
  })

  it('adds the ports the matcher needs to the nodes', () => {
    const porterIn = toy.node('porter_in', [manualPort('c_A_i'), toy.port('porter_in', 'c_A_i')])
    const cell = toy.node('cell', [manualPort('c_A'), toy.port('cell', 'c_A')])
    const edge = edgeOf(porterIn, cell)
    const nodes = [porterIn, cell]
    const { edges, ports } = driveEdgesByAnnotations({ nodes, edges: [edge], context: toy.context(nodes) })
    expect(variablesOf(edges[0].data.couplings)).toEqual(['area -> area', 'c_A_i -> c_A', 'v_A_i -> v_A'])
    expect(ports.get(porterIn.id)).toHaveLength(4)
    expect(ports.get(cell.id)).toHaveLength(4)
  })

  it('drives only the given edges', () => {
    const { edge, nodes } = annotatedPair()
    const { changed } = driveEdgesByAnnotations({ nodes, edges: [edge], context: toy.context(nodes), edgeIds: ['x'] })
    expect(changed).toEqual([])
  })
})

describe('withCouplings', () => {
  it('drops manualCouplings when there are none to keep', () => {
    const data = { couplings: [1], manualCouplings: [2], other: true }
    expect(withCouplings(data, { couplings: [3] })).toEqual({ couplings: [3], other: true })
    expect(withCouplings(data, { couplings: [3], manualCouplings: [4] })).toEqual({
      couplings: [3],
      manualCouplings: [4],
      other: true,
    })
  })
})
