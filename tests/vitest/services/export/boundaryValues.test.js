import { describe, expect, it } from 'vitest'

import { resolveBoundaryValues } from '../../../../src/services/export/boundaryValues.js'

const node = (id, variables, ports = []) => ({ id, data: { name: id, variables, ports } })
const row = (name, type, value = '', units = 'mM') => ({ name, type, value, units })
const edge = (source, target, sourcePort, targetPort) => ({
  source,
  target,
  data: { couplings: [{ sourcePort, targetPort }] },
})
const port = (variables, multiportType) => ({ label: 'p', variables, ...(multiportType ? { multiportType } : {}) })

const namesFor = (map, nodeId) => [...(map.get(nodeId) ?? [])]

describe('resolveBoundaryValues', () => {
  it('uses the value of a boundary condition nothing is connected to', () => {
    const { supplied, missing } = resolveBoundaryValues([node('a', [row('P', 'boundary_condition', '100')])], [])
    expect(namesFor(supplied, 'a')).toEqual(['P'])
    expect(missing.size).toBe(0)
  })

  it('ignores the value when a connected module computes the variable', () => {
    const nodes = [node('src', [row('P', 'variable')]), node('v', [row('P', 'boundary_condition', '100')])]
    const { supplied, missing } = resolveBoundaryValues(nodes, [edge('src', 'v', port(['P']), port(['P']))])
    expect(supplied.size).toBe(0)
    expect(missing.size).toBe(0)
  })

  it('ignores the value when a connected constant already sets it', () => {
    const nodes = [node('c', [row('P', 'constant', '5')]), node('v', [row('P', 'boundary_condition', '100')])]
    const { supplied } = resolveBoundaryValues(nodes, [edge('c', 'v', port(['P']), port(['P']))])
    expect(supplied.size).toBe(0)
  })

  it('sets one member of a group of boundary conditions from the one that has a value', () => {
    const nodes = [
      node('env', [row('Na_o', 'boundary_condition', '140')]),
      node('cell1', [row('Na_o', 'boundary_condition')]),
      node('cell2', [row('Na_o', 'boundary_condition')]),
    ]
    const edges = [
      edge('env', 'cell1', port(['Na_o']), port(['Na_o'])),
      edge('env', 'cell2', port(['Na_o']), port(['Na_o'])),
    ]
    const { supplied, missing } = resolveBoundaryValues(nodes, edges)
    expect(namesFor(supplied, 'env')).toEqual(['Na_o'])
    expect(supplied.has('cell1') || supplied.has('cell2')).toBe(false)
    expect(missing.size).toBe(0)
  })

  it('sets only one member when several give the same value', () => {
    const nodes = [node('a', [row('T', 'boundary_condition', '310')]), node('b', [row('T', 'boundary_condition', '310')])]
    const { supplied, conflicts } = resolveBoundaryValues(nodes, [edge('a', 'b', port(['T']), port(['T']))])
    expect([...supplied.values()].reduce((count, names) => count + names.size, 0)).toBe(1)
    expect(conflicts).toEqual([])
  })

  it('reports a group given different values', () => {
    const nodes = [node('a', [row('T', 'boundary_condition', '310')]), node('b', [row('T', 'boundary_condition', '300')])]
    const { supplied, conflicts } = resolveBoundaryValues(nodes, [edge('a', 'b', port(['T']), port(['T']))])
    expect(supplied.size).toBe(0)
    expect(conflicts).toEqual(['a.T=310, b.T=300'])
  })

  it('reports a group nothing supplies', () => {
    const nodes = [node('a', [row('T', 'boundary_condition')]), node('b', [row('T', 'boundary_condition')])]
    const { missing } = resolveBoundaryValues(nodes, [edge('a', 'b', port(['T']), port(['T']))])
    expect(namesFor(missing, 'a')).toEqual(['T'])
    expect(namesFor(missing, 'b')).toEqual(['T'])
  })

  it('counts a sum result as computed', () => {
    const nodes = [node('hub', [row('total', 'boundary_condition', '1')]), node('leaf', [row('q', 'variable')])]
    const { supplied, missing } = resolveBoundaryValues(nodes, [
      edge('hub', 'leaf', port(['total'], 'Sum'), port(['q'])),
    ])
    expect(supplied.size).toBe(0)
    expect(missing.size).toBe(0)
  })

  it('counts a multiply output as computed', () => {
    const nodes = [node('src', [row('q', 'variable')]), node('dst', [row('q_in', 'boundary_condition', '2')])]
    const { supplied, missing } = resolveBoundaryValues(nodes, [
      edge('src', 'dst', port(['q'], 'Multiply'), port(['q_in'])),
    ])
    expect(supplied.size).toBe(0)
    expect(missing.size).toBe(0)
  })

  it('counts the converted side of an affine unit conversion as computed', () => {
    const nodes = [
      node('a', [row('T', 'variable', '', 'kelvin')]),
      node('b', [row('T_c', 'boundary_condition', '37', 'celsius')]),
    ]
    const { supplied, missing } = resolveBoundaryValues(nodes, [edge('a', 'b', port(['T']), port(['T_c']))])
    expect(supplied.size).toBe(0)
    expect(missing.size).toBe(0)
  })

  it('sums and shares the variables of a per-variable multiport', () => {
    const hubPort = port(['v_sum', 'u'], ['sum', 'True'])
    const nodes = [
      node('hub', [row('v_sum', 'boundary_condition', '3'), row('u', 'variable')], [hubPort]),
      node('leaf', [row('v', 'variable'), row('u', 'boundary_condition')]),
    ]
    const { supplied, missing, emptySums } = resolveBoundaryValues(nodes, [edge('hub', 'leaf', hubPort, port(['v', 'u']))])
    expect(supplied.size).toBe(0)
    expect(missing.size).toBe(0)
    expect(emptySums.size).toBe(0)
  })

  it('does not join a sum to its term', () => {
    const nodes = [node('hub', [row('v_sum', 'boundary_condition')]), node('leaf', [row('v', 'boundary_condition', '2')])]
    const { supplied } = resolveBoundaryValues(nodes, [edge('hub', 'leaf', port(['v_sum'], ['sum']), port(['v']))])
    expect(namesFor(supplied, 'leaf')).toEqual(['v'])
  })

  it('sets a blank Sum variable nothing is connected to to 0, scalar or per variable', () => {
    const nodes = [
      node('a', [row('v_sum', 'boundary_condition'), row('u', 'boundary_condition', '1')], [port(['v_sum', 'u'], ['sum', 'True'])]),
      node('b', [row('total', 'boundary_condition')], [port(['total'], 'Sum')]),
    ]
    const { missing, emptySums } = resolveBoundaryValues(nodes, [])
    expect(missing.size).toBe(0)
    expect(namesFor(emptySums, 'a')).toEqual(['v_sum'])
    expect(namesFor(emptySums, 'b')).toEqual(['total'])
  })

  it('uses the value of a Sum variable nothing is connected to', () => {
    const nodes = [node('a', [row('total', 'boundary_condition', '4')], [port(['total'], 'Sum')])]
    const { supplied, emptySums } = resolveBoundaryValues(nodes, [])
    expect(namesFor(supplied, 'a')).toEqual(['total'])
    expect(emptySums.size).toBe(0)
  })

  it('leaves a Sum variable nothing is connected to alone when another coupling supplies it', () => {
    const nodes = [
      node('a', [row('s', 'boundary_condition')], [port(['s'], 'Sum'), port(['s'])]),
      node('b', [row('p', 'boundary_condition', '5')]),
    ]
    const { supplied, emptySums } = resolveBoundaryValues(nodes, [edge('a', 'b', port(['s']), port(['p']))])
    expect(namesFor(supplied, 'b')).toEqual(['p'])
    expect(emptySums.size).toBe(0)
  })

  it('names the instance whose port has a malformed per-variable multiport', () => {
    const nodes = [node('a', [row('s', 'boundary_condition', '1')], [port(['s', 't'], ['sum'])])]
    expect(() => resolveBoundaryValues(nodes, [])).toThrow('"a" port "p": Port "p" has 1 multiport entries for 2 variables.')
  })

  it('counts the neighbour of a multiply on the target side as computed', () => {
    const nodes = [node('src', [row('q_in', 'boundary_condition', '2')]), node('dst', [row('q', 'variable')])]
    const { supplied, missing } = resolveBoundaryValues(nodes, [
      edge('src', 'dst', port(['q_in']), port(['q'], ['multiply'])),
    ])
    expect(supplied.size).toBe(0)
    expect(missing.size).toBe(0)
  })

  it('counts a sum fed by a multiply as computed', () => {
    const nodes = [node('src', [row('q', 'variable')]), node('hub', [row('total', 'boundary_condition')])]
    const { missing } = resolveBoundaryValues(nodes, [edge('src', 'hub', port(['q'], 'Multiply'), port(['total'], 'Sum'))])
    expect(missing.size).toBe(0)
  })
})
