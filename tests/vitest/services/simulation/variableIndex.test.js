import { describe, expect, it } from 'vitest'

import { buildVariableIndex, findInspectionModule, readInspectionOutputId, resolvePlotTarget, searchVariableIndex } from '../../../../src/services/simulation/variableIndex.js'

const NODES = [
  {
    id: 'n1',
    data: {
      name: 'Na_channel',
      variables: [
        { name: 'g_Na', type: 'constant', units: 'mS' },
        { name: 'V', type: 'variable', units: 'mV' },
        { name: 'R', type: 'global_constant', units: 'J_per_K_mol' },
      ],
    },
  },
  {
    id: 'n2',
    data: {
      name: 'membrane',
      variables: [
        { name: 'V', type: 'variable', units: 'mV' },
        { name: 'R', type: 'global_constant', units: 'J_per_K_mol' },
        { name: 'g_Na_eff', type: 'variable', units: 'mS' },
      ],
    },
  },
]

describe('buildVariableIndex', () => {
  it('lists every row as instance/variable, and each global constant once', () => {
    const index = buildVariableIndex(NODES)
    expect(index.map((entry) => entry.path)).toEqual([
      'global_parameters/R',
      'membrane/V',
      'membrane/g_Na_eff',
      'Na_channel/g_Na',
      'Na_channel/V',
    ].sort((a, b) => a.localeCompare(b)))
    const byPath = new Map(index.map((entry) => [entry.path, entry]))
    expect(byPath.get('Na_channel/g_Na')).toMatchObject({ plottable: false, slidable: true, kind: 'constant' })
    expect(byPath.get('Na_channel/V')).toMatchObject({ plottable: true, slidable: false })
    expect(byPath.get('global_parameters/R')).toMatchObject({ key: 'global::R', nodeId: 'n1', slidable: true, plottable: false })
  })

  it('marks what a run left out, and names the variables a run made one', () => {
    const mapping = new Map([
      ['n1::V', 'membrane/V'],
      ['n2::V', 'membrane/V'],
      ['n2::g_Na_eff', 'membrane/g_Na_eff'],
    ])
    const index = buildVariableIndex(NODES, { scopeNodeIds: ['n2'], mapping })
    const byPath = new Map(index.map((entry) => [entry.path, entry]))
    expect(byPath.get('Na_channel/V')).toMatchObject({ inScope: false, equivalents: ['membrane/V'] })
    expect(byPath.get('membrane/V').equivalents).toEqual(['Na_channel/V'])
    expect(byPath.get('membrane/g_Na_eff').equivalents).toEqual([])
    // A global constant is in a run when any instance using it is.
    expect(byPath.get('global_parameters/R').inScope).toBe(true)
  })
})

describe('searchVariableIndex', () => {
  const index = buildVariableIndex(NODES)

  it('matches every word anywhere in the path, in any order', () => {
    expect(searchVariableIndex(index, 'na g').map((entry) => entry.path)).toEqual(['Na_channel/g_Na', 'membrane/g_Na_eff'])
    expect(searchVariableIndex(index, 'membrane/v').map((entry) => entry.path)).toEqual(['membrane/V'])
  })

  it('puts exact variable names first, then names that start with a word', () => {
    expect(searchVariableIndex(index, 'v').map((entry) => entry.path).slice(0, 2)).toEqual(['membrane/V', 'Na_channel/V'])
  })

  it('filters and limits the results', () => {
    expect(searchVariableIndex(index, '', { filter: (entry) => entry.slidable }).map((entry) => entry.path)).toEqual([
      'Na_channel/g_Na',
      'global_parameters/R',
    ])
    expect(searchVariableIndex(index, '', { limit: 2 })).toHaveLength(2)
  })
})

describe('inspection modules', () => {
  const MODULES = [{ id: 'inspection-1', name: 'Total current', units: 'nA', variables: [] }]

  it('lists each one as inspection_modules/<name>, to plot but not slide', () => {
    const index = buildVariableIndex(NODES, { inspectionModules: MODULES, inspectionOutputs: [] })
    const entry = index.find((candidate) => candidate.kind === 'inspection')
    expect(entry).toMatchObject({ path: 'inspection_modules/Total current', plottable: true, slidable: false, inScope: false, units: 'nA' })
    expect(searchVariableIndex(index, 'total').map((candidate) => candidate.path)).toEqual(['inspection_modules/Total current'])
  })

  it('plots one as a stand-in node, found again by its id', () => {
    const entry = buildVariableIndex([], { inspectionModules: MODULES })[0]
    const { node, row } = resolvePlotTarget(entry, [], MODULES)
    expect(node.id).toBe('inspection:inspection-1')
    expect(row).toMatchObject({ name: 'Total current', units: 'nA' })
    expect(findInspectionModule(node.id, MODULES)).toBe(MODULES[0])
    expect(findInspectionModule('dndnode_0', MODULES)).toBeNull()
  })
})

describe('readInspectionOutputId', () => {
  it("gives the inspection module an inspection node id stands for, and null for an instance's", () => {
    expect(readInspectionOutputId('inspection:m1')).toBe('m1')
    expect(readInspectionOutputId('node-1')).toBeNull()
  })
})
