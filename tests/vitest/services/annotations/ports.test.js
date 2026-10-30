import { describe, expect, it } from 'vitest'
import { couplingsToEdges, portFor, reconcileAnnotatedPorts } from '../../../../src/services/annotations/ports.js'
import { suggestCouplings } from '../../../../src/services/annotations/match.js'
import { loadToy } from './toyModel.js'

const quantity = (role, variable = 'x') => ({
  instance: 'a',
  variable,
  subject: `https://phlynx.invalid/modules/a.cellml#a.${variable}`,
  property: 'OPB:00340',
  species: ['CHEBI:29101'],
  location: 'self',
  role,
  mathRef: 'a.cellml:a',
})

describe('portFor', () => {
  it('builds an unlabelled general port carrying the annotation', () => {
    expect(portFor(quantity('owner'))).toEqual({
      portType: 'general_ports',
      label: '',
      variables: ['x'],
      multiportType: 'True',
      annotation: {
        subject: 'https://phlynx.invalid/modules/a.cellml#a.x',
        variable: 'x',
        property: 'OPB:00340',
        species: ['CHEBI:29101'],
        location: 'self',
        role: 'owner',
        source: { kind: 'sidecar', mathRef: 'a.cellml:a' },
      },
    })
  })

  it('maps roles to multiport types', () => {
    expect(portFor(quantity('reader')).multiportType).toBe('None')
    expect(portFor(quantity('aggregator')).multiportType).toBe('Sum')
    expect(portFor(quantity('contributor')).multiportType).toBe('None')
  })
})

describe('couplingsToEdges', () => {
  it('turns toy suggestions into workspace edges', async () => {
    const toy = await loadToy()
    const { suggestions } = suggestCouplings(toy.instances, {
      coords: toy.coords,
      scopes: toy.scopes,
      heldConstant: new Set(['outside', 'vessel']),
    })
    const nodes = new Map(toy.instances.map((instance) => [instance.name, { id: `n_${instance.name}` }]))
    nodes.delete('vessel')
    const edges = couplingsToEdges(suggestions, nodes)
    expect(edges).toHaveLength(suggestions.length - 1)

    const edge = edges.find((candidate) => candidate.id === 'n_porter_in--n_cell')
    expect(edge).toMatchObject({ source: 'n_porter_in', target: 'n_cell' })
    const flux = edge.data.couplings.find((c) => c.sourcePort.variables[0] === 'v_A_i')
    expect(flux.sourcePort).toMatchObject({ multiportType: 'None', annotation: { role: 'contributor' } })
    expect(flux.targetPort).toMatchObject({
      variables: ['v_A'],
      multiportType: 'Sum',
      annotation: { role: 'aggregator' },
    })
    expect(flux.sourcePort.annotation.subject).toBe('https://phlynx.invalid/modules/porter.cellml#flux_in')

    // A plain object works as the lookup too.
    expect(couplingsToEdges(suggestions, Object.fromEntries(nodes))).toEqual(edges)
  })
})

describe('reconcileAnnotatedPorts', () => {
  const MATH_REF = 'a.cellml:a'
  const subjectOf = (variable, component = 'a') => `https://phlynx.invalid/modules/a.cellml#${component}.${variable}`
  const entry = (variable, overrides = {}) => ({
    variable,
    subject: subjectOf(variable),
    property: 'OPB:00340',
    species: ['CHEBI:29101'],
    location: 'self',
    ...overrides,
  })
  const sidecarPort = (variable, overrides = {}) => portFor({ ...quantity('owner', variable), ...overrides })
  const labelPort = { portType: 'general_ports', label: 'x_port', variables: ['x'], multiportType: 'None' }
  const mirrored = {
    portType: 'general_ports',
    label: '',
    variables: ['y'],
    multiportType: 'None',
    annotation: { subject: 'other#b.y', variable: '', role: 'reader', source: { kind: 'copied', mathRef: MATH_REF } },
  }

  it('adds one port per complete entry, after the ports already there', () => {
    const sidecar = { variables: [entry('x'), entry('j', { property: 'OPB:00592' })] }
    const { ports, added } = reconcileAnnotatedPorts([labelPort], sidecar, { mathRef: MATH_REF })
    expect(added).toHaveLength(2)
    expect(ports[0]).toBe(labelPort)
    expect(ports[1]).toEqual(sidecarPort('x'))
    expect(ports[2]).toMatchObject({ variables: ['j'], multiportType: 'Sum', annotation: { role: 'aggregator' } })
  })

  it('leaves label and mirrored ports alone, so a label port and an annotated port share a variable', () => {
    const { ports, removed } = reconcileAnnotatedPorts([labelPort, mirrored], { variables: [entry('x')] }, { mathRef: MATH_REF })
    expect(removed).toEqual([])
    expect(ports).toEqual([labelPort, mirrored, sidecarPort('x')])
  })

  it('gives partial entries, and variables the math lacks, no port', () => {
    const sidecar = { variables: [entry('x', { location: null }), entry('y', { property: null }), entry('z')] }
    const { ports } = reconcileAnnotatedPorts([], sidecar, { mathRef: MATH_REF, variables: ['x', 'y'] })
    expect(ports).toEqual([])
  })

  it('removes ports whose entry is gone or partial, and duplicates of one subject', () => {
    const kept = sidecarPort('x')
    const sidecar = { variables: [entry('x'), entry('y', { location: null })] }
    const { ports, removed } = reconcileAnnotatedPorts([kept, sidecarPort('x'), sidecarPort('y'), sidecarPort('z')], sidecar, {
      mathRef: MATH_REF,
    })
    expect(ports).toEqual([kept])
    expect(removed.map((port) => port.variables[0])).toEqual(['x', 'y', 'z'])
  })

  it('refreshes a changed entry in place, keeping the port type and following the role', () => {
    const port = { ...sidecarPort('x'), portType: 'exit_ports' }
    const sidecar = { variables: [entry('x', { location: 'GO:0005737', species: ['CHEBI:29103'] })] }
    const { ports, changed } = reconcileAnnotatedPorts([port], sidecar, { mathRef: MATH_REF })
    expect(changed).toEqual([{ before: port, after: ports[0] }])
    expect(ports[0]).toMatchObject({
      portType: 'exit_ports',
      multiportType: 'None',
      annotation: { location: 'GO:0005737', species: ['CHEBI:29103'], role: 'reader' },
    })
  })

  it('moves a port to the renamed subject of its variable', () => {
    const port = sidecarPort('x')
    const renamed = entry('x', { subject: subjectOf('x', 'b') })
    const { ports, changed, added } = reconcileAnnotatedPorts([port], { variables: [renamed] }, { mathRef: 'a.cellml:b' })
    expect(added).toEqual([])
    expect(changed).toHaveLength(1)
    expect(ports[0].annotation).toMatchObject({ subject: renamed.subject, source: { kind: 'sidecar', mathRef: 'a.cellml:b' } })
  })

  it('removes every sidecar port without a sidecar, and changes nothing for an unreadable one', () => {
    const ports = [labelPort, sidecarPort('x')]
    expect(reconcileAnnotatedPorts(ports, null, { mathRef: MATH_REF }).ports).toEqual([labelPort])
    expect(reconcileAnnotatedPorts(ports, { unreadable: true, variables: [] }, { mathRef: MATH_REF }).ports).toBe(ports)
  })

  it('changes nothing once reconciled', () => {
    const sidecar = { variables: [entry('x')] }
    const { ports } = reconcileAnnotatedPorts([], sidecar, { mathRef: MATH_REF })
    const again = reconcileAnnotatedPorts(ports, sidecar, { mathRef: MATH_REF })
    expect(again).toMatchObject({ added: [], removed: [], changed: [] })
    expect(again.ports[0]).toBe(ports[0])
  })
})
