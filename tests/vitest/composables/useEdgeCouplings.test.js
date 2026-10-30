import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/notify', () => ({ notify: { warning: vi.fn() } }))

import { useEdgeCouplings } from '../../../src/composables/useEdgeCouplings.js'
import { loadToyNodes } from '../services/annotations/toyNodes.js'

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
  function open({ sourcePorts, targetPorts, couplings = [], siblings = [], withContext = true }) {
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

  const uidOf = (ports, variable) => ports.value.find((port) => port.variables.includes(variable))._uid
  const coupled = (state) =>
    state.localCouplings.value.map(({ srcUid, tgtUid }) => [
      state.srcByUid(srcUid).variables[0],
      state.tgtByUid(tgtUid).variables[0],
    ])

  it('keeps a loaded annotated coupling, even before the context is parsed', () => {
    const [reader, owner] = [toy.port('porter_in', 'c_A_i'), toy.port('cell', 'c_A')]
    const state = open({
      sourcePorts: [reader],
      targetPorts: [owner],
      couplings: [{ sourcePort: reader, targetPort: owner }],
      withContext: false,
    })
    expect(coupled(state)).toEqual([['c_A_i', 'c_A']])
  })

  it('never couples annotated ports automatically, though their labels are equal', () => {
    const state = open({
      sourcePorts: [toy.port('porter_in', 'c_A_i')],
      targetPorts: [toy.port('cell', 'c_A')],
    })
    expect(state.localCouplings.value).toEqual([])
  })

  it('connects compatible annotated ports and blocks a mismatch', () => {
    const state = open({
      sourcePorts: [toy.port('porter_in', 'c_A_i'), toy.port('porter_in', 'c_A_o')],
      targetPorts: [toy.port('cell', 'c_A')],
    })
    const owner = uidOf(state.localTgtPorts, 'c_A')
    expect(state.connectPorts(uidOf(state.localSrcPorts, 'c_A_o'), owner, [])).toEqual([])
    const next = state.connectPorts(uidOf(state.localSrcPorts, 'c_A_i'), owner, [])
    expect(next).toHaveLength(1)
  })

  it('makes a ghost port that mirrors an annotated partner, and couples it', () => {
    const state = open({ sourcePorts: [toy.port('porter_in', 'c_A_i')], targetPorts: [] })
    const partner = state.localSrcPorts.value[0]
    state.activateGhost('target', partner)

    const copy = state.localTgtPorts.value.at(-1)
    expect(copy).toMatchObject({
      label: '',
      variables: [],
      multiportType: 'True',
      annotation: { role: 'owner', location: 'self', source: { kind: 'copied' } },
    })
    expect(state.connectPorts(partner._uid, copy._uid, [])).toEqual([{ srcUid: partner._uid, tgtUid: copy._uid }])
  })

  it('makes no copy of an annotated port before the context locates it', () => {
    const state = open({ sourcePorts: [toy.port('porter_in', 'c_A_i')], targetPorts: [], withContext: false })
    state.activateGhost('target', state.localSrcPorts.value[0])
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
    const state = open({ sourcePorts: [sodium, area], targetPorts: [], siblings: [sibling] })
    expect([...state.takenElsewhereUids.value]).toEqual([uidOf(state.localSrcPorts, 'c_A_i')])
  })

  it('still couples labelled ports by label', () => {
    const port = (label, variables) => ({ portType: 'general_ports', label, variables, multiportType: 'None' })
    const state = open({ sourcePorts: [port('flow', ['q'])], targetPorts: [port('flow', ['q_in']), port('p', ['p'])] })
    expect(coupled(state)).toEqual([['q', 'q_in']])
  })
})
