import { describe, expect, it } from 'vitest'

import { buildSimulationJson } from '../../../../src/services/export/simulation.js'
import {
  acceptsUnits,
  addPlot,
  addPlotSelection,
  assignSelection,
  buildPlotConfig,
  buildPlotVariableRows,
  choosePlotForUnits,
  createPlotXAxis,
  getPlotUnits,
  getNodePlotEntries,
  movePlot,
  normaliseGroups,
  removePlot,
  removePlotSelection,
  renamePlot,
  resolveGroups,
  resolvePlotConfig,
  setNodePlotVariables,
  setPlotXAxis,
} from '../../../../src/services/simulation/plotSelections.js'

const GROUPS = [
  { id: 'plot-1', name: 'Plot 1' },
  { id: 'plot-2', name: 'Pressures' },
]

/**
 * Creates a node with a state `x`, an algebraic `y` and a constant `k`.
 *
 * @param {string} id
 * @param {string} [name]
 * @returns {Object}
 */
function createNode(id, name = id) {
  return {
    id,
    data: {
      name,
      variables: [
        { name: 'x', units: 'metre', type: 'variable', stateRole: 'state' },
        { name: 'y', units: 'second', type: 'variable' },
        { name: 'k', units: 'per_second', type: 'constant' },
      ],
    },
  }
}

/**
 * Builds a saved selection.
 *
 * @param {string} nodeId
 * @param {string} variableName
 * @param {string|null} groupId
 * @param {Object} [overrides]
 * @returns {Object}
 */
function selectionOf(nodeId, variableName, groupId, overrides = {}) {
  return {
    key: `${nodeId}::${variableName}`,
    nodeId,
    nodeName: nodeId,
    variableName,
    units: variableName === 'x' ? 'metre' : 'second',
    type: 'variable',
    plot: true,
    groupId,
    ...overrides,
  }
}

describe('normaliseGroups', () => {
  it('starts with one "Plot 1" group when there are none', () => {
    expect(normaliseGroups(undefined)).toEqual([{ id: 'plot-1', name: 'Plot 1' }])
    expect(normaliseGroups([])).toEqual([{ id: 'plot-1', name: 'Plot 1' }])
  })

  it('fills in missing ids and names from their position', () => {
    expect(normaliseGroups([{ name: 'A' }, { id: 'g' }])).toEqual([
      { id: 'plot-1', name: 'A' },
      { id: 'g', name: 'Plot 2' },
    ])
  })
})

describe('buildPlotConfig', () => {
  it('orders selections by group, with those whose group is gone ungrouped at the end', () => {
    const config = buildPlotConfig(GROUPS, [
      selectionOf('a', 'x', 'plot-2'),
      selectionOf('a', 'y', 'deleted'),
      selectionOf('b', 'x', 'plot-1'),
    ])

    expect(config.groups).toEqual(GROUPS)
    expect(config.groupedSelections.map((group) => group.id)).toEqual(['plot-1', 'plot-2'])
    expect(config.selections.map((selection) => [selection.key, selection.groupId])).toEqual([
      ['b::x', 'plot-1'],
      ['a::x', 'plot-2'],
      ['a::y', null],
    ])
  })
})

describe('buildPlotVariableRows', () => {
  it('lists only computed variables, carrying an existing selection’s group', () => {
    const rows = buildPlotVariableRows([createNode('b'), createNode('a')], new Map([['a::y', selectionOf('a', 'y', 'plot-2')]]))

    expect(rows.map((row) => row.key)).toEqual(['a::x', 'a::y', 'b::x', 'b::y'])
    expect(rows[1]).toMatchObject({ plot: true, groupId: 'plot-2', selected: false })
    expect(rows[0]).toMatchObject({ plot: false, groupId: null })
  })
})

describe('getNodePlotEntries', () => {
  it('gets one node’s plotted variables with their groups', () => {
    const config = { selections: [selectionOf('a', 'x', 'plot-2'), selectionOf('b', 'x', 'plot-1'), selectionOf('a', 'y', null)] }

    expect(getNodePlotEntries(config, 'a')).toEqual([
      { name: 'x', groupId: 'plot-2' },
      { name: 'y', groupId: null },
    ])
    expect(getNodePlotEntries({}, 'a')).toEqual([])
  })
})

describe('setNodePlotVariables', () => {
  it('adds a new variable to the first group and keeps an existing one in its own', () => {
    const config = buildPlotConfig(GROUPS, [selectionOf('a', 'x', 'plot-2'), selectionOf('b', 'x', 'plot-1')])

    const next = setNodePlotVariables(config, createNode('a'), [{ name: 'x', groupId: 'plot-2' }, { name: 'y' }])

    expect(next.selections.map((selection) => [selection.key, selection.groupId])).toEqual([
      // In plot order, as the charts and the export list them.
      ['b::x', 'plot-1'],
      ['a::y', 'plot-1'],
      ['a::x', 'plot-2'],
    ])
  })

  it('removes the node’s unticked variables only', () => {
    const config = buildPlotConfig(GROUPS, [selectionOf('a', 'x', 'plot-1'), selectionOf('b', 'x', 'plot-1')])

    const next = setNodePlotVariables(config, createNode('a'), [])

    expect(next.selections.map((selection) => selection.key)).toEqual(['b::x'])
  })

  it('starts the groups of an empty config with "Plot 1"', () => {
    const next = setNodePlotVariables({}, createNode('a'), [{ name: 'x' }])

    expect(next.groups).toEqual([{ id: 'plot-1', name: 'Plot 1' }])
    expect(next.selections).toEqual([selectionOf('a', 'x', 'plot-1')])
  })

  it('takes the name and units from the node as saved', () => {
    const config = buildPlotConfig(GROUPS, [selectionOf('a', 'x', 'plot-1', { nodeName: 'old', units: 'mm' })])

    const next = setNodePlotVariables(config, createNode('a', 'renamed'), [{ name: 'x', groupId: 'plot-1' }])

    expect(next.selections[0]).toMatchObject({ nodeName: 'renamed', units: 'metre' })
  })

  it('skips constants, missing variables and duplicates', () => {
    const next = setNodePlotVariables({}, createNode('a'), [{ name: 'k' }, { name: 'gone' }, { name: 'x' }, { name: 'x' }])

    expect(next.selections.map((selection) => selection.key)).toEqual(['a::x'])
  })

  it('keeps a variable whose group no longer exists ungrouped', () => {
    const next = setNodePlotVariables({ groups: GROUPS }, createNode('a'), [{ name: 'x', groupId: 'deleted' }])

    expect(next.selections).toEqual([selectionOf('a', 'x', null)])
  })

  it('returns the same config when nothing changed, whatever the order', () => {
    const config = buildPlotConfig(GROUPS, [selectionOf('a', 'x', 'plot-2'), selectionOf('a', 'y', 'plot-1')])

    const entries = [{ name: 'x', groupId: 'plot-2' }, { name: 'y', groupId: 'plot-1' }]
    expect(setNodePlotVariables(config, createNode('a'), entries)).toBe(config)
    expect(setNodePlotVariables({}, createNode('a'), [])).toEqual({})
  })
})

describe('resolvePlotConfig', () => {
  it('drops selections whose node or variable is gone, and takes names and units from the nodes', () => {
    const config = buildPlotConfig(GROUPS, [
      selectionOf('a', 'x', 'plot-1', { nodeName: 'stale' }),
      selectionOf('a', 'removed', 'plot-1'),
      selectionOf('deleted', 'x', 'plot-2'),
      selectionOf('a', 'k', 'plot-2'),
    ])

    const resolved = resolvePlotConfig(config, [createNode('a', 'current')])

    expect(resolved.selections).toEqual([selectionOf('a', 'x', 'plot-1', { nodeName: 'current' })])
    expect(resolved.groupedSelections.map((group) => group.id)).toEqual(['plot-1'])
  })

  it('resolves an empty config to no selections', () => {
    expect(resolvePlotConfig({}, [createNode('a')]).selections).toEqual([])
  })
})

describe('an imported config, whose selections name groups it doesn’t list', () => {
  // As rehydrateSimulationConfig gives: selections only, each plot its own group id.
  const imported = () => ({
    selections: [
      selectionOf('a', 'x', 'plot-1', { units: '' }),
      selectionOf('b', 'x', 'plot-2', { units: '' }),
      selectionOf('c', 'x', 'plot-3', { units: '' }),
    ],
  })

  it('gets one group per group its selections use', () => {
    expect(resolveGroups(imported()).map((group) => group.id)).toEqual(['plot-1', 'plot-2', 'plot-3'])
  })

  it('keeps the other nodes’ groups when one node’s plotted variables change', () => {
    const next = setNodePlotVariables(imported(), createNode('a'), [{ name: 'x', groupId: 'plot-1' }, { name: 'y' }])

    expect(next.selections.map((selection) => [selection.key, selection.groupId])).toEqual([
      ['a::x', 'plot-1'],
      ['a::y', 'plot-1'],
      ['b::x', 'plot-2'],
      ['c::x', 'plot-3'],
    ])
  })

  it('exports every plot it had', () => {
    const nodes = [createNode('a'), createNode('b'), createNode('c')]
    const voi = { componentName: 'environment', name: 'time', units: 'second' }

    const plotsOf = (config) => JSON.parse(buildSimulationJson(config, {}, { voi, mappedParameters: {} })).output.plots
    expect(plotsOf(resolvePlotConfig(imported(), nodes))).toHaveLength(3)
  })
})

describe('setNodePlotVariables on other nodes', () => {
  it('leaves selections in a group that was deleted ungrouped as they are', () => {
    const config = { groups: GROUPS, selections: [selectionOf('b', 'x', 'deleted')] }

    const next = setNodePlotVariables(config, createNode('a'), [{ name: 'x' }])

    expect(next.selections.find((selection) => selection.nodeId === 'b').groupId).toBe('deleted')
  })
})

describe('editing plots', () => {
  const node = createNode('a')
  const [x, y] = node.data.variables
  const config = buildPlotConfig(GROUPS, [selectionOf('a', 'x', 'plot-1'), selectionOf('a', 'y', 'plot-2')])

  it('adds a plot with an id no other plot has, named after the highest "Plot n"', () => {
    const first = addPlot(config)
    const second = addPlot(first.plotConfig)
    expect(first.plotConfig.groups.at(-1)).toEqual({ id: first.id, name: 'Plot 2' })
    expect(second.plotConfig.groups.at(-1).name).toBe('Plot 3')
    expect(new Set(second.plotConfig.groups.map((group) => group.id)).size).toBe(4)
    expect(addPlot(config, ' Currents ').plotConfig.groups.at(-1).name).toBe('Currents')
  })

  it('gives a config without plots one to add to', () => {
    expect(addPlot({}).plotConfig.groups.map((group) => group.name)).toEqual(['Plot 1', 'Plot 2'])
  })

  it('renames a plot, ignoring a blank name', () => {
    expect(renamePlot(config, 'plot-2', 'Volumes').groups[1].name).toBe('Volumes')
    expect(renamePlot(config, 'plot-2', '  ')).toBe(config)
  })

  it('removes a plot with its variables, but never the last plot', () => {
    const removed = removePlot(config, 'plot-2')
    expect(removed.groups.map((group) => group.id)).toEqual(['plot-1'])
    expect(removed.selections.map((selection) => selection.key)).toEqual(['a::x'])
    expect(removePlot(removed, 'plot-1')).toBe(removed)
  })

  it('moves a plot along the list, its variables following, stopping at the ends', () => {
    const moved = movePlot(config, 'plot-2', -1)
    expect(moved.groups.map((group) => group.id)).toEqual(['plot-2', 'plot-1'])
    expect(moved.selections.map((selection) => selection.key)).toEqual(['a::y', 'a::x'])
    expect(movePlot(config, 'plot-2', 1)).toBe(config)
  })

  it('plots a variable once: adding it again moves it', () => {
    const added = addPlotSelection(buildPlotConfig(GROUPS, []), node, x, 'plot-2')
    expect(added.selections).toEqual([selectionOf('a', 'x', 'plot-2', { nodeName: 'a' })])
    const moved = addPlotSelection(added, node, x, 'plot-1')
    expect(moved.selections.map((selection) => [selection.key, selection.groupId])).toEqual([['a::x', 'plot-1']])
    expect(moved.groupedSelections.map((group) => group.id)).toEqual(['plot-1'])
  })

  it('moves and removes a plotted variable', () => {
    expect(assignSelection(config, 'a::y', 'plot-1').selections.every((selection) => selection.groupId === 'plot-1')).toBe(true)
    expect(assignSelection(config, 'a::y', 'missing')).toBe(config)
    expect(removePlotSelection(config, 'a::y').selections.map((selection) => selection.key)).toEqual(['a::x'])
    expect(removePlotSelection(config, 'a::zz')).toBe(config)
    expect(addPlotSelection(config, node, y, 'missing').selections.find((selection) => selection.key === 'a::y').groupId).toBe('plot-1')
  })
})

describe('one unit per plot', () => {
  // plot-1 holds metres, plot-2 seconds, and an extra empty plot-3.
  const config = buildPlotConfig([...GROUPS, { id: 'plot-3', name: 'Plot 3' }], [selectionOf('a', 'x', 'plot-1'), selectionOf('a', 'y', 'plot-2')])

  it('reads the units on a plot', () => {
    expect([...getPlotUnits(config, 'plot-1')]).toEqual(['metre'])
    expect(getPlotUnits(config, 'plot-3').size).toBe(0)
  })

  it('accepts a variable on an empty plot or one in its units, leaving out the one being moved', () => {
    expect(acceptsUnits(config, 'plot-1', 'metre')).toBe(true)
    expect(acceptsUnits(config, 'plot-1', 'second')).toBe(false)
    expect(acceptsUnits(config, 'plot-3', 'second')).toBe(true)
    expect(acceptsUnits(config, 'plot-1', 'second', 'a::x')).toBe(true)
  })

  it('chooses the preferred plot when it fits, else the first that does, else none', () => {
    expect(choosePlotForUnits(config, 'metre', 'plot-1')).toBe('plot-1')
    expect(choosePlotForUnits(config, 'second', 'plot-1')).toBe('plot-2')
    expect(choosePlotForUnits(config, 'volt', 'plot-1')).toBe('plot-3')
    expect(choosePlotForUnits(buildPlotConfig(GROUPS, config.selections), 'volt', 'plot-1')).toBeNull()
  })
})

describe('plotting against a variable', () => {
  const node = createNode('a', 'cell')
  const [x, y] = node.data.variables
  const config = buildPlotConfig(GROUPS, [selectionOf('a', 'x', 'plot-1'), selectionOf('a', 'y', 'plot-2')])
  const phase = setPlotXAxis(config, 'plot-1', createPlotXAxis(node, y))

  it('sets one plot against a variable, and back against time', () => {
    expect(resolveGroups(phase)).toEqual([
      { id: 'plot-1', name: 'Plot 1', xAxis: { key: 'a::y', nodeId: 'a', nodeName: 'cell', variableName: 'y', units: 'second' } },
      { id: 'plot-2', name: 'Pressures' },
    ])
    expect(resolveGroups(setPlotXAxis(phase, 'plot-1', null))).toEqual(GROUPS)
    expect(setPlotXAxis(config, 'missing', createPlotXAxis(node, x))).toBe(config)
  })

  it('keeps the variable as plots are renamed, moved and added', () => {
    const edited = addPlot(movePlot(renamePlot(phase, 'plot-1', 'Phase'), 'plot-1', 1)).plotConfig
    expect(resolveGroups(edited).find((group) => group.id === 'plot-1')).toMatchObject({ name: 'Phase', xAxis: { key: 'a::y' } })
  })

  it('exports the plot against its variable, renamed as the instance is now, and drops one that is gone', () => {
    const renamed = [{ ...node, data: { ...node.data, name: 'soma' } }]
    const exported = resolvePlotConfig(phase, renamed)
    expect(exported.groups[0].xAxis.nodeName).toBe('soma')
    expect(resolvePlotConfig(phase, []).groups[0].xAxis).toBeUndefined()

    const voi = { componentName: 'environment', name: 'time', units: 'second' }
    const json = JSON.parse(buildSimulationJson(exported, {}, { voi, mappedParameters: {} }))
    expect(json.output.plots.map((plot) => plot.xValue)).toEqual(['data__soma__y', 'voi__environment__time'])
    expect(json.output.data.map((entry) => entry.id)).toEqual(['data__soma__x', 'data__soma__y', 'voi__environment__time'])
  })
})
