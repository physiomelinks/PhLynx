import { describe, expect, it } from 'vitest'

import { BUILT_IN_EDGE_APPEARANCE } from '../../../src/utils/constants.js'
import {
  previewCouplings,
  pruneAppearance,
  resolveEdgeAppearance,
  resolvePortCouplings,
  withEdgeAppearance,
} from '../../../src/utils/edges.js'

const port = (label, portType, variables) => ({ label, portType, variables, multiportType: 'None' })
const node = (id, ports) => ({ id, data: { name: id, ports } })
const edge = (id, source, target) => ({ id, source, target, data: { couplings: [] } })

describe('previewCouplings', () => {
  it('couples the given ports for the node, and the canvas ports for the other end', () => {
    const nodes = [node('a', [port('p', 'exit_ports', ['x'])]), node('b', [port('p', 'entrance_ports', ['y'])])]
    const edges = [edge('e', 'a', 'b')]
    const edited = [port('p', 'exit_ports', ['z'])]

    const couplings = previewCouplings('a', edited, nodes, edges)
    expect(couplings.get('e')).toEqual([{ sourcePort: edited[0], targetPort: nodes[1].data.ports[0] }])
    expect(nodes[0].data.ports[0].variables).toEqual(['x'])
    expect(edges[0].data.couplings).toEqual([])
  })

  it('leaves out edges not touching the node, or whose other node is missing', () => {
    const nodes = [node('a', []), node('b', []), node('c', [])]
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ax', 'a', 'gone')]
    expect([...previewCouplings('a', [], nodes, edges).keys()]).toEqual(['ab'])
  })

  it("picks each edge's slot by its position among the edges sharing its source and its target", () => {
    const hubPorts = [port('v', 'exit_ports', ['q0']), port('v', 'exit_ports', ['q1'])]
    const leafPorts = [port('v', 'entrance_ports', ['q'])]
    const nodes = [node('hub', hubPorts), node('l0', leafPorts), node('l1', leafPorts)]
    const edges = [edge('e0', 'hub', 'l0'), edge('e1', 'hub', 'l1')]

    const couplings = previewCouplings('hub', hubPorts, nodes, edges)
    expect(couplings.get('e0')).toEqual(resolvePortCouplings(hubPorts, leafPorts, 0, 0))
    expect(couplings.get('e1')[0].sourcePort.variables).toEqual(['q1'])
  })
})

describe('resolveEdgeAppearance', () => {
  it('gives an edge with no appearance the built-in one', () => {
    expect(resolveEdgeAppearance(undefined)).toEqual(BUILT_IN_EDGE_APPEARANCE)
    expect(resolveEdgeAppearance({})).toEqual(BUILT_IN_EDGE_APPEARANCE)
  })

  it('keeps the values it knows and replaces the others with the built-in ones', () => {
    expect(resolveEdgeAppearance({ colour: '#123456', path: 'step', arrow: 'none', width: 'thick' })).toEqual({
      colour: '#123456',
      path: 'step',
      arrow: 'none',
      width: 'thick',
    })
    expect(resolveEdgeAppearance({ colour: '', path: 'zigzag', arrow: 'toString', width: 9 })).toEqual(BUILT_IN_EDGE_APPEARANCE)
  })
})

describe('pruneAppearance', () => {
  it('keeps only the values that differ from the built-in ones', () => {
    expect(pruneAppearance({ colour: null, path: 'bezier', arrow: 'medium', width: 'thin' })).toEqual({ path: 'bezier', width: 'thin' })
    expect(pruneAppearance({ ...BUILT_IN_EDGE_APPEARANCE })).toEqual({})
    expect(pruneAppearance(undefined)).toEqual({})
  })
})

describe('withEdgeAppearance', () => {
  it('sets the appearance on new data, leaving the old data alone', () => {
    const data = { couplings: [], appearance: { width: 'thin' } }
    const next = withEdgeAppearance(data, { arrow: 'large' })
    expect(next).toEqual({ couplings: [], appearance: { arrow: 'large' } })
    expect(next).not.toBe(data)
    expect(data.appearance).toEqual({ width: 'thin' })
  })

  it('leaves the key out for the built-in appearance', () => {
    expect(withEdgeAppearance({ couplings: [], appearance: { width: 'thin' } }, { width: 'normal' })).toEqual({ couplings: [] })
    expect(withEdgeAppearance(undefined, {})).toEqual({})
  })
})
