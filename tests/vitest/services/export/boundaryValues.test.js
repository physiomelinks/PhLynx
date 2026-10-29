import { describe, expect, it } from 'vitest'

import { resolveBoundaryValues } from '../../../../src/services/export/boundaryValues.js'
import { previewCouplings } from '../../../../src/utils/edges.js'

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
    const { supplied, missing, bcOnly } = resolveBoundaryValues([node('a', [row('P', 'boundary_condition', '100')])], [])
    expect(namesFor(supplied, 'a')).toEqual(['P'])
    expect(missing.size).toBe(0)
    expect(bcOnly).toEqual([])
  })

  it('ignores the value when a connected module computes the variable', () => {
    const nodes = [node('src', [row('P', 'variable')]), node('v', [row('P', 'boundary_condition', '100')])]
    const { supplied, missing, ignored } = resolveBoundaryValues(nodes, [edge('src', 'v', port(['P']), port(['P']))])
    expect(supplied.size).toBe(0)
    expect(missing.size).toBe(0)
    expect(namesFor(ignored, 'v')).toEqual(['P'])
  })

  it('ignores the value when a connected constant already sets it', () => {
    const nodes = [node('c', [row('P', 'constant', '5')]), node('v', [row('P', 'boundary_condition', '100')])]
    const { supplied, ignored } = resolveBoundaryValues(nodes, [edge('c', 'v', port(['P']), port(['P']))])
    expect(supplied.size).toBe(0)
    expect(namesFor(ignored, 'v')).toEqual(['P'])
    expect(ignored.has('c')).toBe(false)
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
    const { supplied, missing, bcOnly } = resolveBoundaryValues(nodes, edges)
    expect(namesFor(supplied, 'env')).toEqual(['Na_o'])
    expect(supplied.has('cell1') || supplied.has('cell2')).toBe(false)
    expect(missing.size).toBe(0)
    // Export rejects such a group; a scope that cuts one off falls back to the value.
    expect(bcOnly).toEqual([
      { keys: ['env::Na_o', 'cell1::Na_o', 'cell2::Na_o'], label: 'env.Na_o, cell1.Na_o, cell2.Na_o' },
    ])
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

  it('sets a Sum variable nothing is connected to to 0, ignoring its value', () => {
    const nodes = [node('a', [row('total', 'boundary_condition', '4')], [port(['total'], 'Sum')])]
    const { supplied, emptySums, ignored } = resolveBoundaryValues(nodes, [])
    expect(supplied.size).toBe(0)
    expect(namesFor(emptySums, 'a')).toEqual(['total'])
    expect(namesFor(ignored, 'a')).toEqual(['total'])
  })

  it('sets a Sum variable nothing is connected to to 0 when another coupling would supply it', () => {
    // As circulatory_autogen: a sum with no terms is 0, so it supplies what it is coupled to.
    const nodes = [
      node('a', [row('s', 'boundary_condition')], [port(['s'], 'Sum'), port(['s'])]),
      node('b', [row('p', 'boundary_condition', '5')]),
    ]
    const { supplied, emptySums, ignored } = resolveBoundaryValues(nodes, [edge('a', 'b', port(['s']), port(['p']))])
    expect(supplied.size).toBe(0)
    expect(namesFor(emptySums, 'a')).toEqual(['s'])
    expect(namesFor(ignored, 'b')).toEqual(['p'])
  })

  it('leaves a computed Sum variable nothing is connected to to its own math', () => {
    const nodes = [node('a', [row('total', 'variable')], [port(['total'], 'Sum')])]
    const { emptySums, ignored } = resolveBoundaryValues(nodes, [])
    expect(emptySums.size).toBe(0)
    expect(ignored.size).toBe(0)
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

  describe('values a connection supplies instead', () => {
    it('ignores a constant coupled to a computed variable', () => {
      const nodes = [node('vol', [row('C', 'variable')]), node('face', [row('C_up', 'constant', '0.06')])]
      const { ignored } = resolveBoundaryValues(nodes, [edge('vol', 'face', port(['C']), port(['C_up']))])
      expect(namesFor(ignored, 'face')).toEqual(['C_up'])
    })

    it('ignores a global constant coupled to a computed variable', () => {
      const nodes = [node('src', [row('P', 'variable')]), node('v', [row('P', 'global_constant')])]
      const { ignored } = resolveBoundaryValues(nodes, [edge('src', 'v', port(['P']), port(['P']))])
      expect(namesFor(ignored, 'v')).toEqual(['P'])
    })

    it('ignores a constant on a connected Sum variable', () => {
      const nodes = [node('hub', [row('total', 'constant', '1')]), node('leaf', [row('q', 'variable')])]
      const { ignored } = resolveBoundaryValues(nodes, [edge('hub', 'leaf', port(['total'], 'Sum'), port(['q']))])
      expect(namesFor(ignored, 'hub')).toEqual(['total'])
    })

    it('ignores a constant fed by a Multiply on either end, or by a per-variable one', () => {
      const source = [node('src', [row('q', 'variable')]), node('dst', [row('q_in', 'constant', '2')])]
      expect(namesFor(resolveBoundaryValues(source, [edge('src', 'dst', port(['q'], 'Multiply'), port(['q_in']))]).ignored, 'dst')).toEqual(['q_in'])

      const target = [node('src', [row('q_in', 'constant', '2')]), node('dst', [row('q', 'variable')])]
      expect(namesFor(resolveBoundaryValues(target, [edge('src', 'dst', port(['q_in']), port(['q'], ['multiply']))]).ignored, 'src')).toEqual(['q_in'])

      const perVariable = [node('src', [row('q', 'variable'), row('u', 'variable')]), node('dst', [row('q_in', 'constant', '2'), row('u', 'boundary_condition')])]
      const { ignored } = resolveBoundaryValues(perVariable, [
        edge('src', 'dst', port(['q', 'u'], ['multiply', 'True']), port(['q_in', 'u'])),
      ])
      expect(namesFor(ignored, 'dst')).toEqual(['q_in'])
    })

    it('leaves a constant nothing else supplies, and a blank boundary condition, alone', () => {
      const nodes = [node('a', [row('k', 'constant', '3')]), node('b', [row('P', 'variable')]), node('c', [row('P', 'boundary_condition')])]
      const { ignored } = resolveBoundaryValues(nodes, [edge('b', 'c', port(['P']), port(['P']))])
      expect(ignored.size).toBe(0)
    })
  })

  describe('boundary conditions coupled only to each other', () => {
    it('reports the group, whatever values its members have', () => {
      const blank = [node('a', [row('T', 'boundary_condition')]), node('b', [row('T', 'boundary_condition')])]
      expect(resolveBoundaryValues(blank, [edge('a', 'b', port(['T']), port(['T']))]).bcOnly).toEqual([
        { keys: ['a::T', 'b::T'], label: 'a.T, b.T' },
      ])
      const valued = [node('a', [row('T', 'boundary_condition', '310')]), node('b', [row('T', 'boundary_condition', '310')])]
      expect(resolveBoundaryValues(valued, [edge('a', 'b', port(['T']), port(['T']))]).bcOnly).toHaveLength(1)
    })

    it('does not report a group something computes or a constant sets', () => {
      const nodes = [
        node('a', [row('T', 'boundary_condition')]),
        node('b', [row('T', 'boundary_condition')]),
        node('c', [row('T', 'constant', '300')]),
      ]
      const edges = [edge('a', 'b', port(['T']), port(['T'])), edge('b', 'c', port(['T']), port(['T']))]
      expect(resolveBoundaryValues(nodes, edges).bcOnly).toEqual([])
    })
  })

  describe('variables set more than once', () => {
    const state = (name) => ({ ...row(name, 'variable'), stateRole: 'state' })
    const messages = (nodes, edges) => resolveBoundaryValues(nodes, edges).overdetermined.map(({ message }) => message)

    it.each([
      ['a state and an algebraic variable', state('V'), row('V', 'variable')],
      ['two states', state('V'), state('V')],
      ['two algebraic variables', row('V', 'variable'), row('V', 'variable')],
    ])('reports %s', (_, somaRow, axonRow) => {
      const nodes = [node('soma', [somaRow]), node('axon', [axonRow])]
      const result = resolveBoundaryValues(nodes, [edge('soma', 'axon', port(['V']), port(['V']))])
      expect(result.overdetermined).toEqual([
        { keys: ['soma::V', 'axon::V'], message: 'soma.V and axon.V are both computed; only one module can set a connected variable.' },
      ])
      expect(result.status.get('soma').get('V')).toEqual({ state: 'overdetermined', from: ['axon.V'] })
    })

    it('names every computed variable in a larger group, and still ignores its constants', () => {
      const nodes = [node('a', [row('x', 'variable')]), node('b', [row('x', 'variable')]), node('c', [row('x', 'variable')]), node('d', [row('x', 'constant', '1')])]
      const edges = [edge('a', 'b', port(['x']), port(['x'])), edge('b', 'c', port(['x']), port(['x'])), edge('c', 'd', port(['x']), port(['x']))]
      const { overdetermined, ignored } = resolveBoundaryValues(nodes, edges)
      expect(overdetermined.map(({ message }) => message)).toEqual([
        'a.x, b.x and c.x are all computed; only one module can set a connected variable.',
      ])
      expect(overdetermined[0].keys).toEqual(expect.arrayContaining(['d::x']))
      expect(namesFor(ignored, 'd')).toEqual(['x'])
    })

    it('reports a variable coupled to a sum, a multiply output or a unit conversion', () => {
      const hub = node('hub', [row('total', 'boundary_condition')], [port(['total'], 'Sum')])
      const summed = [hub, node('leaf', [row('q', 'variable')]), node('other', [row('total', 'variable')])]
      expect(
        messages(summed, [edge('hub', 'leaf', port(['total'], 'Sum'), port(['q'])), edge('hub', 'other', port(['total']), port(['total']))])
      ).toEqual(['hub.total (the sum of leaf.q) and other.total are both computed; only one module can set a connected variable.'])

      const scaled = [node('src', [row('q', 'variable')]), node('dst', [row('q_in', 'variable')])]
      expect(messages(scaled, [edge('src', 'dst', port(['q'], 'Multiply'), port(['q_in']))])).toEqual([
        'dst.q_in (its own math and scaled from src.q) is computed twice; only one module can set a connected variable.',
      ])

      const converted = [node('a', [row('T', 'variable', '', 'kelvin')]), node('b', [row('T_c', 'variable', '', 'celsius')])]
      expect(messages(converted, [edge('a', 'b', port(['T']), port(['T_c']))])).toEqual([
        'b.T_c (its own math and converted from a.T) is computed twice; only one module can set a connected variable.',
      ])
    })

    it('reports a boundary condition two Multiply outputs both set', () => {
      const nodes = [node('a', [row('q', 'variable')]), node('b', [row('q', 'variable')]), node('dst', [row('q_in', 'boundary_condition')])]
      const edges = ['a', 'b'].map((src) => edge(src, 'dst', port(['q'], 'Multiply'), port(['q_in'])))
      expect(messages(nodes, edges)).toEqual([
        'dst.q_in (scaled from a.q, b.q) is computed twice; only one module can set a connected variable.',
      ])
    })

    it('reports a computed variable a connected Sum port also sums into', () => {
      const nodes = [node('hub', [row('total', 'variable')], [port(['total'], 'Sum')]), node('leaf', [row('q', 'variable')])]
      expect(messages(nodes, [edge('hub', 'leaf', port(['total'], 'Sum'), port(['q']))])).toEqual([
        'hub.total (its own math and the sum of leaf.q) is computed twice; only one module can set a connected variable.',
      ])
    })

    it('reports a computed variable coupled to a Sum variable nothing sums into, which is 0', () => {
      const nodes = [node('hub', [row('s', 'boundary_condition')], [port(['s'], 'Sum'), port(['s'])]), node('leaf', [row('q', 'variable')])]
      expect(messages(nodes, [edge('hub', 'leaf', port(['s']), port(['q']))])).toEqual([
        'hub.s (a sum with nothing connected, so 0) and leaf.q are both computed; only one module can set a connected variable.',
      ])
    })

    it('reports constants given different values, naming each', () => {
      const nodes = [node('a', [row('k', 'constant', '1')]), node('b', [row('k', 'constant', '2')])]
      const result = resolveBoundaryValues(nodes, [edge('a', 'b', port(['k']), port(['k']))])
      expect(result.overdetermined.map(({ message }) => message)).toEqual([
        'a.k=1 and b.k=2 are connected but set to different values; give them one value, or let one module compute it.',
      ])
      expect(result.status.get('b').get('k')).toEqual({ state: 'overdetermined', from: ['a.k'] })
      expect(result.ignored.size).toBe(0)
    })

    it('reports a constant coupled to a global constant, or to another one', () => {
      const mixed = [node('a', [row('T', 'constant', '310')]), node('b', [row('T', 'global_constant')])]
      expect(messages(mixed, [edge('a', 'b', port(['T']), port(['T']))])).toEqual([
        'a.T=310 and b.T (global) are connected but set to different values; give them one value, or let one module compute it.',
      ])
      const globals = [node('a', [row('R', 'global_constant')]), node('b', [row('R_gas', 'global_constant')])]
      expect(messages(globals, [edge('a', 'b', port(['R']), port(['R_gas']))])).toHaveLength(1)
    })

    it('sets a group once from constants that agree, as it does from boundary conditions', () => {
      const nodes = [node('a', [row('k', 'constant', '2')]), node('b', [row('k', 'constant', ' 2 ')]), node('c', [row('k', 'boundary_condition')])]
      const edges = [edge('a', 'b', port(['k']), port(['k'])), edge('b', 'c', port(['k']), port(['k']))]
      const { overdetermined, ignored, status } = resolveBoundaryValues(nodes, edges)
      expect(overdetermined).toEqual([])
      expect(namesFor(ignored, 'b')).toEqual(['k'])
      expect(ignored.has('a')).toBe(false)
      expect(status.get('b').get('k')).toEqual({ state: 'connected', from: ['a.k'] })
      expect(status.get('c').get('k')).toEqual({ state: 'connected', from: ['a.k'] })

      const globals = [node('a', [row('R', 'global_constant')]), node('b', [row('R', 'global_constant')])]
      expect(resolveBoundaryValues(globals, [edge('a', 'b', port(['R']), port(['R']))]).overdetermined).toEqual([])
    })

    describe('leaves valid groups alone', () => {
      it('one computed variable with constants and boundary conditions', () => {
        const nodes = [node('a', [state('V')]), node('b', [row('V', 'constant', '1')]), node('c', [row('V', 'boundary_condition', '2')])]
        const edges = [edge('a', 'b', port(['V']), port(['V'])), edge('a', 'c', port(['V']), port(['V']))]
        expect(resolveBoundaryValues(nodes, edges).overdetermined).toEqual([])
      })

      it('a sum of several computed terms feeding one boundary condition', () => {
        const hubPort = port(['total'], 'Sum')
        const nodes = [
          node('hub', [row('total', 'boundary_condition')], [hubPort]),
          node('l1', [row('q', 'variable')]),
          node('l2', [row('q', 'variable')]),
          node('tank', [row('v_in', 'boundary_condition')]),
        ]
        const edges = [
          edge('hub', 'l1', hubPort, port(['q'])),
          edge('hub', 'l2', hubPort, port(['q'])),
          edge('hub', 'tank', port(['total']), port(['v_in'])),
        ]
        expect(resolveBoundaryValues(nodes, edges).overdetermined).toEqual([])
      })

      it('a saved variable row its math only reads, or uses as the VoI', () => {
        // As an older workspace's SN_axon.V_in: typed `variable`, though its math only reads it.
        const withMath = (id, rows, mathRef) => ({ ...node(id, rows), data: { ...node(id, rows).data, mathRef } })
        const analyses = { soma: { stateVariables: ['V'], assigned: [] }, axon: { stateVariables: ['V'], assigned: ['I'] } }
        const nodes = [withMath('soma', [state('V'), row('t', 'variable')], 'soma'), withMath('axon', [row('V_in', 'variable'), row('t', 'variable')], 'axon')]
        const edges = [edge('soma', 'axon', port(['V', 't']), port(['V_in', 't']))]
        expect(resolveBoundaryValues(nodes, edges, (mathRef) => analyses[mathRef]).overdetermined).toEqual([])
        // Math it can't analyse falls back to the rows' types.
        expect(resolveBoundaryValues(nodes, edges, () => null).overdetermined).toHaveLength(2)
      })

      it('a Multiply term feeding a Sum', () => {
        const hubPort = port(['total'], 'Sum')
        const nodes = [node('hub', [row('total', 'boundary_condition')], [hubPort]), node('leaf', [row('q', 'variable')])]
        expect(resolveBoundaryValues(nodes, [edge('hub', 'leaf', hubPort, port(['q'], 'Multiply'))]).overdetermined).toEqual([])
      })

      it('a per-variable multiport that sums one variable and shares another', () => {
        const hubPort = port(['v_sum', 'u'], ['sum', 'True'])
        const nodes = [
          node('hub', [row('v_sum', 'boundary_condition'), row('u', 'variable')], [hubPort]),
          node('l1', [row('v', 'variable'), row('u', 'boundary_condition')]),
          node('l2', [row('v', 'variable'), row('u', 'boundary_condition')]),
        ]
        const edges = ['l1', 'l2'].map((leaf) => edge('hub', leaf, hubPort, port(['v', 'u'])))
        expect(resolveBoundaryValues(nodes, edges).overdetermined).toEqual([])
      })

      it('a pair summed on both ends, which the export rejects itself', () => {
        const nodes = [node('a', [row('v', 'variable')]), node('b', [row('v', 'variable')])]
        expect(resolveBoundaryValues(nodes, [edge('a', 'b', port(['v'], 'Sum'), port(['v'], 'Sum'))]).overdetermined).toEqual([])
      })
    })
  })

  describe('status', () => {
    const statusOf = (nodes, edges, nodeId, name) => resolveBoundaryValues(nodes, edges).status.get(nodeId)?.get(name)

    it('names the computed variable a boundary condition takes its value from, and shares the computed one', () => {
      const nodes = [node('src', [row('P', 'variable')]), node('v', [row('P', 'boundary_condition', '100')])]
      const edges = [edge('src', 'v', port(['P']), port(['P']))]
      expect(statusOf(nodes, edges, 'v', 'P')).toEqual({ state: 'connected', from: ['src.P'] })
      expect(statusOf(nodes, edges, 'src', 'P')).toEqual({ state: 'shares', from: ['v.P'] })
    })

    it('names the constant that sets a boundary condition', () => {
      const nodes = [node('c', [row('P', 'constant', '5')]), node('v', [row('P', 'boundary_condition')])]
      const edges = [edge('c', 'v', port(['P']), port(['P']))]
      expect(statusOf(nodes, edges, 'v', 'P')).toEqual({ state: 'connected', from: ['c.P'] })
      expect(statusOf(nodes, edges, 'c', 'P')).toEqual({ state: 'shares', from: ['v.P'] })
    })

    it('names what a generated component computes a variable from', () => {
      const nodes = [node('src', [row('q', 'variable')]), node('dst', [row('q_in', 'boundary_condition')])]
      const edges = [edge('src', 'dst', port(['q'], 'Multiply'), port(['q_in']))]
      expect(statusOf(nodes, edges, 'dst', 'q_in')).toEqual({ state: 'connected', from: ['src.q'] })
    })

    it('marks a lone boundary condition own with a value and missing without one', () => {
      expect(statusOf([node('a', [row('P', 'boundary_condition', '1')])], [], 'a', 'P')).toEqual({ state: 'own', from: [] })
      expect(statusOf([node('a', [row('P', 'boundary_condition')])], [], 'a', 'P')).toEqual({ state: 'missing', from: [] })
    })

    it('marks boundary conditions coupled only to each other, and those given different values', () => {
      const nodes = [node('a', [row('T', 'boundary_condition', '310')]), node('b', [row('T', 'boundary_condition')])]
      const edges = [edge('a', 'b', port(['T']), port(['T']))]
      expect(statusOf(nodes, edges, 'b', 'T')).toEqual({ state: 'bcOnly', from: ['a.T'] })

      const clashing = [node('a', [row('T', 'boundary_condition', '310')]), node('b', [row('T', 'boundary_condition', '300')])]
      expect(statusOf(clashing, edges, 'a', 'T')).toEqual({ state: 'conflict', from: ['b.T'] })
    })

    it('gives an uncoupled constant or computed variable, and an empty sum, no status', () => {
      const nodes = [node('a', [row('k', 'constant', '1'), row('x', 'variable'), row('s', 'boundary_condition')], [port(['s'], 'Sum')])]
      expect(resolveBoundaryValues(nodes, []).status.size).toBe(0)
    })

    // The SN simple chain: soma_SN's voltage feeds axon_SN, whose own voltage feeds var_SN's boundary condition.
    describe('on a soma, axon and varicosity chain', () => {
      const VARICOSITY = 'dndnode_2'
      const vi = (portType, variables) => ({ portType, label: 'VI_port', variables, multiportType: 'None' })
      const voltage = (portType) => ({ portType, label: 'membrane_voltage', variables: ['V'], multiportType: 'None' })
      const chainNode = (id, name, variables, ports) => ({ id, data: { name, variables, ports } })
      const chainEdge = (source, target, sourcePort, targetPort) => ({
        id: `${source}--${target}`,
        source,
        target,
        data: { couplings: [{ sourcePort, targetPort }] },
      })
      const loadFlow = () => ({
        nodes: [
          chainNode('dndnode_0', 'soma_SN', [row('V', 'variable', '', 'mV'), row('I_out', 'variable', '', 'nA')], [vi('exit_ports', ['V', 'I_out'])]),
          chainNode(
            'dndnode_1',
            'axon_SN',
            [row('V_in', 'variable', '', 'mV'), row('I', 'variable', '', 'nA'), row('V', 'variable', '', 'mV')],
            [vi('entrance_ports', ['V_in', 'I']), voltage('exit_ports')]
          ),
          chainNode(VARICOSITY, 'var_SN', [row('V', 'boundary_condition', '', 'mV')], [voltage('entrance_ports')]),
        ],
        edges: [
          chainEdge('dndnode_0', 'dndnode_1', vi('exit_ports', ['V', 'I_out']), vi('entrance_ports', ['V_in', 'I'])),
          chainEdge('dndnode_1', VARICOSITY, voltage('exit_ports'), voltage('entrance_ports')),
        ],
      })

      /** Drops var_SN's membrane voltage port and recouples its edges, as the instance editor previews it. */
      function withoutVoltagePort({ nodes, edges }) {
        const varicosity = nodes.find((candidate) => candidate.id === VARICOSITY)
        const ports = varicosity.data.ports.filter((candidate) => candidate.label !== 'membrane_voltage')
        varicosity.data.ports = ports
        const couplings = previewCouplings(VARICOSITY, ports, nodes, edges)
        return edges.map((candidate) =>
          couplings.has(candidate.id) ? { ...candidate, data: { ...candidate.data, couplings: couplings.get(candidate.id) } } : candidate
        )
      }

      it('takes var_SN.V from axon_SN.V', () => {
        const { nodes, edges } = loadFlow()
        expect(statusOf(nodes, edges, VARICOSITY, 'V')).toEqual({ state: 'connected', from: ['axon_SN.V'] })
        expect(statusOf(nodes, edges, 'dndnode_1', 'V')).toEqual({ state: 'shares', from: ['var_SN.V'] })
      })

      it('marks var_SN.V missing once its port is deleted, and own once given a value', () => {
        const flow = loadFlow()
        const edges = withoutVoltagePort(flow)
        expect(statusOf(flow.nodes, edges, VARICOSITY, 'V')).toEqual({ state: 'missing', from: [] })

        flow.nodes.find((candidate) => candidate.id === VARICOSITY).data.variables.find((variable) => variable.name === 'V').value = '-60'
        expect(statusOf(flow.nodes, edges, VARICOSITY, 'V')).toEqual({ state: 'own', from: [] })
      })
    })
  })
})

describe('resolveBoundaryValues with a driven CellDL store', () => {
  const store = (id, mathRef = 'celldl') => ({
    id,
    data: {
      name: id,
      mathRef,
      variables: [
        { name: 'q', type: 'variable', stateRole: 'state', initialiser: 'q_init', units: 'mM' },
        row('q_init', 'constant', '1'),
      ],
    },
  })
  const source = (id) => node(id, [row('X', 'variable')])
  const drive = (from, to, drivesState = true) => ({
    id: `${from}-${to}`,
    source: from,
    target: to,
    data: { couplings: [{ sourcePort: port(['X']), targetPort: port(['q']), ...(drivesState && { drivesState }) }] },
  })
  const options = { isCelldlMath: (mathRef) => mathRef === 'celldl' }

  it('lets a marked coupling drive the store, ignoring its initial value', () => {
    const result = resolveBoundaryValues([source('src'), store('s')], [drive('src', 's')], null, options)
    expect(result.overdetermined).toEqual([])
    expect([...result.driven.get('s')]).toEqual([['q', { initialiser: 'q_init', from: ['src.X'] }]])
    expect(result.status.get('s').get('q_init')).toEqual({ state: 'drivenInitial', from: ['src.X'] })
    expect(namesFor(result.ignored, 's')).toEqual(['q_init'])
  })

  it('still rejects the store set twice without the mark, offering to drive it', () => {
    const result = resolveBoundaryValues([source('src'), store('s')], [drive('src', 's', false)], null, options)
    expect(result.driven.size).toBe(0)
    expect(result.overdetermined[0].message).toMatch(/Confirming the connection can let it drive the store s\.q/)
    expect(result.drivable.map(({ key }) => key)).toEqual(['s::q'])
  })

  it('still rejects a group two other modules compute, marked or not', () => {
    const nodes = [source('a'), source('b'), store('s')]
    const edges = [drive('a', 's'), { ...drive('b', 's', false), id: 'b-s' }]
    const result = resolveBoundaryValues(nodes, edges, null, options)
    expect(result.overdetermined).toHaveLength(1)
    expect(result.overdetermined[0].message).not.toMatch(/Confirming/)
  })

  it('leaves other instances of the same math to their own equation', () => {
    const result = resolveBoundaryValues([source('src'), store('s'), store('other')], [drive('src', 's')], null, options)
    expect([...result.driven.keys()]).toEqual(['s'])
    expect(result.status.get('other')?.get('q_init')).toBeUndefined()
  })

  it('ignores the mark on a state of math not drawn in CellDL', () => {
    const result = resolveBoundaryValues([source('src'), store('s', 'cellml')], [drive('src', 's')], null, options)
    expect(result.driven.size).toBe(0)
    expect(result.overdetermined).toHaveLength(1)
  })
})
