import { describe, expect, it } from 'vitest'

import { caMultiPort, simulateCaPairing, simulateImportPairing } from '../../../../src/services/export/caSimulate.js'
import { node, port } from '../../fixtures/ca/workspace.js'

/**
 * Makes a module array: rows in order, each edge `source>target`, out_instances and inp_instances in edge order.
 *
 * @param {Array} nodes - In row order.
 * @param {Array<string>} links - `source>target`.
 * @returns {Object} The array, for the simulators.
 */
function array(nodes, links) {
  const edges = links.map((link) => {
    const [source, target] = link.split('>')
    return { id: link, source, target }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return {
    rows: nodes,
    outEdges: new Map(nodes.map((n) => [n.id, edges.filter((edge) => edge.source === n.id)])),
    inpEdges: new Map(nodes.map((n) => [n.id, edges.filter((edge) => edge.target === n.id)])),
    portsOf: (id) => byId.get(id).data.ports,
  }
}

/** Lists a simulation's pairs as `source>target:sourcePort>targetPort`, with a rule when one wires them. */
const pairsOf = ({ pairs }) => pairs.map(({ edge, source, target, rule }) => `${edge.id}:${source}>${target}${rule ? ` (${rule})` : ''}`)
const errorsOf = ({ errors }) => errors.map(({ edge, kind }) => `${edge.id}:${kind}`)
const vessel = (portType, variables = ['v'], multiportType = 'None') => port(portType, 'vessel_port', variables, multiportType)

describe('simulateCaPairing', () => {
  it("merges a source's exit and general ports of one label, exit first", () => {
    const x = node('x', [vessel('general_ports', ['g']), vessel('exit_ports', ['e'])])
    const y = node('y', [vessel('entrance_ports')])
    expect(pairsOf(simulateCaPairing(array([x, y], ['x>y'])))).toEqual(['x>y:1>0'])
  })

  it('pairs every free source slot of a label other than vessel_port with the one first free target slot', () => {
    const x = node('x', [port('exit_ports', 'flow_port', ['a']), port('general_ports', 'flow_port', ['b'])])
    const y = node('y', [port('entrance_ports', 'flow_port', ['c']), port('entrance_ports', 'flow_port', ['d'])])
    expect(pairsOf(simulateCaPairing(array([x, y], ['x>y'])))).toEqual(['x>y:0>0', 'x>y:1>0'])
  })

  it('pairs one vessel_port slot per connection, and takes a source slot for its row only', () => {
    const x = node('x', [vessel('exit_ports', ['a']), vessel('exit_ports', ['b'])])
    const [y, z] = [node('y', [vessel('entrance_ports'), vessel('entrance_ports')]), node('z', [vessel('entrance_ports')])]
    const w = node('w', [vessel('exit_ports')])
    expect(pairsOf(simulateCaPairing(array([x, w, y, z], ['x>y', 'x>z', 'w>y'])))).toEqual(['x>y:0>0', 'x>z:1>0', 'w>y:0>1'])
  })

  it('never takes a multiport slot', () => {
    const x = node('x', [vessel('exit_ports', ['a'], 'True')])
    const [y, z] = [node('y', [vessel('entrance_ports')]), node('z', [vessel('entrance_ports')])]
    expect(pairsOf(simulateCaPairing(array([x, y, z], ['x>y', 'x>z'])))).toEqual(['x>y:0>0', 'x>z:0>0'])
  })

  it("never targets an exit port, nor sources from an entrance port", () => {
    const x = node('x', [port('entrance_ports', 'link', ['a'])])
    const y = node('y', [port('exit_ports', 'link', ['b']), port('general_ports', 'other', ['c'])])
    const result = simulateCaPairing(array([x, y], ['x>y']))
    expect(pairsOf(result)).toEqual([])
    expect(errorsOf(result)).toEqual([])
  })

  it("gives a heart's inputs the entrance slots of their place in its inputs, one later with two inputs", () => {
    const heart = node('heart', [vessel('entrance_ports', ['i']), vessel('entrance_ports', ['s']), vessel('entrance_ports', ['p']), vessel('exit_ports', ['a']), vessel('exit_ports', ['b'])], 'heart:vp')
    const feeder = (id) => node(id, [vessel('exit_ports')])
    const out = (id) => node(id, [vessel('entrance_ports')])
    const [svc, pvn, ivc, aorta, par] = [feeder('venous_svc'), feeder('pvn'), feeder('venous_ivc'), out('aorta'), out('par')]
    const outs = ['heart>aorta', 'heart>par']

    const two = simulateCaPairing(array([pvn, svc, heart, aorta, par], ['venous_svc>heart', 'pvn>heart', ...outs]))
    expect(pairsOf(two).filter((pair) => pair.includes('>heart'))).toEqual(['pvn>heart:0>2', 'venous_svc>heart:0>1'])
    const three = simulateCaPairing(array([pvn, svc, ivc, heart, aorta, par], ['venous_ivc>heart', 'venous_svc>heart', 'pvn>heart', ...outs]))
    expect(pairsOf(three).filter((pair) => pair.includes('>heart'))).toEqual(['pvn>heart:0>2', 'venous_svc>heart:0>1', 'venous_ivc>heart:0>0'])
  })

  it('stops wherever connected modules share a label the target has no free slot of, needed or not', () => {
    const z = node('z', [port('exit_ports', 'ctrl', ['c'])])
    const x = node('x', [vessel('exit_ports'), port('exit_ports', 'ctrl', ['d'])])
    const y = node('y', [vessel('entrance_ports'), port('entrance_ports', 'ctrl', ['e'])])
    expect(errorsOf(simulateCaPairing(array([z, x, y], ['z>y', 'x>y'])))).toEqual(['x>y:targetFull'])
  })

  it('stops on a vessel_port with no free source slot left in its row', () => {
    const x = node('x', [vessel('exit_ports')])
    const [y, z] = [node('y', [vessel('entrance_ports')]), node('z', [vessel('entrance_ports')])]
    expect(errorsOf(simulateCaPairing(array([x, y, z], ['x>y', 'x>z'])))).toEqual(['x>z:sourceFull'])
  })

  it('stops on a source with exit and general ports that shares no label with its target', () => {
    const x = node('x', [port('exit_ports', 'a'), port('general_ports', 'b')])
    const y = node('y', [port('entrance_ports', 'c')])
    expect(errorsOf(simulateCaPairing(array([x, y], ['x>y'])))).toEqual(['x>y:noMatchingPort'])
  })

  it('leaves a vessel_port slot next to a Min_ junction True port untaken, and its pairs to the junction rule', () => {
    const r = node('r', [vessel('exit_ports')])
    const junction = node('j', [vessel('entrance_ports', ['v_in_sum', 'u'], 'True'), vessel('exit_ports', ['v', 'u'])], 'Min_junction:vp')
    const z = node('z', [vessel('entrance_ports')])
    const result = simulateCaPairing(array([r, junction, z], ['r>j', 'r>z']))
    expect(pairsOf(result)).toEqual(['r>j:0>0 (junction)', 'r>z:0>0 (junction)'])
    expect(errorsOf(result)).toEqual([])
  })

  it("leaves a terminal's vessel_port to the terminal rule and a volume_port Sum to the volume sum", () => {
    const terminal = node('t', [vessel('exit_ports', ['v_T', 'u_out']), port('exit_ports', 'volume_port', ['q'])], 'terminal:pp')
    const venous = node('v', [vessel('entrance_ports', ['v_in', 'u'])], 'venous:vp')
    const sum = node('s', [port('entrance_ports', 'volume_port', ['q_total'], 'Sum')], 'volume_sum:nn')
    const result = simulateCaPairing(array([terminal, venous, sum], ['t>v', 't>s']))
    expect(pairsOf(result)).toEqual(['t>v:0>0 (terminal)', 't>s:1>0 (volume)'])
    expect([...result.ruled].map(([edge, labels]) => `${edge.id}:${[...labels]}`)).toEqual(['t>v:vessel_port', 't>s:volume_port'])
  })

  it("maps nothing from a terminal's vessel_port into a vessel that takes pressure at its inlet, as CA's terminal rule skips it", () => {
    const terminal = node('t', [vessel('exit_ports', ['v_T', 'u_out'])], 'terminal:pp')
    const artery = node('a', [vessel('entrance_ports', ['v', 'u_in'])], 'arterial_simple:pv')
    const result = simulateCaPairing(array([terminal, artery], ['t>a']))
    expect(pairsOf(result)).toEqual([])
    expect(result.ruled.size).toBe(0)
  })

  it('fails where the source port has more variables, and a list multiport of unequal number', () => {
    const [a, b] = [node('a', [vessel('exit_ports', ['v', 'u'])]), node('b', [vessel('entrance_ports', ['v_in'])])]
    expect(errorsOf(simulateCaPairing(array([a, b], ['a>b'])))).toEqual(['a>b:indexError'])
    const [e, f] = [node('e', [vessel('exit_ports', ['v'])]), node('f', [vessel('entrance_ports', ['v_in', 'u'], ['sum', 'True'])])]
    expect(errorsOf(simulateCaPairing(array([e, f], ['e>f'])))).toEqual(['e>f:listCount'])
  })

  it('misaligns a pair whose source has fewer variables only when CA maps another pair of that connection after it', () => {
    const flow = (portType, name) => port(portType, 'flow_port', [name])
    const [c, d] = [node('c', [vessel('exit_ports', ['v']), flow('exit_ports', 'f')]), node('d', [vessel('entrance_ports', ['v_in', 'u']), flow('entrance_ports', 'g')])]
    expect(simulateCaPairing(array([c, d], ['c>d'])).errors).toEqual([expect.objectContaining({ kind: 'misaligned', label: 'vessel_port', source: 0 })])
    // Last on its connection, as after a vessel_port pair: nothing follows to shift.
    const [x, y] = [node('x', [vessel('exit_ports', ['v']), flow('exit_ports', 'f')]), node('y', [vessel('entrance_ports', ['v_in']), port('entrance_ports', 'flow_port', ['g', 'h'])])]
    expect(errorsOf(simulateCaPairing(array([x, y], ['x>y'])))).toEqual([])
  })

  it("gives the variables CA's terminal rule maps by name: pressure into a venous module, flow into a vessel taking flow at its inlet", () => {
    const targets = [
      node('v', [vessel('entrance_ports', ['v_in', 'u'])], 'venous:vp'),
      node('a', [vessel('entrance_ports', ['v_in', 'u'])], 'arterial_simple:vp'),
      node('p', [vessel('entrance_ports', ['v_in', 'u'])], 'venous:pp'),
      node('s', [vessel('entrance_ports', ['v_in', 'u'], ['sum', 'True'])], 'venous:vp'),
    ]
    const terminals = targets.map((target) => node(`t${target.id}`, [vessel('exit_ports', ['v_T', 'u_out'])], 'terminal:pp'))
    const result = simulateCaPairing(array([...terminals, ...targets], targets.map((target) => `t${target.id}>${target.id}`)))
    expect(Object.fromEntries([...result.terminals].map(([edge, mappings]) => [edge.id, mappings]))).toEqual({
      'tv>v': [['u_out', 'u'], ['v_T', 'v_in']],
      'ta>a': [['v_T', 'v_in']],
      'tp>p': [['u_out', 'u']],
    })
    // A list-form vessel_port maps the pair itself.
    expect(pairsOf(result)).toContain('ts>s:0>0')
  })

  it("takes the vessel_port CA's junction rule picks at each module meeting a junction: by place, two variables, the last past the end", () => {
    const junction = node('j', [vessel('entrance_ports', ['v_in_sum', 'u'], 'True'), vessel('exit_ports', ['v', 'u_out'])], 'Min_junction:vp')
    const r = node('r', [vessel('exit_ports', ['v']), vessel('exit_ports', ['w', 'u_w']), vessel('exit_ports', ['x', 'u_x'])])
    const z = node('z', [vessel('entrance_ports', ['v_in', 'u'])])
    const result = simulateCaPairing(array([r, junction, z], ['r>z', 'r>j']))
    expect(result.junctions.map(({ edge, end, index }) => `${edge.id}:${end}#${index}`)).toEqual(['r>j:source#2', 'r>z:target#0'])
  })
})

describe('caMultiPort', () => {
  it('reads a port as CA normalises its written multi_port', () => {
    expect(caMultiPort(port('exit_ports', 'vessel_port', ['v']))).toBeNull()
    expect(caMultiPort(port('exit_ports', 'vessel_port', ['v'], 'True'))).toBe('True')
    expect(caMultiPort(port('exit_ports', 'flow_port', ['v'], 'Sum'))).toEqual(['sum'])
    expect(caMultiPort(port('exit_ports', 'volume_port', ['q'], 'Sum'))).toBe('sum')
    expect(caMultiPort(port('exit_ports', 'flow_port', ['v'], 'Multiply'))).toBe('Multiply')
    expect(caMultiPort(port('exit_ports', 'vessel_port', ['v', 'u'], 'Sum'))).toEqual(['sum', 'sum'])
  })
})

describe('simulateImportPairing', () => {
  it('couples as CA does, never from an entrance port nor into an exit port', () => {
    const x = node('x', [port('general_ports', 'link', ['a']), port('entrance_ports', 'back', ['b'])])
    const y = node('y', [port('entrance_ports', 'link', ['c']), port('exit_ports', 'link', ['d']), port('general_ports', 'back', ['e'])])
    expect(pairsOf(simulateImportPairing(array([x, y], ['x>y'])))).toEqual(['x>y:0>0'])
  })

  it('leaves out a conduit whose single slot another took, as the import does', () => {
    const x = node('x', [vessel('exit_ports')])
    const [y, z] = [node('y', [vessel('entrance_ports')]), node('z', [vessel('entrance_ports')])]
    const result = simulateImportPairing(array([x, y, z], ['x>y', 'x>z']))
    expect(pairsOf(result)).toEqual(['x>y:0>0'])
    expect(errorsOf(result)).toEqual(['x>z:importConflict'])
  })
})
