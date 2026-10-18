import { describe, expect, it } from 'vitest'

import { couplingProblemsWarning } from '../../../../src/services/coupling/loadWarning.js'

const port = (portType, label, variables = ['v']) => ({ portType, label, variables, multiportType: 'None' })
const node = (id, ports, name = id) => ({ id, data: { name, ports } })
const edge = (source, target, couplings) => ({ id: `${source.id}--${target.id}`, source: source.id, target: target.id, data: { couplings } })
const coupling = (source, target, s, t) => ({ sourcePort: source.data.ports[s], targetPort: target.data.ports[t], sourceSlot: 0, targetSlot: 0 })

describe('couplingProblemsWarning', () => {
  it('gives nothing when every connection pairs as CA does', () => {
    const [x, y] = [node('x', [port('exit_ports', 'p')]), node('y', [port('entrance_ports', 'p')])]
    expect(couplingProblemsWarning([x, y], [edge(x, y, [coupling(x, y, 0, 0)])])).toBeNull()
  })

  it('lists each connection as source → target: reason, escaped, and stays until closed', () => {
    const x = node('x', [port('exit_ports', 'p'), port('general_ports', 'q')], '<i>x</i>')
    const y = node('y', [port('entrance_ports', 'p'), port('general_ports', 'q')])
    const warning = couplingProblemsWarning([x, y], [edge(x, y, [coupling(x, y, 0, 0)])])
    expect(warning).toMatchObject({ title: 'Connections CA Would Pair Otherwise', duration: 0 })
    const [line] = warning.message.split('<br>')
    expect(line).toMatch(/^&lt;i&gt;x&lt;\/i&gt; → y: CA couples every label two modules share, so it would also couple &quot;q&quot;/)
    expect(warning.message).toMatch(/Open a connection to see and fix its problems\.$/)
  })

  it('counts the connections past the first eight', () => {
    const nodes = []
    const edges = []
    for (let i = 0; i < 10; i++) {
      const [x, y] = [node(`x${i}`, [port('exit_ports', 'p', ['a', 'b'])]), node(`y${i}`, [port('entrance_ports', 'p', ['a'])])]
      nodes.push(x, y)
      edges.push(edge(x, y, [coupling(x, y, 0, 0)]))
    }
    const lines = couplingProblemsWarning(nodes, edges).message.split('<br>')
    expect(lines).toHaveLength(10)
    expect(lines[8]).toBe('…and 2 more.')
  })
})
