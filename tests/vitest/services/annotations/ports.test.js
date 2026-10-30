import { describe, expect, it } from 'vitest'
import { couplingsToEdges, portFor } from '../../../../src/services/annotations/ports.js'
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
