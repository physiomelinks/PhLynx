import { describe, expect, it, vi } from 'vitest'

import { useEdgeCouplings } from '../../../src/composables/useEdgeCouplings.js'
import { resolvePortCouplings } from '../../../src/utils/edges.js'

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
