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

  it('follows the run to the cursor, sizing each point against the largest flow of the stretch played', () => {
    run.results = {
      voi: { name: 't', unit: 's', values: Float64Array.from([0, 1, 2, 3]) },
      variables: new Map([['porter/v_Na_i', { values: Float64Array.from([4, 1, 0, -16]) }]]),
    }
    run.mapping = new Map([[mappingKey('porter', 'v_Na_i'), 'porter/v_Na_i']])
    const voiCursor = ref(null)
    const { species } = useBioNodes(nodes, edges, { speciesMode: ref({ all: false }), voiCursor })
    const shown = () => [species.value.paths[0].direction, species.value.paths[0].width]
    // With no cursor, the run's end, drawn as wide as a path gets.
    expect(shown()).toEqual(['out', 5])

    // Over the whole run the largest flow is its last: a quarter of it is half as wide a share.
    voiCursor.value = { index: 0, range: [0, 3] }
    expect(shown()).toEqual(['in', 1.5 + 3.5 * 0.5])
    voiCursor.value = { index: 2, range: [0, 3] }
    expect(shown()).toEqual([null, 1.5])
    voiCursor.value = { index: 3, range: [0, 3] }
    expect(shown()).toEqual(['out', 5])
    // Over its first three points alone, the first is the largest.
    voiCursor.value = { index: 0, range: [0, 2] }
    expect(shown()).toEqual(['in', 5])
    voiCursor.value = { index: 1, range: [0, 2] }
    expect(shown()).toEqual(['in', 1.5 + 3.5 * 0.5])
  })

  it('points a process’s exchange the way its flow goes: out while it gives the species away', () => {
    // A porter inside the cell is a process; its flow into the cytoplasm is what it gives the cell's pool.
    const inside = ref([
      node('cell', 'pool', { role: 'cytosol' }),
      node('works', 'porter', { role: 'cytosolic', cell: 'cell' }),
    ])
    const coupled = ref([couple('works', 'cell', [['v_Na_i', 'v_Na']])])
    run.results = {
      voi: { name: 't', unit: 's', values: Float64Array.from([0, 1]) },
      variables: new Map([['works/v_Na_i', { values: Float64Array.from([2, -1]) }]]),
    }
    run.mapping = new Map([[mappingKey('works', 'v_Na_i'), 'works/v_Na_i']])
    const voiCursor = ref(null)
    const { species } = useBioNodes(inside, coupled, { speciesMode: ref({ all: false }), voiCursor })
    expect(species.value.paths.map(({ protein, direction }) => [protein, direction])).toEqual([['works', 'in']])
    voiCursor.value = { index: 0, range: [0, 1] }
    expect(species.value.paths[0].direction).toBe('out')
  })
})

describe('uncoupled modules in the physiological view', () => {
  it('marks a protein or process no edge couples, as a new module is until its math has ports', () => {
    const nodes = ref([
      node('cell', 'pool', { role: 'cytosol' }),
      node('porter', 'porter', { role: 'membraneProtein', cell: 'cell', facet: 'apical' }),
      node('fresh', 'porter', { role: 'membraneProtein', cell: 'cell', facet: 'apical' }),
      node('works', 'porter', { role: 'cytosolic', cell: 'cell' }),
    ])
    // Joined to the cell by its drop, but coupled through nothing.
    const edges = ref([
      couple('porter', 'cell', [['v_Na_i', 'v_Na']]),
      { id: 'fresh-cell', source: 'fresh', target: 'cell', data: { couplings: [], placement: 'across' } },
    ])
    const { bioNodes } = useBioNodes(nodes, edges)
    const flag = (id) => bioNodes.value.find((n) => n.id === id)?.data.uncoupled
    expect([flag('porter'), flag('fresh'), flag('works'), flag('cell')]).toEqual([false, true, true, undefined])
    // Once its math is saved with ports, its edge couples and the mark goes.
    edges.value = [...edges.value.slice(0, 1), couple('fresh', 'cell', [['v_Na_i', 'v_Na']])]
    expect(flag('fresh')).toBe(false)
  })
})
