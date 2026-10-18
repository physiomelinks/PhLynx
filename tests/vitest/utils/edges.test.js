import { describe, expect, it } from 'vitest'

import {
  buildUsedPortKeys,
  checkAndClaimCouplings,
  previewCouplings,
  resolveEdgeCouplings,
  resolvePortCouplings,
  slotOf,
} from '../../../src/utils/edges.js'

const port = (label, portType, variables) => ({ label, portType, variables, multiportType: 'None' })
const node = (id, ports) => ({ id, data: { name: id, ports } })
const edge = (id, source, target, couplings = []) => ({ id, source, target, data: { couplings } })
const reversed = (items) => [...items].reverse()

// A splitter with two exit vessel_port slots, and vessels each with one entrance.
const splitPorts = [port('vessel_port', 'exit_ports', ['v0']), port('vessel_port', 'exit_ports', ['v1'])]
const vesselPorts = [port('vessel_port', 'entrance_ports', ['v'])]
const held = (slot) => [{ sourcePort: splitPorts[slot], targetPort: vesselPorts[0], sourceSlot: slot, targetSlot: 0 }]

describe('previewCouplings', () => {
  it('couples the given ports for the node, and the canvas ports for the other end', () => {
    const nodes = [node('a', [port('p', 'exit_ports', ['x'])]), node('b', [port('p', 'entrance_ports', ['y'])])]
    const edges = [edge('e', 'a', 'b')]
    const edited = [port('p', 'exit_ports', ['z'])]

    const couplings = previewCouplings('a', edited, nodes, edges)
    expect(couplings.get('e')).toEqual([{ sourcePort: edited[0], targetPort: nodes[1].data.ports[0], sourceSlot: 0, targetSlot: 0 }])
    expect(nodes[0].data.ports[0].variables).toEqual(['x'])
    expect(edges[0].data.couplings).toEqual([])
  })

  it('leaves out edges not touching the node, or whose other node is missing', () => {
    const nodes = [node('a', []), node('b', []), node('c', [])]
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ax', 'a', 'gone')]
    expect([...previewCouplings('a', [], nodes, edges).keys()]).toEqual(['ab'])
  })

  it('gives edges without couplings the first free slots, in edge order', () => {
    const hubPorts = [port('v', 'exit_ports', ['q0']), port('v', 'exit_ports', ['q1'])]
    const leafPorts = [port('v', 'entrance_ports', ['q'])]
    const nodes = [node('hub', hubPorts), node('l0', leafPorts), node('l1', leafPorts)]
    const edges = [edge('e0', 'hub', 'l0'), edge('e1', 'hub', 'l1')]

    const couplings = previewCouplings('hub', hubPorts, nodes, edges)
    expect(couplings.get('e0')).toEqual(resolvePortCouplings(hubPorts, leafPorts))
    expect(couplings.get('e1')[0].sourcePort.variables).toEqual(['q1'])
  })

  it('keeps the slots the edges hold whatever their order, so an edited node keeps its wiring', () => {
    const nodes = [node('s', splitPorts), node('a', vesselPorts), node('b', vesselPorts)]
    const edges = [edge('ea', 's', 'a', held(1)), edge('eb', 's', 'b', held(0))]
    const edited = splitPorts.map((p) => ({ ...p, variables: [`${p.variables[0]}_edited`] }))

    for (const order of [edges, reversed(edges)]) {
      const couplings = previewCouplings('s', edited, nodes, order)
      expect(couplings.get('ea')[0]).toMatchObject({ sourceSlot: 1, sourcePort: edited[1] })
      expect(couplings.get('eb')[0]).toMatchObject({ sourceSlot: 0, sourcePort: edited[0] })
    }
  })

  it('keeps an edge on its port when an edit removes an earlier slot', () => {
    const nodes = [node('s', splitPorts), node('a', vesselPorts), node('b', vesselPorts)]
    const edges = [edge('ea', 's', 'a', held(1))]
    const couplings = previewCouplings('s', [splitPorts[1]], nodes, edges)
    expect(couplings.get('ea')[0]).toMatchObject({ sourcePort: splitPorts[1], sourceSlot: 0 })
  })

  it('gives a slot to the edge whose port is still there over one holding it only by its recorded index', () => {
    const nodes = [node('s', splitPorts), node('b', vesselPorts), node('c', vesselPorts)]
    const edges = [edge('eb', 's', 'b', held(1)), edge('ec', 's', 'c', held(0))]

    for (const order of [edges, reversed(edges)]) {
      const conflicts = []
      const couplings = previewCouplings('s', [splitPorts[1]], nodes, order, conflicts)
      expect(couplings.get('eb')[0]).toMatchObject({ sourcePort: splitPorts[1], sourceSlot: 0 })
      expect(couplings.get('ec')).toEqual([])
      expect(conflicts).toEqual([expect.stringMatching(/^s → c: /)])
    }
  })

  it('leaves out a coupling whose slot an edit removed when no other is free, and says why', () => {
    const nodes = [node('s', splitPorts), node('a', vesselPorts), node('b', vesselPorts)]
    const edges = [edge('ea', 's', 'a', held(0)), edge('eb', 's', 'b', held(1))]
    const conflicts = []
    const couplings = previewCouplings('s', [splitPorts[0]], nodes, edges, conflicts)
    expect(couplings.get('ea')).toEqual(held(0))
    expect(couplings.get('eb')).toEqual([])
    expect(conflicts).toHaveLength(1)
  })
})

describe('resolvePortCouplings', () => {
  it("takes each group's first slot without slots held", () => {
    expect(resolvePortCouplings(splitPorts, vesselPorts)).toEqual(held(0))
  })

  it('takes the first slot no other edge holds', () => {
    const usedPortKeys = buildUsedPortKeys([edge('e', 's', 'a', held(0))])
    const couplings = resolvePortCouplings(splitPorts, vesselPorts, { sourceId: 's', targetId: 'b', usedPortKeys })
    expect(couplings).toEqual(held(1))
  })

  it("keeps the slot the edge's stored coupling names while it is free", () => {
    const couplings = resolvePortCouplings(splitPorts, vesselPorts, { sourceId: 's', targetId: 'a', stored: held(1) })
    expect(couplings[0].sourceSlot).toBe(1)
  })

  it('takes an exit slot before a general one, and an entrance slot before a general one, as CA groups them', () => {
    const source = [port('vessel_port', 'general_ports', ['g']), port('vessel_port', 'exit_ports', ['x'])]
    const target = [port('vessel_port', 'general_ports', ['h']), port('vessel_port', 'entrance_ports', ['n'])]
    expect(resolvePortCouplings(source, target)).toEqual([{ sourcePort: source[1], targetPort: target[1], sourceSlot: 0, targetSlot: 0 }])
  })

  it('takes the general slot once every exit slot of its label is held', () => {
    const source = [port('vessel_port', 'exit_ports', ['x']), port('vessel_port', 'general_ports', ['g'])]
    const usedPortKeys = buildUsedPortKeys([edge('e', 's', 'a', [{ sourcePort: source[0], targetPort: vesselPorts[0], sourceSlot: 0, targetSlot: 0 }])])
    const couplings = resolvePortCouplings(source, vesselPorts, { sourceId: 's', targetId: 'b', usedPortKeys })
    expect(couplings).toEqual([{ sourcePort: source[1], targetPort: vesselPorts[0], sourceSlot: 0, targetSlot: 0 }])
  })

  it('never couples from an entrance port nor into an exit port', () => {
    expect(resolvePortCouplings([port('p', 'entrance_ports', ['a'])], [port('p', 'general_ports', ['b'])])).toEqual([])
    expect(resolvePortCouplings([port('p', 'general_ports', ['a'])], [port('p', 'exit_ports', ['b'])])).toEqual([])
  })

  it('pairs every free source slot of a label other than vessel_port into a multiport target slot, and one into a single one', () => {
    const source = [port('p', 'exit_ports', ['a']), port('p', 'general_ports', ['b'])]
    const shared = [{ ...port('p', 'entrance_ports', ['c']), multiportType: 'True' }]
    expect(resolvePortCouplings(source, shared).map((c) => c.sourcePort)).toEqual(source)
    expect(resolvePortCouplings(source, [port('p', 'entrance_ports', ['c'])]).map((c) => c.sourcePort)).toEqual([source[0]])
  })

  it('takes a multiport slot however many edges hold it', () => {
    const shared = [{ ...splitPorts[0], multiportType: 'True' }, splitPorts[1]]
    const usedPortKeys = buildUsedPortKeys([edge('e', 's', 'a', [{ ...held(0)[0], sourcePort: shared[0] }])])
    const couplings = resolvePortCouplings(shared, vesselPorts, { sourceId: 's', targetId: 'b', usedPortKeys })
    expect(couplings[0].sourceSlot).toBe(0)
  })
})

describe('checkAndClaimCouplings', () => {
  it("holds a general slot as source and as target apart, so one edge may leave and one arrive through it", () => {
    const general = [port('p', 'general_ports', ['g'])]
    const usedPortKeys = buildUsedPortKeys([edge('xg', 'x', 'g', [{ sourcePort: general[0], targetPort: general[0], sourceSlot: 0, targetSlot: 0 }])])
    const out = resolvePortCouplings(general, general, { sourceId: 'g', targetId: 'y', usedPortKeys })
    expect(checkAndClaimCouplings('g', 'y', out, usedPortKeys).valid).toBe(true)

    const into = resolvePortCouplings(general, general, { sourceId: 'z', targetId: 'g', usedPortKeys })
    expect(checkAndClaimCouplings('z', 'g', into, usedPortKeys).valid).toBe(false)
  })

  it('rejects a coupling when its group has no free slot, and claims nothing', () => {
    const usedPortKeys = buildUsedPortKeys([edge('ea', 's', 'a', held(0)), edge('eb', 's', 'b', held(1))])
    const couplings = resolvePortCouplings(splitPorts, vesselPorts, { sourceId: 's', targetId: 'c', usedPortKeys })
    const before = [...usedPortKeys]

    const { valid, conflicts } = checkAndClaimCouplings('s', 'c', couplings, usedPortKeys, (id) => id.toUpperCase())
    expect(valid).toBe(false)
    expect(conflicts).toEqual([expect.stringContaining('"S" has no free "vessel_port" slot (exit_ports)')])
    expect([...usedPortKeys]).toEqual(before)
  })
})

describe('slotOf', () => {
  it("takes a coupling's recorded slot while its port is there", () => {
    const twins = [splitPorts[0], { ...splitPorts[0] }]
    expect(slotOf(twins, { ...splitPorts[0] }, 1)).toBe(1)
    expect(slotOf([], splitPorts[0], 1)).toBe(1)
  })

  it('follows the port when the ports have changed since the slot was recorded', () => {
    expect(slotOf([splitPorts[1]], splitPorts[1], 1)).toBe(0)
    expect(slotOf(splitPorts, splitPorts[0], 1)).toBe(0)
  })

  it('keeps the recorded slot when the port has been edited past finding', () => {
    expect(slotOf(splitPorts, port('vessel_port', 'exit_ports', ['edited']), 1)).toBe(1)
  })

  it("infers the slot of a coupling saved without one from its port's variables", () => {
    expect(slotOf(splitPorts, { ...splitPorts[1] })).toBe(1)
    expect(slotOf(splitPorts, port('vessel_port', 'exit_ports', ['gone']))).toBe(-1)
  })

  it('lets couplings saved without slots hold the slots their ports are in', () => {
    const legacy = [{ sourcePort: { ...splitPorts[1] }, targetPort: { ...vesselPorts[0] } }]
    const nodes = [node('s', splitPorts), node('a', vesselPorts), node('b', vesselPorts)]
    const usedPortKeys = buildUsedPortKeys([edge('ea', 's', 'a', legacy)], (id) => nodes.find((n) => n.id === id).data.ports)
    const couplings = resolvePortCouplings(splitPorts, vesselPorts, { sourceId: 's', targetId: 'b', usedPortKeys })
    expect(couplings[0].sourceSlot).toBe(0)
  })
})

describe('resolveEdgeCouplings', () => {
  const nodes = [node('s', splitPorts), node('a', vesselPorts), node('b', vesselPorts), node('c', vesselPorts)]

  it('keeps the slots edges hold, whatever the edge order, and gives new couplings the free ones', () => {
    const edges = [edge('ea', 's', 'a', held(1)), edge('eb', 's', 'b'), edge('ec', 's', 'c')]
    const all = () => true

    const conflicts = []
    const couplings = resolveEdgeCouplings(nodes, edges, all, { conflicts })
    expect(couplings.get('ea')).toEqual(held(1))
    expect(couplings.get('eb')).toEqual(held(0))
    expect(couplings.get('ec')).toEqual([])
    expect(conflicts).toEqual([expect.stringMatching(/^s → c: "s" has no free "vessel_port" slot/)])

    const reordered = resolveEdgeCouplings(nodes, [edges[0], ...reversed(edges.slice(1))], all)
    expect(reordered.get('ea')).toEqual(held(1))
    expect(reordered.get('ec')).toEqual(held(0))
  })

  it('keeps the slot of a coupling saved without one, and gives a new edge the free one, whatever the edge order', () => {
    const legacy = [{ sourcePort: { ...splitPorts[1] }, targetPort: { ...vesselPorts[0] } }]
    const edges = [edge('ea', 's', 'a', legacy), edge('eb', 's', 'b')]

    for (const order of [edges, reversed(edges)]) {
      const couplings = resolveEdgeCouplings(nodes, order, (e) => !e.data.couplings.length)
      expect(couplings.get('eb')[0]).toMatchObject({ sourcePort: splitPorts[0], sourceSlot: 0 })
    }
    for (const order of [edges, reversed(edges)]) {
      const couplings = resolveEdgeCouplings(nodes, order, () => true)
      expect(couplings.get('ea')[0]).toMatchObject({ sourcePort: splitPorts[1], sourceSlot: 1 })
      expect(couplings.get('eb')[0]).toMatchObject({ sourcePort: splitPorts[0], sourceSlot: 0 })
    }
  })

  it('gives the same couplings for any order of edges that all hold slots', () => {
    const edges = [edge('ea', 's', 'a', held(1)), edge('eb', 's', 'b', held(0))]
    const all = () => true
    const forwards = resolveEdgeCouplings(nodes, edges, all)
    const backwards = resolveEdgeCouplings(nodes, reversed(edges), all)
    expect(backwards).toEqual(forwards)
    expect(forwards.get('ea')).toEqual(held(1))
  })
})
