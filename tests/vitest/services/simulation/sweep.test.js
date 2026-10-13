import { describe, expect, it } from 'vitest'

import { resolveBoundaryValues } from '../../../../src/services/export/boundaryValues'
import {
  createFamily,
  createSweep,
  familyValues,
  findBoundarySweepProblem,
  listSweptBoundaries,
  findSweepProblem,
  isSweepableEntry,
  isSweepableRow,
  MAX_FAMILY_VALUES,
  MAX_SWEEP_POINTS,
  MAX_SWEEP_RUNS,
  resolveSweepTarget,
  scopeHasOde,
  splitFamily,
  sweepLabel,
  sweepReadout,
  sweepValues,
} from '../../../../src/services/simulation/sweep.js'

const node = (id, name, variables) => ({ id, data: { name, variables } })

describe('isSweepableRow', () => {
  it('sweeps what has a value of its own, not what the model computes', () => {
    for (const type of ['constant', 'global_constant']) expect(isSweepableRow({ name: 'x', type }, 'n1', new Set()), type).toBe(true)
    expect(isSweepableRow({ name: 'x', type: 'variable' }, 'n1', new Set())).toBe(false)
  })

  it('sweeps a boundary condition only while nothing connected supplies it', () => {
    const row = { name: 'V', type: 'boundary_condition' }
    expect(isSweepableRow(row, 'n1', new Set(['n1::V']))).toBe(true)
    expect(isSweepableRow(row, 'n1', new Set())).toBe(false)
  })

  it("doesn't sweep a value a connection supplies instead", () => {
    const ignored = new Map([['n1', new Set(['k'])]])
    expect(isSweepableRow({ name: 'k', type: 'constant' }, 'n1', new Set(), ignored)).toBe(false)
    expect(isSweepableRow({ name: 'k', type: 'constant' }, 'n2', new Set(), ignored)).toBe(true)
  })
})

describe('isSweepableEntry', () => {
  const entry = (overrides) => ({ key: 'n1::g', nodeId: 'n1', rowName: 'g', kind: 'constant', reportedName: null, ...overrides })
  const unsupplied = new Set()

  it('leaves out the parameter already swept', () => {
    expect(isSweepableEntry(entry(), { unsupplied, sweep: { key: 'n1::g', type: 'constant', parameterName: 'g' } })).toBe(false)
    expect(isSweepableEntry(entry(), { unsupplied, sweep: { key: 'n1::k', type: 'constant', parameterName: 'k' } })).toBe(true)
  })

  it('leaves out the parameter the sweep’s curves vary', () => {
    const sweep = { key: 'n1::k', type: 'constant', parameterName: 'k', family: { key: 'n1::g', type: 'constant', parameterName: 'g' } }
    expect(isSweepableEntry(entry(), { unsupplied, sweep })).toBe(false)
  })

  it('leaves out a global constant already swept, from whichever instance', () => {
    const global = entry({ key: 'global::T', nodeId: 'n2', rowName: 'T', kind: 'global_constant' })
    expect(isSweepableEntry(global, { unsupplied, sweep: { key: 'n1::T', type: 'global_constant', parameterName: 'T' } })).toBe(false)
  })

  it('leaves out what the last run computed', () => {
    const variables = new Map([
      ['cell/g', { kind: 'computedConstant' }],
      ['cell/k', { kind: 'constant' }],
    ])
    expect(isSweepableEntry(entry({ reportedName: 'cell/g' }), { unsupplied, variables })).toBe(false)
    expect(isSweepableEntry(entry({ reportedName: 'cell/k' }), { unsupplied, variables })).toBe(true)
    // Not in the last run: the row type decides.
    expect(isSweepableEntry(entry(), { unsupplied, variables })).toBe(true)
  })
})

describe('createSweep', () => {
  it('spans half the value either side', () => {
    const sweep = createSweep(node('n1', 'cell', []), { name: 'V', type: 'boundary_condition', units: 'millivolt', value: '-80' }, () => null)
    expect(sweep).toMatchObject({ key: 'n1::V', nodeName: 'cell', parameterName: 'V', units: 'millivolt', from: -120, to: -40, points: 51 })
    expect(sweepLabel(sweep)).toBe('cell/V')
  })

  it('spans 0 to 1 for a value of 0 or none', () => {
    expect(createSweep(node('n1', 'cell', []), { name: 'k', type: 'constant', value: '0' }, () => null)).toMatchObject({ from: 0, to: 1 })
  })
})

describe('findSweepProblem', () => {
  const sweep = { parameterName: 'V', from: -100, to: 50, points: 16 }

  it('passes a complete sweep', () => {
    expect(findSweepProblem(sweep)).toBeNull()
  })

  it.each([
    [null, /choose a parameter/i],
    [{ ...sweep, from: null }, /start and end/],
    [{ ...sweep, to: 50, from: 50 }, /different value/],
    [{ ...sweep, points: 1 }, /from 2 to/],
    [{ ...sweep, points: MAX_SWEEP_POINTS + 1 }, /from 2 to/],
    [{ ...sweep, points: 2.5 }, /from 2 to/],
  ])('stops %j', (candidate, message) => {
    expect(findSweepProblem(candidate)).toMatch(message)
  })

  describe('with curves', () => {
    const family = { key: 'n1::Ko', nodeName: 'cell', parameterName: 'Ko', type: 'constant', values: [2, 5.4, 10] }
    const swept = { ...sweep, key: 'n1::V', nodeName: 'cell', type: 'constant', family }

    it('passes curves of another parameter, each at a value', () => {
      expect(findSweepProblem(swept)).toBeNull()
    })

    it.each([
      [{ ...family, parameterName: '' }, /choose a parameter for the curves/i],
      [{ ...family, key: 'n1::V', parameterName: 'V' }, /other than the swept cell\/V/],
      [{ ...family, values: [] }, /a value of cell\/Ko each/],
      [{ ...family, values: [1, Number.NaN] }, /a value of cell\/Ko each/],
      [{ ...family, values: Array.from({ length: MAX_FAMILY_VALUES + 1 }, (_, i) => i) }, /up to 8 values/],
    ])('stops curves %j', (candidate, message) => {
      expect(findSweepProblem({ ...swept, family: candidate })).toMatch(message)
    })

    it('stops more runs than a sweep can take', () => {
      const values = Array.from({ length: MAX_FAMILY_VALUES }, (_, i) => i)
      expect(findSweepProblem({ ...swept, points: MAX_SWEEP_POINTS, family: { ...family, values } })).toMatch(new RegExp(`up to ${MAX_SWEEP_RUNS}`))
    })
  })
})

describe('createFamily', () => {
  it('varies a row from just its own value, which more join', () => {
    const cell = node('n1', 'cell', [{ name: 'Ko', type: 'constant', units: 'mM', value: '5.4' }])
    expect(createFamily(cell, cell.data.variables[0], () => null)).toEqual({
      key: 'n1::Ko',
      nodeId: 'n1',
      nodeName: 'cell',
      parameterName: 'Ko',
      units: 'mM',
      type: 'constant',
      values: [5.4],
    })
  })

  it('lists its values once each, from the least up', () => {
    expect(familyValues({ values: [10, 2, 5.4, 2] })).toEqual([2, 5.4, 10])
  })
})

describe('splitFamily', () => {
  const results = (values, familyValues) => ({
    voi: { name: 'c/a', unit: '', values: Float64Array.of(1, 2, 3) },
    variables: new Map([['c/y', { kind: 'algebraic', unit: 'm', values: Float64Array.from(values) }]]),
    family: { name: 'c/b', unit: 'mM', values: familyValues },
  })

  it('gives a curve per value of the family’s parameter, the first as the results’ own', () => {
    const split = splitFamily(results([11, 12, 13, 21, 22, 23], [1, 2]))
    expect(split.family.curves.map(({ value, variables }) => [value, [...variables.get('c/y').values]])).toEqual([
      [1, [11, 12, 13]],
      [2, [21, 22, 23]],
    ])
    expect([...split.variables.get('c/y').values]).toEqual([11, 12, 13])
    expect(split.variables.get('c/y')).toMatchObject({ kind: 'algebraic', unit: 'm' })
  })

  it('leaves a curve cut short without values past the point it reached', () => {
    const split = splitFamily(results([11, 12, 13, 21], [1, 2]))
    expect(split.family.curves[1].variables.get('c/y').values).toEqual([21, null, null])
  })

  it('leaves a sweep without curves as it is', () => {
    const plain = { voi: { values: new Float64Array() }, variables: new Map() }
    expect(splitFamily(plain)).toBe(plain)
  })
})

describe('sweepValues', () => {
  it('spaces the values evenly, from the lower end up, ending exactly at the upper', () => {
    expect(sweepValues({ from: 0, to: 1, points: 5 })).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(sweepValues({ from: 50, to: -100, points: 4 })).toEqual([-100, -50, 0, 50])
    expect(sweepValues({ from: 0, to: 0.3, points: 4 }).at(-1)).toBe(0.3)
  })
})

describe('resolveSweepTarget', () => {
  const nodes = [
    node('n1', 'cell', [
      { name: 'V', type: 'boundary_condition' },
      { name: 'I', type: 'variable' },
      { name: 'g', type: 'global_constant' },
    ]),
  ]
  const mapping = new Map([
    ['n1::V', 'parameters/V'],
    ['n1::I', 'cell/I'],
    ['n1::g', 'global_parameters/g'],
  ])
  const variables = new Map([
    ['parameters/V', { kind: 'constant' }],
    ['cell/I', { kind: 'algebraic' }],
    ['global_parameters/g', { kind: 'constant' }],
  ])
  const resolve = (sweep) => resolveSweepTarget({ sweep, nodes, mapping, variables })

  it('names the constant libOpenCOR changes', () => {
    expect(resolve({ nodeId: 'n1', nodeName: 'cell', parameterName: 'V', type: 'boundary_condition' })).toEqual({ component: 'parameters', variable: 'V' })
  })

  it('finds a global constant through any instance using it', () => {
    expect(resolve({ nodeId: 'gone', nodeName: 'other', parameterName: 'g', type: 'global_constant' })).toEqual({
      component: 'global_parameters',
      variable: 'g',
    })
  })

  it('explains what a family’s curves can’t vary', () => {
    const family = { nodeId: 'n1', nodeName: 'cell', parameterName: 'I', type: 'constant' }
    expect(resolveSweepTarget({ sweep: family, role: 'varied across curves', nodes, mapping, variables }).problem).toMatch(
      /so it can’t be varied across curves\. Choose a parameter instead/
    )
  })

  it('explains what can’t be swept', () => {
    expect(resolve({ nodeId: 'n1', nodeName: 'cell', parameterName: 'I', type: 'constant' }).problem).toMatch(/computed by the model/)
    expect(resolve({ nodeId: 'n2', nodeName: 'other', parameterName: 'V', type: 'constant' }).problem).toMatch(/isn’t in the simulated instances/)
  })
})

describe('sweepReadout', () => {
  it('reads the sweep’s own reading, or the end for one saved without a reading it knows', () => {
    expect(sweepReadout({ readout: 'min' })).toBe('min')
    expect(sweepReadout({})).toBe('end')
    expect(sweepReadout({ readout: 'mean' })).toBe('end')
    expect(sweepReadout(null)).toBe('end')
  })
})

describe('findBoundarySweepProblem', () => {
  const port = { label: 'p', variables: ['V'] }
  const bcRow = { name: 'V', type: 'boundary_condition', value: '1' }
  const bc = { key: 'a::V', nodeId: 'a', nodeName: 'mem', parameterName: 'V', type: 'boundary_condition' }
  const constant = { key: 'b::g', nodeId: 'b', nodeName: 'cell', parameterName: 'g', type: 'constant' }
  // b computes the V that a's boundary condition takes.
  const connected = [node('a', 'mem', [bcRow]), node('b', 'cell', [{ name: 'V', type: 'variable' }, { name: 'g', type: 'constant', value: '1' }])]
  const edges = [{ id: 'e', source: 'b', target: 'a', data: { couplings: [{ sourcePort: port, targetPort: port }] } }]
  const problemOf = (sweep, nodes, scopeEdges = edges) =>
    findBoundarySweepProblem(sweep, { nodes, status: resolveBoundaryValues(nodes, scopeEdges).status })

  it('says when a connection in the scope supplies a swept boundary condition, or its family’s', () => {
    expect(problemOf(bc, connected)).toBe('mem/V is supplied through a connection in this run: simulate mem on its own to sweep it.')
    expect(problemOf({ ...constant, family: bc }, connected)).toBe(
      'mem/V is supplied through a connection in this run: simulate mem on its own to vary it across curves.'
    )
  })

  it('passes one nothing in the scope supplies, a constant, and one outside the scope', () => {
    expect(problemOf(bc, connected, [])).toBeNull()
    expect(problemOf(bc, [connected[0]], [])).toBeNull()
    expect(problemOf(constant, connected)).toBeNull()
    expect(problemOf(bc, [connected[1]], [])).toBeNull()
    expect(problemOf(null, connected)).toBeNull()
  })

  it('leaves a row since deleted or retyped to the other checks', () => {
    expect(problemOf(bc, [node('a', 'mem', []), connected[1]])).toBeNull()
    expect(problemOf(bc, [node('a', 'mem', [{ ...bcRow, type: 'constant' }]), connected[1]])).toBeNull()
  })

  it('passes one on a Sum port nothing is connected to', () => {
    const summed = { ...node('a', 'mem', [bcRow]), data: { name: 'mem', variables: [bcRow], ports: [{ label: 'in', variables: ['V'], multiportType: 'Sum' }] } }
    expect(problemOf(bc, [summed], [])).toBeNull()
  })
})

describe('scopeHasOde', () => {
  const analyses = new Map([
    ['ode', { voi: ['t'] }],
    ['algebraic', { voi: [] }],
  ])
  const getMathAnalysis = (mathRef) => analyses.get(mathRef) ?? null
  const withMath = (id, mathRef) => ({ id, data: { name: id, mathRef, variables: [] } })

  it('tells whether any of the scope’s math integrates over a VoI', () => {
    expect(scopeHasOde([withMath('a', 'algebraic'), withMath('b', 'ode')], getMathAnalysis)).toBe(true)
    expect(scopeHasOde([withMath('a', 'algebraic')], getMathAnalysis)).toBe(false)
    expect(scopeHasOde([], getMathAnalysis)).toBe(false)
  })

  it('can’t tell without every node’s analysis, unless one has ODEs', () => {
    expect(scopeHasOde([withMath('a', 'algebraic'), withMath('b', 'missing')], getMathAnalysis)).toBeNull()
    expect(scopeHasOde([withMath('a', 'missing'), withMath('b', 'ode')], getMathAnalysis)).toBe(true)
    expect(scopeHasOde([{ id: 'c', data: { name: 'c', variables: [] } }], getMathAnalysis)).toBeNull()
  })
})

describe('listSweptBoundaries', () => {
  it('lists the boundary conditions a sweep and its curves vary, and nothing else', () => {
    const bc = { nodeId: 'a', parameterName: 'v', type: 'boundary_condition' }
    expect(listSweptBoundaries(null)).toEqual(new Set())
    expect(listSweptBoundaries({ nodeId: 'a', parameterName: 'k', type: 'constant' })).toEqual(new Set())
    expect(listSweptBoundaries({ ...bc, family: { nodeId: 'b', parameterName: 'w', type: 'boundary_condition' } })).toEqual(new Set(['a::v', 'b::w']))
  })
})
