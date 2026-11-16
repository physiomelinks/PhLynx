import { describe, expect, it } from 'vitest'

import { spreadConfig, spreadPortEdits } from '../../../src/services/configSpread.js'

const node = (id, moduleRef, variables = [{ name: 'x', value: '2', units: 'metre', access: 'access', type: 'variable' }]) => ({
  id,
  data: { name: id, moduleRef, variables, ports: [] },
})
const ports = [{ _uid: 'a_0', label: 'q', portType: 'general_ports', variables: ['x', 'k'] }]
const variables = [
  { name: 'x', value: '9', units: 'centimetre', access: 'access', type: 'state' },
  { name: 'k', value: '3', units: 'per_second', access: 'none', type: 'constant' },
]

describe('spreadConfig', () => {
  it("gives the config's ports without ids, and its kinds over the instance's own values, adding rows it lacks blank", () => {
    expect(spreadConfig(node('b', 'm:base'), { ports, variables })).toEqual({
      ports: [{ label: 'q', portType: 'general_ports', variables: ['x', 'k'] }],
      variables: [
        { name: 'x', value: '2', units: 'centimetre', access: 'access', type: 'state' },
        { name: 'k', value: null, units: 'per_second', access: 'none', type: 'constant', data_reference: null },
      ],
    })
  })

  it("keeps the instance's own annotated ports, which its side-car gives, and spreads only manual ones", () => {
    const annotated = (subject) => ({ label: '', portType: 'general_ports', variables: ['x'], annotation: { subject } })
    const other = { id: 'b', data: { ...node('b', 'm:base').data, ports: [annotated('b#x')] } }
    expect(spreadConfig(other, { ports: [...ports, annotated('a#x')], variables }).ports).toEqual([
      { label: 'q', portType: 'general_ports', variables: ['x', 'k'] },
      annotated('b#x'),
    ])
  })
})

describe('spreadPortEdits', () => {
  const nodes = [node('a', 'm:base'), node('b', 'm:base'), node('c', 'm:base'), node('d', 'm:other')]
  const edits = [{ node: { ...nodes[0], data: { ...nodes[0].data, variables } }, ports }]

  it('reaches every other instance on an updated module, but none the edit changes itself', () => {
    const spread = spreadPortEdits(edits, new Map([['a', { action: 'update' }], ['c', { action: 'new', moduleRef: 'm:c' }]]), nodes)
    expect([...spread.keys()]).toEqual(['b'])
    expect(spread.get('b').ports[0]).not.toHaveProperty('_uid')
  })

  it('reaches no one when the instance saves a new config', () => {
    expect(spreadPortEdits(edits, new Map([['a', { action: 'new', moduleRef: 'm:a' }]]), nodes).size).toBe(0)
  })
})
