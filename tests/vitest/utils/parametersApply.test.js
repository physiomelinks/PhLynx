import { describe, expect, it } from 'vitest'

import {
  applyInstancesToNodes,
  buildParametersReport,
  planGlobals,
  planSetApply,
  planSetsForNodes,
  planSharedSetUpdate,
} from '../../../src/utils/parameters/apply.js'

const param = (value, units = 'mM') => ({ value, units, data_reference: 'paper', extra: {} })
const row = (name, value, type = 'constant', units = 'mM') => ({ name, value, type, units, data_reference: '' })
const node = (id, name, data = {}) => ({
  id,
  data: { name, mathRef: 'NKA.cellml:NKA', variables: [row('K', '1'), row('v', '0', 'variable')], ...data },
})

describe('planSetsForNodes', () => {
  const NKA = 'NKA.cellml:NKA'
  const plan = (nodes, set, byName = false) => planSetsForNodes(nodes, [{ mathRef: NKA, set, byName }])

  it('applies a set only to the nodes of its math seeded with it, leaving computed rows', () => {
    const nodes = [
      node('1', 'NKA_a', { parameterisation: 'NKA' }),
      node('2', 'NKA', { parameterisation: 'other' }),
      node('3', 'NKA_2'),
      node('4', 'lumen', { mathRef: 'compartment.cellml:compartment', parameterisation: 'NKA' }),
    ]
    const set = { ref: 'NKA', values: new Map([['K', param('5')], ['v', param('9')], ['x', param(null)]]) }

    const changes = plan(nodes, set)

    expect(changes.nodeIds).toEqual(['1'])
    expect(changes.updated).toBe(1)
    expect(changes.variablesById.get('1').map((r) => r.value)).toEqual(['5', '0'])
    expect(changes.skipped).toEqual([{ nodeName: 'NKA_a', name: 'v' }])
    expect(changes.tags.size).toBe(0)
    expect(changes.uses).toEqual([{ ref: 'NKA', mathRef: NKA, nodeId: '1', nodeName: 'NKA_a', count: 1 }])
    expect(nodes[0].data.variables[0].value).toBe('1')
  })

  it('by name, also applies it to the instances of its math named after it, tagging them', () => {
    const nodes = [
      node('1', 'NKA', { parameterisation: 'other' }),
      node('2', ' NKA_1 ', { parameterisation: 'NKA' }),
      node('3', 'NKA_2'),
      node('4', 'NKA', { mathRef: 'compartment.cellml:compartment' }),
    ]
    const changes = plan(nodes, { ref: 'NKA', values: new Map([['K', param('5')]]) }, true)

    expect(changes.nodeIds).toEqual(['1', '2'])
    expect(changes.tags).toEqual(new Map([['1', 'NKA']]))
    expect(changes.changed.map((change) => change.nodeId)).toEqual(['1', '2'])
  })

  it('tags an instance named after a set even when no value changes', () => {
    const nodes = [node('1', 'NKA')]
    const changes = plan(nodes, { ref: 'NKA', values: new Map([['K', param('1')]]) }, true)
    expect(changes).toMatchObject({ nodeIds: ['1'], updated: 0, changed: [], tags: new Map([['1', 'NKA']]) })
  })

  it('lets a later set win where two reach one instance, listing the net changes', () => {
    const nodes = [node('1', 'NKA', { parameterisation: 'old' })]
    const changes = planSetsForNodes(nodes, [
      { mathRef: NKA, set: { ref: 'old', values: new Map([['K', param('3')]]) } },
      { mathRef: NKA, set: { ref: 'NKA', values: new Map([['K', param('5')]]) }, byName: true },
    ])
    expect(changes.changed).toEqual([{ nodeId: '1', nodeName: 'NKA', name: 'K', from: '1', to: '5' }])
    expect(changes.tags.get('1')).toBe('NKA')
    expect(changes.uses.map((use) => [use.ref, use.count])).toEqual([['old', 1], ['NKA', 1]])
  })

  it('counts only the values that change', () => {
    const nodes = [node('1', 'NKA', { parameterisation: 'NKA' }), node('2', 'NKA_1', { parameterisation: 'NKA' })]
    nodes[1].data.variables[0].value = ' 5 '
    const changes = plan(nodes, { ref: 'NKA', values: new Map([['K', param('5')]]) })

    expect(changes.updated).toBe(1)
    expect(changes.changed).toEqual([{ nodeId: '1', nodeName: 'NKA', name: 'K', from: '1', to: '5' }])
  })

  it('warns where units differ', () => {
    const nodes = [node('1', 'NKA', { parameterisation: 'NKA' })]
    const changes = plan(nodes, { ref: 'NKA', values: new Map([['K', param('5', 'M')]]) })
    expect(changes.warnings).toEqual(['NKA.K units M ≠ mM'])
  })
})

describe('applyInstancesToNodes', () => {
  it('applies values by instance name and lists the instances not in the workspace', () => {
    const nodes = [node('1', 'NKA'), node('2', 'NKA_1')]
    const instances = new Map([
      ['NKA_1', new Map([['K', param('7')]])],
      ['gone', new Map([['K', param('8')]])],
    ])

    const changes = applyInstancesToNodes(nodes, instances)

    expect(changes.nodeIds).toEqual(['2'])
    expect(changes.variablesById.get('2')[0].value).toBe('7')
    expect(changes.missing).toEqual(['gone'])
    expect(changes.warnings).toEqual(['no instance named gone in the workspace'])
  })
})

describe('planGlobals', () => {
  const current = new Map([['F', { value: '96485' }], ['R', { value: '8.314' }]])
  const globals = new Map([
    ['F', param('96485.3321', 'C_per_mol')],
    ['R', param('8.314')],
    ['T', param('310', 'K')],
    ['RT', param(null)],
    ['unused', param('1')],
  ])

  it('sorts globals into new and changed ones, leaving unused and unfilled ones out', () => {
    const plan = planGlobals(globals, (name) => current.get(name), new Set(['F', 'R', 'T', 'RT']))

    expect(plan.added.map((g) => g.name)).toEqual(['T'])
    expect(plan.changed).toEqual([
      { name: 'F', value: '96485.3321', units: 'C_per_mol', data_reference: 'paper', from: '96485' },
    ])
  })

  it('keeps every global when no names are given', () => {
    expect(planGlobals(globals, () => undefined).added.map((g) => g.name)).toEqual(['F', 'R', 'T', 'unused'])
  })
})

describe('buildParametersReport', () => {
  it('lists linked and unlinked sets with each file\'s warnings', () => {
    const report = buildParametersReport(
      [
        {
          fileName: 'NKA_parameters.json',
          ok: true,
          count: 3,
          stored: [{ mathRef: 'NKA.cellml:NKA', ref: 'NKA' }],
          uses: [{ ref: 'NKA', mathRef: 'NKA.cellml:NKA', nodeId: '1', nodeName: 'NKA', count: 3 }],
          warnings: ['`K_9` is not a variable of NKA.cellml:NKA'],
        },
        { fileName: 'glut5_parameters.json', ok: true, count: 0, stored: [{ mathRef: null, ref: 'glut5' }], warnings: [] },
      ],
      [{ mathRef: 'compartment.cellml:compartment', ref: 'lumen', warnings: [] }]
    )

    expect(report).toMatchObject({ type: 'warning', title: 'Parameters Loaded with Warnings' })
    expect(report.message.split('<br>')).toEqual([
      'Parameter sets: NKA (NKA.cellml:NKA), lumen (compartment.cellml:compartment)',
      'Applied 3 values to NKA (3 values).',
      '1 parameter set is waiting for its config: glut5. A set links to its math, and applies to the instance named ' +
        'after it, once a configuration naming it as its default_parameterisation is loaded.',
      'NKA_parameters.json: `K_9` is not a variable of NKA.cellml:NKA',
    ])
  })

  it('says which sets wait for their configs, listing at most five', () => {
    const refs = ['NKA', 'lumen', 'enterocyte', 'capillary', 'Kir', 'SGLT1', 'GLUT2_api']
    const results = refs.map((ref) => ({ fileName: `${ref}_parameters.json`, ok: true, count: 0, stored: [{ mathRef: null, ref }] }))
    const report = buildParametersReport(results)
    expect(report).toMatchObject({ type: 'warning', title: 'Parameter Sets Waiting for Configs' })
    expect(report.message).toContain('7 parameter sets are waiting for their configs: NKA, lumen, enterocyte, capillary, Kir and 2 more.')
  })

  it('reports the instances linked sets reached, the sets left as defaults and those kept off instances', () => {
    const links = [
      { mathRef: 'compartment.cellml:compartment', ref: 'lumen', warnings: [] },
      { mathRef: 'compartment.cellml:compartment', ref: 'capillary', warnings: [] },
      { mathRef: 'NKA.cellml:NKA', ref: 'NKA', warnings: [] },
    ]
    const applied = {
      count: 2,
      uses: [
        { ref: 'lumen', mathRef: 'compartment.cellml:compartment', nodeId: '1', nodeName: 'lumen', count: 1 },
        { ref: 'lumen', mathRef: 'compartment.cellml:compartment', nodeId: '2', nodeName: 'gut', count: 1 },
        { ref: 'lumen', mathRef: 'compartment.cellml:compartment', nodeId: '3', nodeName: 'lumen_b', count: 0 },
      ],
      defaultOnly: ['capillary'],
      kept: ['NKA'],
    }
    const report = buildParametersReport([], links, applied)
    expect(report).toMatchObject({ type: 'success', title: 'Parameter Sets Linked' })
    expect(report.message.split('<br>')).toEqual([
      'Parameter sets: lumen (compartment.cellml:compartment), capillary (compartment.cellml:compartment), NKA (NKA.cellml:NKA)',
      'Applied 2 values to lumen (1 value), gut from lumen (1 value).',
      'Library defaults only, as no instance of their math is named after them: capillary.',
      'Instance values kept, as chosen; library defaults only: NKA.',
    ])
  })

  it('reports success, failure and nothing loaded', () => {
    expect(buildParametersReport([{ fileName: 'a.csv', ok: true, count: 1 }]).type).toBe('success')
    expect(buildParametersReport([{ fileName: 'a.json', ok: false, error: 'boom' }])).toMatchObject({
      type: 'error',
      message: 'a.json: boom',
    })
    expect(buildParametersReport([{ fileName: 'a.csv', ok: false, count: 0 }])).toMatchObject({ type: 'info' })
    expect(buildParametersReport([])).toBeNull()
  })
})

describe('planSetApply', () => {
  const set = {
    globals: new Map([['F', param('96485')], ['T', param('310')]]),
    values: new Map([['K', param('5')], ['same', param('1')], ['v', param('9')], ['blank', param(null)]]),
  }
  const rows = () => [
    row('K', '1'),
    row('same', '1'),
    row('v', '0', 'variable'),
    row('blank', '3'),
    row('F', '1', 'global_constant'),
    row('T', '', 'global_constant'),
  ]

  it('overwrites every value the set holds, listing those that change', () => {
    const { rows: next, changes } = planSetApply(rows(), set)

    expect(changes).toEqual([
      { name: 'K', from: '1', to: '5' },
      { name: 'T', from: '', to: '310' },
    ])
    expect(next.map((r) => r.value)).toEqual(['5', '1', '0', '3', '1', '310'])
    expect(next[1].data_reference).toBe('paper')
  })

  it('keeps a global constant already set, and leaves the rows given alone', () => {
    const given = rows()
    const { rows: next } = planSetApply(given, set)

    expect(next[4]).toBe(given[4])
    expect(given[0].value).toBe('1')
  })
})

describe('planSharedSetUpdate', () => {
  it("gives the other nodes tagged with the set its new values, listing each one's changes", () => {
    const nodes = [
      node('a', 'a', { parameterisation: 'nka' }),
      node('b', 'b', { parameterisation: 'nka' }),
      node('c', 'c', { parameterisation: 'nka', variables: [row('K', '2')] }),
      node('d', 'd', { parameterisation: 'other' }),
    ]
    const entries = { globals: new Map(), values: new Map([['K', param('2')]]) }
    const { variablesById, changes } = planSharedSetUpdate(nodes, { nodeId: 'a', mathRef: 'NKA.cellml:NKA', paramRef: 'nka' }, entries)

    expect(changes).toEqual([{ nodeId: 'b', nodeName: 'b', name: 'K', from: '1', to: '2' }])
    expect([...variablesById.keys()]).toEqual(['b'])
    expect(variablesById.get('b')[0].value).toBe('2')
    expect(nodes[1].data.variables[0].value).toBe('1')
  })
})
