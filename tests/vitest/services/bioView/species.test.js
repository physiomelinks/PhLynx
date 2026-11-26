import { beforeAll, describe, expect, it } from 'vitest'

import { annotatedMatches, couplingsFromMatches } from '../../../../src/services/annotations/couple.js'
import { CHEBI, GO, OPB } from '../../../../src/services/annotations/iris.js'
import { resolveBioRole } from '../../../../src/services/bioView/roles.js'
import {
  crossingFlow,
  ownSpecies,
  portAnnotation,
  speciesFocus,
  speciesNetwork,
} from '../../../../src/services/bioView/species.js'
import { loadToyNodes } from '../annotations/toyNodes.js'

const annotated = (variable, property, species, location) => ({
  variable,
  subject: `m#${variable}`,
  property,
  species: species ? [species] : [],
  location,
})
const conc = (variable, species, location) => annotated(variable, OPB.concentration, species, location)
const flow = (variable, species, location) => annotated(variable, OPB.molarFlowRate, species, location)

// A pool holding Na⁺ and glucose, of which only Na⁺ is coupled; a porter carrying Na⁺ across.
const POOL = {
  variables: [
    conc('c_Na', CHEBI.sodium, 'self'),
    conc('c_Glc', CHEBI.glucose, 'self'),
    flow('v_Na', CHEBI.sodium, 'self'),
    annotated('volume', OPB.fluidVolume, null, 'self'),
  ],
}
const PORTER = {
  variables: [
    conc('c_Na_o', CHEBI.sodium, GO.extracellularRegion),
    conc('c_Na_i', CHEBI.sodium, GO.cytoplasm),
    flow('v_Na_i', CHEBI.sodium, GO.cytoplasm),
    flow('v_Na_o', CHEBI.sodium, GO.extracellularRegion),
    annotated('W_i', OPB.fluidVolume, null, GO.cytoplasm),
  ],
}
const node = (id, mathRef) => ({ id, data: { name: id, mathRef } })
const port = (variable) => ({ portType: 'general_ports', label: variable, variables: [variable] })
const edge = (source, target, pairs) => ({
  id: `${source}-${target}`,
  source,
  target,
  data: { couplings: pairs.map(([a, b]) => ({ sourcePort: port(a), targetPort: port(b) })) },
})

// held: only the lumen's amount is coupled to the porter, as when it is held at a fixed concentration; flagged: the
// lumen is also marked held (Hold summed flows at 0), as the coupling that left out its flow does.
function toyNetwork({ held = false, flagged = false, ...options } = {}) {
  const lumen = node('lumen', 'pool')
  if (flagged) lumen.data.annotationOverlay = { heldConstant: true }
  const nodes = [lumen, node('cell', 'pool'), node('porter', 'porter'), node('note', 'note')]
  const roles = { lumen: 'region', cell: 'cytosol', porter: 'membraneProtein', note: 'none' }
  const edges = [
    edge('lumen', 'porter', [
      ['c_Na', 'c_Na_o'],
      ...(held ? [] : [['v_Na', 'v_Na_o']]),
      ['volume', 'W_i'],
    ]),
    edge('porter', 'cell', [
      ['c_Na_i', 'c_Na'],
      ['v_Na_i', 'v_Na'],
    ]),
  ]
  const sidecars = { pool: POOL, porter: PORTER }
  const sidecarOf = (n) => sidecars[n.data.mathRef] ?? null
  return {
    nodes,
    sidecarOf,
    network: speciesNetwork({ nodes, edges, roleOf: (id) => roles[id], sidecarOf, ...options }),
  }
}

describe('the species network', () => {
  it('gives each compartment its own coupled species, or every annotated one', () => {
    const { network } = toyNetwork()
    expect([...network.compartments.keys()]).toEqual(['lumen', 'cell'])
    const lumen = network.compartments.get('lumen').map(({ species, label, variable }) => [species, label, variable])
    expect(lumen).toEqual([[CHEBI.sodium, 'Na⁺', 'c_Na']])
    expect(network.compartments.get('cell')[0].flow.variable).toBe('v_Na')

    const all = toyNetwork({ all: true }).network
    expect(all.compartments.get('lumen').map(({ label }) => label)).toEqual(['Na⁺', 'D-glucose'])
  })

  it('shows only the species with a path through a protein, with Species with Fluxes', () => {
    const { network } = toyNetwork({ fluxes: true })
    expect([...network.compartments.keys()]).toEqual(['lumen', 'cell'])
    expect(network.compartments.get('lumen').map(({ label }) => label)).toEqual(['Na⁺'])
    expect(network.paths).toHaveLength(1)
    // Shown with every annotated species asked for too: fluxes wins.
    expect(toyNetwork({ fluxes: true, all: true }).network.compartments.get('lumen')).toHaveLength(1)
  })

  it('hides a species everywhere, with its paths, and still lists it', () => {
    const all = toyNetwork({ all: true }).network
    expect(all.species.map(({ label }) => label).sort()).toEqual(['D-glucose', 'Na⁺'])
    const hidden = toyNetwork({ all: true, hidden: [CHEBI.sodium] }).network
    expect(hidden.compartments.get('lumen').map(({ label }) => label)).toEqual(['D-glucose'])
    expect(hidden.paths).toEqual([])
    // The list is what a menu offers and colours are counted along: unchanged by hiding.
    expect(hidden.species).toEqual(all.species)
    // A compartment left with nothing shown goes.
    expect(toyNetwork({ hidden: [CHEBI.sodium] }).network.compartments.size).toBe(0)
  })

  it('joins a process inside the cell to the compartment species it takes or gives', () => {
    // A process taking Na⁺ from the cell (its flow annotated on itself) and giving glucose (annotated in the
    // cytoplasm).
    const WORKS = {
      variables: [flow('v_Na_used', CHEBI.sodium, 'self'), flow('v_Glc_made', CHEBI.glucose, GO.cytoplasm)],
    }
    const nodes = [node('cell', 'pool'), node('works', 'works')]
    const roles = { cell: 'cytosol', works: 'cytosolic' }
    const GLUCOSE_POOL = { variables: [...POOL.variables, flow('v_Glc', CHEBI.glucose, 'self')] }
    const edges = [
      edge('works', 'cell', [
        ['v_Na_used', 'v_Na'],
        ['v_Glc_made', 'v_Glc'],
      ]),
    ]
    const sidecars = { pool: GLUCOSE_POOL, works: WORKS }
    const build = (options) =>
      speciesNetwork({ nodes, edges, roleOf: (id) => roles[id], sidecarOf: (n) => sidecars[n.data.mathRef], ...options })
    const network = build()
    expect(network.paths).toEqual([])
    expect(network.exchanges).toEqual([
      { process: 'works', compartment: 'cell', species: CHEBI.sodium, label: 'Na⁺', variable: 'v_Na_used', produces: -1 },
      {
        process: 'works',
        compartment: 'cell',
        species: CHEBI.glucose,
        label: 'D-glucose',
        variable: 'v_Glc_made',
        produces: 1,
      },
    ])
    // An exchange is a flux: its species stay with Species with Fluxes, and go when hidden.
    expect(build({ fluxes: true }).compartments.get('cell')).toHaveLength(2)
    expect(build({ hidden: [CHEBI.sodium] }).exchanges.map(({ species }) => species)).toEqual([CHEBI.glucose])
  })

  it('counts a held reservoir with only a dependence as no flux, unless it is the focused one', () => {
    const held = toyNetwork({ held: true, fluxes: true }).network
    expect(held.compartments.size).toBe(0)
    expect(held.paths).toEqual([])
    expect(held.dependences).toEqual([])

    const keep = { nodeId: 'lumen', species: CHEBI.sodium }
    const kept = toyNetwork({ held: true, fluxes: true, keep }).network
    expect([...kept.compartments.keys()]).toEqual(['lumen'])
    expect(kept.dependences).toEqual([
      { protein: 'porter', compartment: 'lumen', species: CHEBI.sodium, label: 'Na⁺', side: 'outside' },
    ])
  })

  it('keeps a focused token its compartment annotates, even one not coupled', () => {
    const keep = { nodeId: 'lumen', species: CHEBI.glucose }
    const { network } = toyNetwork({ fluxes: true, keep })
    expect(network.compartments.get('lumen').map(({ label }) => label)).toEqual(['Na⁺', 'D-glucose'])
    expect(network.compartments.get('cell').map(({ label }) => label)).toEqual(['Na⁺'])
  })

  it('links a protein and a compartment by couplings of one species, on the protein’s side', () => {
    const { network } = toyNetwork()
    expect(network.links.map(({ protein, compartment, kind, side }) => [protein, compartment, kind, side])).toEqual([
      ['porter', 'lumen', 'amount', 'outside'],
      ['porter', 'lumen', 'flow', 'outside'],
      ['porter', 'cell', 'amount', 'inside'],
      ['porter', 'cell', 'flow', 'inside'],
    ])
  })

  it('draws a path from outside the cell, through the protein, to inside', () => {
    expect(toyNetwork().network.paths).toEqual([
      { protein: 'porter', species: CHEBI.sodium, label: 'Na⁺', outside: 'lumen', inside: 'cell' },
    ])
  })

  it('draws no path through an amount coupled alone, but a dependence on it', () => {
    const { network } = toyNetwork({ held: true })
    expect(network.paths).toEqual([])
    expect(network.dependences).toEqual([
      { protein: 'porter', compartment: 'lumen', species: CHEBI.sodium, label: 'Na⁺', side: 'outside' },
    ])
  })

  it('draws a path into a compartment held at its concentration, from the protein’s own flow there', () => {
    const { network } = toyNetwork({ held: true, flagged: true })
    expect(network.paths).toEqual([
      { protein: 'porter', species: CHEBI.sodium, label: 'Na⁺', outside: 'lumen', inside: 'cell' },
    ])
    // The held end is the path's, not something the porter only reads.
    expect(network.dependences).toEqual([])
    expect(toyNetwork({ held: true, flagged: true, fluxes: true }).network.compartments.get('lumen')).toHaveLength(1)
  })

  it('draws no path into a held compartment the protein has no flow of the species to', () => {
    const noOuterFlow = { variables: PORTER.variables.filter(({ variable }) => variable !== 'v_Na_o') }
    const lumen = { id: 'lumen', data: { name: 'lumen', mathRef: 'pool', annotationOverlay: { heldConstant: true } } }
    const nodes = [lumen, node('cell', 'pool'), node('porter', 'porter')]
    const roles = { lumen: 'region', cell: 'cytosol', porter: 'membraneProtein' }
    const edges = [
      edge('lumen', 'porter', [['c_Na', 'c_Na_o']]),
      edge('porter', 'cell', [
        ['c_Na_i', 'c_Na'],
        ['v_Na_i', 'v_Na'],
      ]),
    ]
    const sidecarOf = (n) => ({ pool: POOL, porter: noOuterFlow })[n.data.mathRef]
    const network = speciesNetwork({ nodes, edges, roleOf: (id) => roles[id], sidecarOf })
    expect(network.paths).toEqual([])
    expect(network.dependences.map(({ compartment }) => compartment)).toEqual(['lumen'])
  })

  it('finds no dependence where a flow is coupled too, or the compartment doesn’t show the species', () => {
    expect(toyNetwork().network.dependences).toEqual([])
    const nodes = [node('lumen', 'pool'), node('porter', 'porter')]
    const roles = { lumen: 'region', porter: 'membraneProtein' }
    const edges = [edge('lumen', 'porter', [['c_Glc', 'c_Na_o']])]
    const sidecarOf = (n) => ({ pool: POOL, porter: PORTER })[n.data.mathRef]
    expect(speciesNetwork({ nodes, edges, roleOf: (id) => roles[id], sidecarOf }).dependences).toEqual([])
  })

  it('links and draws the density flow rates of older side-cars as it does molar flow rates', () => {
    const perArea = (a) => (a.property === OPB.molarFlowRate ? { ...a, property: OPB.amountDensityFlowRate } : a)
    const density = (sidecar) => ({ variables: sidecar.variables.map(perArea) })
    const nodes = [node('lumen', 'pool'), node('cell', 'pool'), node('porter', 'porter')]
    const roles = { lumen: 'region', cell: 'cytosol', porter: 'membraneProtein' }
    const edges = [
      edge('lumen', 'porter', [['v_Na', 'v_Na_o']]),
      edge('porter', 'cell', [['v_Na_i', 'v_Na']]),
    ]
    const sidecars = { pool: density(POOL), porter: density(PORTER) }
    const sidecarOf = (n) => sidecars[n.data.mathRef]
    const network = speciesNetwork({ nodes, edges, roleOf: (id) => roles[id], sidecarOf })
    expect(network.links.find((link) => link.compartment === 'cell')).toMatchObject({ kind: 'flow', side: 'inside' })
    expect(network.paths).toHaveLength(1)
    expect(network.compartments.get('cell')[0].flow.variable).toBe('v_Na')
    expect(crossingFlow(sidecars.porter, CHEBI.sodium)).toEqual({ variable: 'v_Na_i', inward: 1 })
  })

  it('draws nothing without coupling edges', () => {
    const nodes = [node('cell', 'pool')]
    const network = speciesNetwork({ nodes, edges: [], roleOf: () => 'cytosol', sidecarOf: () => POOL })
    expect(network.compartments.size).toBe(0)
    const all = speciesNetwork({ nodes, edges: [], roleOf: () => 'cytosol', sidecarOf: () => POOL, all: true })
    expect(all.compartments.size).toBe(1)
  })

  it('reads a port’s own annotation before its variable’s', () => {
    const own = {
      annotation: { subject: 'x', property: OPB.amount, species: [CHEBI.potassium], location: 'self' },
      variables: ['c_Na'],
    }
    expect(portAnnotation(own, POOL).species).toEqual([CHEBI.potassium])
    expect(portAnnotation(port('c_Na'), POOL).variable).toBe('c_Na')
    expect(portAnnotation(port('nope'), POOL)).toBeNull()
  })

  it('prefers a compartment’s concentration of a species over its amount', () => {
    const own = ownSpecies({
      variables: [annotated('n_K', OPB.amount, CHEBI.potassium, 'self'), conc('c_K', CHEBI.potassium, 'self')],
    })
    expect(own.get(CHEBI.potassium).variable).toBe('c_K')
  })

  it('reads which way a protein moves a species from its inside flow, else its outside one', () => {
    expect(crossingFlow(PORTER, CHEBI.sodium)).toEqual({ variable: 'v_Na_i', inward: 1 })
    const outsideOnly = { variables: [flow('v_o', CHEBI.sodium, GO.extracellularRegion)] }
    expect(crossingFlow(outsideOnly, CHEBI.sodium)).toEqual({ variable: 'v_o', inward: -1 })
    expect(crossingFlow(PORTER, CHEBI.potassium)).toBeNull()
  })
})

describe('what a species token plots', () => {
  const focus = (nodeId, held = false) => {
    const { network, nodes, sidecarOf } = toyNetwork({ held })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const options = { nameOf: (id) => id, sidecarOf: (id) => sidecarOf(byId.get(id)) }
    return speciesFocus(network, { nodeId, species: CHEBI.sodium }, options)
  }

  it('plots a compartment’s amount, its net inflow and the coupled flows into it', () => {
    expect(focus('cell')).toEqual({
      entries: [
        { nodeId: 'cell', variable: 'c_Na', label: 'cell · Na⁺ concentration' },
        { nodeId: 'cell', variable: 'v_Na', label: 'cell · Na⁺ molar flow rate' },
        { nodeId: 'porter', variable: 'v_Na_i', label: 'porter · Na⁺ molar flow rate (cytoplasm)' },
      ],
      scope: ['cell', 'porter'],
    })
  })

  it('plots each coupled protein’s flow on that side where no flow is coupled', () => {
    expect(focus('lumen', true)).toEqual({
      entries: [
        { nodeId: 'lumen', variable: 'c_Na', label: 'lumen · Na⁺ concentration' },
        { nodeId: 'porter', variable: 'v_Na_o', label: 'porter · Na⁺ molar flow rate (extracellular region)' },
      ],
      scope: ['lumen', 'porter'],
    })
  })

  it('plots nothing for a species the compartment doesn’t show', () => {
    expect(focus('note')).toEqual({ entries: [], scope: [] })
  })
})

describe('the species network of the toy model placed on an epithelial cell', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  // Each toy instance's role, as the view's overrides give it, at its template site.
  const ROLES = {
    outside: 'region',
    cell: 'cytosol',
    wall: 'membrane',
    porter_in: 'membraneProtein',
    porter_out: 'membraneProtein',
    vessel: 'region',
  }

  it('shows coupled species in every compartment, and a path through every transporter', () => {
    const nodes = Object.entries(ROLES).map(([name, role]) => {
      const placed = toy.node(name)
      return { ...placed, id: name, data: { ...placed.data, bioView: { ...placed.data.bioView, role } } }
    })
    const context = toy.context(nodes)
    const sidecarOf = (n) => toy.sidecarFor(n.data.mathRef)
    const roles = new Map(nodes.map((n) => [n.id, resolveBioRole(n.data, { sidecar: sidecarOf(n) }).role]))
    // The edges the matcher couples the placed instances with.
    const matches = annotatedMatches(nodes, context)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges = matches.map(({ sourceName, targetName }) => ({
      id: `${sourceName}-${targetName}`,
      source: sourceName,
      target: targetName,
      data: { couplings: couplingsFromMatches(matches, byId.get(sourceName), byId.get(targetName)).couplings },
    }))
    const options = { nodes, edges, roleOf: (id) => roles.get(id), sidecarOf }
    const network = speciesNetwork(options)

    for (const id of ['outside', 'cell', 'vessel']) {
      expect(network.compartments.get(id)?.map((token) => token.species), id).toEqual([CHEBI.sodium])
    }
    for (const id of ['porter_in', 'porter_out']) {
      const paths = network.paths.filter((path) => path.protein === id)
      expect(paths.length, id).toBeGreaterThan(0)
      for (const path of paths) {
        expect(roles.get(path.outside), id).toBe('region')
        expect(path.inside, id).toBe('cell')
      }
    }

    // A click on the cell's token plots its amount first, and runs the cell.
    const [{ species, variable }] = network.compartments.get('cell')
    const { entries, scope } = speciesFocus(network, { nodeId: 'cell', species }, { nameOf: (x) => x, sidecarOf: (x) => sidecarOf(byId.get(x)) })
    expect(entries[0]).toMatchObject({ nodeId: 'cell', variable })
    expect(scope[0]).toBe('cell')
  })
})
