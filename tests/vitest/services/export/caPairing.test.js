import { describe, expect, it } from 'vitest'

import { planCaPairing } from '../../../../src/services/export/caPairing.js'
import { changedPorts, connect, differences, node, port } from '../../fixtures/ca/workspace.js'

const vessel = (portType, variables = ['v']) => port(portType, 'vessel_port', variables)

/**
 * Plans an export and checks what CA and the import would pair with it.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {{ plan: Object, diff: Object, changed: Array<string> }}
 */
function plan(nodes, edges) {
  const planned = planCaPairing(nodes, edges)
  return { plan: planned, diff: differences(planned, nodes, edges), changed: changedPorts(planned) }
}

const reproduced = { ca: [], imported: [], failures: [] }

describe('planCaPairing', () => {
  it('changes no port where ordering alone reproduces the slots', () => {
    const split = node('s', [vessel('exit_ports', ['a']), vessel('exit_ports', ['b'])])
    const [b, c] = [node('b', [vessel('entrance_ports')]), node('c', [vessel('entrance_ports')])]
    const edges = [connect(split, b, [[1, 0]]), connect(split, c, [[0, 0]])]

    const { plan: planned, diff, changed } = plan([split, b, c], edges)
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual([])
    expect(planned.outEdges.get('s').map((edge) => edge.target)).toEqual(['c', 'b'])
    expect(planned.residuals).toEqual([])
  })

  it("relabels a join's coupled pairs of slots where no order gives crossed slots, as a port both share stops CA", () => {
    const feeder = (id) => node(id, [vessel('exit_ports', ['v']), vessel('exit_ports', ['w'])])
    const join = (id) => node(id, [vessel('entrance_ports', ['a']), vessel('entrance_ports', ['b'])])
    const [j1, j2, x, y] = [join('j1'), join('j2'), feeder('x'), feeder('y')]
    const edges = [connect(x, j1, [[0, 0]]), connect(y, j1, [[0, 1]]), connect(x, j2, [[1, 1]]), connect(y, j2, [[1, 0]])]

    const { diff, changed } = plan([j1, j2, x, y], edges)
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual([
      'j1#0: entrance_ports/vessel_port__1 was {"label":"vessel_port"}',
      'j1#1: entrance_ports/vessel_port__2 was {"label":"vessel_port"}',
      'x#0: exit_ports/vessel_port__1 was {"label":"vessel_port"}',
      'y#0: exit_ports/vessel_port__2 was {"label":"vessel_port"}',
    ])
  })

  it('relabels only the slot a deleted connection left free', () => {
    const split = node('s', [vessel('exit_ports', ['a']), vessel('exit_ports', ['b'])])
    const a = node('a', [vessel('entrance_ports')])

    const { diff, changed } = plan([split, a], [connect(split, a, [[1, 0]])])
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual(['s#0: exit_ports/vessel_port__1 was {"label":"vessel_port"}'])
  })

  it.each(['vessel_port', 'flow_port'])('keeps a %s coupled from the general group, not the exit group CA merges it with', (label) => {
    const source = node('x', [port('exit_ports', label, ['e']), port('general_ports', label, ['g'])])
    const target = node('y', [port('entrance_ports', label, ['i'])])

    const { diff, changed } = plan([source, target], [connect(source, target, [[1, 0]])])
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual([`x#0: exit_ports/${label}__1 was {"label":"${label}"}`])
  })

  it('moves a source entrance port coupled to a general port into general_ports, as CA sources from exit and general ports only', () => {
    const source = node('x', [port('exit_ports', 'other'), port('entrance_ports', 'link', ['a'])])
    const target = node('y', [port('general_ports', 'link', ['b'])])

    const { plan: planned, diff, changed } = plan([source, target], [connect(source, target, [[1, 0]])])
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual(['x#1: general_ports/link was {"portType":"entrance_ports","index":0}'])
    expect(planned.ports.get('x')[1].label).toBe('link')
  })

  it('moves a target exit port coupled from a general port into general_ports, as CA never targets an exit port', () => {
    const source = node('x', [port('general_ports', 'link', ['a'])])
    const target = node('y', [port('entrance_ports', 'other'), port('exit_ports', 'link', ['b'])])

    const { diff, changed } = plan([source, target], [connect(source, target, [[0, 1]])])
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual(['y#1: general_ports/link was {"portType":"exit_ports","index":0}'])
  })

  it('relabels one of two slots of a label coupled on one connection, as CA pairs one vessel_port slot a connection', () => {
    const source = node('x', [vessel('exit_ports', ['a']), vessel('exit_ports', ['b'])])
    const target = node('y', [vessel('entrance_ports', ['c']), vessel('entrance_ports', ['d'])])

    const { diff, changed } = plan([source, target], [connect(source, target, [[0, 0], [1, 1]])])
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual([
      'x#0: exit_ports/vessel_port__1 was {"label":"vessel_port"}',
      'y#0: entrance_ports/vessel_port__1 was {"label":"vessel_port"}',
    ])
  })

  it("reports a terminal coupled into a vessel CA's terminal rule leaves unwired", () => {
    const terminal = node('t', [vessel('exit_ports', ['v_T', 'u_out'])], 'terminal:pp')
    const artery = node('a', [vessel('entrance_ports', ['v', 'u_in'])], 'arterial_simple:pv')

    const { plan: planned, changed } = plan([terminal, artery], [connect(terminal, artery, [[0, 0]])])
    expect(changed).toEqual([])
    expect(planned.residuals).toEqual([expect.objectContaining({ label: 'vessel_port', reason: 'terminal' })])
  })

  it("reports a terminal into an arterial vessel taking flow at its inlet, which CA's terminal rule gives its flow but not its pressure", () => {
    const terminal = node('t', [vessel('exit_ports', ['v_T', 'u_out'])], 'terminal:pp')
    const artery = node('a', [vessel('entrance_ports', ['v_in', 'u'])], 'arterial_simple:vp')
    const edges = [connect(terminal, artery, [[0, 0]])]

    const { plan: planned } = plan([terminal, artery], edges)
    expect(planned.residuals).toEqual([{ edge: edges[0], label: 'vessel_port', reason: 'terminal' }])
  })

  it("reports nothing for a terminal into a venous vessel, whose variables CA's terminal rule maps as coupled", () => {
    const terminal = node('t', [vessel('exit_ports', ['v_T', 'u_out'])], 'terminal:pp')
    const venous = node('v', [vessel('entrance_ports', ['v_in', 'u'])], 'venous:vp_woCont')

    const { plan: planned } = plan([terminal, venous], [connect(terminal, venous, [[0, 0]])])
    expect(planned.residuals).toEqual([])
  })

  it('never relabels the flow ports of a vessel a terminal feeds, which CA sums its flow into', () => {
    const terminal = node('t', [vessel('exit_ports', ['v_T', 'u_out'])], 'terminal:pp')
    const venous = node('v', [vessel('entrance_ports', ['v_in', 'u']), vessel('entrance_ports', ['w_in', 'u'])], 'venous:vp')

    const { plan: planned, changed } = plan([terminal, venous], [connect(terminal, venous, [[0, 1]])])
    expect(changed).toEqual([])
    expect(planned.residuals).toEqual([expect.objectContaining({ label: 'vessel_port', reason: 'terminal' })])
  })

  it('relabels a label the modules share but the connection leaves uncoupled, as after Replace', () => {
    const source = node('x', [vessel('exit_ports'), port('exit_ports', 'flow_port', ['f'])])
    const target = node('y', [vessel('entrance_ports'), port('entrance_ports', 'flow_port', ['g'])])

    const { diff, changed } = plan([source, target], [connect(source, target, [[0, 0]])])
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual(['x#1: exit_ports/flow_port__1 was {"label":"flow_port"}'])
  })

  it('relabels the target of a slot another connection took, as after Swap or Replace', () => {
    const source = node('x', [vessel('exit_ports'), port('exit_ports', 'flow_port', ['f'])])
    const target = node('y', [vessel('entrance_ports'), port('entrance_ports', 'flow_port', ['g'])])
    const sensor = node('z', [port('entrance_ports', 'flow_port', ['h'])])
    const edges = [connect(source, target, [[0, 0]]), connect(source, sensor, [[1, 0]])]

    const { diff, changed } = plan([source, target, sensor], edges)
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual(['y#1: entrance_ports/flow_port__1 was {"label":"flow_port"}'])
  })

  it('reports a multiport coupled to two slots of one label on one connection, which neither CA nor the import gives', () => {
    const source = node('x', [port('general_ports', 'link', ['a'], 'True')])
    const target = node('y', [port('entrance_ports', 'link', ['b']), port('entrance_ports', 'link', ['c'])])

    const { plan: planned } = plan([source, target], [connect(source, target, [[0, 0], [0, 1]])])
    expect(planned.residuals).toEqual([expect.objectContaining({ label: 'link', reason: 'superset' })])
    expect(planned.failures).toEqual([])
  })

  it('trims a port to the variables its one partner pairs, keeping its own', () => {
    const source = node('x', [vessel('exit_ports', ['v', 'u'])])
    const target = node('y', [vessel('entrance_ports', ['v_in'])])

    const { plan: planned, diff, changed } = plan([source, target], [connect(source, target, [[0, 0]])])
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual(['x#0: exit_ports/vessel_port was {"variables":["v","u"]}'])
    expect(planned.ports.get('x')[0].variables).toEqual(['v'])
  })

  it('trims a list-form multiport with its variables, keeping the list it had', () => {
    const source = node('x', [vessel('exit_ports', ['v'])])
    const target = node('y', [port('entrance_ports', 'vessel_port', ['v_in', 'u'], ['sum', 'True'])])

    const { plan: planned, diff } = plan([source, target], [connect(source, target, [[0, 0]])])
    expect(diff).toEqual(reproduced)
    expect(planned.ports.get('y')[0]).toMatchObject({
      variables: ['v_in'],
      multiportType: ['sum'],
      original: { variables: ['v_in', 'u'], multiportType: ['sum', 'True'] },
    })
  })

  it('trims a multiport source to the variables of the partners it fans out to, as CA would index past theirs', () => {
    const hub = node('h', [port('general_ports', 'ctrl', ['a', 'b'], 'True')])
    const [y, z] = [node('y', [port('general_ports', 'ctrl', ['c'])]), node('z', [port('general_ports', 'ctrl', ['d'])])]

    const { plan: planned, diff } = plan([hub, y, z], [connect(hub, y, [[0, 0]]), connect(hub, z, [[0, 0]])])
    expect(diff).toEqual(reproduced)
    expect(planned.ports.get('h')[0]).toMatchObject({ variables: ['a'], original: { variables: ['a', 'b'] } })
  })

  it("trims each target a shorter multiport fans out to, so CA's later pairs on the connection keep their place", () => {
    const hub = node('h', [port('exit_ports', 'aaa', ['u'], 'True'), port('exit_ports', 'vessel_port', ['v', 'u_out'], 'True')])
    const target = (id) => node(id, [port('entrance_ports', 'aaa', ['u', 'w']), vessel('entrance_ports', ['v_in', 'u'])])
    const [y, z] = [target('y'), target('z')]

    const { plan: planned, diff, changed } = plan([hub, y, z], [connect(hub, y, [[0, 0], [1, 1]]), connect(hub, z, [[0, 0], [1, 1]])])
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual(['y#0: entrance_ports/aaa was {"variables":["u","w"]}', 'z#0: entrance_ports/aaa was {"variables":["u","w"]}'])
    expect(planned.residuals).toEqual([])
  })

  it('reports a source with fewer variables than a target it shares with a longer source, as CA shifts the pairs after it', () => {
    const short = node('s', [port('exit_ports', 'aaa', ['u']), vessel('exit_ports', ['v', 'u_out'])])
    const long = node('l', [port('exit_ports', 'aaa', ['p', 'q'])])
    const target = node('t', [port('entrance_ports', 'aaa', ['a', 'b'], 'True'), vessel('entrance_ports', ['v_in', 'u'])])
    const edges = [connect(short, target, [[0, 0], [1, 1]]), connect(long, target, [[0, 0]])]

    const { plan: planned } = plan([short, long, target], edges)
    expect(planned.residuals).toEqual([{ edge: edges[0], label: 'aaa', reason: 'misaligned' }])
    expect(planned.failures).toEqual([])
  })

  it("reports a label CA's terminal rule wires though the connection leaves it uncoupled", () => {
    const terminal = node('t', [vessel('exit_ports', ['v_T', 'u_out']), port('exit_ports', 'link', ['x'])], 'terminal:pp')
    const venous = node('v', [vessel('entrance_ports', ['v_in', 'u']), port('entrance_ports', 'link', ['y'])], 'venous:vp_woCont')
    const edges = [connect(terminal, venous, [[1, 1]])]

    const { plan: planned } = plan([terminal, venous], edges)
    expect(planned.residuals).toContainEqual({ edge: edges[0], label: 'vessel_port', reason: 'rule' })
  })

  it('reports a slot coupled on two connections, which CA and the import pair on the first only, by its component', () => {
    const source = node('x', [port('exit_ports', 'link', ['a'])])
    const [y, z] = [node('y', [port('general_ports', 'link', ['b'])]), node('z', [port('entrance_ports', 'link', ['c'], 'True')])]
    const edges = [connect(source, y, [[0, 0]]), connect(source, z, [[0, 0]])]

    const { plan: planned } = plan([source, y, z], edges)
    expect(planned.residuals).toEqual([{ edge: edges[1], label: 'link', reason: 'component' }])
  })

  it("relabels only the coupled slots when CA and the import pair a later general port alike", () => {
    // CA and the import pair only x's first vessel_port with y's entrance; y's exit ports never take a coupling.
    const x = node('x', [vessel('general_ports', ['a']), vessel('general_ports', ['b']), vessel('general_ports', ['c'])])
    const y = node('y', [vessel('exit_ports', ['d']), vessel('exit_ports', ['e']), vessel('entrance_ports', ['f'])])

    const { diff, changed } = plan([x, y], [connect(x, y, [[2, 2]])])
    expect(diff).toEqual(reproduced)
    expect(changed).toEqual([
      'x#2: general_ports/vessel_port__1 was {"label":"vessel_port"}',
      'y#2: entrance_ports/vessel_port__1 was {"label":"vessel_port"}',
    ])
  })

  it('untangles many crossed groups, each with one relabel', () => {
    const nodes = []
    const edges = []
    for (let i = 0; i < 25; i++) {
      const [b, c] = [node(`b${i}`, [port('exit_ports', 'flow_port', ['v'], 'True')]), node(`c${i}`, [port('exit_ports', 'flow_port', ['v'], 'True')])]
      const sum = (id) => node(id, [port('entrance_ports', 'flow_port', ['v_1']), port('entrance_ports', 'flow_port', ['v_2']), port('exit_ports', 'flow_port', ['v_out'])], 'flow_sum_2:nn')
      const [s1, s2] = [sum(`s1_${i}`), sum(`s2_${i}`)]
      nodes.push(b, c, s1, s2)
      edges.push(connect(b, s1, [[0, 0]]), connect(c, s1, [[0, 1]]), connect(b, s2, [[0, 1]]), connect(c, s2, [[0, 0]]))
    }

    const { plan: planned, diff } = plan(nodes, edges)
    expect(diff).toEqual(reproduced)
    expect(planned.residuals).toEqual([])
  })

  it('fails on a hub with more variables than one of several partners, as CA indexes past them', () => {
    const hub = node('h', [port('exit_ports', 'link', ['a', 'b'], 'True')])
    const [y, z] = [node('y', [port('entrance_ports', 'link', ['c'])]), node('z', [port('entrance_ports', 'link', ['d', 'e'])])]

    const { plan: planned } = plan([hub, y, z], [connect(hub, y, [[0, 0]]), connect(hub, z, [[0, 0]])])
    expect(planned.failures).toEqual([expect.objectContaining({ kind: 'indexError', label: 'link' })])
  })

  it("never relabels a heart's vessel_ports, and reports the inputs CA puts on other slots", () => {
    const heart = node(
      'heart',
      [
        vessel('entrance_ports', ['v_ivc', 'u_ra']),
        vessel('entrance_ports', ['v_svc', 'u_ra']),
        vessel('entrance_ports', ['v_pvn', 'u_la']),
        vessel('exit_ports', ['v_aov', 'u_root']),
        vessel('exit_ports', ['v_puv', 'u_par']),
      ],
      'heart:vp'
    )
    const feeder = (id) => node(id, [vessel('exit_ports', ['v', 'u_out'])])
    const artery = (id) => node(id, [vessel('entrance_ports', ['v_in', 'u'])])
    const [ivc, pvn, aorta, par] = [feeder('venous_ivc'), feeder('pvn'), artery('aorta'), artery('par')]
    const edges = [
      connect(ivc, heart, [[0, 0]]),
      connect(pvn, heart, [[0, 2]]),
      connect(heart, aorta, [[3, 0]]),
      connect(heart, par, [[4, 0]]),
    ]

    const { plan: planned, changed } = plan([heart, ivc, pvn, aorta, par], edges)
    expect(changed).toEqual([])
    expect(planned.residuals).toEqual([expect.objectContaining({ edge: edges[0], label: 'vessel_port', reason: 'heart' })])
  })

  it('never relabels the flow ports of the vessels meeting at a Min_ junction, two hops out', () => {
    const junction = node('j', [port('entrance_ports', 'vessel_port', ['v_in_sum', 'u'], 'True'), vessel('exit_ports', ['v', 'u_out'])], 'Min_junction:vp')
    const branch = node('r', [vessel('exit_ports', ['v', 'u_out']), port('exit_ports', 'flow_port', ['f'])])
    // z, two hops from j through r, takes r's flow at its second flow_port, which relabelling its first would give.
    const other = node('z', [port('entrance_ports', 'flow_port', ['g']), port('entrance_ports', 'flow_port', ['h'])])
    const edges = [connect(branch, junction, [[0, 0]]), connect(branch, other, [[1, 1]])]

    const { plan: planned, changed } = plan([junction, branch, other], edges)
    expect(changed).toEqual([])
    expect(planned.residuals).toEqual([{ edge: edges[1], label: 'flow_port', reason: 'junction' }])
  })

  it("reports a vessel_port coupled at a junction other than the one CA's junction rule takes, by place and two variables", () => {
    const junction = node('j', [port('entrance_ports', 'vessel_port', ['v_in_sum', 'u'], 'True'), vessel('exit_ports', ['v', 'u_out'])], 'Min_junction:vp')
    // CA's rule skips r's first vessel_port, which has one variable, though the import pairs it.
    const branch = node('r', [vessel('exit_ports', ['v']), vessel('exit_ports', ['w', 'u_w'])])
    const edges = [connect(branch, junction, [[0, 0]])]

    const { plan: planned, diff } = plan([junction, branch], edges)
    expect(diff).toEqual(reproduced)
    expect(planned.residuals).toEqual([{ edge: edges[0], label: 'vessel_port', reason: 'junction' }])
  })

  it("never relabels the volume_ports a volume_port Sum adds up, and reports CA's sum", () => {
    const sum = node('sum', [port('entrance_ports', 'volume_port', ['q_total'], 'Sum')], 'volume_sum:nn')
    const source = node('a', [port('exit_ports', 'volume_port', ['q']), port('exit_ports', 'volume_port', ['q2'])])

    // CA sums each input's first volume_port, and the import pairs the first free one: q, not q2.
    const { plan: planned, changed } = plan([sum, source], [connect(source, sum, [[1, 0]])])
    expect(changed).toEqual([])
    expect(planned.residuals).toEqual([expect.objectContaining({ label: 'volume_port', reason: 'volume' })])
    expect(planned.failures).toEqual([])
  })

  it('reports a coupling whose port changed since, by its multiport too', () => {
    const source = node('x', [vessel('exit_ports')])
    const target = node('y', [vessel('entrance_ports')])
    const edge = connect(source, target, [[0, 0]])
    edge.data.couplings[0].sourcePort = { ...source.data.ports[0], multiportType: 'True' }

    const { plan: planned } = plan([source, target], [edge])
    expect(planned.stale).toEqual([{ edge, coupling: edge.data.couplings[0], gone: false }])
  })

  it('reports a coupling whose Multiply factor changed since', () => {
    const source = node('x', [{ ...port('exit_ports', 'flow_port', ['v'], 'Multiply'), multiplyFactor: 2 }])
    const target = node('y', [port('entrance_ports', 'flow_port', ['w'])])
    const edge = connect(source, target, [[0, 0]])
    edge.data.couplings[0].sourcePort = { ...source.data.ports[0], multiplyFactor: 3 }

    const { plan: planned } = plan([source, target], [edge])
    expect(planned.stale).toEqual([{ edge, coupling: edge.data.couplings[0], gone: false }])
  })

  it('leaves out an edge with no couplings that CA would couple, and keeps one CA would not', () => {
    const [x, y] = [node('x', [vessel('exit_ports')]), node('y', [vessel('entrance_ports')])]
    const lone = node('z', [port('entrance_ports', 'other')])
    const [shared, apart] = [connect(x, y, []), connect(x, lone, [])]

    const { plan: planned } = plan([x, y, lone], [shared, apart])
    expect(planned.dropped).toEqual([shared])
    expect(planned.outEdges.get('x')).toEqual([apart])
  })

  it('gives the same plan whatever the edge order', () => {
    const feeder = (id) => node(id, [vessel('exit_ports', ['v']), vessel('exit_ports', ['w'])])
    const join = (id) => node(id, [vessel('entrance_ports', ['a']), vessel('entrance_ports', ['b'])])
    const [j1, j2, x, y] = [join('j1'), join('j2'), feeder('x'), feeder('y')]
    const edges = [connect(x, j1, [[0, 0]]), connect(y, j1, [[0, 1]]), connect(x, j2, [[1, 1]]), connect(y, j2, [[1, 0]])]

    expect(plan([j1, j2, x, y], [...edges].reverse()).changed).toEqual(plan([j1, j2, x, y], edges).changed)
  })
})
