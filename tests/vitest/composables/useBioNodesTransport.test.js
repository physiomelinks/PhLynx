import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { CHEBI, GO, OPB } from '../../../src/services/annotations/iris.js'
import { mappingKey } from '../../../src/services/simulation/variableMapping.js'

const flow = (variable, species, location) => ({ variable, property: OPB.molarFlowRate, species: [species], location })
const sidecar = {
  component: { kind: 'transporter', isVersionOf: [] },
  variables: [
    flow('v_Na_i', CHEBI.sodium, GO.cytoplasm),
    flow('v_Na_o', CHEBI.sodium, GO.extracellularRegion),
    flow('v_K_i', CHEBI.potassium, GO.cytoplasm),
    flow('v_K_o', CHEBI.potassium, GO.extracellularRegion),
  ],
}
const run = { results: null, mapping: null }

vi.mock('../../../src/stores/annotationStore', () => ({ useAnnotationStore: () => ({ getApiCoords: () => null }) }))
vi.mock('../../../src/stores/libraryStore', () => ({
  useLibraryStore: () => ({ getParsedModuleAnnotations: (mathRef) => (mathRef === 'pump.cellml:pump' ? sidecar : null), ensureModuleAnnotations: vi.fn() }),
}))
vi.mock('../../../src/stores/simulationResultsStore', () => ({ useSimulationResultsStore: () => run }))

const { useBioNodes } = await import('../../../src/composables/useBioNodes.js')

describe('the arrows on a physiological view’s proteins', () => {
  const nodes = ref([{ id: 'n1', data: { name: 'pump', mathRef: 'pump.cellml:pump', bioView: { role: 'membraneProtein' } } }])

  it('shows what each protein carries both ways before a run, and which way after one', () => {
    const protein = () => useBioNodes(nodes).bioNodes.value.find((n) => n.id === 'n1')
    expect(protein().data.arrows).toEqual([
      { label: 'Na⁺', direction: null },
      { label: 'K⁺', direction: null },
    ])

    // Na⁺ leaving the cell and K⁺ entering it at the end of the run.
    run.results = {
      voi: { name: 't', unit: 's', values: Float64Array.from([0, 1]) },
      variables: new Map([
        ['pump/v_Na_i', { values: Float64Array.from([0, -3]) }],
        ['pump/v_K_i', { values: Float64Array.from([0, 2]) }],
      ]),
    }
    run.mapping = new Map([
      [mappingKey('n1', 'v_Na_i'), 'pump/v_Na_i'],
      [mappingKey('n1', 'v_K_i'), 'pump/v_K_i'],
    ])
    expect(protein().data.arrows).toEqual([
      { label: 'Na⁺', direction: 'out' },
      { label: 'K⁺', direction: 'in' },
    ])
  })

  it('leaves the arrows both ways after a sweep, whose last value isn’t where a run ended', () => {
    run.results = { ...run.results, isSweep: true }
    const protein = useBioNodes(nodes).bioNodes.value.find((n) => n.id === 'n1')
    expect(protein.data.arrows.map((arrow) => arrow.direction)).toEqual([null, null])
  })
})
