import { describe, expect, it } from 'vitest'

import { getHandleId } from '../../../../src/utils/handles.js'

import { buildScopeSignature, checkScope, resolveScope, scopeFlowObject, summariseScopeReport } from '../../../../src/services/simulation/scopedModel.js'

const flowPort = (portType, multiportType = 'None') => ({ portType, label: 'flow', variables: ['v'], multiportType })

/**
 * Creates a node whose `v` is computed or, as a port input, a boundary condition.
 *
 * @param {string} id
 * @param {Object} [options]
 * @returns {Object}
 */
function createNode(id, { vType = 'boundary_condition', vValue = '', ports = [flowPort('general_ports')], extraRows = [] } = {}) {
  return {
    id,
    data: {
      name: `${id}_name`,
      mathRef: 'file:m',
      variables: [{ name: 'v', type: vType, value: vValue, units: 'per_second' }, ...extraRows],
      ports,
    },
  }
}

/**
 * Couples two nodes' first ports.
 *
 * @param {Object} source
 * @param {Object} target
 * @returns {Object}
 */
function connect(source, target) {
  return {
    id: `${source.id}_${target.id}`,
    source: source.id,
    target: target.id,
    data: { couplings: [{ sourcePort: source.data.ports[0], targetPort: target.data.ports[0] }] },
  }
}

const library = (globals = {}) => ({
  availableMath: new Map([['file:m', '<model/>']]),
  getGlobalConstant: (name) => globals[name],
})

describe('resolveScope', () => {
  const a = createNode('a', { vType: 'variable' })
  const b = createNode('b')
  const c = createNode('c')
  const edges = [connect(a, b), connect(b, c)]

  it('keeps the edges inside the selection and cuts those leaving it', () => {
    const scope = resolveScope(['b', 'a'], [a, b, c], edges)

    expect(scope.nodeIds).toEqual(['a', 'b'])
    expect(scope.internalEdges.map((edge) => edge.id)).toEqual(['a_b'])
    expect(scope.cutEdges.map((edge) => edge.id)).toEqual(['b_c'])
  })

  it('takes every node when nothing is selected', () => {
    const scope = resolveScope(null, [a, b, c], edges)

    expect(scope.nodeIds).toEqual(['a', 'b', 'c'])
    expect(scope.internalEdges).toHaveLength(2)
    expect(scope.cutEdges).toEqual([])
  })

  it('trims inspection modules to the selected variables, leaving out those with none left', () => {
    const modules = [
      { name: 'total', units: 'per_second', variables: [{ nodeId: 'a', variableName: 'v' }, { nodeId: 'c', variableName: 'v' }] },
      { name: 'outside', units: 'per_second', variables: [{ nodeId: 'c', variableName: 'v' }] },
      { name: 'inside', units: 'per_second', variables: [{ nodeId: 'b', variableName: 'v' }] },
    ]

    const scope = resolveScope(['a', 'b'], [a, b, c], edges, modules)

    expect(scope.inspectionModules.map((module) => [module.name, module.variables.length])).toEqual([
      ['total', 1],
      ['inside', 1],
    ])
    expect(scope.trimmedModules).toEqual([
      { name: 'total', removed: 1, isLeftOut: false },
      { name: 'outside', removed: 1, isLeftOut: true },
    ])
  })
})

describe('checkScope', () => {
  it('sets a boundary condition the cut leaves without a value to 0, with a warning', () => {
    const a = createNode('a', { vType: 'variable' })
    const b = createNode('b')
    const nodes = [a, b]
    const edges = [connect(a, b)]

    const report = checkScope(resolveScope(['b'], nodes, edges), library())
    expect(report.canBuild).toBe(true)
    expect(report.missingValues).toEqual([])
    expect(report.zeroedBoundaries).toEqual([{ nodeId: 'b', nodeName: 'b_name', variableName: 'v' }])

    const withValue = createNode('b', { vValue: '2' })
    const fixed = checkScope(resolveScope(['b'], [a, withValue], [connect(a, withValue)]), library())
    expect(fixed.zeroedBoundaries).toEqual([])
    expect(fixed.usesOwnValue).toEqual([{ nodeId: 'b', nodeName: 'b_name', variableName: 'v' }])
  })

  it('doesn’t report a boundary condition whose supplier is in the scope', () => {
    const a = createNode('a', { vType: 'variable' })
    const b = createNode('b')

    const report = checkScope(resolveScope(['a', 'b'], [a, b], [connect(a, b)]), library())
    expect(report.canBuild).toBe(true)
    expect(report.usesOwnValue).toEqual([])
  })

  it('warns about a Sum variable losing terms from outside the scope, without stopping the build', () => {
    const hub = createNode('hub', { vType: 'boundary_condition', ports: [flowPort('exit_ports', 'Sum')] })
    const leaves = ['l1', 'l2', 'l3'].map((id) => createNode(id, { vType: 'variable', ports: [flowPort('entrance_ports')] }))
    const edges = leaves.map((leaf) => connect(hub, leaf))

    const report = checkScope(resolveScope(['hub', 'l1'], [hub, ...leaves], edges), library())
    expect(report.lostSumTerms).toEqual([{ nodeId: 'hub', nodeName: 'hub_name', variableName: 'v', lost: 2 }])
    expect(report.canBuild).toBe(true)
  })

  it('reports blank constants and global constants, and nodes without math, each stopping the build', () => {
    const node = createNode('a', {
      vType: 'variable',
      extraRows: [
        { name: 'k', type: 'constant', value: '' },
        { name: 'g', type: 'global_constant' },
      ],
    })
    const report = checkScope(resolveScope(null, [node], []), library({ g: { value: '' } }))
    expect(report.missingValues.map((entry) => [entry.variableName, entry.kind])).toEqual([
      ['k', 'constant'],
      ['g', 'global_constant'],
    ])
    expect(report.canBuild).toBe(false)

    const orphan = { id: 'o', data: { name: 'o_name', variables: [], ports: [] } }
    const orphanReport = checkScope(resolveScope(['o'], [orphan], []), library())
    expect(orphanReport.incompleteNodes).toEqual([{ nodeId: 'o', nodeName: 'o_name', reason: 'has no module' }])
    expect(orphanReport.canBuild).toBe(false)
  })

  it('warns about a Sum on the target end of its edges losing terms from outside the scope', () => {
    const hub = createNode('hub', { ports: [flowPort('entrance_ports', 'Sum')] })
    const leaves = ['l1', 'l2'].map((id) => createNode(id, { vType: 'variable', ports: [flowPort('exit_ports')] }))
    const edges = leaves.map((leaf) => connect(leaf, hub))

    const report = checkScope(resolveScope(['hub', 'l1'], [hub, ...leaves], edges), library())
    expect(report.lostSumTerms).toEqual([{ nodeId: 'hub', nodeName: 'hub_name', variableName: 'v', lost: 1 }])
  })

  it('stops the build on coupled boundary conditions with different values', () => {
    const a = createNode('a', { vValue: '1' })
    const b = createNode('b', { vValue: '2' })

    const report = checkScope(resolveScope(null, [a, b], [connect(a, b)]), library())
    expect(report.conflicts).toEqual([expect.stringContaining('a_name.v=1')])
    expect(report.canBuild).toBe(false)
  })

  it('stops the build on a coupling the build rejects, such as Sum on both ends', () => {
    const a = createNode('a', { vType: 'variable', ports: [flowPort('exit_ports', 'Sum')] })
    const b = createNode('b', { vType: 'variable', ports: [flowPort('entrance_ports', 'Sum')] })

    const report = checkScope(resolveScope(null, [a, b], [connect(a, b)]), library())
    expect(report.conflicts).toEqual([expect.stringMatching(/^Cannot connect "a_name" to "b_name"/)])
    expect(report.canBuild).toBe(false)
  })

  it('doesn’t warn about a boundary condition that used its own value in the whole model too', () => {
    const lone = createNode('b', { vValue: '2' })
    const report = checkScope(resolveScope(['b'], [lone], []), library())
    expect(report.usesOwnValue).toEqual([])

    // Two plain-coupled boundary conditions with the same value: each falls back whichever is selected.
    const a = createNode('a', { vValue: '5' })
    const b = createNode('b', { vValue: '5' })
    for (const selected of ['a', 'b']) {
      expect(checkScope(resolveScope([selected], [a, b], [connect(a, b)]), library()).usesOwnValue).toEqual([])
    }
  })

  it('warns about variables in celsius, which lose their offset', () => {
    const node = createNode('a', { vType: 'variable', extraRows: [{ name: 'T', type: 'constant', value: '37', units: 'celsius' }] })
    const report = checkScope(resolveScope(null, [node], []), library())
    expect(report.usesCelsius).toEqual([{ nodeId: 'a', nodeName: 'a_name', variableName: 'T' }])
    expect(summariseScopeReport(report).warnings).toEqual([expect.stringMatching(/"a_name\.T" is in celsius/)])
  })

  it('stops an empty selection', () => {
    const report = checkScope(resolveScope([], [createNode('a', { vType: 'variable' })], []), library())
    expect(report.errors).toEqual(['Select at least one instance to simulate.'])
    expect(report.canBuild).toBe(false)
  })

  it('lets a selection whose math has no differential equation build, as an algebraic system', () => {
    const report = checkScope(resolveScope(null, [createNode('a', { vType: 'variable' })], []), {
      ...library(),
      getMathAnalysis: () => ({ stateVariables: [] }),
    })
    expect(report.errors).toEqual([])
    expect(report.canBuild).toBe(true)
  })

  it('ignores a broken port outside the scope', () => {
    const inside = createNode('a', { vType: 'variable' })
    const broken = createNode('b', { ports: [{ portType: 'general_ports', label: 'bad', variables: ['v'], multiportType: ['nonsense'] }] })

    const report = checkScope(resolveScope(['a'], [inside, broken], [connect(inside, broken)]), library())
    expect(report.errors).toEqual([])
    expect(report.canBuild).toBe(true)
  })
})

describe('buildScopeSignature', () => {
  const a = createNode('a', { vType: 'variable', ports: [flowPort('exit_ports')], extraRows: [{ name: 'g', type: 'global_constant' }] })
  const b = createNode('b', { vValue: '1', ports: [flowPort('entrance_ports')] })
  const module = { name: 'total', units: 'per_second', variables: [{ nodeId: 'a', variableName: 'v' }] }

  /**
   * Signs the scope of `a` and `b`, with an optional change to the inputs.
   *
   * @param {Object} [changes]
   * @returns {number}
   */
  function signatureOf({ nodes = [a, b, createNode('outside')], edges = [connect(a, b)], modules = [module], store = {} } = {}) {
    const libraryStore = { ...library({ g: { value: '1' } }), availableUnits: [], ...store }
    return buildScopeSignature(resolveScope(['a', 'b'], nodes, edges, modules), libraryStore)
  }

  const before = signatureOf()

  it('ignores nodes outside the scope', () => {
    const outside = createNode('outside')
    outside.data.name = 'renamed'
    expect(signatureOf({ nodes: [a, b, outside] })).toBe(before)
  })

  it.each([
    ['a node in the scope', { nodes: [{ ...a, data: { ...a.data, name: 'renamed' } }, b] }],
    ['the math', { store: { availableMath: new Map([['file:m', '<model name="edited"/>']]) } }],
    ['a global constant', { store: { getGlobalConstant: () => ({ value: '2' }) } }],
    ['a coupling', { edges: [] }],
    ['an inspection module', { modules: [{ ...module, units: 'second' }] }],
    ['the units libraries', { store: { availableUnits: [{ componentFile: 'units.cellml', model: '<model/>' }] } }],
  ])('changes with %s', (_, changes) => {
    expect(signatureOf(changes)).not.toBe(before)
  })
})

describe('summariseScopeReport', () => {
  it('words errors and warnings, one line each', () => {
    const entry = (variableName) => ({ nodeId: 'a', nodeName: 'a_name', variableName })
    const { errors, warnings } = summariseScopeReport({
      errors: ['Select at least one instance to simulate.'],
      incompleteNodes: [{ nodeId: 'o', nodeName: 'o_name', reason: 'has no module' }],
      missingValues: [{ ...entry('k'), kind: 'constant' }],
      conflicts: ['Conflicting values'],
      lostSumTerms: [{ ...entry('q'), lost: 1 }, { ...entry('r'), lost: 2 }],
      trimmedModules: [
        { name: 'total', removed: 2, isLeftOut: false },
        { name: 'outside', removed: 1, isLeftOut: true },
      ],
      usesOwnValue: [entry('u')],
      zeroedBoundaries: [entry('w')],
    })

    expect(errors).toEqual(['Select at least one instance to simulate.', '"o_name" has no module.', '"a_name.k" needs a value.', 'Conflicting values'])
    expect(warnings).toEqual([
      '"a_name.q" leaves out 1 term from outside the selection.',
      '"a_name.r" leaves out 2 terms from outside the selection.',
      'Inspection module "total" leaves out 2 variables from outside the selection.',
      'Inspection module "outside" has no variables in the selection, so it is left out.',
      '"a_name.u" uses its own value, since what supplies it is outside the selection.',
      '"a_name.w" has no value and nothing in the selection supplies it, so it is set to 0.',
    ])
  })
})

describe('scopeFlowObject', () => {
  const handle = (uid, variant = 'active') => ({ uid, variant, type: 'source', position: 'right' })

  it('keeps the selected nodes and their edges, turning handles whose edges were cut into ghosts', () => {
    const flow = {
      nodes: [
        { id: 'a', data: { handles: [handle('h1'), handle('h2'), handle('g', 'ghost')] } },
        { id: 'b', data: { handles: [handle('h3')] } },
        { id: 'c', data: { handles: [handle('h4')] } },
      ],
      edges: [
        { id: 'ab', source: 'a', sourceHandle: 'h1', target: 'b', targetHandle: 'h3' },
        { id: 'ac', source: 'a', sourceHandle: 'h2', target: 'c', targetHandle: 'h4' },
      ],
    }
    // getHandleId builds a handle's id from its parts; the edges above name the ids it gives.
    const ids = Object.fromEntries(flow.nodes.flatMap((node) => node.data.handles.map((h) => [h.uid, getHandleId(h)])))
    flow.edges.forEach((edge) => Object.assign(edge, { sourceHandle: ids[edge.sourceHandle], targetHandle: ids[edge.targetHandle] }))

    const scoped = scopeFlowObject(flow, ['a', 'b'])

    expect(scoped.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(scoped.edges.map((edge) => edge.id)).toEqual(['ab'])
    expect(scoped.nodes[0].data.handles.map((h) => [h.uid, h.variant])).toEqual([
      ['h1', 'active'],
      ['h2', 'ghost'],
      ['g', 'ghost'],
    ])
    expect(flow.nodes[0].data.handles[1].variant).toBe('active')
  })

  it('returns the flow as it is for every node', () => {
    const flow = { nodes: [], edges: [] }
    expect(scopeFlowObject(flow, null)).toBe(flow)
  })
})
