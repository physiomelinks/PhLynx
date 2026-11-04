// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHEBI, GO, OPB } from '../../../src/services/annotations/iris.js'
import { mappingKey } from '../../../src/services/simulation/variableMapping.js'

const flow = (variable, species, location) => ({ variable, property: OPB.molarFlowRate, species: [species], location })
const sidecars = new Map([
  [
    'NKA.cellml:NKA',
    { variables: [flow('v_Na_i', CHEBI.sodium, GO.cytoplasm), flow('v_K_i', CHEBI.potassium, GO.cytoplasm)] },
  ],
  [
    'compartment.cellml:compartment',
    { variables: [{ variable: 'c_Na', property: OPB.concentration, species: [CHEBI.sodium], location: 'self' }] },
  ],
])

vi.mock('../../../src/stores/libraryStore', () => ({
  useLibraryStore: () => ({ getParsedModuleAnnotations: (mathRef) => sidecars.get(mathRef) ?? null }),
}))

const { useSelectionPlot } = await import('../../../src/composables/useSelectionPlot.js')
const { useSimulationCharts } = await import('../../../src/composables/useSimulationCharts.js')
const { useAppSettings } = await import('../../../src/composables/useAppSettings.js')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
const { useViewModeStore } = await import('../../../src/stores/viewModeStore.js')

const instance = (id, name, mathRef, role) => ({ id, selected: false, data: { name, mathRef, bioView: { role } } })

describe('the physiological view’s selection plot', () => {
  let nodes
  beforeEach(() => {
    setActivePinia(createPinia())
    nodes = ref([
      instance('p', 'NKA', 'NKA.cellml:NKA', 'membraneProtein'),
      instance('c', 'epithelial', 'compartment.cellml:compartment', 'cytosol'),
      instance('k', 'note', 'note.cellml:note', 'none'),
    ])
    useSimulationResultsStore().finishRun({
      results: {
        voi: { name: 'environment/t', unit: 'second', values: Float64Array.of(0, 1) },
        variables: new Map([
          ['NKA/v_Na_i', { unit: 'fmol_per_s', values: Float64Array.of(0, -3) }],
          ['NKA/v_K_i', { unit: 'fmol_per_s', values: Float64Array.of(0, 2) }],
          ['epithelial/c_Na', { unit: 'mM', values: Float64Array.of(10, 11) }],
        ]),
      },
      mapping: new Map([
        [mappingKey('p', 'v_Na_i'), 'NKA/v_Na_i'],
        [mappingKey('p', 'v_K_i'), 'NKA/v_K_i'],
        [mappingKey('c', 'c_Na'), 'epithelial/c_Na'],
      ]),
      signature: 's',
    })
  })
  afterEach(() => useAppSettings().saveAppSettings({ autoPlotSelection: true }))

  const select = (...ids) => nodes.value.forEach((node) => (node.selected = ids.includes(node.id)))

  it('follows the selection: a protein’s flows, then a compartment’s concentrations', () => {
    useViewModeStore().mode = 'bio'
    const selection = useSelectionPlot(nodes)
    const { charts } = useSimulationCharts(nodes, { plotConfig: selection.plotConfig })
    expect(selection.hint.value).toMatch(/^Select a protein/)

    select('p')
    expect(charts.value.map(({ plotLabel, unit, title }) => [plotLabel, unit, title])).toEqual([
      [
        'Selection',
        'fmol_per_s',
        'NKA · Na⁺ molar flow rate (cytoplasm), NKA · K⁺ molar flow rate (cytoplasm)',
      ],
    ])

    select('c')
    const labels = charts.value.map(({ series }) => series.map(({ label }) => label))
    expect(labels).toEqual([['epithelial · Na⁺ concentration']])

    select('k')
    expect(charts.value).toEqual([])
    expect(selection.hint.value).toBe('note has no annotated flows, concentrations, amounts or potential to plot.')
  })

  it('never touches the workspace’s plots', () => {
    useViewModeStore().mode = 'bio'
    const settingsStore = useSimulationSettingsStore()
    const before = JSON.stringify(settingsStore.plotConfig)
    const selection = useSelectionPlot(nodes)
    select('p', 'c')
    useSimulationCharts(nodes, { plotConfig: selection.plotConfig }).charts.value
    expect(selection.plotConfig.value.selections).toHaveLength(3)
    expect(JSON.stringify(settingsStore.plotConfig)).toBe(before)
  })

  it('plots nothing in the diagram, or with auto-plot off', () => {
    const selection = useSelectionPlot(nodes)
    select('p')
    expect(selection.isShown.value).toBe(false)
    expect(selection.plotConfig.value.selections).toEqual([])

    useViewModeStore().mode = 'bio'
    expect(selection.plotConfig.value.selections).toHaveLength(2)
    selection.setOn(false)
    expect(selection.isOn.value).toBe(false)
    expect(selection.plotConfig.value.selections).toEqual([])
    expect(useAppSettings().settings.autoPlotSelection).toBe(false)
  })
})
