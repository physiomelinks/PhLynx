import { describe, expect, it } from 'vitest'

import { connectionsMenu } from '../../../../src/services/bioView/connections.js'

describe('connectionsMenu', () => {
  const nodes = ['p', 'lumen', 'cell'].map((id) => ({ id, data: { name: id } }))
  const coupling = { sourcePort: { label: 'vessel_port' }, targetPort: { label: 'vessel_port' } }

  it('counts each connection’s couplings, and says when it has none', () => {
    const edges = [
      { id: 'e1', source: 'lumen', target: 'p', data: { couplings: [] } },
      { id: 'e2', source: 'p', target: 'cell', data: { couplings: [coupling] } },
    ]
    expect(connectionsMenu('p', nodes, edges).items.map((item) => item.label)).toEqual([
      'cell (1)',
      'lumen (no couplings)',
    ])
  })
})
