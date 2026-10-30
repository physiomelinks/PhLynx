import { describe, expect, it } from 'vitest'

import {
  buildUsedPortKeys,
  checkAndClaimCouplings,
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
})

describe('annotated ports', () => {
  const sodium = annotated('m#s.v_Na_i', ['v_Na_i'])
  const glucose = annotated('m#s.v_Glc_i', ['v_Glc_i'])
  const owner = annotated('m#c.v_Na', ['v_Na'], 'Sum')

  it('are never coupled by label, even with equal empty labels', () => {
    expect(resolvePortCouplings([sodium, glucose], [owner])).toEqual([])
    expect(resolvePortCouplings([port('', 'general_ports', ['a'])], [port('', 'general_ports', ['b'])])).toHaveLength(1)
  })

  it('keep their couplings through a preview while both ports remain, beside the label couplings', () => {
    const label = [port('p', 'exit_ports', ['x']), port('p', 'entrance_ports', ['y'])]
    const nodes = [node('s', [sodium, glucose, label[0]]), node('c', [owner, label[1]])]
    const edges = [edge('e', 's', 'c', [{ sourcePort: { ...sodium }, targetPort: { ...owner } }])]

    const couplings = previewCouplings('s', nodes[0].data.ports, nodes, edges).get('e')
    expect(couplings).toEqual([
      { sourcePort: label[0], targetPort: label[1] },
      { sourcePort: sodium, targetPort: owner },
    ])
    expect(previewCouplings('s', [glucose, label[0]], nodes, edges).get('e')).toEqual([
      { sourcePort: label[0], targetPort: label[1] },
    ])
  })

  it('keep a coupling after the port’s variable changes', () => {
    const picked = annotated('m#s.v_Na_i', ['v_Na_total'])
    const nodes = [node('s', [picked]), node('c', [owner])]
    const edges = [edge('e', 's', 'c', [{ sourcePort: sodium, targetPort: owner }])]
    expect(previewCouplings('s', [picked], nodes, edges).get('e')).toEqual([{ sourcePort: picked, targetPort: owner }])
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
