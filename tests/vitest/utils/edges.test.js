import { describe, expect, it } from 'vitest'

import {
  buildUsedPortKeys,
  carryDrivesState,
  checkAndClaimCouplings,
  comparableCouplings,
  edgeOrdinals,
  previewCouplings,
  resolvePortCouplings,
} from '../../../src/utils/edges.js'

const port = (label, portType, variables) => ({ label, portType, variables, multiportType: 'None' })
const node = (id, ports) => ({ id, data: { name: id, ports } })
const edge = (id, source, target, couplings = []) => ({ id, source, target, data: { couplings } })
const annotated = (subject, variables, multiportType = 'None') => ({
  portType: 'general_ports',
  label: '',
  variables,
  multiportType,
  annotation: { subject, variable: variables[0], role: 'reader', source: { kind: 'sidecar' } },
})

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

  it("re-pairs a Sum with every multiport slot of its label when a node's save recomputes the edge", () => {
    const nodes = [node('membrane', [sum]), node('pump', pump)]
    const edges = [{ ...edge('e', 'membrane', 'pump'), data: { couplings: [{ sourcePort: sum, targetPort: pump[0] }] } }]
    expect(previewCouplings('pump', pump, nodes, edges).get('e').map((c) => c.targetPort)).toEqual(pump)
  })
})

// A membrane sums v_tot over a pump's two multiport v_tot ports.
const sum = { ...port('v_tot', 'general_ports', ['v_tot']), multiportType: 'Sum' }
const pump = [
  { ...port('v_tot', 'general_ports', ['v_K']), multiportType: 'True' },
  { ...port('v_tot', 'general_ports', ['v_Na']), multiportType: 'True' },
]

describe('resolvePortCouplings', () => {
  const pairs = (couplings) => couplings.map((c) => [c.sourcePort.variables[0], c.targetPort.variables[0]])

  it('pairs every multiport slot of a label, whichever way the edge points', () => {
    expect(pairs(resolvePortCouplings([sum], pump))).toEqual([['v_tot', 'v_K'], ['v_tot', 'v_Na']])
    expect(pairs(resolvePortCouplings(pump, [sum]))).toEqual([['v_K', 'v_tot'], ['v_Na', 'v_tot']])
  })

  it('pairs a single-connection slot once, picking it by the edge index', () => {
    const single = [port('v_tot', 'general_ports', ['a']), port('v_tot', 'general_ports', ['b'])]
    expect(pairs(resolvePortCouplings([sum], single, 0, 1))).toEqual([['v_tot', 'b']])
    expect(pairs(resolvePortCouplings(single, pump, 0, 0))).toEqual([['a', 'v_K']])
  })

  it('never pairs ports with different numbers of variables, ports without variables or without a label', () => {
    const wide = { ...port('v_tot', 'general_ports', ['a', 'b']), multiportType: 'True' }
    expect(pairs(resolvePortCouplings([sum], [wide, pump[0]]))).toEqual([['v_tot', 'v_K']])
    expect(resolvePortCouplings([port('p', 'exit_ports', [])], [port('p', 'entrance_ports', [])])).toEqual([])
    expect(resolvePortCouplings([port(' ', 'exit_ports', ['x'])], [port(' ', 'entrance_ports', ['y'])])).toEqual([])
  })
})

describe('choosing single-connection slots', () => {
  const hubPorts = [port('v', 'exit_ports', ['q0']), port('v', 'exit_ports', ['q1'])]
  const leafPorts = [port('v', 'entrance_ports', ['q'])]
  const coupled = (id, target, slot) => ({ ...edge(id, 'hub', target), data: { couplings: [{ sourcePort: hubPorts[slot], targetPort: leafPorts[0] }] } })

  it('keeps the slot the edge stores over its ordinal one', () => {
    const stored = [{ sourcePort: { ...hubPorts[1] }, targetPort: leafPorts[0] }]
    expect(resolvePortCouplings(hubPorts, leafPorts, 0, 0, { stored })[0].sourcePort).toBe(hubPorts[1])
  })

  it('passes by a slot another edge holds', () => {
    const held = new Set([hubPorts[0]])
    expect(resolvePortCouplings(hubPorts, leafPorts, 0, 0, { held })[0].sourcePort).toBe(hubPorts[1])
    expect(resolvePortCouplings(hubPorts, leafPorts, 0, 0, { held: new Set(hubPorts) })).toEqual([])
  })

  it("keeps two edges' swapped slots when a save recomputes them", () => {
    const nodes = [node('hub', hubPorts), node('l0', leafPorts), node('l1', leafPorts)]
    const edges = [coupled('e0', 'l0', 1), coupled('e1', 'l1', 0)]
    const couplings = previewCouplings('hub', hubPorts, nodes, edges)
    expect(couplings.get('e0')[0].sourcePort).toBe(hubPorts[1])
    expect(couplings.get('e1')[0].sourcePort).toBe(hubPorts[0])
  })

  it('gives an edge without a stored slot the one no other edge holds', () => {
    const nodes = [node('hub', hubPorts), node('l0', leafPorts), node('l1', leafPorts)]
    const edges = [edge('e0', 'hub', 'l0'), coupled('e1', 'l1', 0)]
    expect(previewCouplings('hub', hubPorts, nodes, edges).get('e0')[0].sourcePort).toBe(hubPorts[1])
  })
})

describe('edgeOrdinals', () => {
  it("gives an edge's position among the edges sharing its source and its target", () => {
    const edges = [edge('a', 'hub', 'x'), edge('b', 'y', 'leaf'), edge('c', 'hub', 'leaf')]
    expect(edgeOrdinals(edges[2], edges)).toEqual({ sourceIndex: 1, targetIndex: 1 })
  })
})

describe('carryDrivesState', () => {
  const coupling = (source, target, drivesState) => ({
    sourcePort: port('p', 'general_ports', [source]),
    targetPort: port('p', 'general_ports', [target]),
    ...(drivesState && { drivesState }),
  })

  it('keeps the mark on a recomputed coupling between the same ports and variables', () => {
    expect(carryDrivesState([coupling('X', 'q', true)], [coupling('X', 'q')])).toEqual([coupling('X', 'q', true)])
  })

  it('drops the mark when a port now joins other variables, so driving them is asked again', () => {
    expect(carryDrivesState([coupling('X', 'q', true)], [coupling('X', 'q_P')])).toEqual([coupling('X', 'q_P')])
  })

  it('keeps the mark by port alone for couplings confirmed before a rename', () => {
    const next = carryDrivesState([coupling('X', 'q', true)], [coupling('X', 'q_renamed')], { byLabel: true })
    expect(next).toEqual([coupling('X', 'q_renamed', true)])
  })

  it('returns the same couplings when none was marked', () => {
    const next = [coupling('X', 'q')]
    expect(carryDrivesState([coupling('X', 'q')], next)).toBe(next)
  })
})

describe('annotated ports', () => {
  const sodium = annotated('m#s.v_Na_i', ['v_Na_i'])
  const glucose = annotated('m#s.v_Glc_i', ['v_Glc_i'])
  const owner = annotated('m#c.v_Na', ['v_Na'], 'Sum')

  it('are never coupled by label, even with equal empty labels', () => {
    expect(resolvePortCouplings([sodium, glucose], [owner])).toEqual([])
  })

  it('keep their couplings through a preview while both ports remain, and hide the manual ports from matching', () => {
    const label = [port('p', 'exit_ports', ['x']), port('p', 'entrance_ports', ['y'])]
    const nodes = [node('s', [sodium, glucose, label[0]]), node('c', [owner, label[1]])]
    const edges = [edge('e', 's', 'c', [{ sourcePort: { ...sodium }, targetPort: { ...owner } }])]

    expect(previewCouplings('s', nodes[0].data.ports, nodes, edges).get('e')).toEqual([
      { sourcePort: sodium, targetPort: owner },
    ])
    expect(previewCouplings('s', [glucose, label[0]], nodes, edges).get('e')).toEqual([])
  })

  it('keep a stored coupling through a hidden manual port, so it still generates', () => {
    const label = [port('p', 'exit_ports', ['x']), port('p', 'entrance_ports', ['y'])]
    const nodes = [node('s', [sodium, label[0]]), node('c', [owner, label[1]])]
    const stored = [
      { sourcePort: { ...label[0] }, targetPort: { ...label[1] } },
      { sourcePort: { ...sodium }, targetPort: { ...owner } },
    ]
    const edges = [edge('e', 's', 'c', stored)]
    expect(previewCouplings('s', nodes[0].data.ports, nodes, edges).get('e')).toEqual([
      { sourcePort: label[0], targetPort: label[1] },
      { sourcePort: sodium, targetPort: owner },
    ])
    // Gone once its manual port is deleted.
    expect(previewCouplings('s', [sodium], nodes, edges).get('e')).toEqual([{ sourcePort: sodium, targetPort: owner }])
  })

  it('match labels only where neither node has annotated ports', () => {
    const label = [port('p', 'exit_ports', ['x']), port('p', 'entrance_ports', ['y'])]
    expect(resolvePortCouplings([label[0]], [label[1]])).toEqual([{ sourcePort: label[0], targetPort: label[1] }])
    expect(resolvePortCouplings([sodium, label[0]], [label[1]])).toEqual([])
    expect(resolvePortCouplings([label[0]], [owner, label[1]])).toEqual([])
  })

  it('keep a coupling after the port’s variable changes', () => {
    const picked = annotated('m#s.v_Na_i', ['v_Na_total'])
    const nodes = [node('s', [picked]), node('c', [owner])]
    const edges = [edge('e', 's', 'c', [{ sourcePort: sodium, targetPort: owner }])]
    expect(previewCouplings('s', [picked], nodes, edges).get('e')).toEqual([{ sourcePort: picked, targetPort: owner }])
  })

  it('keep a kept coupling’s drivesState mark', () => {
    const nodes = [node('s', [sodium]), node('c', [owner])]
    const edges = [edge('e', 's', 'c', [{ sourcePort: sodium, targetPort: owner, drivesState: true }])]
    expect(previewCouplings('s', [sodium], nodes, edges).get('e')).toEqual([
      { sourcePort: sodium, targetPort: owner, drivesState: true },
    ])
  })

  it('claim single connections by identity, naming the port by its variables', () => {
    const used = buildUsedPortKeys([edge('e', 's', 'c', [{ sourcePort: sodium, targetPort: owner }])])
    const free = checkAndClaimCouplings('s', 'd', [{ sourcePort: glucose, targetPort: owner }], new Set(used))
    expect(free.valid).toBe(true)
    const clash = checkAndClaimCouplings('s', 'd', [{ sourcePort: sodium, targetPort: owner }], new Set(used))
    expect(clash.valid).toBe(false)
    expect(clash.conflicts[0]).toContain('"v_Na_i" (general_ports) on "s"')
  })
})

describe('comparableCouplings', () => {
  const coupling = (sourcePort, targetPort, extra = {}) => ({ sourcePort, targetPort, ...extra })

  it('ignores dialog uids, editor fields and order', () => {
    const a = coupling(port('p', 'exit_ports', ['x']), port('p', 'entrance_ports', ['y']))
    const b = coupling(port('q', 'general_ports', ['u']), port('q', 'general_ports', ['v']))
    const stamped = [
      coupling({ ...b.sourcePort, _uid: 's1', multiplyFactor: 1 }, { ...b.targetPort, _uid: 't1' }),
      coupling({ ...a.sourcePort, _uid: 's0' }, { ...a.targetPort, _uid: 't0' }),
    ]
    expect(comparableCouplings(stamped)).toEqual(comparableCouplings([a, b]))
  })

  it('tells apart other variables, labels, annotation subjects and drivesState marks', () => {
    const base = coupling(port('p', 'exit_ports', ['x']), port('p', 'entrance_ports', ['y']))
    const differ = (other) => expect(comparableCouplings([other])).not.toEqual(comparableCouplings([base]))
    differ(coupling(port('p', 'exit_ports', ['z']), base.targetPort))
    differ(coupling(port('r', 'exit_ports', ['x']), base.targetPort))
    differ({ ...base, drivesState: true })
    expect(comparableCouplings([coupling(annotated('m#a', ['x']), owner())])).not.toEqual(
      comparableCouplings([coupling(annotated('m#b', ['x']), owner())])
    )
  })
})

function owner() {
  return annotated('m#c.v', ['v'], 'Sum')
}
