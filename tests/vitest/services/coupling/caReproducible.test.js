import { describe, expect, it } from 'vitest'

import {
  couplingProblems,
  pairingRefusal,
  PROBLEM_KINDS,
  uncoupledSharedLabels,
} from '../../../../src/services/coupling/caReproducible.js'
import { couplingPairs, orderCaLists } from '../../../../src/services/export/caOrder.js'
import { CA_FAILURES, comparePairs, simulateCaPairing } from '../../../../src/services/export/caSimulate.js'
import { buildUsedPortKeys, checkAndClaimCouplings, resolvePortCouplings } from '../../../../src/utils/edges.js'
import { connect, exposed, exposures, module, port as hierarchyPort, superInstance, supermodule } from '../../fixtures/hierarchy/graph.js'

const port = (portType, label, variables = ['v'], multiportType = 'None') => ({ portType, label, variables, multiportType })
const node = (id, ports, moduleRef = 'vessel:v') => ({ id, data: { name: id, moduleRef, ports } })
const couple = (source, target, pairs) =>
  pairs.map(([s, t]) => {
    const [sourcePort, targetPort] = [source.data.ports[s], target.data.ports[t]]
    const slotIn = (ports, p) => ports.filter((o) => o.portType === p.portType && o.label === p.label).indexOf(p)
    return { sourcePort, targetPort, sourceSlot: slotIn(source.data.ports, sourcePort), targetSlot: slotIn(target.data.ports, targetPort) }
  })
const edge = (source, target, pairs) => ({ id: `${source.id}--${target.id}`, source: source.id, target: target.id, data: { couplings: couple(source, target, pairs) } })
const kinds = (problems) => problems.map((problem) => `${problem.edgeId}:${problem.kind}:${problem.label}`)

describe('uncoupledSharedLabels', () => {
  it("lists the labels of the source's exit and general ports and the target's entrance and general ports left uncoupled", () => {
    const x = node('x', [port('exit_ports', 'a'), port('general_ports', 'b'), port('entrance_ports', 'c'), port('exit_ports', 'd')])
    const y = node('y', [port('entrance_ports', 'a'), port('general_ports', 'b'), port('general_ports', 'c'), port('exit_ports', 'd')])
    expect(uncoupledSharedLabels(x, y, [])).toEqual(['a', 'b'])
    expect(uncoupledSharedLabels(x, y, couple(x, y, [[0, 0]]))).toEqual(['b'])
  })
})

describe('pairingRefusal', () => {
  const [exit, general, entrance] = [port('exit_ports', 'p'), port('general_ports', 'p'), port('entrance_ports', 'p')]

  it('refuses an entrance port as source and an exit port as target, as CA does', () => {
    expect(pairingRefusal(entrance, general)).toMatch(/from an entrance port/)
    expect(pairingRefusal(general, exit)).toMatch(/into an exit port/)
    expect(pairingRefusal(exit, entrance)).toBeNull()
    expect(pairingRefusal(general, general)).toBeNull()
  })

  it('refuses ports with different numbers of variables, unless one has none yet and that is allowed', () => {
    const wide = port('entrance_ports', 'p', ['a', 'b'])
    expect(pairingRefusal(exit, wide)).toMatch(/source port has 1 and the target port 2/)
    const empty = port('entrance_ports', 'p', [])
    expect(pairingRefusal(exit, empty)).not.toBeNull()
    expect(pairingRefusal(exit, empty, [], { allowEmpty: true })).toBeNull()
  })

  it('refuses a second target for one source slot, a second vessel_port pair, and a second target slot of a label', () => {
    const other = port('general_ports', 'p')
    expect(pairingRefusal(exit, other, [{ sourcePort: exit, targetPort: entrance }])).toMatch(/each p slot of the source/)
    const [v0, v1, vt] = [port('exit_ports', 'vessel_port'), port('general_ports', 'vessel_port'), port('entrance_ports', 'vessel_port')]
    expect(pairingRefusal(v1, vt, [{ sourcePort: v0, targetPort: vt }])).toMatch(/one vessel_port slot/)
    expect(pairingRefusal(general, other, [{ sourcePort: exit, targetPort: entrance }])).toMatch(/into one slot of the target/)
    expect(pairingRefusal(general, entrance, [{ sourcePort: exit, targetPort: entrance }])).toBeNull()
  })
})

describe('couplingProblems', () => {
  it('finds none where CA reproduces every coupling', () => {
    const x = node('x', [port('exit_ports', 'vessel_port'), port('exit_ports', 'vessel_port')])
    const [y, z] = [node('y', [port('entrance_ports', 'vessel_port')]), node('z', [port('entrance_ports', 'vessel_port')])]
    // z holds x's first slot: CA reproduces it by listing z first.
    expect(couplingProblems([x, y, z], [edge(x, y, [[1, 0]]), edge(x, z, [[0, 0]])])).toEqual([])
  })

  it('gives a role problem for a coupling from an entrance port', () => {
    const x = node('x', [port('entrance_ports', 'p')])
    const y = node('y', [port('general_ports', 'p')])
    const e = edge(x, y, [[0, 0]])
    const problems = couplingProblems([x, y], [e])
    expect(kinds(problems)).toEqual(['x--y:role:p'])
    expect(problems[0].coupling).toBe(e.data.couplings[0])
  })

  it('gives a superset problem for a slot paired twice on one edge, and one vessel_port pair past the first', () => {
    const x = node('x', [port('exit_ports', 'p'), port('exit_ports', 'vessel_port'), port('general_ports', 'vessel_port')])
    const y = node('y', [port('entrance_ports', 'p'), port('general_ports', 'p'), port('entrance_ports', 'vessel_port'), port('general_ports', 'vessel_port')])
    const e = edge(x, y, [[0, 0], [0, 1], [1, 2], [2, 3]])
    const problems = couplingProblems([x, y], [e])
    expect(kinds(problems)).toEqual(['x--y:superset:p', 'x--y:superset:vessel_port'])
    expect(problems.map((problem) => problem.coupling)).toEqual([e.data.couplings[1], e.data.couplings[3]])
  })

  it('lets several source slots of a label other than vessel_port pair into one target slot', () => {
    const x = node('x', [port('exit_ports', 'p'), port('general_ports', 'p')])
    const y = node('y', [port('entrance_ports', 'p', ['v'], 'True')])
    expect(couplingProblems([x, y], [edge(x, y, [[0, 0], [1, 0]])])).toEqual([])
  })

  it('gives a variableCount problem, but not on a slot a CA rule wires', () => {
    const x = node('x', [port('exit_ports', 'p', ['a', 'b'])])
    const y = node('y', [port('entrance_ports', 'p', ['c'])])
    expect(kinds(couplingProblems([x, y], [edge(x, y, [[0, 0]])]))).toEqual(['x--y:variableCount:p'])

    const vein = node('vein', [port('exit_ports', 'vessel_port', ['a', 'b'])])
    const heart = node('heart', [port('entrance_ports', 'vessel_port', ['c']), port('entrance_ports', 'vessel_port', ['d'])], 'heart:h')
    expect(couplingProblems([vein, heart], [edge(vein, heart, [[0, 0]])])).toEqual([])
  })

  it('gives a subset problem for each shared label left uncoupled', () => {
    const x = node('x', [port('exit_ports', 'p'), port('general_ports', 'q')])
    const y = node('y', [port('entrance_ports', 'p'), port('general_ports', 'q')])
    expect(kinds(couplingProblems([x, y], [edge(x, y, [[0, 0]])]))).toEqual(['x--y:subset:q'])
  })

  it('gives an order problem where the slots cross so no module array order reproduces them', () => {
    const vessel = (portType) => port(portType, 'vessel_port')
    const [a, b] = [node('a', [vessel('exit_ports'), vessel('exit_ports')]), node('b', [vessel('exit_ports'), vessel('exit_ports')])]
    const [x, y] = [node('x', [vessel('entrance_ports'), vessel('entrance_ports')]), node('y', [vessel('entrance_ports'), vessel('entrance_ports')])]
    // a must come before b for x, and b before a for y.
    const edges = [edge(a, x, [[0, 0]]), edge(b, x, [[0, 1]]), edge(b, y, [[1, 0]]), edge(a, y, [[1, 1]])]
    const problems = couplingProblems([a, b, x, y], edges)
    expect(problems.length).toBeGreaterThan(0)
    expect(new Set(problems.map((problem) => problem.kind))).toEqual(new Set([PROBLEM_KINDS.order]))
    expect(problems[0].message).toMatch(/first free vessel_port slot/)
  })

  it('gives an order problem for a general slot coupled while the exit slot of its label is free', () => {
    const x = node('x', [port('exit_ports', 'vessel_port'), port('general_ports', 'vessel_port')])
    const y = node('y', [port('entrance_ports', 'vessel_port')])
    const problems = couplingProblems([x, y], [edge(x, y, [[1, 0]])])
    expect(kinds(problems)).toEqual(['x--y:order:vessel_port'])
  })

  it('with edgeIds, gives only those edges’ problems and those their couplings cause elsewhere', () => {
    const vessel = (portType) => port(portType, 'vessel_port')
    const [a, b] = [node('a', [vessel('exit_ports'), vessel('exit_ports')]), node('b', [vessel('exit_ports'), vessel('exit_ports')])]
    const [x, y] = [node('x', [vessel('entrance_ports'), vessel('entrance_ports')]), node('y', [vessel('entrance_ports'), vessel('entrance_ports')])]
    const broken = node('q', [port('entrance_ports', 'p')])
    const r = node('r', [port('general_ports', 'p')])
    const edges = [edge(broken, r, [[0, 0]]), edge(a, x, [[0, 0]]), edge(b, x, [[0, 1]]), edge(b, y, [[1, 0]])]
    expect(couplingProblems([a, b, x, y, broken, r], edges, { edgeIds: ['b--y'] })).toEqual([])

    const crossing = edge(a, y, [[1, 1]])
    const problems = couplingProblems([a, b, x, y, broken, r], [...edges, crossing], { edgeIds: [crossing.id] })
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.every((problem) => problem.kind === PROBLEM_KINDS.order)).toBe(true)
    expect(problems.some((problem) => problem.edgeId === 'q--r')).toBe(false)
  })

  it('with a baseline, leaves out the order problems elsewhere the edges had before their edit', () => {
    const vessel = (portType) => port(portType, 'vessel_port')
    const [a, b] = [node('a', [vessel('exit_ports'), vessel('exit_ports')]), node('b', [vessel('exit_ports'), vessel('exit_ports')])]
    const [x, y] = [node('x', [vessel('entrance_ports'), vessel('entrance_ports')]), node('y', [vessel('entrance_ports'), vessel('entrance_ports')])]
    const crossed = [edge(a, x, [[0, 0]]), edge(b, x, [[0, 1]]), edge(b, y, [[1, 0]]), edge(a, y, [[1, 1]])]
    const [s, t] = [node('s', [port('exit_ports', 'p')]), node('t', [port('entrance_ports', 'p')])]
    const unrelated = edge(s, t, [[0, 0]])
    const nodes = [a, b, x, y, s, t]
    const edges = [...crossed, unrelated]
    expect(couplingProblems(nodes, crossed).length).toBeGreaterThan(0)
    // Editing a.x, which takes part in the crossing, as it is: the crossing it already had blocks nothing elsewhere.
    const problems = couplingProblems(nodes, edges, { edgeIds: ['a--x'], baseline: { nodes, edges } })
    expect(problems.every((problem) => problem.edgeId === 'a--x')).toBe(true)
    expect(couplingProblems(nodes, edges, { edgeIds: [unrelated.id], baseline: { nodes, edges } })).toEqual([])
  })

  it('checks the order through a super instance and gives problems on the store edge', () => {
    // sm_1's child c has two exit vessel_ports, both exposed; outside, both feed y.
    const c = module('c', 'c', { scope: 'sm_1', ports: [hierarchyPort('exit_ports', 'vessel_port', ['a']), hierarchyPort('exit_ports', 'vessel_port', ['b'])] })
    const sm = supermodule('sm_1', 'pair', { submoduleOrder: ['c'] })
    const store = { nodes: [sm, c], edges: exposures('sm_1', [exposed('xp_1', 'c', 'exit_ports', 'vessel_port'), exposed('xp_2', 'c', 'exit_ports', 'vessel_port', { slot: 1 })]) }
    const inst = superInstance(store, 'i', 'inst', 'sm_1')
    const y = module('y', 'y', { ports: [hierarchyPort('entrance_ports', 'vessel_port', ['v'])] })
    const z = module('z', 'z', { ports: [hierarchyPort('entrance_ports', 'vessel_port', ['v'])] })
    const nodes = [...store.nodes, inst, y, z]
    const used = new Set()
    const good = [connect(inst, y, { used }), connect(inst, z, { used })]
    expect(couplingProblems(nodes, [...store.edges, ...good])).toEqual([])

    // Coupling the instance's second exposed port to y while z is listed first still reproduces; coupling both into y doesn't.
    const twice = { ...good[0], data: { couplings: [...good[0].data.couplings, ...good[1].data.couplings.map((cp) => ({ ...cp, targetPort: y.data.ports[0], targetSlot: 0 }))] } }
    const problems = couplingProblems(nodes, [...store.edges, twice], { edgeIds: [twice.id] })
    expect(kinds(problems)).toEqual([`${twice.id}:superset:vessel_port`])
    expect(problems[0].coupling).toBe(twice.data.couplings[1])
  })
})

describe('auto-connected graphs', () => {
  const LABELS = ['vessel_port', 'p', 'q']
  const TYPES = ['exit_ports', 'entrance_ports', 'general_ports']

  /** A seeded random generator, the same each run. */
  const randomFrom = (seed) => {
    let state = seed
    return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646
  }

  /**
   * Builds a random graph edge by edge as the canvas would: each label's first free slot in CA's group order, an edge
   * kept only while it makes no problem.
   */
  function randomGraph(seed) {
    const random = randomFrom(seed)
    const pick = (list) => list[Math.floor(random() * list.length)]
    const nodes = Array.from({ length: 3 + Math.floor(random() * 4) }, (_, i) =>
      node(
        `n${i}`,
        Array.from({ length: 2 + Math.floor(random() * 4) }, () =>
          port(pick(TYPES), pick(LABELS), random() < 0.85 ? ['v'] : ['v', 'w'], random() < 0.2 ? 'True' : 'None')
        )
      )
    )
    const portsOf = (id) => nodes.find((n) => n.id === id).data.ports
    const edges = []
    let refused = 0
    for (let tries = 0; tries < 20; tries++) {
      const [source, target] = [pick(nodes), pick(nodes)]
      const id = `${source.id}--${target.id}`
      if (source === target || edges.some((e) => e.id === id)) continue
      const used = buildUsedPortKeys(edges, portsOf)
      const couplings = resolvePortCouplings(source.data.ports, target.data.ports, { sourceId: source.id, targetId: target.id, usedPortKeys: used })
      if (!couplings.length || !checkAndClaimCouplings(source.id, target.id, couplings, used).valid) continue
      const candidate = { id, source: source.id, target: target.id, data: { couplings } }
      if (couplingProblems(nodes, [...edges, candidate], { edgeIds: [id] }).length) {
        refused++
        continue
      }
      edges.push(candidate)
    }
    return { nodes, edges, portsOf, refused }
  }

  it('leaves no problem, and CA reproduces exactly the couplings', () => {
    let [kept, refused] = [0, 0]
    for (let seed = 1; seed <= 150; seed++) {
      const graph = randomGraph(seed)
      const { nodes, edges, portsOf } = graph
      kept += edges.length
      refused += graph.refused
      expect(couplingProblems(nodes, edges), `seed ${seed}`).toEqual([])

      const { pairs } = couplingPairs(nodes, edges)
      const lists = orderCaLists(nodes, edges, { portsOf, pairs })
      const ca = simulateCaPairing({ ...lists, portsOf })
      expect(comparePairs(pairs, ca.pairs, { portsOf }), `seed ${seed}`).toEqual({ missing: [], spurious: [] })
      expect(ca.errors.filter((error) => CA_FAILURES.has(error.kind) || error.kind === 'misaligned'), `seed ${seed}`).toEqual([])
    }
    expect(kept).toBeGreaterThan(200)
    expect(refused).toBeGreaterThan(0)
  })
})
