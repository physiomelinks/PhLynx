import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/notify', () => ({ notify: { warning: vi.fn() } }))

import { useEdgeCouplings } from '../../../src/composables/useEdgeCouplings.js'
import { resolvePortCouplings } from '../../../src/utils/edges.js'
import { loadToyNodes } from '../services/annotations/toyNodes.js'

const port = (label, variables, multiportType = 'None') => ({ label, portType: 'general_ports', variables, multiportType })

/** Opens the dialog's state on an edge from a node with the source ports to one with the target ports. */
function open(sourcePorts, targetPorts, { couplings = [], ordinals } = {}) {
  const edge = { id: 's--t', source: 's', target: 't', data: { couplings } }
  const state = useEdgeCouplings(
    {
      sourceNode: { id: 's', data: { ports: sourcePorts } },
      targetNode: { id: 't', data: { ports: targetPorts } },
      activeEdge: edge,
      subgraph: new Map([[edge.id, edge]]),
      ordinals,
    },
    vi.fn()
  )
  state.initLocalState()
  const pairs = () =>
    state.localCouplings.value.map(({ srcUid, tgtUid }) => [state.srcByUid(srcUid).variables[0], state.tgtByUid(tgtUid).variables[0]])
  return { state, pairs }
}

describe('useEdgeCouplings', () => {
  const sum = port('v_tot', ['v_tot'], 'Sum')
  const pump = [port('v_tot', ['v_K'], 'True'), port('v_tot', ['v_Na'], 'True')]

  it('shows the couplings save and export apply, not the ones the edge stored', () => {
    const { pairs } = open([sum], pump, { couplings: [{ sourcePort: sum, targetPort: pump[0] }] })
    expect(pairs()).toEqual([['v_tot', 'v_K'], ['v_tot', 'v_Na']])
    expect(pairs()).toEqual(resolvePortCouplings([sum], pump).map((c) => [c.sourcePort.variables[0], c.targetPort.variables[0]]))
  })

  it("picks single-connection slots by the edge's ordinal indices", () => {
    const single = [port('p', ['a']), port('p', ['b'])]
    const { pairs } = open([port('p', ['x'])], single, { ordinals: { sourceIndex: 0, targetIndex: 1 } })
    expect(pairs()).toEqual([['x', 'b']])
  })

  it('follows port edits, leaving out ports with different numbers of variables', () => {
    const { state, pairs } = open([sum], pump)
    state.localTgtPorts.value[1].variables = ['v_Na', 'extra']
    state.onPortConfigChange()
    expect(pairs()).toEqual([['v_tot', 'v_K']])

    state.deletePort(state.localTgtPorts.value[0]._uid, 'target')
    expect(pairs()).toEqual([])
  })

  it('keeps a swapped single-connection slot through later edits, as save does', () => {
    const single = [port('p', ['a']), port('p', ['b'])]
    const { state, pairs } = open([port('p', ['x'])], single)
    expect(pairs()).toEqual([['x', 'a']])

    const [, b] = state.localTgtPorts.value
    state.localCouplings.value = [{ srcUid: state.localSrcPorts.value[0]._uid, tgtUid: b._uid }]
    state.deriveCouplings()
    state.onPortConfigChange()
    expect(pairs()).toEqual([['x', 'b']])
  })

  it('opens on the slot the edge stores, and passes by a slot another edge holds', () => {
    const single = [port('p', ['a']), port('p', ['b'])]
    expect(open([port('p', ['x'])], single, { couplings: [{ sourcePort: port('p', ['x']), targetPort: single[1] }] }).pairs()).toEqual([['x', 'b']])

    const src = port('p', ['x'])
    const sibling = { id: 'o--t', source: 'o', target: 't', data: { couplings: [{ sourcePort: port('p', ['y']), targetPort: single[0] }] } }
    const edge = { id: 's--t', source: 's', target: 't', data: { couplings: [] } }
    const state = useEdgeCouplings(
      {
        sourceNode: { id: 's', data: { ports: [src] } },
        targetNode: { id: 't', data: { ports: single } },
        activeEdge: edge,
        subgraph: new Map([[edge.id, edge], [sibling.id, sibling]]),
      },
      vi.fn()
    )
    state.initLocalState()
    expect(state.localCouplings.value.map((c) => state.tgtByUid(c.tgtUid).variables[0])).toEqual(['b'])
  })
})

describe('useEdgeCouplings with annotated ports', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  /**
   * Opens the edge dialog's state for porter_in → cell, with the given ports and couplings.
   *
   * @returns {ReturnType<typeof useEdgeCouplings>}
   */
  function openToy({ sourcePorts, targetPorts, couplings = [], siblings = [], withContext = true }) {
    const sourceNode = toy.node('porter_in', sourcePorts)
    const targetNode = toy.node('cell', targetPorts)
    const activeEdge = { id: 'e', source: sourceNode.id, target: targetNode.id, data: { couplings } }
    const subgraph = new Map([['e', activeEdge], ...siblings.map((edge) => [edge.id, edge])])
    const context = toy.context([sourceNode, targetNode])
    const state = useEdgeCouplings({ sourceNode, targetNode, activeEdge, subgraph }, async () => 'overwrite', {
      getContext: () => (withContext ? context : undefined),
    })
    state.initLocalState()
    return state
  }

  const place = { key: 'apical-fluid', label: 'apical fluid' }
  /** A port whose annotation carries a resolved place, as a placed node's would. */
  const placed = (port, at = place) => ({ ...port, annotation: { ...port.annotation, absoluteLocation: at } })
  const uidOf = (ports, variable) => ports.value.find((port) => port.variables.includes(variable))._uid
  const coupled = (state) =>
    state.localCouplings.value.map(({ srcUid, tgtUid }) => [
      state.srcByUid(srcUid).variables[0],
      state.tgtByUid(tgtUid).variables[0],
    ])

  it('keeps a loaded annotated coupling, even before the context is parsed', () => {
    const [reader, owner] = [toy.port('porter_in', 'c_A_i'), toy.port('cell', 'c_A')]
    const state = openToy({
      sourcePorts: [reader],
      targetPorts: [owner],
      couplings: [{ sourcePort: reader, targetPort: owner }],
      withContext: false,
    })
    expect(coupled(state)).toEqual([['c_A_i', 'c_A']])
  })

  it('never couples annotated ports automatically, though their labels are equal', () => {
    const state = openToy({
      sourcePorts: [toy.port('porter_in', 'c_A_i')],
      targetPorts: [toy.port('cell', 'c_A')],
    })
    expect(state.localCouplings.value).toEqual([])
  })

  it('connects annotated ports only at one place, and blocks a mismatch', () => {
    const unplaced = openToy({
      sourcePorts: [toy.port('porter_in', 'c_A_i')],
      targetPorts: [toy.port('cell', 'c_A')],
    })
    const pair = (state) => [uidOf(state.localSrcPorts, 'c_A_i'), uidOf(state.localTgtPorts, 'c_A')]
    expect(unplaced.connectPorts(...pair(unplaced), [])).toEqual([])

    const state = openToy({
      sourcePorts: [placed(toy.port('porter_in', 'c_A_i')), placed(toy.port('porter_in', 'c_A_o'), { key: 'lumen' })],
      targetPorts: [placed(toy.port('cell', 'c_A'))],
    })
    const owner = uidOf(state.localTgtPorts, 'c_A')
    expect(state.connectPorts(uidOf(state.localSrcPorts, 'c_A_o'), owner, [])).toEqual([])
    expect(state.connectPorts(uidOf(state.localSrcPorts, 'c_A_i'), owner, [])).toHaveLength(1)
  })

  it('makes a ghost port that mirrors a placed annotated partner, and couples it', () => {
    const state = openToy({ sourcePorts: [placed(toy.port('porter_in', 'c_A_i'))], targetPorts: [] })
    const partner = state.localSrcPorts.value[0]
    const copy = state.activateGhost('target', partner)

    expect(copy._uid).toBe(state.localTgtPorts.value.at(-1)._uid)
    expect(copy).toMatchObject({
      label: '',
      variables: [],
      multiportType: 'True',
      annotation: { role: 'owner', location: null, absoluteLocation: place, source: { kind: 'copied' } },
    })
    expect(state.connectPorts(partner._uid, copy._uid, [])).toEqual([{ srcUid: partner._uid, tgtUid: copy._uid }])
  })

  it('makes no copy of an annotated port that has no place', () => {
    const state = openToy({ sourcePorts: [toy.port('porter_in', 'c_A_i')], targetPorts: [] })
    expect(state.activateGhost('target', state.localSrcPorts.value[0])).toBeNull()
    expect(state.localTgtPorts.value).toEqual([])
  })

  it('marks only the annotated port another edge uses as taken, though all labels are empty', () => {
    const [sodium, area] = [toy.port('porter_in', 'c_A_i'), toy.port('porter_in', 'area')]
    const sibling = {
      id: 'f',
      source: 'node_porter_in',
      target: 'node_outside',
      data: { couplings: [{ sourcePort: { ...sodium }, targetPort: toy.port('outside', 'c_A') }] },
    }
    const state = openToy({ sourcePorts: [sodium, area], targetPorts: [], siblings: [sibling] })
    expect([...state.takenElsewhereUids.value]).toEqual([uidOf(state.localSrcPorts, 'c_A_i')])
  })

  describe('beside manual ports, which annotated ports hide', () => {
    it('lists only the annotated ports, and connects no manual port, keeping both in the node data', () => {
      const state = openToy({
        sourcePorts: [port('flow', ['q']), toy.port('porter_in', 'c_A_i')],
        targetPorts: [port('flow', ['q_in']), toy.port('cell', 'c_A')],
      })
      expect(state.localCouplings.value).toEqual([])
      expect(state.visibleSrcPorts.value.map((p) => p.variables[0])).toEqual(['c_A_i'])
      expect(state.visibleTgtPorts.value.map((p) => p.variables[0])).toEqual(['c_A'])
      expect(state.localSrcPorts.value).toHaveLength(2)
      const [flowSrc, flowTgt] = [uidOf(state.localSrcPorts, 'q'), uidOf(state.localTgtPorts, 'q_in')]
      expect(state.connectPorts(flowSrc, flowTgt, [])).toEqual([])
    })

    it('keeps and lists a stored coupling through a hidden manual port', () => {
      const [flow, flowIn] = [port('flow', ['q']), port('flow', ['q_in'])]
      const state = openToy({
        sourcePorts: [flow, toy.port('porter_in', 'c_A_i')],
        targetPorts: [flowIn, toy.port('cell', 'c_A')],
        couplings: [{ sourcePort: flow, targetPort: flowIn }],
      })
      expect(coupled(state)).toEqual([['q', 'q_in']])
      const shown = state.visibleSrcPorts.value.find((p) => p.label === 'flow')
      expect(shown).toBeDefined()
      expect(state.isHidden(shown)).toBe(true)
    })

    it('adds no manual port to a node whose annotated ports take over', () => {
      const state = openToy({ sourcePorts: [port('flow', ['q'])], targetPorts: [toy.port('cell', 'c_A')] })
      expect(state.activateGhost('target', state.localSrcPorts.value[0])).toBeNull()
      expect(state.localTgtPorts.value).toHaveLength(1)
    })
  })

  it('still couples labelled ports by label', () => {
    const state = openToy({ sourcePorts: [port('flow', ['q'])], targetPorts: [port('flow', ['q_in']), port('p', ['p'])] })
    expect(coupled(state)).toEqual([['q', 'q_in']])
  })

  it('puts the annotation in the payload, so a coupling keeps its identity', () => {
    const [reader, owner] = [toy.port('porter_in', 'c_A_i'), toy.port('cell', 'c_A')]
    const state = openToy({ sourcePorts: [reader], targetPorts: [owner], couplings: [{ sourcePort: reader, targetPort: owner }] })
    const [coupling] = state.buildPayload().couplings
    expect(coupling.sourcePort.annotation.subject).toBe(reader.annotation.subject)
    expect(coupling.targetPort.annotation.subject).toBe(owner.annotation.subject)
  })
})

describe('useEdgeCouplings Done without edits', () => {
  const sum = port('v_tot', ['v_tot'], 'Sum')
  const pump = [port('v_tot', ['v_K'], 'True'), port('v_tot', ['v_Na'], 'True')]
  const derived = () => resolvePortCouplings([sum], pump)

  it('counts the payload as it opened unchanged, and the stored couplings as shown', () => {
    const { state } = open([sum], pump, { couplings: derived() })
    expect(state.isUnchanged(state.buildPayload())).toBe(true)
    expect(state.storedDiffers()).toBe(false)
  })

  it('counts any edit as a change', () => {
    const { state } = open([sum], pump, { couplings: derived() })
    state.deletePort(state.localTgtPorts.value[1]._uid, 'target')
    expect(state.isUnchanged(state.buildPayload())).toBe(false)

    const renamed = open([sum], pump, { couplings: derived() }).state
    renamed.localSrcPorts.value[0].label = 'v_total'
    renamed.onPortConfigChange()
    expect(renamed.isUnchanged(renamed.buildPayload())).toBe(false)
  })

  it('still opens on the derived couplings, and tells when the stored ones differ', () => {
    const { state, pairs } = open([sum], pump, { couplings: [{ sourcePort: sum, targetPort: pump[0] }] })
    expect(pairs()).toEqual([['v_tot', 'v_K'], ['v_tot', 'v_Na']])
    expect(state.isUnchanged(state.buildPayload())).toBe(true)
    expect(state.storedDiffers()).toBe(true)
  })
})
