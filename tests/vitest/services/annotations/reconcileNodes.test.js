import { describe, expect, it } from 'vitest'

import { buildCouplingContext } from '../../../../src/services/annotations/couple.js'
import { portFor } from '../../../../src/services/annotations/ports.js'
import {
  countDroppedCouplings,
  dropStaleAnnotatedPorts,
  findSidecarPortChanges,
  reconcileNodePorts,
} from '../../../../src/services/annotations/reconcileNodes.js'

const quantity = (mathRef, component, variable, overrides = {}) => ({
  variable,
  subject: `https://phlynx.invalid/modules/m.cellml#${component}.${variable}`,
  property: 'OPB:00340',
  species: ['CHEBI:29101'],
  location: 'self',
  role: 'owner',
  mathRef,
  ...overrides,
})
const pool = quantity('m.cellml:pool', 'pool', 'c')
const reader = quantity('m.cellml:cell', 'cell', 'c_o', { location: 'GO:0005576', role: 'reader' })
const entryOf = ({ variable, subject, property, species, location }) => ({ variable, subject, property, species, location })
const nodeOf = (id, mathRef, ports, variables) => ({
  id,
  data: { name: id, mathRef, ports, variables: variables.map((name) => ({ name })) },
})

/** A pool owning c, coupled to a cell reading c_o. */
function buildWorkspace() {
  const poolPort = portFor(pool)
  const readerPort = portFor(reader)
  const nodes = [nodeOf('p', pool.mathRef, [poolPort], ['c']), nodeOf('r', reader.mathRef, [readerPort], ['c_o'])]
  const edges = [{ id: 'e', source: 'p', target: 'r', data: { couplings: [{ sourcePort: poolPort, targetPort: readerPort }] } }]
  return { nodes, edges }
}

describe('reconcileNodePorts', () => {
  it('keeps a coupling whose refreshed ports still agree', () => {
    const { nodes, edges } = buildWorkspace()
    const sidecars = new Map([[pool.mathRef, { variables: [entryOf(pool)] }]])
    const sidecarFor = (mathRef) => sidecars.get(mathRef)
    const result = reconcileNodePorts({ nodes, edges, nodeIds: ['p'], sidecarFor, context: buildCouplingContext({ sidecarFor }) })
    expect(result.ports.size).toBe(0)
    expect(result.couplings.get('e')).toHaveLength(1)
    expect(countDroppedCouplings(edges, result.couplings)).toEqual({ couplings: 0, connections: 0 })
  })

  it('drops a coupling once the sidecar changes its port so it no longer couples', () => {
    const { nodes, edges } = buildWorkspace()
    const changed = { variables: [entryOf({ ...pool, species: ['CHEBI:29103'] })] }
    const sidecarFor = (mathRef) => (mathRef === pool.mathRef ? changed : undefined)
    const result = reconcileNodePorts({ nodes, edges, nodeIds: ['p'], sidecarFor, context: buildCouplingContext({ sidecarFor }) })
    expect(result.ports.get('p')[0].annotation.species).toEqual(['CHEBI:29103'])
    expect(result.couplings.get('e')).toEqual([])
    expect(countDroppedCouplings(edges, result.couplings)).toEqual({ couplings: 1, connections: 1 })
  })

  it('drops a coupling whose port the sidecar no longer annotates', () => {
    const { nodes, edges } = buildWorkspace()
    const result = reconcileNodePorts({ nodes, edges, nodeIds: ['p'], sidecarFor: () => null })
    expect(result.ports.get('p')).toEqual([])
    expect(result.couplings.get('e')).toEqual([])
  })

  it('moves a coupling onto the port of a renamed subject', () => {
    const { nodes, edges } = buildWorkspace()
    const renamed = { ...pool, subject: 'https://phlynx.invalid/modules/m.cellml#tank.c', mathRef: 'm.cellml:tank' }
    nodes[0].data.mathRef = renamed.mathRef
    const sidecarFor = (mathRef) => (mathRef === renamed.mathRef ? { variables: [entryOf(renamed)] } : undefined)
    const result = reconcileNodePorts({ nodes, edges, nodeIds: ['p'], sidecarFor, context: buildCouplingContext({ sidecarFor }) })
    const [coupling] = result.couplings.get('e')
    expect(coupling.sourcePort.annotation.subject).toBe(renamed.subject)
    expect(coupling.sourcePort).toBe(result.ports.get('p')[0])
  })

  it('keeps the port and coupling of a variable renamed under the same id subject', () => {
    const { nodes, edges } = buildWorkspace()
    nodes[0].data.variables = [{ name: 'conc' }]
    const renamed = { variables: [entryOf({ ...pool, variable: 'conc' })] }
    const sidecarFor = (mathRef) => (mathRef === pool.mathRef ? renamed : undefined)
    const context = buildCouplingContext({ sidecarFor })
    const result = reconcileNodePorts({ nodes, edges, nodeIds: ['p'], sidecarFor, context })
    const [port] = result.ports.get('p')
    expect(port).toMatchObject({ variables: ['conc'], annotation: { subject: pool.subject, variable: 'conc' } })
    expect(result.couplings.get('e')[0].sourcePort).toBe(port)
    expect(countDroppedCouplings(edges, result.couplings)).toEqual({ couplings: 0, connections: 0 })
  })

  it('gives no port to an entry for a variable the node’s math lacks', () => {
    const missing = quantity(pool.mathRef, 'pool', 'I_K')
    const nodes = [nodeOf('p', pool.mathRef, [], ['c'])]
    const sidecarFor = () => ({ variables: [entryOf(pool), entryOf(missing)] })
    const result = reconcileNodePorts({ nodes, edges: [], nodeIds: ['p'], sidecarFor })
    expect(result.ports.get('p').map((port) => port.variables[0])).toEqual(['c'])
  })

  it('leaves the ports of a math with no sidecar to follow', () => {
    const { nodes, edges } = buildWorkspace()
    const result = reconcileNodePorts({ nodes, edges, nodeIds: ['p', 'r'], sidecarFor: () => undefined })
    expect(result.ports.size).toBe(0)
    expect(result.couplings.get('e')).toHaveLength(1)
  })
  it('re-checks a coupling on a port the editor already changed', () => {
    const { nodes, edges } = buildWorkspace()
    const before = nodes[0].data.ports
    const after = [portFor({ ...pool, species: ['CHEBI:29103'] })]
    const portChanges = new Map([['p', findSidecarPortChanges(before, after)]])
    nodes[0].data.ports = after
    const sidecarFor = () => undefined
    const result = reconcileNodePorts({ nodes, edges, nodeIds: ['p'], sidecarFor, context: buildCouplingContext({ sidecarFor }), portChanges })
    expect(portChanges.get('p')).toEqual([{ before: before[0], after: after[0] }])
    expect(result.couplings.get('e')).toEqual([])
  })
})

describe('findSidecarPortChanges', () => {
  it('pairs ports by subject before variable, so two swapped names pair with their own subjects', () => {
    const c = portFor(quantity(pool.mathRef, 'pool', 'c', { subject: 'm.cellml#va' }))
    const d = portFor(quantity(pool.mathRef, 'pool', 'd', { subject: 'm.cellml#vb' }))
    const swapped = (port, variable) => ({
      ...port,
      variables: [variable],
      annotation: { ...port.annotation, variable },
    })
    const after = [swapped(d, 'c'), swapped(c, 'd')]
    expect(findSidecarPortChanges([c, d], after)).toEqual([
      { before: c, after: after[1] },
      { before: d, after: after[0] },
    ])
    expect(findSidecarPortChanges([c, d], [d, c])).toEqual([])
  })
})

describe('dropStaleAnnotatedPorts', () => {
  it('drops an annotated port on a variable the math lacks, and the couplings through it', () => {
    const { nodes, edges } = buildWorkspace()
    const label = { portType: 'general_ports', label: 'c', variables: ['c'], multiportType: 'None' }
    edges[0].data.couplings.push({ sourcePort: label, targetPort: label })
    nodes[0].data.ports.push(label)
    nodes[1].data.ports.push(label)
    nodes[1].data.variables = [{ name: 'other' }]
    const { ports, couplings, dropped } = dropStaleAnnotatedPorts(nodes, edges)
    expect(ports.get('r')).toEqual([label])
    expect(ports.has('p')).toBe(false)
    expect(couplings.get('e')).toEqual([{ sourcePort: label, targetPort: label }])
    expect(dropped).toEqual([{ name: 'r', variables: ['c_o'] }])
  })

  it('leaves workspaces whose ports name their math variables, and nodes without rows, as they are', () => {
    const { nodes, edges } = buildWorkspace()
    const result = dropStaleAnnotatedPorts(nodes, edges)
    expect(result).toEqual({ ports: new Map(), couplings: new Map(), dropped: [] })
    delete nodes[1].data.variables
    expect(dropStaleAnnotatedPorts(nodes, edges).dropped).toEqual([])
  })
})
