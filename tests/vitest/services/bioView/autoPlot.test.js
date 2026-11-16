import { describe, expect, it } from 'vitest'

import { CHEBI, GO, OPB } from '../../../../src/services/annotations/iris.js'
import {
  SELECTION_PLOT_ID,
  buildSelectionPlot,
  selectionLabel,
  selectionPlotVariables,
} from '../../../../src/services/bioView/autoPlot.js'

const annotation = (variable, property, species = [], location = 'self') => ({ variable, property, species, location })

const pump = {
  variables: [
    annotation('c_Na_o', OPB.concentration, [CHEBI.sodium], GO.extracellularRegion),
    annotation('V_m', OPB.electricalPotential, [], 'self+GO:0005886'),
    annotation('I', OPB.chargeFlowRate),
    annotation('v_Na_i', OPB.molarFlowRate, [CHEBI.sodium], GO.cytoplasm),
    annotation('v_K_o', OPB.molarFlowRate, [CHEBI.potassium], GO.extracellularRegion),
  ],
}
const compartment = {
  variables: [
    annotation('q_Na', OPB.molarFlowRate, [CHEBI.sodium]),
    annotation('W', OPB.fluidVolume),
    annotation('c_Na', OPB.concentration, [CHEBI.sodium]),
    annotation('c_K', OPB.concentration, [CHEBI.potassium]),
    annotation('A', OPB.spatialArea, [], 'self+GO:0005886'),
  ],
}
const membrane = { variables: [annotation('I_total', OPB.chargeFlowRate), annotation('u', OPB.electricalPotential)] }

const node = (id, name) => ({ id, data: { name } })
const names = (variables) => variables.map(({ variable }) => variable)

describe('selectionPlotVariables', () => {
  it("plots a protein's annotated flows, molar then charge, and nothing it only reads", () => {
    const variables = selectionPlotVariables(node('p', 'NKA'), 'membraneProtein', pump)
    expect(names(variables)).toEqual(['v_Na_i', 'v_K_o', 'I'])
    expect(variables[0]).toEqual({ nodeId: 'p', variable: 'v_Na_i', label: 'NKA · Na⁺ molar flow rate (cytoplasm)' })
  })

  it("plots a protein's older density flow rates as it does its molar flow rates", () => {
    const flux = {
      variables: [
        annotation('I', OPB.chargeFlowRate),
        annotation('j_Na', OPB.amountDensityFlowRate, [CHEBI.sodium], GO.cytoplasm),
      ],
    }
    const variables = selectionPlotVariables(node('p', 'SGLT1'), 'membraneProtein', flux)
    expect(names(variables)).toEqual(['j_Na', 'I'])
    expect(variables[0].label).toBe('SGLT1 · Na⁺ chemical amount density flow rate (cytoplasm)')
  })

  it("plots a storage site's concentrations, then amounts and volume, but not the flows summed into it", () => {
    expect(names(selectionPlotVariables(node('c', 'epithelial'), 'cytosol', compartment))).toEqual(['c_Na', 'c_K', 'W'])
    expect(names(selectionPlotVariables(node('l', 'lumen'), 'region', compartment))).toEqual(['c_Na', 'c_K', 'W'])
    const withAmounts = {
      variables: [annotation('q_K', OPB.amount, [CHEBI.potassium]), ...compartment.variables],
    }
    const variables = selectionPlotVariables(node('c', 'epithelial'), 'cytosol', withAmounts)
    expect(names(variables)).toEqual(['c_Na', 'c_K', 'q_K', 'W'])
    expect(variables[2].label).toBe('epithelial · K⁺ amount')
  })

  it("plots a membrane's potential, then its charge flow", () => {
    const variables = selectionPlotVariables(node('m', 'Membrane'), 'membrane', membrane)
    expect(variables.map(({ label }) => label)).toEqual([
      'Membrane · electrical potential',
      'Membrane · charge flow rate',
    ])
  })

  it('plots nothing of an instance without annotations, or with no physiological role', () => {
    expect(selectionPlotVariables(node('p', 'NKA'), 'membraneProtein', null)).toEqual([])
    expect(selectionPlotVariables(node('p', 'NKA'), 'membraneProtein', { variables: [] })).toEqual([])
    expect(selectionPlotVariables(node('p', 'NKA'), 'none', pump)).toEqual([])
  })
})

describe('selectionLabel', () => {
  it("names a place within the instance's own by its term alone", () => {
    expect(selectionLabel('NKA', annotation('V_m', OPB.electricalPotential, [], 'self+GO:0005886'))).toBe(
      'NKA · electrical potential (plasma membrane)'
    )
  })
})

describe('buildSelectionPlot', () => {
  const sidecars = new Map([['p', pump], ['c', compartment], ['x', null]])
  const roles = new Map([['p', 'membraneProtein'], ['c', 'cytosol'], ['x', 'none']])
  const options = { roleOf: (n) => roles.get(n.id), sidecarOf: (n) => sidecars.get(n.id) }

  it('puts every selected instance on one plot of its own, each variable once, naming those with nothing', () => {
    const p = node('p', 'NKA')
    const selected = [p, node('c', 'epithelial'), p, node('x', 'note')]
    const { plotConfig, total, unannotated } = buildSelectionPlot(selected, options)
    expect(plotConfig.groups).toEqual([{ id: SELECTION_PLOT_ID, name: 'Selection' }])
    const keys = ['p::v_Na_i', 'p::v_K_o', 'p::I', 'c::c_Na', 'c::c_K', 'c::W']
    expect(plotConfig.selections.map(({ key }) => key)).toEqual(keys)
    expect(plotConfig.selections.every(({ groupId }) => groupId === SELECTION_PLOT_ID)).toBe(true)
    expect(total).toBe(6)
    expect(unannotated).toEqual(['note'])
  })

  it('plots at most the limit, counting the rest', () => {
    const selected = [node('p', 'NKA'), node('c', 'epithelial')]
    const { plotConfig, total } = buildSelectionPlot(selected, { ...options, limit: 4 })
    expect(plotConfig.selections).toHaveLength(4)
    expect(total).toBe(6)
  })

  it('plots given entries first, as a species token gives them, each variable once', () => {
    const entries = [
      { nodeId: 'c', nodeName: 'epithelial', variable: 'c_Na', label: 'epithelial · Na⁺ concentration' },
      { nodeId: 'p', variable: 'v_Na_i', label: 'NKA · Na⁺' },
    ]
    const { plotConfig, total } = buildSelectionPlot([node('c', 'epithelial')], { ...options, entries })
    expect(plotConfig.selections.map(({ key, nodeName }) => [key, nodeName])).toEqual([
      ['c::c_Na', 'epithelial'],
      ['p::v_Na_i', 'p'],
      ['c::c_K', 'epithelial'],
      ['c::W', 'epithelial'],
    ])
    expect(total).toBe(4)
  })
})
