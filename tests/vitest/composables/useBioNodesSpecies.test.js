import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { CHEBI, GO, OPB } from '../../../src/services/annotations/iris.js'
import { mappingKey } from '../../../src/services/simulation/variableMapping.js'

const annotated = (variable, property, species, location) => ({ variable, property, species: [species], location })
const sidecars = {
  'pool.cellml:pool': {
    variables: [
      annotated('c_Na', OPB.concentration, CHEBI.sodium, 'self'),
      annotated('c_K', OPB.concentration, CHEBI.potassium, 'self'),
      annotated('v_Na', OPB.molarFlowRate, CHEBI.sodium, 'self'),
    ],
  },
  'porter.cellml:porter': {
    component: { kind: 'transporter', isVersionOf: [] },
    variables: [
      annotated('c_Na_o', OPB.concentration, CHEBI.sodium, GO.extracellularRegion),
      annotated('c_Na_i', OPB.concentration, CHEBI.sodium, GO.cytoplasm),
      annotated('v_Na_i', OPB.molarFlowRate, CHEBI.sodium, GO.cytoplasm),
      annotated('v_Na_o', OPB.molarFlowRate, CHEBI.sodium, GO.extracellularRegion),
    ],
  },
}
const run = { results: null, mapping: null }

vi.mock('../../../src/stores/libraryStore', () => ({
  useLibraryStore: () => ({
    getModuleAnnotations: () => null,
    getParsedModuleAnnotations: (mathRef) => sidecars[mathRef] ?? null,
    ensureModuleAnnotations: vi.fn(),
  }),
}))
vi.mock('../../../src/stores/bioTemplateStore', () => ({
  useBioTemplateStore: () => ({ instances: [], definitions: new Map() }),
}))
vi.mock('../../../src/stores/simulationResultsStore', () => ({ useSimulationResultsStore: () => run }))

const { useBioNodes } = await import('../../../src/composables/useBioNodes.js')

const node = (id, module, bioView) => ({ id, data: { name: id, mathRef: `${module}.cellml:${module}`, bioView } })
const port = (variable) => ({ variables: [variable] })
const couple = (source, target, pairs) => ({
  id: `${source}-${target}`,
  source,
  target,
  data: { couplings: pairs.map(([a, b]) => ({ sourcePort: port(a), targetPort: port(b) })) },
})

describe('species mode in the physiological view', () => {
  const nodes = ref([
    node('cell', 'pool', { role: 'cytosol' }),
    node('lumen', 'pool', { role: 'region', adjacent: [{ cell: 'cell', facet: 'apical' }] }),
    node('porter', 'porter', { role: 'membraneProtein', cell: 'cell', facet: 'apical' }),
  ])
  const edges = ref([
    couple('lumen', 'porter', [
      ['c_Na', 'c_Na_o'],
      ['v_Na', 'v_Na_o'],
    ]),
    couple('porter', 'cell', [
      ['c_Na_i', 'c_Na'],
      ['v_Na_i', 'v_Na'],
    ]),
  ])

  it('works out nothing while species mode is off, but knows there are species to show', () => {
    const { hasSpecies, species } = useBioNodes(nodes, edges)
    expect(hasSpecies.value).toBe(true)
    expect(species.value).toBeNull()
  })

  it('shows the coupled species, or every annotated one, and the path through the protein', () => {
    const speciesMode = ref({ all: false })
    const { species } = useBioNodes(nodes, edges, { speciesMode })
    expect(species.value.tokens.map(({ key }) => key).sort()).toEqual(['cell::CHEBI:29101', 'lumen::CHEBI:29101'])
    const ends = species.value.paths.map(({ protein, outside, inside, direction }) => [protein, outside, inside, direction])
    expect(ends).toEqual([['porter', 'lumen', 'cell', null]])
    expect(species.value.dependences).toEqual([])

    speciesMode.value = { all: true }
    expect(species.value.tokens).toHaveLength(4)
  })

  it('shows only species with a path through a protein, and keeps a focused one', () => {
    const speciesMode = ref({ fluxes: true })
    const { species } = useBioNodes(nodes, edges, { speciesMode })
    expect(species.value.tokens.map(({ key }) => key).sort()).toEqual(['cell::CHEBI:29101', 'lumen::CHEBI:29101'])
    speciesMode.value = { fluxes: true, keep: { nodeId: 'cell', species: CHEBI.potassium } }
    expect(species.value.tokens.map(({ key }) => key)).toContain(`cell::${CHEBI.potassium}`)
    expect(species.value.tokens).toHaveLength(3)
  })

  it('lays a compartment’s tokens out in the order its bioView keeps', () => {
    const xOf = (order) => {
      const ordered = ref(
        nodes.value.map((n) =>
          n.id === 'cell' ? { ...n, data: { ...n.data, bioView: { ...n.data.bioView, speciesOrder: order } } } : n
        )
      )
      const { species } = useBioNodes(ordered, edges, { speciesMode: ref({ all: true }) })
      const cell = species.value.tokens.filter((t) => t.nodeId === 'cell')
      return Object.fromEntries(cell.map((t) => [t.species, t.x]))
    }
    const kFirst = xOf([CHEBI.potassium, CHEBI.sodium])
    const naFirst = xOf([CHEBI.sodium, CHEBI.potassium])
    expect(kFirst[CHEBI.potassium]).toBeLessThan(kFirst[CHEBI.sodium])
    expect(naFirst[CHEBI.sodium]).toBeLessThan(naFirst[CHEBI.potassium])
  })

  it('previews where one compartment’s tokens go in an order, as keeping it would lay them out', () => {
    const { species, speciesOrderPreview } = useBioNodes(nodes, edges, { speciesMode: ref({ all: true }) })
    expect(species.value).not.toBeNull()
    const order = [CHEBI.sodium, CHEBI.potassium]
    const preview = speciesOrderPreview('cell', order)
    expect(preview.every((t) => t.nodeId === 'cell')).toBe(true)
    const ordered = ref(
      nodes.value.map((n) =>
        n.id === 'cell' ? { ...n, data: { ...n.data, bioView: { ...n.data.bioView, speciesOrder: order } } } : n
      )
    )
    const kept = useBioNodes(ordered, edges, { speciesMode: ref({ all: true }) }).species.value.tokens
    const at = (tokens) => tokens.filter((t) => t.nodeId === 'cell').map((t) => [t.key, t.x, t.y])
    expect(at(preview)).toEqual(at(kept))
    // Nothing to preview while species mode is off.
    expect(useBioNodes(nodes, edges).speciesOrderPreview('cell', order)).toEqual([])
  })

  it('points a path the way its species went in the last run', () => {
    run.results = {
      voi: { name: 't', unit: 's', values: Float64Array.from([0, 1]) },
      variables: new Map([['porter/v_Na_i', { values: Float64Array.from([0, -3]) }]]),
    }
    run.mapping = new Map([[mappingKey('porter', 'v_Na_i'), 'porter/v_Na_i']])
    const { species } = useBioNodes(nodes, edges, { speciesMode: ref({ all: false }) })
    expect(species.value.paths[0].direction).toBe('out')
  })
})
