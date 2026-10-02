import { describe, expect, it } from 'vitest'

import { getConnectionFedVariables, resolvePortCouplings } from '../../../src/utils/edges.js'

// Minimal modules: a source whose exit port gives [v, u_out], and a sink whose
// entrance port takes [v_in (boundary_condition), u (variable)].
const modules = new Map([
  [
    'source:x',
    {
      variables: [
        { name: 'v', type: 'variable' },
        { name: 'u_out', type: 'boundary_condition' },
      ],
    },
  ],
  [
    'sink:x',
    {
      variables: [
        { name: 'v_in', type: 'boundary_condition' },
        { name: 'u', type: 'variable' },
      ],
    },
  ],
])
const libraryStore = { availableModules: modules }

const node = (id, moduleRef, ports) => ({ id, data: { name: id, moduleRef, ports } })
const port = (portType, variables, multiportType = 'None') => ({
  portType,
  label: 'vessel_port',
  variables,
  multiportType,
})

function edgeBetween(source, target) {
  const couplings = resolvePortCouplings(source.data.ports, target.data.ports)
  return { source: source.id, target: target.id, data: { couplings } }
}

describe('getConnectionFedVariables', () => {
  it('marks boundary_condition variables on a plain coupling, on both sides, and nothing else', () => {
    const source = node('a', 'source:x', [port('exit_ports', ['v', 'u_out'])])
    const sink = node('b', 'sink:x', [port('entrance_ports', ['v_in', 'u'])])

    const fed = getConnectionFedVariables([source, sink], [edgeBetween(source, sink)], libraryStore)

    expect([...fed.get('a')]).toEqual(['u_out'])
    expect([...fed.get('b')]).toEqual(['v_in'])
  })

  it('marks nothing when the nodes are not connected', () => {
    const source = node('a', 'source:x', [port('exit_ports', ['v', 'u_out'])])
    const sink = node('b', 'sink:x', [port('entrance_ports', ['v_in', 'u'])])
    expect(getConnectionFedVariables([source, sink], [], libraryStore).size).toBe(0)
  })

  it('marks the target of a Multiply port whatever its type', () => {
    const source = node('a', 'source:x', [{ ...port('exit_ports', ['v'], 'Multiply'), multiplyFactor: 2 }])
    const sink = node('b', 'sink:x', [port('entrance_ports', ['u'])])

    const fed = getConnectionFedVariables([source, sink], [edgeBetween(source, sink)], libraryStore)

    expect(fed.get('a')).toBeUndefined()
    expect([...fed.get('b')]).toEqual(['u'])
  })
})
